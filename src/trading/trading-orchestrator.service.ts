import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Market, OrderStatus, Prisma, WatchStockExecutionEventType } from '@prisma/client';
import { TradingService } from './trading.service';
import { MarketAnalysisService } from './market-analysis.service';
import { MarketRegimeService } from './market-regime.service';
import { RiskManagementService } from './risk-management.service';
import { StrategyRegistryService } from './strategy/strategy-registry.service';
import { OrderSyncService } from './order-sync.service';
import { MarketStateSyncService } from './market-state-sync.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import { getMarketHours } from '../kis/types/kis-config.types';
import { StockPriceResult, UnfilledOrder } from '../kis/types/kis-api.types';
import {
  StockStrategyContext,
  StockFundamentals,
  WatchStockConfig,
  PerStockTradingStrategy,
  StockIndicators,
  PositionQuantitySnapshot,
} from './types';
import { SlackService } from '../notification/slack.service';
import { SlackCommandsService } from '../notification/slack-commands.service';
import { summarizeEstimatePerform, summarizeInvestOpinion } from '../common/utils/consensus.util';
import { summarizeDividendSchedule } from '../common/utils/dividend.util';
import { pickNumeric } from '../common/utils/api-data.util';
import { MarketDataCacheService } from '../market-data/market-data-cache.service';
import { OpenDartDomesticSignals } from '../opendart/types';
import { SecFundamentals } from '../sec/types';

const DAILY_SUMMARY_SENT_KEY_PREFIX = 'daily-summary-sent';

type KstExecutionTime = {
  hour: number;
  minute: number;
};

/**
 * 시장별 거래 루프 오케스트레이터.
 * - 전략별 WatchStock 그룹 실행
 * - 종목 컨텍스트 빌드 (가격, 포지션, 지표, 재무 등)
 * - TradingService.executePerStockStrategy 호출
 * - 장중 리스크 알림 및 daily summary 전송
 * - 시장 레짐 감지 트리거
 * - 수동 실행 엔트리 (triggerWatchStockNow)
 */
@Injectable()
export class TradingOrchestrator {
  private readonly logger = new Logger(TradingOrchestrator.name);
  private readonly tradingEnabled: boolean;

  // 루프 중복 실행 방지용 mutex
  private isDomesticRunning = false;
  private isOverseasRunning = false;

  // 리스크 알림 중복 방지 (market → 마지막 알림 날짜)
  private lastRiskAlertDate: Record<string, string> = {};

  constructor(
    private tradingService: TradingService,
    private marketAnalysis: MarketAnalysisService,
    private marketRegimeService: MarketRegimeService,
    private riskManagement: RiskManagementService,
    private orderSyncService: OrderSyncService,
    private strategyRegistry: StrategyRegistryService,
    private marketStateSync: MarketStateSyncService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private prisma: PrismaService,
    private configService: ConfigService,
    private marketDataCache: MarketDataCacheService,
    @Optional() private slackService?: SlackService,
    @Optional() private slackCommandsService?: SlackCommandsService,
  ) {
    this.tradingEnabled = this.configService.get<boolean>('trading.enabled') ?? true;
  }

  // ========== 공개 엔트리 포인트 ==========

  async executeDomestic(): Promise<void> {
    if (!this.marketStateSync.isMarketOpen('KRX')) return;
    if (this.isDomesticRunning) return;
    this.isDomesticRunning = true;

    try {
      if (await this.marketStateSync.isHoliday('DOMESTIC')) return;
      await this.executeMarket('DOMESTIC', 'KRX');
    } catch (e) {
      this.logger.error(`Trading domestic error: ${e.message}`);
    } finally {
      this.isDomesticRunning = false;
    }
  }

  async executeOverseas(): Promise<void> {
    if (this.isOverseasRunning) return;
    this.isOverseasRunning = true;

    try {
      const watchStocks = await this.prisma.watchStock.findMany({
        where: { market: Market.OVERSEAS, isActive: true, NOT: { strategyName: null } },
      });

      const byExchange = new Map<string, typeof watchStocks>();
      for (const w of watchStocks) {
        const ex = w.exchangeCode;
        if (!byExchange.has(ex)) byExchange.set(ex, []);
        byExchange.get(ex)!.push(w);
      }

      for (const [exchangeCode, stocks] of byExchange) {
        if (!this.marketStateSync.isMarketOpen(exchangeCode)) continue;
        await this.executeMarket('OVERSEAS', exchangeCode, stocks);
      }
    } catch (e) {
      this.logger.error(`Trading overseas error: ${e.message}`);
    } finally {
      this.isOverseasRunning = false;
    }
  }

  isBusy(): boolean {
    return this.isDomesticRunning || this.isOverseasRunning;
  }

  /** 시장 레짐 판별 (cron 트리거용) */
  async runMarketRegimeDetection(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
  ): Promise<void> {
    this.logger.log(`=== Regime Detect ${exchangeCode}: triggered ===`);
    try {
      const regime = await this.marketRegimeService.detectAndSave(market, exchangeCode);
      this.logger.log(`${exchangeCode} Market Regime: ${regime}`);
    } catch (e) {
      this.logger.error(`Regime detect ${exchangeCode} error: ${e.message}`);
    }
  }

  /** 활성 관심종목이 있는 거래소에 대해서만 regime 감지 */
  async runMarketRegimeDetectionForExchanges(exchanges: string[]): Promise<void> {
    for (const ex of exchanges) {
      try {
        const hasStocks = await this.prisma.watchStock.count({
          where: { exchangeCode: ex, isActive: true },
        });
        if (hasStocks > 0) {
          await this.runMarketRegimeDetection('OVERSEAS', ex);
        }
      } catch (e) {
        this.logger.error(`Regime detect ${ex} error: ${e.message}`);
      }
    }
  }

