import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TradingService } from './trading.service';
import { MarketAnalysisService } from './market-analysis.service';
import { MarketRegimeService } from './market-regime.service';
import { RiskManagementService } from './risk-management.service';
import { StrategyRegistryService } from './strategy/strategy-registry.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import { MARKET_HOURS, MarketHours } from '../kis/types/kis-config.types';
import { HolidayItem, StockPriceResult } from '../kis/types/kis-api.types';
import { StockStrategyContext, StockFundamentals, WatchStockConfig, PerStockTradingStrategy } from './types';
import { Market } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { SlackCommandsService } from '../notification/slack-commands.service';

@Injectable()
export class TradingScheduler implements OnModuleInit {
  private readonly logger = new Logger(TradingScheduler.name);
  private readonly isPaper: boolean;
  private isDomesticRunning = false;
  private isOverseasRunning = false;

  // 휴장일 캐시 (일 1회)
  private holidayCache: { date: string; domestic: HolidayItem[]; overseas: HolidayItem[] } | null = null;

  constructor(
    private tradingService: TradingService,
    private marketAnalysis: MarketAnalysisService,
    private marketRegimeService: MarketRegimeService,
    private riskManagement: RiskManagementService,
    private strategyRegistry: StrategyRegistryService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private prisma: PrismaService,
    private configService: ConfigService,
    private schedulerRegistry: SchedulerRegistry,
    @Optional() private slackService?: SlackService,
    @Optional() private slackCommandsService?: SlackCommandsService,
  ) {
    this.isPaper = this.configService.get<string>('kis.env') === 'paper';
  }

