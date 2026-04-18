import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TradingService } from './trading.service';
import { TradingPositionSyncService } from './trading-position-sync.service';
import { TradingOrderReconciliationService } from './trading-order-reconciliation.service';
import { MarketAnalysisService } from './market-analysis.service';
import { MarketRegimeService } from './market-regime.service';
import { RiskManagementService } from './risk-management.service';
import { StrategyRegistryService } from './strategy/strategy-registry.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import { MarketHours, getMarketHours } from '../kis/types/kis-config.types';
import { HolidayItem, StockPriceResult, UnfilledOrder } from '../kis/types/kis-api.types';
import { StockStrategyContext, StockFundamentals, WatchStockConfig, PerStockTradingStrategy, StockIndicators, PositionQuantitySnapshot } from './types';
import { Market, OrderStatus, Prisma, WatchStockExecutionEventType } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { SlackCommandsService } from '../notification/slack-commands.service';
import { summarizeEstimatePerform, summarizeInvestOpinion } from '../screening/utils/consensus.util';
import { summarizeDividendSchedule } from '../screening/utils/dividend.util';
import { pickNumeric } from '../screening/utils/api-data.util';
import { MarketDataCacheService } from '../market-data/market-data-cache.service';
import { OpenDartDomesticSignals } from '../opendart/types';
import { SecFundamentals } from '../sec/types';
import { OrderSyncService } from './order-sync.service';

const DAILY_SUMMARY_SENT_KEY_PREFIX = 'daily-summary-sent';

type KstExecutionTime = {
  hour: number;
  minute: number;
};

@Injectable()
export class TradingScheduler implements OnModuleInit {
  private readonly logger = new Logger(TradingScheduler.name);
  private readonly isPaper: boolean;
  private readonly tradingEnabled: boolean;
  private isDomesticRunning = false;
  private isOverseasRunning = false;
  private isDomesticOrderSyncRunning = false;
  private isOverseasOrderSyncRunning = false;

  // 휴장일 캐시 (국내, 일 1회)
  private holidayCache: { date: string; domestic: HolidayItem[] } | null = null;
  // 리스크 알림 중복 방지 (market → 마지막 알림 날짜)
  private lastRiskAlertDate: Record<string, string> = {};

  constructor(
    private tradingService: TradingService,
    private positionSyncService: TradingPositionSyncService,
    private orderReconciliationService: TradingOrderReconciliationService,
    private marketAnalysis: MarketAnalysisService,
    private marketRegimeService: MarketRegimeService,
    private riskManagement: RiskManagementService,
    private orderSyncService: OrderSyncService,
    private strategyRegistry: StrategyRegistryService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private prisma: PrismaService,
    private configService: ConfigService,
    private schedulerRegistry: SchedulerRegistry,
    private marketDataCache: MarketDataCacheService,
    @Optional() private slackService?: SlackService,
    @Optional() private slackCommandsService?: SlackCommandsService,
  ) {
    this.isPaper = this.configService.get<string>('kis.env') === 'paper';
    this.tradingEnabled = this.configService.get<boolean>('trading.enabled') ?? true;
  }