  async triggerWatchStockNow(
    watchStockId: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.tradingEnabled) {
      return { success: false, message: '현재 환경에서는 실거래가 비활성화되어 수동 실행할 수 없습니다.' };
    }

    const watchStock = await this.prisma.watchStock.findUnique({
      where: { id: watchStockId },
    });

    if (!watchStock) {
      return { success: false, message: '관심종목을 찾을 수 없습니다.' };
    }

    if (!watchStock.isActive) {
      return { success: false, message: '비활성 관심종목은 수동 실행할 수 없습니다.' };
    }

    if (!watchStock.strategyName) {
      return { success: false, message: '전략이 설정되지 않은 관심종목입니다.' };
    }

    const strategy = this.strategyRegistry.getStrategy(watchStock.strategyName);
    if (!strategy) {
      return { success: false, message: `알 수 없는 전략입니다: ${watchStock.strategyName}` };
    }

    if (!this.marketStateSync.isMarketOpen(watchStock.exchangeCode)) {
      return { success: false, message: '현재 시장이 열려 있지 않아 수동 실행할 수 없습니다.' };
    }

    const market = watchStock.market as 'DOMESTIC' | 'OVERSEAS';
    if (watchStock.exchangeCode === 'KRX' && await this.marketStateSync.isExchangeHoliday(watchStock.exchangeCode)) {
      return { success: false, message: '현재 휴장일이라 수동 실행할 수 없습니다.' };
    }