  onModuleInit() {
    // 국내 시장: 매 1분, 09:00-15:29 KST
    const krJob = new CronJob('*/1 9-14 * * 1-5', () => this.executeDomestic(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic', krJob);
    krJob.start();

    const krCloseJob = new CronJob('0-29 15 * * 1-5', () => this.executeDomestic(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-domestic-close', krCloseJob);
    krCloseJob.start();
    this.logger.log('Trading domestic cron registered: every 1min 09:00-15:29 KST');

    // 해외 시장 (아시아): 매 1분, 09:00-16:59 KST (일본/베트남 09:00~, 홍콩/중국 10:30~17:00)
    const asiaJob = new CronJob('*/1 9-16 * * 1-5', () => this.executeOverseas(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-asia', asiaJob);
    asiaJob.start();
    this.logger.log('Trading overseas-asia cron registered: every 1min 09:00-16:59 KST');

    // 해외 시장 (미국): 매 1분, 23:00-05:59 KST
    const usNightJob = new CronJob('*/1 23 * * 1-5', () => this.executeOverseas(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-night', usNightJob);
    usNightJob.start();

    const usMorningJob = new CronJob('*/1 0-5 * * 2-6', () => this.executeOverseas(), null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('trading-overseas-us-morning', usMorningJob);
    usMorningJob.start();
    this.logger.log('Trading overseas-us cron registered: every 1min 23:00-05:59 KST');

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

    // 미국 개장 (23:30)
    const regimeUsJob = new CronJob('20 23 * * 1-5', () => {
      this.detectRegimeForExchanges(['NASD', 'NYSE', 'AMEX']);
    }, null, false, 'Asia/Seoul');
    this.schedulerRegistry.addCronJob('regime-detect-us', regimeUsJob);
    regimeUsJob.start();
    this.logger.log('Regime detect US cron registered: 23:20 KST');
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
      if (await this.isHoliday('OVERSEAS')) return;

      // 거래소별 그룹
      const watchStocks = await this.prisma.watchStock.findMany({
        where: { market: Market.OVERSEAS, isActive: true, NOT: { strategyName: null } },
      });

      const byExchange = new Map<string, typeof watchStocks>();
      for (const w of watchStocks) {
        const ex = w.exchangeCode || 'NASD';
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
    const marketCondition = await this.marketAnalysis.getMarketCondition(exchangeCode);

    // 잔고 동기화
    const balance = market === 'DOMESTIC'
      ? await this.kisDomestic.getBalance()
      : await this.kisOverseas.getBalance();
    await this.tradingService.syncPositions(market, balance);

    const positions = await this.prisma.position.findMany({
      where: { market: market as Market },
    });

    const totalPortfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );

    // 3. 미체결 주문 정리 (once-daily 전략 실행 시각에만)
    const kstHour = this.getKSTHour();
    const hasOnceDailyNow = this.strategyRegistry.getAllStrategies().some((s) => {
      if (s.executionMode.type !== 'once-daily') return false;
      if (market === 'DOMESTIC') return kstHour === s.executionMode.hours.domestic;
      return kstHour === this.getOverseasExecutionHour(exchangeCode, s.executionMode.hours.overseas);
    });

    if (hasOnceDailyNow) {
      await this.cancelUnfilledOrders(market);
    }

    // 4. 전략별 그룹핑
    const byStrategy = new Map<string, typeof watchStocks>();
    for (const ws of watchStocks) {
      const name = ws.strategyName!;
      if (!byStrategy.has(name)) byStrategy.set(name, []);
      byStrategy.get(name)!.push(ws);
    }

    const today = new Date().toISOString().slice(0, 10);

    for (const [strategyName, stocks] of byStrategy) {
      const strategy = this.strategyRegistry.getStrategy(strategyName);
      if (!strategy) {
        this.logger.warn(`Unknown strategy: ${strategyName}`);
        continue;
      }

      // 실행 타이밍 체크
      if (!this.shouldExecuteNow(strategy, market, exchangeCode)) continue;

      // 5. 종목별 컨텍스트 빌드
      const contexts: StockStrategyContext[] = [];

      for (const ws of stocks) {
        try {
          const price = market === 'DOMESTIC'
            ? await this.kisDomestic.getPrice(ws.stockCode)
            : await this.kisOverseas.getPrice(ws.exchangeCode || exchangeCode, ws.stockCode);

          const pos = positions.find((p) => p.stockCode === ws.stockCode);

          const stockIndicators = await this.marketAnalysis.getStockIndicators(
            market, ws.exchangeCode || exchangeCode, ws.stockCode, price.currentPrice,
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
          if (market === 'DOMESTIC') {
            try {
              const buyable = await this.kisDomestic.getBuyableAmount();
              buyableAmount = buyable.cashAvailable;
            } catch (e) {
              this.logger.warn(`Failed to get domestic buyable amount: ${e.message}`);
            }
          } else {
            try {
              const buyable = await this.kisOverseas.getBuyableAmount(
                ws.exchangeCode || exchangeCode, ws.stockCode, price.currentPrice,
              );
              buyableAmount = buyable.foreignCurrencyAvailable;
            } catch (e) {
              this.logger.warn(`Failed to get buyable amount for ${ws.stockCode}: ${e.message}`);
            }
          }

          const existing = await this.prisma.strategyExecution.findUnique({
            where: {
              market_stockCode_strategyName_executedDate: {
                market: market as Market,
                stockCode: ws.stockCode,
                strategyName,
                executedDate: today,
              },
            },
          });

          const watchStockConfig: WatchStockConfig = {
            id: ws.id,
            market,
            exchangeCode: ws.exchangeCode || exchangeCode,
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
            fundamentals = await this.fetchFundamentals(market, ws.exchangeCode || exchangeCode, ws.stockCode, price);
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
            alreadyExecutedToday: !!existing,
            marketCondition,
            stockIndicators,
            fundamentals,
            buyableAmount,
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
            firstStock.exchangeCode || exchangeCode,
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
      try {
        const summary = await this.slackCommandsService.buildDailySummary();
        summary.marketCondition = marketCondition;
        await this.slackService.sendDailySummary(summary);
      } catch (e) {
        this.logger.warn(`Failed to send daily summary to Slack: ${e.message}`);
      }
    }
  }

  // ========== 타이밍 판단 ==========

  private shouldExecuteNow(strategy: PerStockTradingStrategy, market: 'DOMESTIC' | 'OVERSEAS', exchangeCode: string): boolean {
    const mode = strategy.executionMode;

    if (mode.type === 'continuous') return true;

    // once-daily: 해당 시각(KST hour)에만 실행
    const kstHour = this.getKSTHour();
    if (market === 'DOMESTIC') return kstHour === mode.hours.domestic;
    // 해외: 거래소 장 시간 기준으로 실행 시각 계산
    return kstHour === this.getOverseasExecutionHour(exchangeCode, mode.hours.overseas);
  }

  /** 거래소 장 시간 기준으로 KST 실행 시각 계산 */
  private getOverseasExecutionHour(
    exchangeCode: string,
    overseas: { basis: 'afterOpen' | 'beforeClose'; offsetHours: number },
  ): number {
    const hours = MARKET_HOURS[exchangeCode];
    if (!hours) return (0 + overseas.offsetHours) % 24;
    if (overseas.basis === 'afterOpen') {
      return (hours.open.hour + overseas.offsetHours) % 24;
    }
    // beforeClose: 장 마감 시각에서 offset만큼 빼기
    const closeHour = hours.overnight
      ? hours.close.hour + 24 // 미국: 06 → 30
      : hours.close.hour;
    return (closeHour - overseas.offsetHours) % 24;
  }

  private getKSTHour(): number {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.getUTCHours();
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

  private async cancelUnfilledOrders(marketType: 'DOMESTIC' | 'OVERSEAS'): Promise<void> {
    try {
      if (marketType === 'OVERSEAS') {
        const orders = await this.kisOverseas.getUnfilledOrders();
        for (const order of orders) {
          this.logger.log(`Cancelling overseas unfilled order: ${order.stockCode} #${order.orderNo}`);
          await this.kisOverseas.cancelOrder(
            order.exchangeCode || 'NASD',
            order.orderNo,
            order.stockCode,
            order.quantity,
            order.price,
          );
        }
        if (orders.length > 0) {
          this.logger.log(`Cancelled ${orders.length} overseas unfilled orders`);
        }
      } else {
        const orders = await this.kisDomestic.getUnfilledOrders();
        for (const order of orders) {
          this.logger.log(`Cancelling domestic unfilled order: ${order.stockCode} #${order.orderNo}`);
          await this.kisDomestic.cancelOrder(order.orderNo, order.stockCode, order.quantity);
        }
        if (orders.length > 0) {
          this.logger.log(`Cancelled ${orders.length} domestic unfilled orders`);
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

    const todayStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    await this.ensureHolidayCache(todayStr);

    if (!this.holidayCache) return false;

    if (marketType === 'DOMESTIC') {
      const holiday = this.holidayCache.domestic.find((h) => h.date === todayStr);
      return holiday ? !holiday.isOpen : false;
    } else {
      const holiday = this.holidayCache.overseas.find((h) => h.date === todayStr);
      return holiday ? !holiday.isOpen : false;
    }
  }

  private async ensureHolidayCache(todayStr: string): Promise<void> {
    if (this.holidayCache?.date === todayStr) return;

    try {
      const [domestic, overseas] = await Promise.all([
        this.kisDomestic.getHolidays(todayStr),
        this.kisOverseas.getOverseasHolidays(todayStr),
      ]);
      this.holidayCache = { date: todayStr, domestic, overseas };
    } catch (e) {
      this.logger.warn(`Failed to fetch holidays: ${e.message}`);
    }
  }

  // ========== 유틸 ==========

  isBusy(): boolean {
    return this.isDomesticRunning || this.isOverseasRunning;
  }

  isMarketOpen(exchangeCode: string): boolean {
    const hours = MARKET_HOURS[exchangeCode];
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

  // ========== 재무 데이터 조회 ==========

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
        const rows = await this.kisDomestic.getFinancialRatio(stockCode);
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
          const otherRows = await this.kisDomestic.getOtherMajorRatios(stockCode);
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
        return {
          per: price.per,
          pbr: price.pbr,
          eps: price.eps,
        };
      }
      return undefined;
    } catch (e) {
      this.logger.warn(`Failed to fetch fundamentals for ${stockCode}: ${e.message}`);
      return undefined;
    }
  }
}
