import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Broker,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  Prisma,
  Side,
  WatchStockExecutionEventType,
} from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
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
import { StockPriceResult } from '../kis/types/kis-api.types';
import {
  BrokerScopedUnfilledOrder,
  StockStrategyContext,
  StockFundamentals,
  WatchStockConfig,
  PerStockTradingStrategy,
  StockIndicators,
  PositionQuantitySnapshot,
  DailySummaryScope,
  WatchStockExecutionPreviewResult,
} from './types';
import { SlackService } from '../notification/slack.service';
import { TradingSlackCommandsService } from './trading-slack-commands.service';
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

  // broker×market 실행 단위별 중복 주문 방지 mutex
  private readonly runningBrokerMarkets = new Set<string>();

  // 리스크 알림 중복 방지 (broker×market → 마지막 알림 날짜)
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
    private readonly registry: BrokerPortRegistry,
    private prisma: PrismaService,
    private configService: ConfigService,
    private marketDataCache: MarketDataCacheService,
    @Optional() private slackService?: SlackService,
    @Optional() private tradingSlackCommandsService?: TradingSlackCommandsService,
  ) {
    this.tradingEnabled = this.configService.get<boolean>('trading.enabled') === true;
  }

  // ========== 공개 엔트리 포인트 ==========

  async executeDomestic(): Promise<void> {
    if (!this.marketStateSync.isMarketOpen('KRX')) return;

    try {
      if (await this.marketStateSync.isHoliday('DOMESTIC')) return;
      await this.executeMarket('DOMESTIC', 'KRX');
    } catch (e) {
      this.logger.error(`Trading domestic error: ${e.message}`);
    }
  }

  async executeOverseas(): Promise<void> {
    try {
      const watchStocks = await this.prisma.watchStock.findMany({
        where: { market: Market.OVERSEAS, isActive: true, NOT: { strategyName: null } },
      });
      await this.executeBrokerGroups('OVERSEAS', watchStocks, async (broker, stocks) => {
        const byExchange = new Map<string, typeof stocks>();
        for (const stock of stocks) {
          if (!byExchange.has(stock.exchangeCode)) byExchange.set(stock.exchangeCode, []);
          byExchange.get(stock.exchangeCode)!.push(stock);
        }
        for (const [exchangeCode, exchangeStocks] of byExchange) {
          if (!this.marketStateSync.isMarketOpen(exchangeCode)) continue;
          if (await this.marketStateSync.isExchangeHoliday(exchangeCode)) continue;
          await this.executeBrokerMarket('OVERSEAS', exchangeCode, broker, exchangeStocks);
        }
      });
    } catch (e) {
      this.logger.error(`Trading overseas error: ${e.message}`);
    }
  }

  isBusy(): boolean {
    return this.runningBrokerMarkets.size > 0;
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

    if (!this.registry.isActive(watchStock.broker)) {
      return { success: false, message: `${watchStock.broker} 브로커가 비활성화되어 수동 실행할 수 없습니다.` };
    }

    const strategy = this.strategyRegistry.getStrategy(watchStock.strategyName);
    if (!strategy) {
      return { success: false, message: `알 수 없는 전략입니다: ${watchStock.strategyName}` };
    }

    if (!this.marketStateSync.isMarketOpen(watchStock.exchangeCode)) {
      return { success: false, message: '현재 시장이 열려 있지 않아 수동 실행할 수 없습니다.' };
    }

    if (await this.marketStateSync.isExchangeHoliday(watchStock.exchangeCode)) {
      return { success: false, message: '현재 휴장일이라 수동 실행할 수 없습니다.' };
    }

    const openOrder = await this.prisma.tradeRecord.findFirst({
      where: {
        broker: watchStock.broker,
        market: watchStock.market,
        exchangeCode: watchStock.exchangeCode,
        stockCode: watchStock.stockCode,
        OR: [
          {
            status: {
              in: [
                OrderStatus.AWAITING_APPROVAL,
                OrderStatus.SUBMITTING,
                OrderStatus.SUBMISSION_UNKNOWN,
                OrderStatus.PENDING,
              ],
            },
          },
          {
            status: OrderStatus.PARTIAL,
            orderNo: { not: null },
          },
        ],
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
        broker: watchStock.broker,
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

  /**
   * "오늘 실행 미리보기" — 실제 전략 코드(evaluateStock)를 주문 제출 없이 호출해 결과만 반환한다.
   * 미리보기 전용 계산식을 별도로 만들지 않음으로써 미리보기와 실제 실행이 갈라질 수 없게 한다.
   * evaluateStock 자체는 Prisma/KIS/Slack에 접근하지 않는 순수 함수라(전략 파일 전수 확인됨)
   * `TradingService.executePerStockStrategy`를 호출하지 않는 한 어떤 전략이든 부작용이 없다 —
   * 주문 제출/실행 로그/strategyParams 영속화(v4StateUpdate 등)는 이 메서드에서 절대 하지 않는다.
   */
  async previewWatchStockExecution(
    watchStockId: string,
    quotaOverride?: number,
  ): Promise<WatchStockExecutionPreviewResult> {
    const watchStock = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
    if (!watchStock) {
      throw new BadRequestException('관심종목을 찾을 수 없습니다.');
    }
    if (!watchStock.strategyName) {
      throw new BadRequestException('전략이 설정되지 않은 관심종목입니다.');
    }

    const strategy = this.strategyRegistry.getStrategy(watchStock.strategyName);
    if (!strategy) {
      throw new BadRequestException(`알 수 없는 전략입니다: ${watchStock.strategyName}`);
    }

    // 가정 원금(what-if): quota를 override 값으로, v4 장부 잔금을 증감분만큼 조정한 가상 사본으로
    // evaluateStock을 돌린다. DB에는 아무것도 쓰지 않는다 (D10 저장과 동일한 규칙으로 계산만).
    let effectiveWatchStock = watchStock;
    let appliedQuotaOverride: number | undefined;
    if (quotaOverride !== undefined) {
      if (watchStock.strategyName !== 'infinite-buy-v4') {
        throw new BadRequestException('가정 원금 미리보기는 무한매수 V4 종목만 지원합니다.');
      }
      if (!Number.isFinite(quotaOverride) || quotaOverride <= 0) {
        throw new BadRequestException('가정 원금은 0보다 커야 합니다.');
      }
      const currentQuota = watchStock.quota ? Number(watchStock.quota) : 0;
      const params = (watchStock.strategyParams as Record<string, any>) ?? {};
      const v4 = (params.v4 as Record<string, any>) ?? {};
      const currentCash = Number.isFinite(v4.cashRemaining) ? Number(v4.cashRemaining) : currentQuota;
      const nextCash = Math.round((currentCash + (quotaOverride - currentQuota)) * 100) / 100;
      if (nextCash < 0) {
        throw new BadRequestException(
          `가정 원금이 너무 낮습니다 — 장부 잔금이 음수가 됩니다 (현재 잔금 ${currentCash.toLocaleString('en-US')})`,
        );
      }
      effectiveWatchStock = {
        ...watchStock,
        quota: new Prisma.Decimal(quotaOverride),
        strategyParams: { ...params, v4: { ...v4, cashRemaining: nextCash } } as Prisma.JsonValue,
      };
      appliedQuotaOverride = quotaOverride;
    }

    const context = await this.buildManualExecutionContext(effectiveWatchStock, strategy.name);
    if (!context) {
      throw new BadRequestException('미리보기용 종목 컨텍스트를 만들지 못했습니다.');
    }

    const evaluation = await strategy.evaluateStock(context);
    const details = evaluation.details ?? {};
    const star = details.star as
      | { starPct: number; starPrice: number; buyLimitPrice: number; sellLimitPrice: number }
      | undefined;

    return {
      context: {
        currentPrice: context.price.currentPrice,
        avgPrice: context.position?.avgPrice,
        holdQty: context.position?.quantity ?? 0,
        buyableAmount: context.buyableAmount,
        turn: details.T,
        maxCycles: context.watchStock.maxCycles,
        cashRemaining: details.cashRemaining,
        mode: details.mode,
        dailyBuyBudget: details.dailyBuyBudget,
        dailyBuyBudgetCapped: details.dailyBuyBudgetCapped,
        starPct: star?.starPct,
        starPrice: star?.starPrice,
        buyLimitPrice: star?.buyLimitPrice,
        sellLimitPrice: star?.sellLimitPrice,
        reverseStarPrice: details.reverseStarPrice,
      },
      signals: evaluation.signals.map((signal) => ({
        side: signal.side,
        phase: signal.metadata?.phase,
        quantity: signal.quantity,
        price: signal.price,
        orderDivision: signal.orderDivision,
        fillModel: signal.metadata?.fillModel,
        reason: signal.reason,
      })),
      skipReasons: evaluation.skipReasons,
      appliedQuotaOverride,
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

    await this.executeBrokerGroups(
      market,
      watchStocks,
      (broker, stocks) => this.executeBrokerMarket(market, exchangeCode, broker, stocks),
    );
  }

  private async executeBrokerGroups(
    market: 'DOMESTIC' | 'OVERSEAS',
    watchStocks: any[],
    execute: (broker: Broker, stocks: any[]) => Promise<void>,
  ): Promise<void> {
    const active = new Set(this.registry.getActive().map((port) => port.broker));
    const byBroker = new Map<Broker, any[]>();
    for (const stock of watchStocks) {
      if (!stock.broker || !active.has(stock.broker)) continue;
      if (stock.broker === Broker.TOSS && !this.tradingEnabled) continue;
      if (!byBroker.has(stock.broker)) byBroker.set(stock.broker, []);
      byBroker.get(stock.broker)!.push(stock);
    }

    for (const [broker, stocks] of byBroker) {
      const key = `${broker}:${market}`;
      if (this.runningBrokerMarkets.has(key)) continue;
      this.runningBrokerMarkets.add(key);
      try {
        await execute(broker, stocks);
      } catch (e) {
        this.logger.warn(`[${broker} ${market}] Trading group failed: ${e.message}`);
      } finally {
        this.runningBrokerMarkets.delete(key);
      }
    }
  }

  private async executeBrokerMarket(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
    broker: Broker,
    watchStocks: any[],
  ): Promise<void> {

    // 2. 공통 데이터 한 번만 조회
    const regime = await this.marketRegimeService.getRegime(market, exchangeCode);
    const riskState = await this.riskManagement.evaluateRisk(broker, market);

    // 리스크 경고 Slack 알림 (같은 시장은 하루 1회만)
    const alertDate = this.getKSTDate();
    const riskAlertKey = `${broker}:${market}`;
    if (riskState.reasons.length > 0 && this.slackService?.isEnabled() && this.lastRiskAlertDate[riskAlertKey] !== alertDate) {
      this.lastRiskAlertDate[riskAlertKey] = alertDate;
      const latestSnapshot = await this.prisma.riskSnapshot.findFirst({
        where: { broker, market: market as Market },
        orderBy: { createdAt: 'desc' },
      });
      const crossBrokerExposures = await this.getCrossBrokerExposures(market);
      this.slackService.sendRiskAlert({
        broker,
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
          crossBrokerExposures,
        },
      });
    }

    const marketCondition = await this.marketAnalysis.getMarketCondition(exchangeCode);

    const positions = await this.prisma.position.findMany({
      where: { broker, market: market as Market },
    });

    await this.orderSyncService.syncMarketOrders(
      market,
      positions.map((position) => this.toPositionSnapshot(position)),
      { force: true, broker },
    );

    const unfilledOrders = await this.marketStateSync.getUnfilledOrders(market, broker);

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
        this.logger.warn(`[${broker} ${market}] Unknown strategy: ${strategyName}`);
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
            unfilledOrders,
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
          this.logger.error(`[${ws.broker} ${ws.stockCode}] Error building context: ${e.message}`);
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
        const buyable = await this.registry.get(broker).getDomesticBuyableAmount();
        cashAvailable = buyable.cashAvailable;
      } else {
        const firstStock = watchStocks[0];
        if (firstStock) {
          const buyable = await this.registry.get(broker).getOverseasBuyableAmount(
            firstStock.exchangeCode,
            firstStock.stockCode,
            1,
          );
          cashAvailable = buyable.foreignCurrencyAvailable;
        }
      }
    } catch (e) {
      this.logger.warn(`[${broker} ${market}] Failed to read cash for risk snapshot: ${e.message}`);
    }

    await this.riskManagement.saveRiskSnapshot(broker, market, totalPortfolioValue, cashAvailable);

  }

  private async syncLatestMarketStateBeforeDailySummary(market: 'DOMESTIC' | 'OVERSEAS'): Promise<boolean> {
    try {
      await this.marketStateSync.syncMarketPortfolioOnly(market, { failOnAnyError: true });
      const latestPositions = await this.prisma.position.findMany({
        where: { market: market as Market },
      });

      await this.orderSyncService.syncMarketOrders(
        market,
        latestPositions.map((position) => this.toPositionSnapshot(position)),
        { force: true, failOnAnyError: true },
      );
      return true;
    } catch (e) {
      this.logger.warn(`Failed to sync latest ${market} state before daily summary: ${e.message}`);
      return false;
    }
  }

  private async getCrossBrokerExposures(market: 'DOMESTIC' | 'OVERSEAS') {
    const positions = await this.prisma.position.findMany({
      where: { market: market as Market },
    });
    const byStock = new Map<string, {
      exchangeCode: string;
      stockCode: string;
      brokerValues: Map<Broker, number>;
    }>();
    for (const position of positions) {
      const key = `${position.exchangeCode}:${position.stockCode}`;
      if (!byStock.has(key)) {
        byStock.set(key, {
          exchangeCode: position.exchangeCode,
          stockCode: position.stockCode,
          brokerValues: new Map(),
        });
      }
      const brokerValues = byStock.get(key)!.brokerValues;
      const value = Number(position.quantity) * Number(position.currentPrice);
      brokerValues.set(position.broker, (brokerValues.get(position.broker) ?? 0) + value);
    }
    return Array.from(byStock.values(), ({ exchangeCode, stockCode, brokerValues }) => {
      const brokers = Array.from(brokerValues, ([positionBroker, value]) => ({
        broker: positionBroker,
        value,
      }));
      return {
        exchangeCode,
        stockCode,
        totalValue: brokers.reduce((sum, item) => sum + item.value, 0),
        brokers,
      };
    });
  }

  async sendDomesticDailySummary(): Promise<void> {
    if (await this.marketStateSync.isHoliday('DOMESTIC')) return;

    const summaryDate = this.getKSTDate();
    await this.sendCloseDailySummary({
      summaryDate,
      claimScope: 'DOMESTIC:KRX:CLOSE',
      summaryTitle: `국내장 매매 요약 | ${summaryDate}`,
      market: 'DOMESTIC',
      exchangeCodes: ['KRX'],
      tradeStart: this.kstDateTime(summaryDate, 0, 0, 0, 0),
      tradeEnd: this.kstDateTime(summaryDate, 23, 59, 59, 999),
    });
  }

  async sendUsDailySummary(): Promise<void> {
    if (await this.marketStateSync.isExchangeHoliday('NASD')) return;

    const scope = this.buildUsDailySummaryScope();
    if (!scope) return;

    await this.sendCloseDailySummary(scope);
  }

  private async sendCloseDailySummary(scope: DailySummaryScope): Promise<void> {
    if (!this.slackService || !this.tradingSlackCommandsService) return;
    if (!this.slackService.isConfigured()) return;

    const claimed = await this.claimDailySummary(scope.summaryDate, scope.market, scope.claimScope);
    if (!claimed) {
      this.logger.debug(`Daily summary already sent for ${scope.claimScope}:${scope.summaryDate}, skipping`);
      return;
    }

    try {
      const synced = await this.syncLatestMarketStateBeforeDailySummary(scope.market);
      if (!synced) {
        await this.releaseDailySummaryClaim(scope.summaryDate, scope.claimScope);
        this.logger.warn(`Daily summary was not sent for ${scope.claimScope}:${scope.summaryDate}; claim released after sync failure`);
        return;
      }

      const summary = {
        ...await this.tradingSlackCommandsService.buildDailySummary({
          summaryTitle: scope.summaryTitle,
          market: scope.market,
          exchangeCodes: scope.exchangeCodes,
          tradeStart: scope.tradeStart,
          tradeEnd: scope.tradeEnd,
        }),
        crossBrokerExposures: await this.getCrossBrokerExposures(scope.market),
      };

      const hasHeldPositions = (summary.marketSummaries?.length ?? 0) > 0;
      const hasSessionTrades = summary.todayBuyCount > 0 || summary.todaySellCount > 0;
      if (!hasHeldPositions && !hasSessionTrades) {
        this.logger.debug(`Skipping ${scope.claimScope} daily summary for ${scope.summaryDate} because there are no held positions or session trades`);
        return;
      }

      const sent = await this.slackService.sendDailySummary(summary);
      if (!sent) {
        await this.releaseDailySummaryClaim(scope.summaryDate, scope.claimScope);
        this.logger.warn(`Daily summary was not sent for ${scope.claimScope}:${scope.summaryDate}; claim released for retry`);
      }
    } catch (e) {
      await this.releaseDailySummaryClaim(scope.summaryDate, scope.claimScope);
      this.logger.warn(`Failed to send ${scope.claimScope} daily summary to Slack: ${e.message}`);
    }
  }

  private buildUsDailySummaryScope(now: Date = new Date()): DailySummaryScope | undefined {
    const exchangeCode = 'NASD';
    const hours = getMarketHours(exchangeCode, now);
    if (!hours?.overnight) return undefined;

    const kstTime = this.getKSTTime(now);
    const currentMinutes = kstTime.hour * 60 + kstTime.minute;
    const openMinutes = hours.open.hour * 60 + hours.open.minute;
    const closeMinutes = hours.close.hour * 60 + hours.close.minute;
    if (currentMinutes < closeMinutes || currentMinutes >= openMinutes) return undefined;

    const closeDate = this.getKSTDate(now);
    const summaryDate = this.addKstDays(closeDate, -1);
    const closeDateForSession = this.addKstDays(summaryDate, 1);

    return {
      summaryDate,
      claimScope: 'OVERSEAS:US:CLOSE',
      summaryTitle: `미국장 매매 요약 | ${summaryDate} 거래일`,
      market: 'OVERSEAS',
      exchangeCodes: ['NASD', 'NYSE', 'AMEX'],
      tradeStart: this.kstDateTime(summaryDate, hours.open.hour, hours.open.minute),
      tradeEnd: this.kstDateTime(closeDateForSession, hours.close.hour, hours.close.minute),
    };
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
    unfilledOrders: BrokerScopedUnfilledOrder[];
    caches: {
      investorTrade: Map<string, Promise<any[] | undefined>>;
      dividendSchedule: Map<string, Promise<any[] | undefined>>;
      investOpinion: Map<string, Promise<any[] | undefined>>;
      estimatePerform: Map<string, Promise<any | undefined>>;
      openDart: Map<string, Promise<OpenDartDomesticSignals | undefined>>;
      secFundamentals: Map<string, Promise<SecFundamentals | undefined>>;
    };
  }): Promise<StockStrategyContext | null> {
    const { market, ws, strategyName, positions, totalPortfolioValue, marketCondition, marketRegime, riskState, today, unfilledOrders, caches } = args;

    const price = market === 'DOMESTIC'
      ? await this.kisDomestic.getPrice(ws.stockCode)
      : await this.kisOverseas.getPrice(ws.exchangeCode, ws.stockCode);

    // 종목별 미체결 주문 → continuous 전략의 중복 주문 방지 플래그
    const stockOpenOrders = unfilledOrders.filter(
      (order) =>
        order.broker === ws.broker
        && order.stockCode === ws.stockCode
        && (!order.exchangeCode || order.exchangeCode === ws.exchangeCode),
    );

    const pos = positions.find(
      (p) => p.broker === ws.broker
        && p.exchangeCode === ws.exchangeCode
        && p.stockCode === ws.stockCode,
    );

    const stockIndicators = await this.marketAnalysis.getStockIndicators(
      market, ws.exchangeCode, ws.stockCode, price.currentPrice,
    );

    this.applyPriceApiIndicators(stockIndicators, price);

    let buyableAmount = 0;
    let buyableMeta: StockStrategyContext['buyableMeta'] | undefined;
    if (market === 'DOMESTIC') {
      try {
        const buyable = await this.registry
          .get(ws.broker)
          .getDomesticBuyableAmount();
        buyableAmount = buyable.cashAvailable;
        buyableMeta = {
          source: ws.broker === Broker.KIS
            ? 'KIS_DOMESTIC_BUYABLE_AMOUNT'
            : 'TOSS_DOMESTIC_BUYABLE_AMOUNT',
        };
      } catch (e) {
        this.logger.warn(`[${ws.broker} ${ws.stockCode}] Failed to get domestic buyable amount: ${e.message}`);
      }
    } else {
      try {
        const buyable = await this.registry
          .get(ws.broker)
          .getOverseasBuyableAmount(
            ws.exchangeCode, ws.stockCode, price.currentPrice,
          );
        buyableAmount = buyable.foreignCurrencyAvailable;
        buyableMeta = {
          source: ws.broker === Broker.KIS
            ? 'KIS_OVERSEAS_INQUIRE_PSAMOUNT'
            : 'TOSS_OVERSEAS_BUYABLE_AMOUNT',
          maxQuantity: buyable.maxQuantity,
          priceUsed: price.currentPrice,
        };
      } catch (e) {
        this.logger.warn(`[${ws.broker} ${ws.stockCode}] Failed to get buyable amount: ${e.message}`);
      }
    }

    // 당일 체결 판정과 미해결 주문 가드는 범위가 다르다. 체결 판정은 당일/전략별,
    // 미해결 가드는 모든 날짜/전략의 같은 instrument+side를 차단한다.
    const todayStart = new Date(today + 'T00:00:00');
    const todayEnd = new Date(today + 'T23:59:59');
    const [todayTrades, unresolvedIntents] = await Promise.all([
      this.prisma.tradeRecord.findMany({
        where: {
          broker: ws.broker,
          market: market as Market,
          exchangeCode: ws.exchangeCode,
          stockCode: ws.stockCode,
          strategyName,
          status: { in: [OrderStatus.FILLED, OrderStatus.PARTIAL] },
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        select: { status: true, side: true },
      }),
      this.prisma.tradeRecord.findMany({
        where: {
          broker: ws.broker,
          market: market as Market,
          exchangeCode: ws.exchangeCode,
          stockCode: ws.stockCode,
          OR: [
            {
              status: {
                in: [
                  OrderStatus.AWAITING_APPROVAL,
                  OrderStatus.SUBMITTING,
                  OrderStatus.SUBMISSION_UNKNOWN,
                  OrderStatus.PENDING,
                ],
              },
            },
            {
              status: OrderStatus.PARTIAL,
              orderNo: { not: null },
            },
          ],
        },
        select: { status: true, side: true },
      }),
    ]);
    const executedToday = todayTrades.some(
      (trade) => trade.status === OrderStatus.FILLED || trade.status === OrderStatus.PARTIAL,
    );
    const hasPendingBuyRecord = unresolvedIntents.some(
      (trade) => trade.side === Side.BUY,
    );
    const hasPendingSellRecord = unresolvedIntents.some(
      (trade) => trade.side === Side.SELL,
    );

    const watchStockConfig: WatchStockConfig = {
      id: ws.id,
      broker: ws.broker,
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
      alreadyExecutedToday: executedToday,
      marketCondition,
      stockIndicators,
      fundamentals,
      buyableAmount,
      buyableMeta,
      totalPortfolioValue,
      marketRegime,
      riskState,
      hasOpenBuyOrder: stockOpenOrders.some((order) => order.side === 'BUY') || hasPendingBuyRecord,
      hasOpenSellOrder: stockOpenOrders.some((order) => order.side === 'SELL') || hasPendingSellRecord,
    };
  }

  private async buildManualExecutionContext(
    ws: {
      id: string;
      broker: Broker;
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
    const riskState = await this.riskManagement.evaluateRisk(ws.broker, market);

    // 수동 실행 전 최신 포지션 동기화
    await this.marketStateSync.syncMarketPortfolioOnly(market);

    const positions = await this.prisma.position.findMany({
      where: { broker: ws.broker, market: ws.market },
    });

    const totalPortfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );

    const price = market === 'DOMESTIC'
      ? await this.kisDomestic.getPrice(ws.stockCode)
      : await this.kisOverseas.getPrice(ws.exchangeCode, ws.stockCode);

    const pos = positions.find(
      (p) => p.broker === ws.broker
        && p.stockCode === ws.stockCode
        && p.exchangeCode === ws.exchangeCode,
    );

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
      const buyable = await this.registry
        .get(ws.broker)
        .getDomesticBuyableAmount();
      buyableAmount = buyable.cashAvailable;
      buyableMeta = {
        source: ws.broker === Broker.KIS
          ? 'KIS_DOMESTIC_BUYABLE_AMOUNT'
          : 'TOSS_DOMESTIC_BUYABLE_AMOUNT',
      };
    } else {
      const buyable = await this.registry
        .get(ws.broker)
        .getOverseasBuyableAmount(
        ws.exchangeCode,
        ws.stockCode,
        price.currentPrice,
      );
      buyableAmount = buyable.foreignCurrencyAvailable;
      buyableMeta = {
        source: ws.broker === Broker.KIS
          ? 'KIS_OVERSEAS_INQUIRE_PSAMOUNT'
          : 'TOSS_OVERSEAS_BUYABLE_AMOUNT',
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
        broker: ws.broker,
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
      // hasOpenBuyOrder/hasOpenSellOrder 미설정(undefined) — 수동 트리거는
      // triggerWatchStockNow에서 이미 열린 주문을 검사해 차단하므로 중복 가드 불필요
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
      broker: Broker;
      exchangeCode: string;
      stockCode: string;
      strategyName: string | null;
    }>,
    orders: BrokerScopedUnfilledOrder[],
  ): Promise<BrokerScopedUnfilledOrder[]> {
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
        AND: [
          {
            OR: [
              { cancellationStatus: null },
              {
                cancellationStatus: {
                  in: [
                    CancellationAttemptStatus.REJECTED,
                    CancellationAttemptStatus.RESOLVED,
                  ],
                },
              },
            ],
          },
          {
            OR: watchStocks
              .filter(
                (
                  watchStock,
                ): watchStock is {
                  broker: Broker;
                  exchangeCode: string;
                  stockCode: string;
                  strategyName: string;
                } =>
                  Boolean(watchStock.strategyName),
              )
              .map((watchStock) => ({
                broker: watchStock.broker,
                exchangeCode: watchStock.exchangeCode,
                stockCode: watchStock.stockCode,
                strategyName: watchStock.strategyName,
              })),
          },
        ],
      },
      select: {
        broker: true,
        orderNo: true,
      },
    });

    const cancelableOrders = new Set(
      openRecords
        .filter((record) => Boolean(record.orderNo))
        .map((record) => `${record.broker}:${record.orderNo}`),
    );

    return orders.filter((order) => cancelableOrders.has(`${order.broker}:${order.orderNo}`));
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

  private getKSTTime(now = new Date()): KstExecutionTime {
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return {
      hour: kst.getUTCHours(),
      minute: kst.getUTCMinutes(),
    };
  }

  private getKSTDate(now = new Date()): string {
    return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private addKstDays(date: string, days: number): string {
    const base = new Date(`${date}T00:00:00+09:00`);
    return this.getKSTDate(new Date(base.getTime() + days * 24 * 60 * 60 * 1000));
  }

  private kstDateTime(
    date: string,
    hour: number,
    minute: number,
    second = 0,
    millisecond = 0,
  ): Date {
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const ss = String(second).padStart(2, '0');
    const ms = String(millisecond).padStart(3, '0');
    return new Date(`${date}T${hh}:${mm}:${ss}.${ms}+09:00`);
  }

  private getKstDayRange(): { gte: Date; lte: Date } {
    const today = this.getKSTDate();
    return {
      gte: new Date(`${today}T00:00:00+09:00`),
      lte: new Date(`${today}T23:59:59.999+09:00`),
    };
  }

  private toPositionSnapshot(position: {
    broker: Broker;
    market: Market;
    exchangeCode: string;
    stockCode: string;
    quantity: number;
  }): PositionQuantitySnapshot {
    return {
      broker: position.broker,
      market: position.market as 'DOMESTIC' | 'OVERSEAS',
      exchangeCode: position.exchangeCode,
      stockCode: position.stockCode,
      quantity: position.quantity,
    };
  }

  // ========== Daily summary claim ==========

  private getDailySummarySentKey(date: string, scope = 'GLOBAL'): string {
    return `${DAILY_SUMMARY_SENT_KEY_PREFIX}:${scope}:${date}`;
  }

  private async claimDailySummary(
    date: string,
    market: 'DOMESTIC' | 'OVERSEAS',
    scope: string,
  ): Promise<boolean> {
    try {
      await this.prisma.appSetting.create({
        data: {
          key: this.getDailySummarySentKey(date, scope),
          value: {
            date,
            market,
            scope,
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

  private async releaseDailySummaryClaim(date: string, scope = 'GLOBAL'): Promise<void> {
    try {
      await this.prisma.appSetting.delete({
        where: { key: this.getDailySummarySentKey(date, scope) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return;
      }

      this.logger.warn(`Failed to release daily summary claim for ${date}: ${e.message}`);
    }
  }
}