    const openOrder = await this.prisma.tradeRecord.findFirst({
      where: {
        market: watchStock.market,
        exchangeCode: watchStock.exchangeCode,
        stockCode: watchStock.stockCode,
        strategyName: watchStock.strategyName,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (openOrder) {
      await this.prisma.watchStockExecutionLog.create({
        data: {
          watchStockId: watchStock.id,
          tradeRecordId: openOrder.id,
          market: watchStock.market,
          exchangeCode: watchStock.exchangeCode,
          stockCode: watchStock.stockCode,
          stockName: watchStock.stockName,
          strategyName: watchStock.strategyName,
          eventType: WatchStockExecutionEventType.SKIPPED,
          message: '열린 주문이 있어 수동 실행을 건너뜀',
          details: { orderNo: openOrder.orderNo, status: openOrder.status },
        },
      });
      return { success: false, message: '이미 열린 주문이 있어 중복 주문을 막았습니다.' };
    }

    const todayRange = this.getKstDayRange();
    const existingTrade = await this.prisma.tradeRecord.findFirst({
      where: {
        market: watchStock.market,
        exchangeCode: watchStock.exchangeCode,
        stockCode: watchStock.stockCode,
        strategyName: watchStock.strategyName,
        status: { in: [OrderStatus.FILLED, OrderStatus.PARTIAL] },
        createdAt: todayRange,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingTrade) {
      await this.prisma.watchStockExecutionLog.create({
        data: {
          watchStockId: watchStock.id,
          tradeRecordId: existingTrade.id,
          market: watchStock.market,
          exchangeCode: watchStock.exchangeCode,
          stockCode: watchStock.stockCode,
          stockName: watchStock.stockName,
          strategyName: watchStock.strategyName,
          eventType: WatchStockExecutionEventType.SKIPPED,
          message: '오늘 이미 체결된 주문이 있어 수동 실행을 건너뜀',
          details: { tradeRecordId: existingTrade.id },
        },
      });
      return { success: false, message: '오늘 이미 체결된 주문이 있어 중복 주문을 막았습니다.' };
    }

    const context = await this.buildManualExecutionContext(
      watchStock,
      strategy.name,
    );

    if (!context) {
      return { success: false, message: '수동 실행용 종목 컨텍스트를 만들지 못했습니다.' };
    }

    await this.tradingService.executePerStockStrategy(strategy, [context]);

    const latestLog = await this.prisma.watchStockExecutionLog.findFirst({
      where: { watchStockId: watchStock.id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      message: latestLog?.message || '수동 전략 실행을 완료했습니다.',
    };
  }

  // ========== 시장 루프 ==========

  /** 단일 시장(거래소) 실행 — 모든 전략을 한 루프에서 처리 */
  private async executeMarket(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
    preloadedStocks?: any[],
  ): Promise<void> {
    // 1. 관심종목 조회
    const watchStocks = preloadedStocks ?? await this.prisma.watchStock.findMany({
      where: { market: market as Market, isActive: true, NOT: { strategyName: null } },
    });

    if (watchStocks.length === 0) return;

    // 2. 공통 데이터 한 번만 조회
    const regime = await this.marketRegimeService.getRegime(market, exchangeCode);
    const riskState = await this.riskManagement.evaluateRisk(market);

    // 리스크 경고 Slack 알림 (같은 시장은 하루 1회만)
    const alertDate = this.getKSTDate();
    if (riskState.reasons.length > 0 && this.slackService?.isEnabled() && this.lastRiskAlertDate[market] !== alertDate) {
      this.lastRiskAlertDate[market] = alertDate;
      const latestSnapshot = await this.prisma.riskSnapshot.findFirst({
        where: { market: market as Market },
        orderBy: { createdAt: 'desc' },
      });
      this.slackService.sendRiskAlert({
        market,
        riskType: riskState.liquidateAll ? 'MDD_LIQUIDATE' : 'MDD_BUY_BLOCK',
        reasons: riskState.reasons,
        details: {
          drawdown: riskState.drawdown,
          peakValue: latestSnapshot ? Number(latestSnapshot.peakValue) : undefined,
          currentValue: latestSnapshot
            ? Number(latestSnapshot.portfolioValue)
            : undefined,
          dailyPnlRate: riskState.dailyPnlRate,
          positionCount: riskState.positionCount,
          investedRate: riskState.investedRate,
        },
      });
    }

    const marketCondition = await this.marketAnalysis.getMarketCondition(exchangeCode);

    const positions = await this.prisma.position.findMany({
      where: { market: market as Market },
    });

    await this.orderSyncService.syncMarketOrders(
      market,
      positions.map((position) => this.toPositionSnapshot(position)),
      { force: true },
    );

    const unfilledOrders = await this.marketStateSync.getUnfilledOrders(market);

    const totalPortfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );

    // 3. 전략별 그룹핑 및 실행 상태 계산
    const byStrategy = new Map<string, typeof watchStocks>();
    for (const ws of watchStocks) {
      const name = ws.strategyName!;
      if (!byStrategy.has(name)) byStrategy.set(name, []);
      byStrategy.get(name)!.push(ws);
    }

    const strategyStates = new Map<string, {
      strategy?: PerStockTradingStrategy;
      shouldExecute: boolean;
    }>();

    for (const strategyName of byStrategy.keys()) {
      const strategy = this.strategyRegistry.getStrategy(strategyName);
      if (!strategy) {
        strategyStates.set(strategyName, { strategy: undefined, shouldExecute: false });
        continue;
      }

      strategyStates.set(strategyName, {
        strategy,
        shouldExecute: this.shouldExecuteNow(strategy, market, exchangeCode),
      });
    }

    const executableOnceDailyStocks = watchStocks.filter((ws) => {
      const state = strategyStates.get(ws.strategyName!);
      return Boolean(
        state?.strategy
        && state.shouldExecute
        && state.strategy.executionMode.type === 'once-daily',
      );
    });

    const cancelableUnfilledOrders = executableOnceDailyStocks.length > 0
      ? await this.filterUnfilledOrdersForWatchStocks(market, executableOnceDailyStocks, unfilledOrders)
      : [];

    if (cancelableUnfilledOrders.length > 0) {
      await this.marketStateSync.cancelUnfilledOrders(market, cancelableUnfilledOrders);
    }

    const hasOnceDailyNow = executableOnceDailyStocks.length > 0;

    const today = this.getKSTDate();
    const investorTradeCache = new Map<string, Promise<any[] | undefined>>();
    const dividendScheduleCache = new Map<string, Promise<any[] | undefined>>();
    const investOpinionCache = new Map<string, Promise<any[] | undefined>>();
    const estimatePerformCache = new Map<string, Promise<any | undefined>>();
    const openDartCache = new Map<string, Promise<OpenDartDomesticSignals | undefined>>();
    const secFundamentalsCache = new Map<string, Promise<SecFundamentals | undefined>>();

    for (const [strategyName, stocks] of byStrategy) {
      const state = strategyStates.get(strategyName);
      const strategy = state?.strategy;
      if (!strategy) {
        this.logger.warn(`Unknown strategy: ${strategyName}`);
        continue;
      }

      // 실행 타이밍 체크
      if (!state?.shouldExecute) continue;

      // 5. 종목별 컨텍스트 빌드
      const contexts: StockStrategyContext[] = [];

      for (const ws of stocks) {
        try {
          const context = await this.buildStockStrategyContext({
            market,
            ws,
            strategyName,
            positions,
            totalPortfolioValue,
            marketCondition,
            marketRegime: regime,
            riskState,
            today,
            caches: {
              investorTrade: investorTradeCache,
              dividendSchedule: dividendScheduleCache,
              investOpinion: investOpinionCache,
              estimatePerform: estimatePerformCache,
              openDart: openDartCache,
              secFundamentals: secFundamentalsCache,
            },
          });
          if (context) contexts.push(context);
        } catch (e) {
          this.logger.error(`Error building context for ${ws.stockCode}: ${e.message}`);
        }
      }

      // 6. 전략 실행
      if (contexts.length > 0) {
        await this.tradingService.executePerStockStrategy(strategy, contexts);
      }
    }

    // 7. 리스크 스냅샷 저장
    let cashAvailable = 0;
    try {
      if (market === 'DOMESTIC') {
        const buyable = await this.kisDomestic.getBuyableAmount();
        cashAvailable = buyable.cashAvailable;
      } else {
        const firstStock = watchStocks[0];
        if (firstStock) {
          const buyable = await this.kisOverseas.getBuyableAmount(
            firstStock.exchangeCode,
            firstStock.stockCode,
            1,
          );
          cashAvailable = buyable.foreignCurrencyAvailable;
        }
      }
    } catch { /* ignore */ }

    await this.riskManagement.saveRiskSnapshot(market, totalPortfolioValue, cashAvailable);

    // 8. Daily summary (once-daily 전략 실행 시각에만)
    if (hasOnceDailyNow && this.slackService?.isEnabled() && this.slackCommandsService) {
      const summaryDate = this.getKSTDate();
      const claimed = await this.claimDailySummary(summaryDate, market, exchangeCode);

      if (claimed) {
        try {
          const summary = await this.slackCommandsService.buildDailySummary();
          if ((summary.marketSummaries?.length ?? 0) === 0) {
            this.logger.debug(`Skipping daily summary for ${summaryDate} because there are no held positions`);
            return;
          }

          const sent = await this.slackService.sendDailySummary(summary);
          if (!sent) {
            await this.releaseDailySummaryClaim(summaryDate);
            this.logger.warn(`Daily summary was not sent for ${summaryDate}; claim released for retry`);
          }
        } catch (e) {
          await this.releaseDailySummaryClaim(summaryDate);
          this.logger.warn(`Failed to send daily summary to Slack: ${e.message}`);
        }
      } else {
        this.logger.debug(`Daily summary already sent for ${summaryDate}, skipping`);
      }
    }
  }

  // ========== 컨텍스트 빌드 ==========

  private async buildStockStrategyContext(args: {
    market: 'DOMESTIC' | 'OVERSEAS';
    ws: any;
    strategyName: string;
    positions: any[];
    totalPortfolioValue: number;
    marketCondition: any;
    marketRegime: any;
    riskState: any;
    today: string;
    caches: {
      investorTrade: Map<string, Promise<any[] | undefined>>;
      dividendSchedule: Map<string, Promise<any[] | undefined>>;
      investOpinion: Map<string, Promise<any[] | undefined>>;
      estimatePerform: Map<string, Promise<any | undefined>>;
      openDart: Map<string, Promise<OpenDartDomesticSignals | undefined>>;
      secFundamentals: Map<string, Promise<SecFundamentals | undefined>>;
    };
  }): Promise<StockStrategyContext | null> {
    const { market, ws, strategyName, positions, totalPortfolioValue, marketCondition, marketRegime, riskState, today, caches } = args;

    const price = market === 'DOMESTIC'
      ? await this.kisDomestic.getPrice(ws.stockCode)
      : await this.kisOverseas.getPrice(ws.exchangeCode, ws.stockCode);

    const pos = positions.find((p) => p.stockCode === ws.stockCode);

    const stockIndicators = await this.marketAnalysis.getStockIndicators(
      market, ws.exchangeCode, ws.stockCode, price.currentPrice,
    );

    this.applyPriceApiIndicators(stockIndicators, price);

    let buyableAmount = 0;
    let buyableMeta: StockStrategyContext['buyableMeta'] | undefined;
    if (market === 'DOMESTIC') {
      try {
        const buyable = await this.kisDomestic.getBuyableAmount();
        buyableAmount = buyable.cashAvailable;
        buyableMeta = {
          source: 'KIS_DOMESTIC_BUYABLE_AMOUNT',
        };
      } catch (e) {
        this.logger.warn(`Failed to get domestic buyable amount: ${e.message}`);
      }
    } else {
      try {
        const buyable = await this.kisOverseas.getBuyableAmount(
          ws.exchangeCode, ws.stockCode, price.currentPrice,
        );
        buyableAmount = buyable.foreignCurrencyAvailable;
        buyableMeta = {
          source: 'KIS_OVERSEAS_INQUIRE_PSAMOUNT',
          maxQuantity: buyable.maxQuantity,
          priceUsed: price.currentPrice,
        };
      } catch (e) {
        this.logger.warn(`Failed to get buyable amount for ${ws.stockCode}: ${e.message}`);
      }
    }

    // 오늘 해당 종목+전략으로 이미 체결된 매매가 있는지 확인
    const todayStart = new Date(today + 'T00:00:00');
    const todayEnd = new Date(today + 'T23:59:59');
    const existingTrade = await this.prisma.tradeRecord.findFirst({
      where: {
        stockCode: ws.stockCode,
        strategyName,
        status: { in: [OrderStatus.FILLED, OrderStatus.PARTIAL] },
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });

    const watchStockConfig: WatchStockConfig = {
      id: ws.id,
      market,
      exchangeCode: ws.exchangeCode,
      stockCode: ws.stockCode,
      stockName: ws.stockName,
      strategyName: ws.strategyName || undefined,
      quota: ws.quota ? Number(ws.quota) : undefined,
      cycle: ws.cycle,
      maxCycles: ws.maxCycles,
      stopLossRate: Number(ws.stopLossRate),
      maxPortfolioRate: Number(ws.maxPortfolioRate),
      strategyParams: ws.strategyParams as Record<string, any> | undefined,
    };

    // 밸류 팩터 전략일 때만 재무 데이터 조회 (API 호출 최소화)
    let fundamentals: StockFundamentals | undefined;
    if (strategyName === 'value-factor') {
      fundamentals = await this.fetchFundamentals(market, ws.exchangeCode, ws.stockCode, price);
    }

    if (market === 'DOMESTIC' && this.needsOpenDartSignals(strategyName)) {
      const openDartSignals = await this.getCachedValue(
        caches.openDart,
        ws.stockCode,
        () => this.marketDataCache.getOpenDartDomesticSignals(ws.stockCode),
      );
      this.applyOpenDartSignals(stockIndicators, openDartSignals);
    }

    if (market === 'OVERSEAS' && this.needsSecSignals(strategyName)) {
      const secKey = `${ws.exchangeCode}:${ws.stockCode}`;
      const secFundamentals = await this.getCachedValue(
        caches.secFundamentals,
        secKey,
        () => this.marketDataCache.getSecFundamentals(ws.stockCode, price.currentPrice, ws.exchangeCode),
      );
      this.applySecSignals(stockIndicators, secFundamentals);
      if (strategyName === 'value-factor') {
        fundamentals = this.mergeSecFundamentals(fundamentals, secFundamentals);
      }
    }

    if (market === 'DOMESTIC' && this.needsInvestorFlow(strategyName)) {
      const investorTradeDaily = await this.getCachedValue(
        caches.investorTrade,
        ws.stockCode,
        () => this.marketDataCache.getKisDomesticInvestorTradeDaily(ws.stockCode),
      );
      this.applyInvestorTradeSignals(stockIndicators, investorTradeDaily);
    }

    if (market === 'DOMESTIC' && (this.needsDividendSignals(strategyName) || this.needsConsensusSignals(strategyName))) {
      const [dividendSchedule, investOpinion, estimatePerform] = await Promise.all([
        this.needsDividendSignals(strategyName)
          ? this.getCachedValue(
              caches.dividendSchedule,
              ws.stockCode,
              () => this.marketDataCache.getKisDomesticDividendSchedule(ws.stockCode),
            )
          : Promise.resolve(undefined),
        this.needsConsensusSignals(strategyName)
          ? this.getCachedValue(
              caches.investOpinion,
              ws.stockCode,
              () => this.marketDataCache.getKisDomesticInvestOpinion(ws.stockCode),
            )
          : Promise.resolve(undefined),
        this.needsConsensusSignals(strategyName)
          ? this.getCachedValue(
              caches.estimatePerform,
              ws.stockCode,
              () => this.marketDataCache.getKisDomesticEstimatePerform(ws.stockCode),
            )
          : Promise.resolve(undefined),
      ]);
      if (this.needsDividendSignals(strategyName)) {
        this.applyDividendSignals(
          stockIndicators,
          dividendSchedule,
          price.currentPrice,
          fundamentals?.dividendPayoutRate,
          fundamentals?.eps,
        );
      }
      if (this.needsConsensusSignals(strategyName)) {
        this.applyConsensusSignals(stockIndicators, investOpinion, estimatePerform, price.currentPrice);
      }
    }

    return {
      watchStock: watchStockConfig,
      price,
      position: pos ? {
        stockCode: pos.stockCode,
        quantity: pos.quantity,
        avgPrice: Number(pos.avgPrice),
        currentPrice: Number(pos.currentPrice),
        totalInvested: Number(pos.totalInvested),
      } : undefined,
      alreadyExecutedToday: !!existingTrade,
      marketCondition,
      stockIndicators,
      fundamentals,
      buyableAmount,
      buyableMeta,
      totalPortfolioValue,
      marketRegime,
      riskState,
    };
  }

  private async buildManualExecutionContext(
    ws: {
      id: string;
      market: Market;
      exchangeCode: string;
      stockCode: string;
      stockName: string;
      strategyName: string | null;
      quota: Prisma.Decimal | null;
      cycle: number;
      maxCycles: number;
      stopLossRate: Prisma.Decimal;
      maxPortfolioRate: Prisma.Decimal;
      strategyParams: Prisma.JsonValue | null;
    },
    strategyName: string,
  ): Promise<StockStrategyContext | null> {
    const market = ws.market as 'DOMESTIC' | 'OVERSEAS';

    const marketCondition = await this.marketAnalysis.getMarketCondition(ws.exchangeCode);
    const regime = await this.marketRegimeService.getRegime(market, ws.exchangeCode);
    const riskState = await this.riskManagement.evaluateRisk(market);

    // 수동 실행 전 최신 포지션 동기화
    await this.marketStateSync.syncMarketPortfolioOnly(market);

    const positions = await this.prisma.position.findMany({
      where: { market: ws.market },
    });

    const totalPortfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );

    const price = market === 'DOMESTIC'
      ? await this.kisDomestic.getPrice(ws.stockCode)
      : await this.kisOverseas.getPrice(ws.exchangeCode, ws.stockCode);

    const pos = positions.find((p) => p.stockCode === ws.stockCode && p.exchangeCode === ws.exchangeCode);

    const stockIndicators = await this.marketAnalysis.getStockIndicators(
      market,
      ws.exchangeCode,
      ws.stockCode,
      price.currentPrice,
    );

    this.applyPriceApiIndicators(stockIndicators, price);

    let buyableAmount = 0;
    let buyableMeta: StockStrategyContext['buyableMeta'] | undefined;
    if (market === 'DOMESTIC') {
      const buyable = await this.kisDomestic.getBuyableAmount();
      buyableAmount = buyable.cashAvailable;
      buyableMeta = {
        source: 'KIS_DOMESTIC_BUYABLE_AMOUNT',
      };
    } else {
      const buyable = await this.kisOverseas.getBuyableAmount(
        ws.exchangeCode,
        ws.stockCode,
        price.currentPrice,
      );
      buyableAmount = buyable.foreignCurrencyAvailable;
      buyableMeta = {
        source: 'KIS_OVERSEAS_INQUIRE_PSAMOUNT',
        maxQuantity: buyable.maxQuantity,
        priceUsed: price.currentPrice,
      };
    }

    let fundamentals: StockFundamentals | undefined;
    if (strategyName === 'value-factor') {
      fundamentals = await this.fetchFundamentals(market, ws.exchangeCode, ws.stockCode, price);
    }

    if (market === 'DOMESTIC' && this.needsOpenDartSignals(strategyName)) {
      const openDartSignals = await this.marketDataCache.getOpenDartDomesticSignals(ws.stockCode);
      this.applyOpenDartSignals(stockIndicators, openDartSignals);
    }

    if (market === 'OVERSEAS' && this.needsSecSignals(strategyName)) {
      const secFundamentals = await this.marketDataCache.getSecFundamentals(
        ws.stockCode,
        price.currentPrice,
        ws.exchangeCode,
      );
      this.applySecSignals(stockIndicators, secFundamentals);
      if (strategyName === 'value-factor') {
        fundamentals = this.mergeSecFundamentals(fundamentals, secFundamentals);
      }
    }

    if (market === 'DOMESTIC' && this.needsInvestorFlow(strategyName)) {
      const investorTradeDaily = await this.marketDataCache.getKisDomesticInvestorTradeDaily(ws.stockCode);
      this.applyInvestorTradeSignals(stockIndicators, investorTradeDaily);
    }

    if (market === 'DOMESTIC' && (this.needsDividendSignals(strategyName) || this.needsConsensusSignals(strategyName))) {
      const [dividendSchedule, investOpinion, estimatePerform] = await Promise.all([
        this.needsDividendSignals(strategyName)
          ? this.marketDataCache.getKisDomesticDividendSchedule(ws.stockCode)
          : Promise.resolve(undefined),
        this.needsConsensusSignals(strategyName)
          ? this.marketDataCache.getKisDomesticInvestOpinion(ws.stockCode)
          : Promise.resolve(undefined),
        this.needsConsensusSignals(strategyName)
          ? this.marketDataCache.getKisDomesticEstimatePerform(ws.stockCode)
          : Promise.resolve(undefined),
      ]);

      if (this.needsDividendSignals(strategyName)) {
        this.applyDividendSignals(
          stockIndicators,
          dividendSchedule,
          price.currentPrice,
          fundamentals?.dividendPayoutRate,
          fundamentals?.eps,
        );
      }

      if (this.needsConsensusSignals(strategyName)) {
        this.applyConsensusSignals(stockIndicators, investOpinion, estimatePerform, price.currentPrice);
      }
    }

    return {
      watchStock: {
        id: ws.id,
        market,
        exchangeCode: ws.exchangeCode,
        stockCode: ws.stockCode,
        stockName: ws.stockName,
        strategyName: ws.strategyName || undefined,
        quota: ws.quota ? Number(ws.quota) : undefined,
        cycle: ws.cycle,
        maxCycles: ws.maxCycles,
        stopLossRate: Number(ws.stopLossRate),
        maxPortfolioRate: Number(ws.maxPortfolioRate),
        strategyParams: ws.strategyParams as Record<string, any> | undefined,
      },
      price,
      position: pos ? {
        stockCode: pos.stockCode,
        quantity: pos.quantity,
        avgPrice: Number(pos.avgPrice),
        currentPrice: Number(pos.currentPrice),
        totalInvested: Number(pos.totalInvested),
      } : undefined,
      alreadyExecutedToday: false,
      marketCondition,
      stockIndicators,
      fundamentals,
      buyableAmount,
      buyableMeta,
      totalPortfolioValue,
      marketRegime: regime,
      riskState,
    };
  }

  private applyPriceApiIndicators(stockIndicators: StockIndicators, price: StockPriceResult): void {
    stockIndicators.foreignHoldRate = price.foreignHoldRate;
    stockIndicators.foreignNetBuyQty = price.foreignNetBuyQty;
    stockIndicators.w52High = price.w52High;
    stockIndicators.w52Low = price.w52Low;
    stockIndicators.investCautionYn = price.investCautionYn;
    stockIndicators.marketWarnCode = price.marketWarnCode;
    stockIndicators.shortOverheatYn = price.shortOverheatYn;
    stockIndicators.d250High = price.d250High;
    stockIndicators.d250Low = price.d250Low;
    stockIndicators.d250HighRate = price.d250HighRate;
    stockIndicators.d250LowRate = price.d250LowRate;
    stockIndicators.yearHigh = price.yearHigh;
    stockIndicators.yearLow = price.yearLow;
    stockIndicators.yearHighRate = price.yearHighRate;
    stockIndicators.yearLowRate = price.yearLowRate;
    stockIndicators.marketCap = price.marketCap;
    stockIndicators.loanBalanceRate = price.loanBalanceRate;
    stockIndicators.shortSellable = price.shortSellable;
  }

  // ========== 타이밍 판단 ==========

  private shouldExecuteNow(strategy: PerStockTradingStrategy, market: 'DOMESTIC' | 'OVERSEAS', exchangeCode: string): boolean {
    const mode = strategy.executionMode;

    if (mode.type === 'continuous') return true;

    const now = this.getKSTTime();
    const target = market === 'DOMESTIC'
      ? { hour: mode.hours.domestic, minute: 0 }
      : this.getOverseasExecutionTime(exchangeCode, mode.hours.overseas);

    return now.hour === target.hour && now.minute === target.minute;
  }

  /** 거래소 장 시간 기준으로 KST 실행 시각 계산 */
  private getOverseasExecutionTime(
    exchangeCode: string,
    overseas: { basis: 'afterOpen' | 'beforeClose'; offsetHours: number },
  ): KstExecutionTime {
    const hours = getMarketHours(exchangeCode);
    if (!hours) {
      return {
        hour: (overseas.offsetHours + 24) % 24,
        minute: 0,
      };
    }

    if (overseas.basis === 'afterOpen') {
      return {
        hour: (hours.open.hour + overseas.offsetHours) % 24,
        minute: hours.open.minute,
      };
    }

    // beforeClose: 장 마감 시각에서 offset만큼 빼기
    const closeHour = hours.overnight
      ? hours.close.hour + 24 // 미국: 06 → 30
      : hours.close.hour;

    return {
      hour: ((closeHour - overseas.offsetHours) % 24 + 24) % 24,
      minute: hours.close.minute,
    };
  }

  // ========== 미체결 주문 필터 ==========

  private async filterUnfilledOrdersForWatchStocks(
    market: 'DOMESTIC' | 'OVERSEAS',
    watchStocks: Array<{
      exchangeCode: string;
      stockCode: string;
      strategyName: string | null;
    }>,
    orders: UnfilledOrder[],
  ): Promise<UnfilledOrder[]> {
    const orderNos = orders
      .map((order) => order.orderNo)
      .filter((orderNo): orderNo is string => Boolean(orderNo));

    if (orderNos.length === 0 || watchStocks.length === 0) {
      return [];
    }

    const openRecords = await this.prisma.tradeRecord.findMany({
      where: {
        market: market as Market,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
        orderNo: { in: orderNos },
        OR: watchStocks
          .filter(
            (
              watchStock,
            ): watchStock is { exchangeCode: string; stockCode: string; strategyName: string } =>
              Boolean(watchStock.strategyName),
          )
          .map((watchStock) => ({
            exchangeCode: watchStock.exchangeCode,
            stockCode: watchStock.stockCode,
            strategyName: watchStock.strategyName,
          })),
      },
      select: {
        orderNo: true,
      },
    });

    const cancelableOrderNos = new Set(
      openRecords
        .map((record) => record.orderNo)
        .filter((orderNo): orderNo is string => Boolean(orderNo)),
    );

    return orders.filter((order) => cancelableOrderNos.has(order.orderNo));
  }

  // ========== 재무 데이터 조회 ==========

  private needsInvestorFlow(strategyName: string): boolean {
    return ['momentum-breakout', 'trend-following', 'conservative', 'infinite-buy'].includes(strategyName);
  }

  private needsDividendSignals(strategyName: string): boolean {
    return ['infinite-buy', 'value-factor'].includes(strategyName);
  }

  private needsConsensusSignals(strategyName: string): boolean {
    return ['trend-following', 'value-factor', 'infinite-buy'].includes(strategyName);
  }

  private needsOpenDartSignals(strategyName: string): boolean {
    return ['infinite-buy', 'conservative'].includes(strategyName);
  }

  private needsSecSignals(strategyName: string): boolean {
    return ['value-factor', 'infinite-buy', 'conservative'].includes(strategyName);
  }

  private async getCachedValue<T>(
    cache: Map<string, Promise<T>>,
    key: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    if (!cache.has(key)) {
      cache.set(key, loader());
    }
    return cache.get(key)!;
  }

  private applyInvestorTradeSignals(stockIndicators: StockIndicators, rows: any[] | undefined): void {
    const latestInvestor = rows?.[0];
    const foreignNetQty = pickNumeric(latestInvestor, ['frgn_ntby_qty', 'foreign_net_buy_qty']);
    const institutionNetQty = pickNumeric(latestInvestor, ['orgn_ntby_qty', 'institution_net_buy_qty']);
    const trustNetQty = pickNumeric(latestInvestor, ['ivtr_ntby_qty', 'trust_net_buy_qty']);
    const fundNetQty = pickNumeric(latestInvestor, ['fund_ntby_qty', 'fund_net_buy_qty']);

    if (foreignNetQty !== undefined) stockIndicators.foreignNetBuy = foreignNetQty > 0;
    if (institutionNetQty !== undefined) stockIndicators.institutionNetBuy = institutionNetQty > 0;
    if (trustNetQty !== undefined) stockIndicators.trustNetBuy = trustNetQty > 0;
    if (fundNetQty !== undefined) stockIndicators.fundNetBuy = fundNetQty > 0;

    stockIndicators.foreignNetBuyAmount = pickNumeric(
      latestInvestor,
      ['frgn_ntby_tr_pbmn', 'foreign_net_buy_amount'],
    );
    stockIndicators.foreignNetBuyStreak = this.estimateNetBuyStreak(
      rows,
      ['frgn_ntby_qty', 'foreign_net_buy_qty'],
    );
    stockIndicators.programTradeDirection = this.estimateProgramTradeDirection(rows);
  }

  private applyDividendSignals(
    stockIndicators: StockIndicators,
    dividendSchedule: any[] | undefined,
    currentPrice: number,
    basePayoutRatio?: number,
    eps?: number,
  ): void {
    const scheduleSummary = summarizeDividendSchedule(dividendSchedule);
    stockIndicators.consecutiveDividendYears = scheduleSummary.consecutiveDividendYears;
    stockIndicators.dividendGrowthRate = scheduleSummary.dividendGrowthRate5y;

    if (scheduleSummary.latestAnnualDividendAmount && currentPrice > 0) {
      stockIndicators.dividendYield = (scheduleSummary.latestAnnualDividendAmount / currentPrice) * 100;
    }

    const payoutRatio = (basePayoutRatio && basePayoutRatio > 0)
      ? basePayoutRatio
      : (scheduleSummary.latestAnnualDividendAmount && eps && eps > 0)
          ? (scheduleSummary.latestAnnualDividendAmount / eps) * 100
          : undefined;
    stockIndicators.payoutRatio = payoutRatio;
  }

  private applyConsensusSignals(
    stockIndicators: StockIndicators,
    investOpinion: any[] | undefined,
    estimatePerform: any,
    currentPrice: number,
  ): void {
    const opinionSummary = summarizeInvestOpinion(investOpinion);
    const estimateSummary = summarizeEstimatePerform(estimatePerform);

    stockIndicators.targetPrice = opinionSummary.targetPrice;
    stockIndicators.consensusRating = opinionSummary.rating ?? estimateSummary.rating;
    stockIndicators.analystCount = opinionSummary.analystCount;
    stockIndicators.earningsSurprise = estimateSummary.earningsSurprise;
    stockIndicators.estimatedEps = estimateSummary.estimatedEps;
    stockIndicators.estimatedPer = estimateSummary.estimatedPer;

    if (opinionSummary.targetPrice && currentPrice > 0) {
      stockIndicators.targetPriceUpside = ((opinionSummary.targetPrice - currentPrice) / currentPrice) * 100;
    }
  }

  private applyOpenDartSignals(
    stockIndicators: StockIndicators,
    openDartSignals: OpenDartDomesticSignals | undefined,
  ): void {
    if (!openDartSignals) return;
    stockIndicators.recentDisclosureCount30d = openDartSignals.recentDisclosureCount30d;
    stockIndicators.recentPeriodicDisclosureCount30d = openDartSignals.recentPeriodicDisclosureCount30d;
    stockIndicators.recentMaterialDisclosureCount30d = openDartSignals.recentMaterialDisclosureCount30d;
    stockIndicators.lastDisclosureDate = openDartSignals.lastDisclosureDate;
    stockIndicators.lastDisclosureTitle = openDartSignals.lastDisclosureTitle;
    stockIndicators.insiderOwnershipRate = openDartSignals.insiderOwnershipRate;
    stockIndicators.insiderOwnershipChangeRate = openDartSignals.insiderOwnershipChangeRate;
    stockIndicators.latestOwnershipReportDate = openDartSignals.latestOwnershipReportDate;
  }

  private applySecSignals(
    stockIndicators: StockIndicators,
    secFundamentals: SecFundamentals | undefined,
  ): void {
    if (!secFundamentals) return;
    stockIndicators.dividendYield = secFundamentals.dividendYield ?? stockIndicators.dividendYield;
    stockIndicators.payoutRatio = secFundamentals.payoutRatio ?? stockIndicators.payoutRatio;
    stockIndicators.latestSecFilingDate = secFundamentals.latestFilingDate;
    stockIndicators.latestSecFilingForm = secFundamentals.latestFilingForm;
    stockIndicators.latestSecPeriodicFilingDate = secFundamentals.latestPeriodicFilingDate;
    stockIndicators.latestSecPeriodicFilingForm = secFundamentals.latestPeriodicFilingForm;
    stockIndicators.recentSecForm8KCount30d = secFundamentals.recentForm8KCount30d;
    stockIndicators.secPeriodicReportAgeDays = secFundamentals.secPeriodicReportAgeDays;
  }

  private mergeSecFundamentals(
    fundamentals: StockFundamentals | undefined,
    secFundamentals: SecFundamentals | undefined,
  ): StockFundamentals | undefined {
    if (!fundamentals && !secFundamentals) return undefined;
    return {
      ...fundamentals,
      debtRatio: secFundamentals?.debtRatio ?? fundamentals?.debtRatio,
      eps: fundamentals?.eps,
      salesGrowthRate: secFundamentals?.revenueGrowthRate ?? fundamentals?.salesGrowthRate,
      operatingProfitGrowthRate: secFundamentals?.operatingProfitGrowthRate ?? fundamentals?.operatingProfitGrowthRate,
      dividendPayoutRate: secFundamentals?.payoutRatio ?? fundamentals?.dividendPayoutRate,
    };
  }

  private estimateNetBuyStreak(rows: any[] | undefined, keys: string[]): number | undefined {
    if (!rows?.length) return undefined;
    let streak = 0;
    for (const row of rows) {
      const value = pickNumeric(row, keys) ?? 0;
      if (value > 0) streak += 1;
      else break;
    }
    return streak || undefined;
  }

  private estimateProgramTradeDirection(rows: any[] | undefined): 'BUY' | 'SELL' | undefined {
    const value = pickNumeric(rows?.[0], ['pgtr_ntby_qty', 'program_net_buy_qty', '프로그램순매수']);
    if (value === undefined) return undefined;
    return value >= 0 ? 'BUY' : 'SELL';
  }

  private async fetchFundamentals(
    market: string,
    exchangeCode: string,
    stockCode: string,
    price: StockPriceResult,
  ): Promise<StockFundamentals | undefined> {
    try {
      if (market === 'DOMESTIC') {
        const fundamentals: StockFundamentals = {
          per: price.per,
          pbr: price.pbr,
        };

        const rows = await this.marketDataCache.getKisDomesticFinancialRatio(stockCode);
        if (rows.length > 0) {
          const latest = rows[0];
          fundamentals.roe = parseFloat(latest.roe_val) || undefined;
          fundamentals.debtRatio = parseFloat(latest.lblt_rate) || undefined;
          const eps = parseFloat(latest.eps);
          fundamentals.eps = isNaN(eps) ? undefined : eps;
          const grs = parseFloat(latest.grs);
          fundamentals.salesGrowthRate = isNaN(grs) ? undefined : grs;
          const bsopInrt = parseFloat(latest.bsop_prfi_inrt);
          fundamentals.operatingProfitGrowthRate = isNaN(bsopInrt) ? undefined : bsopInrt;
        }

        try {
          const otherRows = await this.marketDataCache.getKisDomesticOtherMajorRatios(stockCode);
          if (otherRows.length > 0) {
            const latest = otherRows[0];
            const evEbitda = parseFloat(latest.ev_ebitda);
            fundamentals.evEbitda = isNaN(evEbitda) || evEbitda === 0 ? undefined : evEbitda;
            const payout = parseFloat(latest.payout_rate);
            fundamentals.dividendPayoutRate = isNaN(payout) ? undefined : payout;
          }
        } catch (e) {
          this.logger.debug(`Failed to fetch other-major-ratios for ${stockCode}: ${e.message}`);
        }

        return fundamentals;
      }
      if (price.per || price.pbr || price.eps) {
        const fundamentals: StockFundamentals = {
          per: price.per,
          pbr: price.pbr,
          eps: price.eps,
        };
        const secFundamentals = await this.marketDataCache.getSecFundamentals(
          stockCode,
          price.currentPrice,
          exchangeCode,
        );
        return this.mergeSecFundamentals(fundamentals, secFundamentals);
      }
      return undefined;
    } catch (e) {
      this.logger.warn(`Failed to fetch fundamentals for ${stockCode}: ${e.message}`);
      return undefined;
    }
  }

  // ========== 유틸 ==========

  private getKSTTime(): KstExecutionTime {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return {
      hour: kst.getUTCHours(),
      minute: kst.getUTCMinutes(),
    };
  }

  private getKSTDate(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private getKstDayRange(): { gte: Date; lte: Date } {
    const today = this.getKSTDate();
    return {
      gte: new Date(`${today}T00:00:00+09:00`),
      lte: new Date(`${today}T23:59:59.999+09:00`),
    };
  }

  private toPositionSnapshot(position: {
    market: Market;
    exchangeCode: string;
    stockCode: string;
    quantity: number;
  }): PositionQuantitySnapshot {
    return {
      market: position.market as 'DOMESTIC' | 'OVERSEAS',
      exchangeCode: position.exchangeCode,
      stockCode: position.stockCode,
      quantity: position.quantity,
    };
  }

  // ========== Daily summary claim ==========

  private getDailySummarySentKey(date: string): string {
    return `${DAILY_SUMMARY_SENT_KEY_PREFIX}:${date}`;
  }

  private async claimDailySummary(
    date: string,
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
  ): Promise<boolean> {
    try {
      await this.prisma.appSetting.create({
        data: {
          key: this.getDailySummarySentKey(date),
          value: {
            date,
            market,
            exchangeCode,
            claimedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false;
      }

      this.logger.warn(`Failed to claim daily summary for ${date}: ${e.message}`);
      return true;
    }
  }

  private async releaseDailySummaryClaim(date: string): Promise<void> {
    try {
      await this.prisma.appSetting.delete({
        where: { key: this.getDailySummarySentKey(date) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return;
      }

      this.logger.warn(`Failed to release daily summary claim for ${date}: ${e.message}`);
    }
  }
}