  onModuleInit() {
    if (!this.tradingEnabled) {
      this.logger.warn('Live trading disabled by TRADING_ENABLED=false; trading cron jobs will not be registered');
      return;
    }

    // 국내 시장: 매 1분, 09:00-15:29 KST
    const krJob = new CronJob('*/1 9-14 * * 1-5', () => this.executeDomestic(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic', krJob);
    krJob.start();

    const krCloseJob = new CronJob('0-29 15 * * 1-5', () => this.executeDomestic(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-close', krCloseJob);
    krCloseJob.start();
    this.logger.log('Trading domestic cron registered: every 1min 09:00-15:29 KST');

    const krOrderSyncJob = new CronJob('*/10 * 9-14 * * 1-5', () => this.syncDomesticOpenOrders(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-order-sync', krOrderSyncJob);
    krOrderSyncJob.start();

    const krOrderSyncCloseJob = new CronJob('*/10 * 15 * * 1-5', () => this.syncDomesticOpenOrders(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-order-sync-close', krOrderSyncCloseJob);
    krOrderSyncCloseJob.start();
    this.logger.log('Trading domestic order sync cron registered: every 10s 09:00-15:29 KST');

    const krPortfolioSyncJob = new CronJob('*/10 9-14 * * 1-5', () => this.syncDomesticPortfolioState(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-portfolio-sync', krPortfolioSyncJob);
    krPortfolioSyncJob.start();

    const krPortfolioSyncCloseJob = new CronJob('0,10,20 15 * * 1-5', () => this.syncDomesticPortfolioState(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-portfolio-sync-close', krPortfolioSyncCloseJob);
    krPortfolioSyncCloseJob.start();
    this.logger.log('Trading domestic portfolio sync cron registered: every 10min 09:00-15:20 KST');

    // 해외 시장 (아시아): 매 1분, 09:00-16:59 KST (일본/베트남 09:00~, 홍콩/중국 10:30~17:00)
    const asiaJob = new CronJob('*/1 9-16 * * 1-5', () => this.executeOverseas(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-asia', asiaJob);
    asiaJob.start();
    this.logger.log('Trading overseas-asia cron registered: every 1min 09:00-16:59 KST');

    // 해외 시장 (미국): 매 1분, 22:00-06:59 KST 범위에서 실행 후 실제 장시간으로 필터링 (DST 포함)
    const usNightJob = new CronJob('*/1 22-23 * * 1-5', () => this.executeOverseas(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-night', usNightJob);
    usNightJob.start();

    const usMorningJob = new CronJob('*/1 0-6 * * 2-6', () => this.executeOverseas(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning', usMorningJob);
    usMorningJob.start();
    this.logger.log('Trading overseas-us cron registered: every 1min 22:00-06:59 KST (DST aware)');

    const asiaOrderSyncJob = new CronJob('*/15 * 9-16 * * 1-5', () => this.syncOverseasOpenOrders(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-asia-order-sync', asiaOrderSyncJob);
    asiaOrderSyncJob.start();

    const usNightOrderSyncJob = new CronJob('*/15 * 22-23 * * 1-5', () => this.syncOverseasOpenOrders(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-night-order-sync', usNightOrderSyncJob);
    usNightOrderSyncJob.start();

    const usMorningOrderSyncJob = new CronJob('*/15 * 0-6 * * 2-6', () => this.syncOverseasOpenOrders(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning-order-sync', usMorningOrderSyncJob);
    usMorningOrderSyncJob.start();
    this.logger.log('Trading overseas order sync cron registered: every 15s during overseas sessions');

    const asiaPortfolioSyncJob = new CronJob('*/10 9-16 * * 1-5', () => this.syncOverseasPortfolioState(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-asia-portfolio-sync', asiaPortfolioSyncJob);
    asiaPortfolioSyncJob.start();

    const usNightPortfolioSyncJob = new CronJob('*/10 22-23 * * 1-5', () => this.syncOverseasPortfolioState(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-night-portfolio-sync', usNightPortfolioSyncJob);
    usNightPortfolioSyncJob.start();

    const usMorningPortfolioSyncJob = new CronJob('*/10 0-6 * * 2-6', () => this.syncOverseasPortfolioState(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning-portfolio-sync', usMorningPortfolioSyncJob);
    usMorningPortfolioSyncJob.start();
    this.logger.log('Trading overseas portfolio sync cron registered: every 10min during overseas sessions');

    // 시장 상태 판별 (각 시장 장전)
    const regimeKrJob = new CronJob('50 8 * * 1-5', () => this.detectRegime('DOMESTIC', 'KRX'), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('regime-detect-kr', regimeKrJob);
    regimeKrJob.start();
    this.logger.log('Regime detect KR cron registered: 08:50 KST');

    // 아시아 조기 개장 (일본/베트남 09:00)
    const regimeAsiaEarlyJob = new CronJob('50 8 * * 1-5', () => {
      this.detectRegimeForExchanges(['TKSE', 'HASE', 'VNSE']);
    }, null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('regime-detect-asia-early', regimeAsiaEarlyJob);
    regimeAsiaEarlyJob.start();

    // 아시아 후기 개장 (홍콩/중국 10:30)
    const regimeAsiaLateJob = new CronJob('20 10 * * 1-5', () => {
      this.detectRegimeForExchanges(['SEHK', 'SHAA', 'SZAA']);
    }, null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('regime-detect-asia-late', regimeAsiaLateJob);
    regimeAsiaLateJob.start();

    this.logger.log('Regime detect Asia crons registered: 08:50, 10:20 KST');

    // 미국 개장 전 리짐 판별 (DST 포함)
    const regimeUsJob = new CronJob('20 22,23 * * 1-5', () => {
      this.detectRegimeForExchanges(['NASD', 'NYSE', 'AMEX']);
    }, null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('regime-detect-us', regimeUsJob);
    regimeUsJob.start();
    this.logger.log('Regime detect US cron registered: 22:20 and 23:20 KST (DST aware)');
  }

  // ========== 통합 실행 루프 ==========

  private async executeDomestic(): Promise<void> {
    if (!this.isMarketOpen('KRX')) return;
    if (this.isDomesticRunning) return;
    this.isDomesticRunning = true;

    try {
      if (await this.isHoliday('DOMESTIC')) return;
      await this.executeMarket('DOMESTIC', 'KRX');
    } catch (e) {
      this.logger.error(`Trading domestic error: ${e.message}`);
    } finally {
      this.isDomesticRunning = false;
    }
  }

  private async executeOverseas(): Promise<void> {
    if (this.isOverseasRunning) return;
    this.isOverseasRunning = true;

    try {
      // 거래소별 그룹
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
        if (!this.isMarketOpen(exchangeCode)) continue;
        await this.executeMarket('OVERSEAS', exchangeCode, stocks);
      }
    } catch (e) {
      this.logger.error(`Trading overseas error: ${e.message}`);
    } finally {
      this.isOverseasRunning = false;
    }
  }

  private async syncDomesticOpenOrders(): Promise<void> {
    if (!this.isMarketOpen('KRX')) return;
    if (this.isDomesticRunning || this.isDomesticOrderSyncRunning) return;
    this.isDomesticOrderSyncRunning = true;

    try {
      if (await this.isHoliday('DOMESTIC')) return;
      if (!await this.hasOpenOrders('DOMESTIC')) return;
      await this.syncMarketOrdersOnly('DOMESTIC');
    } catch (e) {
      this.logger.error(`Domestic order sync error: ${e.message}`);
    } finally {
      this.isDomesticOrderSyncRunning = false;
    }
  }

  private async syncOverseasOpenOrders(): Promise<void> {
    if (this.isOverseasRunning || this.isOverseasOrderSyncRunning) return;
    this.isOverseasOrderSyncRunning = true;

    try {
      if (!await this.hasOpenOrders('OVERSEAS')) return;
      await this.syncMarketOrdersOnly('OVERSEAS');
    } catch (e) {
      this.logger.error(`Overseas order sync error: ${e.message}`);
    } finally {
      this.isOverseasOrderSyncRunning = false;
    }
  }

  private async syncDomesticPortfolioState(): Promise<void> {
    if (!this.isMarketOpen('KRX')) return;
    if (this.isDomesticRunning || this.isDomesticOrderSyncRunning) return;

    try {
      if (await this.isHoliday('DOMESTIC')) return;
      if (!await this.hasPortfolioState('DOMESTIC')) return;
      await this.syncMarketPortfolioOnly('DOMESTIC');
    } catch (e) {
      this.logger.error(`Domestic portfolio sync error: ${e.message}`);
    }
  }

  private async syncOverseasPortfolioState(): Promise<void> {
    if (this.isOverseasRunning || this.isOverseasOrderSyncRunning) return;

    try {
      if (!await this.hasPortfolioState('OVERSEAS')) return;
      await this.syncMarketPortfolioOnly('OVERSEAS');
    } catch (e) {
      this.logger.error(`Overseas portfolio sync error: ${e.message}`);
    }
  }

  /**
   * 단일 시장(거래소) 실행 — 모든 전략을 한 루프에서 처리
   */
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

    const unfilledOrders = await this.getUnfilledOrders(market);

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
      await this.cancelUnfilledOrders(market, cancelableUnfilledOrders);
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
          const price = market === 'DOMESTIC'
            ? await this.kisDomestic.getPrice(ws.stockCode)
            : await this.kisOverseas.getPrice(ws.exchangeCode, ws.stockCode);

          const pos = positions.find((p) => p.stockCode === ws.stockCode);

          const stockIndicators = await this.marketAnalysis.getStockIndicators(
            market, ws.exchangeCode, ws.stockCode, price.currentPrice,
          );

          // 현재가 API에서 직접 제공되는 추가 지표를 stockIndicators에 병합
          stockIndicators.foreignHoldRate = price.foreignHoldRate;
          stockIndicators.foreignNetBuyQty = price.foreignNetBuyQty;
          stockIndicators.w52High = price.w52High;
          stockIndicators.w52Low = price.w52Low;
          stockIndicators.investCautionYn = price.investCautionYn;
          stockIndicators.marketWarnCode = price.marketWarnCode;
          stockIndicators.shortOverheatYn = price.shortOverheatYn;
          // 가격 위치 지표
          stockIndicators.d250High = price.d250High;
          stockIndicators.d250Low = price.d250Low;
          stockIndicators.d250HighRate = price.d250HighRate;
          stockIndicators.d250LowRate = price.d250LowRate;
          stockIndicators.yearHigh = price.yearHigh;
          stockIndicators.yearLow = price.yearLow;
          stockIndicators.yearHighRate = price.yearHighRate;
          stockIndicators.yearLowRate = price.yearLowRate;
          // 시가총액/리스크
          stockIndicators.marketCap = price.marketCap;
          stockIndicators.loanBalanceRate = price.loanBalanceRate;
          stockIndicators.shortSellable = price.shortSellable;

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
              openDartCache,
              ws.stockCode,
              () => this.marketDataCache.getOpenDartDomesticSignals(ws.stockCode),
            );
            this.applyOpenDartSignals(stockIndicators, openDartSignals);
          }

          if (market === 'OVERSEAS' && this.needsSecSignals(strategyName)) {
            const secKey = `${ws.exchangeCode}:${ws.stockCode}`;
            const secFundamentals = await this.getCachedValue(
              secFundamentalsCache,
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
              investorTradeCache,
              ws.stockCode,
              () => this.marketDataCache.getKisDomesticInvestorTradeDaily(ws.stockCode),
            );
            this.applyInvestorTradeSignals(stockIndicators, investorTradeDaily);
          }

          if (market === 'DOMESTIC' && (this.needsDividendSignals(strategyName) || this.needsConsensusSignals(strategyName))) {
            const [dividendSchedule, investOpinion, estimatePerform] = await Promise.all([
              this.needsDividendSignals(strategyName)
                ? this.getCachedValue(
                    dividendScheduleCache,
                    ws.stockCode,
                    () => this.marketDataCache.getKisDomesticDividendSchedule(ws.stockCode),
                  )
                : Promise.resolve(undefined),
              this.needsConsensusSignals(strategyName)
                ? this.getCachedValue(
                    investOpinionCache,
                    ws.stockCode,
                    () => this.marketDataCache.getKisDomesticInvestOpinion(ws.stockCode),
                  )
                : Promise.resolve(undefined),
              this.needsConsensusSignals(strategyName)
                ? this.getCachedValue(
                    estimatePerformCache,
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

          contexts.push({
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
            marketRegime: regime,
            riskState,
          });
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

  private async syncMarketOrdersOnly(market: 'DOMESTIC' | 'OVERSEAS'): Promise<void> {
    await this.syncMarketPortfolioOnly(market);

    const positions = await this.prisma.position.findMany({
      where: { market: market as Market },
    });

    await this.orderSyncService.syncMarketOrders(
      market,
      positions.map((position) => this.toPositionSnapshot(position)),
    );
  }

  private async syncMarketPortfolioOnly(market: 'DOMESTIC' | 'OVERSEAS'): Promise<void> {
    const balance = market === 'DOMESTIC'
      ? await this.kisDomestic.getBalance()
      : await this.kisOverseas.getBalance();

    await this.positionSyncService.syncPositions(market, balance);
  }

  private async hasPortfolioState(market: 'DOMESTIC' | 'OVERSEAS'): Promise<boolean> {
    const [activeWatchStocks, positions, openOrders] = await Promise.all([
      this.prisma.watchStock.count({
        where: {
          market: market as Market,
          isActive: true,
          NOT: { strategyName: null },
        },
      }),
      this.prisma.position.count({
        where: { market: market as Market },
      }),
      this.prisma.tradeRecord.count({
        where: {
          market: market as Market,
          status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
          orderNo: { not: null },
        },
      }),
    ]);

    return activeWatchStocks > 0 || positions > 0 || openOrders > 0;
  }

  private async hasOpenOrders(market: 'DOMESTIC' | 'OVERSEAS'): Promise<boolean> {
    const openOrders = await this.prisma.tradeRecord.count({
      where: {
        market: market as Market,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
        orderNo: { not: null },
      },
    });

    return openOrders > 0;
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

  // ========== 시장 상태 판별 ==========

  private async detectRegime(market: 'DOMESTIC' | 'OVERSEAS', exchangeCode: string): Promise<void> {
    this.logger.log(`=== Regime Detect ${exchangeCode}: triggered ===`);
    try {
      const regime = await this.marketRegimeService.detectAndSave(market, exchangeCode);
      this.logger.log(`${exchangeCode} Market Regime: ${regime}`);
    } catch (e) {
      this.logger.error(`Regime detect ${exchangeCode} error: ${e.message}`);
    }
  }

  /** 활성 관심종목이 있는 거래소에 대해서만 regime 감지 */
  private async detectRegimeForExchanges(exchanges: string[]): Promise<void> {
    for (const ex of exchanges) {
      try {
        const hasStocks = await this.prisma.watchStock.count({
          where: { exchangeCode: ex, isActive: true },
        });
        if (hasStocks > 0) {
          await this.detectRegime('OVERSEAS', ex);
        }
      } catch (e) {
        this.logger.error(`Regime detect ${ex} error: ${e.message}`);
      }
    }
  }

  // ========== 미체결 주문 정리 ==========

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

  private async getUnfilledOrders(marketType: 'DOMESTIC' | 'OVERSEAS'): Promise<UnfilledOrder[]> {
    return this.orderSyncService.getMarketUnfilledOrders(marketType);
  }

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

  private async cancelUnfilledOrders(
    marketType: 'DOMESTIC' | 'OVERSEAS',
    orders: UnfilledOrder[],
  ): Promise<void> {
    try {
      if (marketType === 'OVERSEAS') {
        let cancelledCount = 0;
        for (const order of orders) {
          this.logger.log(`Cancelling overseas unfilled order: ${order.stockCode} #${order.orderNo}`);
          const result = await this.kisOverseas.cancelOrder(
            order.exchangeCode ?? '',
            order.orderNo,
            order.stockCode,
            order.quantity,
            order.price,
          );
          if (result.success) {
            cancelledCount += 1;
            await this.orderReconciliationService.markOpenOrderCancelled(
              'OVERSEAS',
              order.orderNo,
              '장중 재실행 전 미체결 주문 취소',
            );
          } else {
            this.logger.warn(`Failed to cancel overseas unfilled order ${order.stockCode} #${order.orderNo}: ${result.message}`);
          }
        }
        if (cancelledCount > 0) {
          this.logger.log(`Cancelled ${cancelledCount} overseas unfilled orders`);
        }
      } else {
        let cancelledCount = 0;
        for (const order of orders) {
          this.logger.log(`Cancelling domestic unfilled order: ${order.stockCode} #${order.orderNo}`);
          const result = await this.kisDomestic.cancelOrder(order.orderNo, order.stockCode, order.quantity);
          if (result.success) {
            cancelledCount += 1;
            await this.orderReconciliationService.markOpenOrderCancelled(
              'DOMESTIC',
              order.orderNo,
              '장중 재실행 전 미체결 주문 취소',
            );
          } else {
            this.logger.warn(`Failed to cancel domestic unfilled order ${order.stockCode} #${order.orderNo}: ${result.message}`);
          }
        }
        if (cancelledCount > 0) {
          this.logger.log(`Cancelled ${cancelledCount} domestic unfilled orders`);
        }
      }
    } catch (e) {
      this.logger.error(`Failed to cancel unfilled orders (${marketType}): ${e.message}`);
    }
  }

  // ========== 휴장일 체크 ==========

  private async isHoliday(marketType: 'DOMESTIC' | 'OVERSEAS'): Promise<boolean> {
    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return true;

    if (this.isPaper) return false;

    if (marketType !== 'DOMESTIC') return false;

    const todayStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    await this.ensureHolidayCache(todayStr);

    if (!this.holidayCache) return false;

    const holiday = this.holidayCache.domestic.find((h) => h.date === todayStr);
    return holiday ? !holiday.isOpen : false;
  }

  async isExchangeHoliday(exchangeCode: string): Promise<boolean> {
    if (exchangeCode === 'KRX') {
      return this.isHoliday('DOMESTIC');
    }
    return false;
  }

  private async ensureHolidayCache(todayStr: string): Promise<void> {
    if (this.holidayCache?.date === todayStr) return;

    try {
      const domestic = await this.kisDomestic.getHolidays(todayStr);
      this.holidayCache = { date: todayStr, domestic };
    } catch (e) {
      this.logger.warn(`Failed to fetch holidays: ${e.message}`);
    }
  }

  // ========== 유틸 ==========

  isBusy(): boolean {
    return this.isDomesticRunning || this.isOverseasRunning;
  }

  async triggerWatchStockNow(watchStockId: string): Promise<{ success: boolean; message: string }> {
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

    if (!this.isMarketOpen(watchStock.exchangeCode)) {
      return { success: false, message: '현재 시장이 열려 있지 않아 수동 실행할 수 없습니다.' };
    }

    const market = watchStock.market as 'DOMESTIC' | 'OVERSEAS';
    if (watchStock.exchangeCode === 'KRX' && await this.isExchangeHoliday(watchStock.exchangeCode)) {
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

  isMarketOpen(exchangeCode: string): boolean {
    const hours = getMarketHours(exchangeCode);
    if (!hours) return false;

    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const day = kst.getUTCDay();

    if (!hours.overnight && (day === 0 || day === 6)) return false;

    if (hours.overnight) {
      if (day === 0) return false;
      if (day === 6) {
        const currentMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
        const closeMin = hours.close.hour * 60 + hours.close.minute;
        return currentMin < closeMin;
      }
    }

    return this.isWithinHours(kst, hours);
  }

  private isWithinHours(kst: Date, hours: MarketHours): boolean {
    const currentMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    const openMin = hours.open.hour * 60 + hours.open.minute;
    const closeMin = hours.close.hour * 60 + hours.close.minute;

    if (hours.overnight) {
      return currentMin >= openMin || currentMin < closeMin;
    }

    return currentMin >= openMin && currentMin < closeMin;
  }

  private getKstDate(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private getKstDayRange(): { gte: Date; lte: Date } {
    const today = this.getKstDate();
    return {
      gte: new Date(`${today}T00:00:00+09:00`),
      lte: new Date(`${today}T23:59:59.999+09:00`),
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

    const balance = market === 'DOMESTIC'
      ? await this.kisDomestic.getBalance()
      : await this.kisOverseas.getBalance();
    await this.positionSyncService.syncPositions(market, balance);

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
        // PER/PBR: 현재가 시세 API에서 제공 (재무비율 API에는 없음)
        const fundamentals: StockFundamentals = {
          per: price.per,
          pbr: price.pbr,
        };

        // ROE, 부채비율, EPS, 매출액증가율, 영업이익증가율: 재무비율 API에서 제공
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

        // EV/EBITDA, 배당성향: 기타주요비율 API에서 제공
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
      // 해외: 현재가상세 API에서 PER/PBR/EPS 제공 (재무비율 API는 없음)
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
}
