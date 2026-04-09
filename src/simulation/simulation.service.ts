import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { StrategyRegistryService } from '../trading/strategy/strategy-registry.service';
import { MarketAnalysisService } from '../trading/market-analysis.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { Market, Side, SimulationStatus, SimulationTradeStatus, Prisma } from '@prisma/client';
import {
  StockStrategyContext,
  WatchStockConfig,
  StockFundamentals,
  RiskState,
  MarketRegimeLabel,
  InfiniteBuyStrategyParams,
  MomentumBreakoutStrategyParams,
  GridMeanReversionStrategyParams,
} from '../trading/types';
import { MarketRegimeService } from '../trading/market-regime.service';
import { StockPriceResult } from '../kis/types/kis-api.types';
import { SimulationMetrics, SimulationPendingOrder } from './types';
import { CreateSimulationInput } from './dto';
import { OpenDartDomesticSignals } from '../opendart/types';
import { SecFundamentals } from '../sec/types';
import { MarketDataCacheService } from '../market-data/market-data-cache.service';
import { MARKET_HOURS } from '../kis/types/kis-config.types';

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);
  /** 인메모리 pending orders: sessionId → 주문 배열 */
  private pendingOrders = new Map<string, SimulationPendingOrder[]>();

  constructor(
    private prisma: PrismaService,
    private strategyRegistry: StrategyRegistryService,
    private marketAnalysis: MarketAnalysisService,
    private marketRegimeService: MarketRegimeService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private marketDataCache: MarketDataCacheService,
  ) {}

  async createSession(input: CreateSimulationInput) {
    return this.prisma.simulationSession.create({
      data: {
        name: input.name,
        description: input.description,
        market: input.market,
        exchangeCode: input.exchangeCode,
        stockCode: input.stockCode,
        stockName: input.stockName,
        countryCode: input.countryCode,
        strategyName: input.strategyName,
        currentCash: new Prisma.Decimal(input.quota),
        quota: new Prisma.Decimal(input.quota),
        stopLossRate: input.stopLossRate ? new Prisma.Decimal(input.stopLossRate) : new Prisma.Decimal(0.3),
        maxPortfolioRate: input.maxPortfolioRate ? new Prisma.Decimal(input.maxPortfolioRate) : new Prisma.Decimal(0.2),
        strategyParams: input.strategyParams ? JSON.parse(input.strategyParams) : undefined,
      },
    });
  }

  async executeSimulationTick(
    sessionId: string,
    options?: { forceExecution?: boolean },
  ): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.status !== SimulationStatus.RUNNING) return;

    const strategy = this.strategyRegistry.getStrategy(session.strategyName);
    if (!strategy) {
      this.logger.warn(`Unknown strategy: ${session.strategyName} for session ${sessionId}`);
      return;
    }

    const exchangeCode = session.exchangeCode
      || (session.market === Market.DOMESTIC ? 'KRX' : 'NASD');
    if (
      !options?.forceExecution &&
      !this.shouldExecuteNow(strategy.executionMode, session.market as 'DOMESTIC' | 'OVERSEAS', exchangeCode)
    ) {
      return;
    }

    const positions = await this.prisma.simulationPosition.findMany({
      where: { sessionId },
    });

    const totalPortfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );

    const today = this.getTodayDate();

    // 공통 데이터: 세션 단위로 1회만 조회 (실거래 스케줄러와 동일)
    const primaryExchangeCode = exchangeCode;
    const market = session.market as 'DOMESTIC' | 'OVERSEAS';
    const marketRegime = await this.marketRegimeService.getRegime(market, primaryExchangeCode);
    const riskState = await this.evaluateSimulationRisk(sessionId, positions, Number(session.currentCash));

    try {
      // Get price
      const price = session.market === Market.DOMESTIC
        ? await this.kisDomestic.getPrice(session.stockCode)
        : await this.kisOverseas.getPrice(exchangeCode, session.stockCode);

      // Get indicators
      const stockIndicators = await this.marketAnalysis.getStockIndicators(
        market,
        exchangeCode,
        session.stockCode,
        price.currentPrice,
      );

      // 현재가 API에서 제공되는 추가 지표를 stockIndicators에 병합 (실거래와 동일)
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

      if (session.market === Market.DOMESTIC && ['infinite-buy', 'conservative'].includes(session.strategyName)) {
        const openDartSignals = await this.marketDataCache.getOpenDartDomesticSignals(session.stockCode);
        this.applyOpenDartSignals(stockIndicators, openDartSignals);
      }

      if (session.market === Market.OVERSEAS && ['value-factor', 'infinite-buy', 'conservative'].includes(session.strategyName)) {
        const secFundamentals = await this.marketDataCache.getSecFundamentals(
          session.stockCode,
          price.currentPrice,
          exchangeCode,
        );
        this.applySecSignals(stockIndicators, secFundamentals);
      }

      // Get market condition
      const marketCondition = await this.marketAnalysis.getMarketCondition(exchangeCode);

      // Check if already executed today
      const todayTrade = await this.prisma.simulationTrade.findFirst({
        where: {
          sessionId,
          stockCode: session.stockCode,
          tradeStatus: SimulationTradeStatus.EXECUTED,
          createdAt: this.getDayRange(today),
        },
      });

      const pos = positions.find((p) => p.stockCode === session.stockCode);
      const currentCycle = this.calculateSessionCycle(session, pos);
      const persistedCycle = this.getPersistedSessionCycle(currentCycle);

      if (persistedCycle !== session.cycle) {
        await this.prisma.simulationSession.update({
          where: { id: session.id },
          data: { cycle: persistedCycle },
        });
      }

      const watchStockConfig: WatchStockConfig = {
        id: session.id,
        market: session.market as 'DOMESTIC' | 'OVERSEAS',
        exchangeCode,
        stockCode: session.stockCode,
        stockName: session.stockName,
        strategyName: session.strategyName,
        quota: Number(session.quota),
        cycle: currentCycle,
        maxCycles: session.maxCycles,
        stopLossRate: Number(session.stopLossRate),
        maxPortfolioRate: Number(session.maxPortfolioRate),
        strategyParams: session.strategyParams as Record<string, any> | undefined,
      };

      let fundamentals: StockFundamentals | undefined;
      if (session.strategyName === 'value-factor') {
        fundamentals = await this.fetchFundamentals(
          session.market as string,
          exchangeCode,
          session.stockCode,
          price,
        );
      }

      const ctx: StockStrategyContext = {
        watchStock: watchStockConfig,
        price,
        position: pos ? {
          stockCode: pos.stockCode,
          quantity: pos.quantity,
          avgPrice: Number(pos.avgPrice),
          currentPrice: Number(pos.currentPrice),
          totalInvested: Number(pos.totalInvested),
        } : undefined,
        alreadyExecutedToday: !!todayTrade,
        marketCondition,
        stockIndicators,
        fundamentals,
        buyableAmount: Number(session.currentCash),
        totalPortfolioValue,
        marketRegime,
        riskState,
      };

      const { signals, skipReasons } = await strategy.evaluateStock(ctx);
      const hasSecondTargetSignal = signals.some((signal) => signal.metadata?.phase === 'take-profit-2');

      if (signals.length === 0) {
        this.logger.debug(
          `[SIM] ${session.stockCode} no signal | price=${price.currentPrice}` +
          ` ma20=${stockIndicators.ma20 ?? 'N/A'} ma60=${stockIndicators.ma60 ?? 'N/A'}` +
          ` adx14=${stockIndicators.adx14 ?? 'N/A'}` +
          ` alreadyToday=${!!todayTrade} pos=${pos ? `qty=${pos.quantity},avg=${Number(pos.avgPrice)}` : 'none'}` +
          ` cash=${Number(session.currentCash)}` +
          ` reason=${skipReasons.join('; ') || 'strategy conditions not met'}`,
        );
      }

      for (const signal of signals) {
        const signalPrice = signal.price || 0;
        const canFillNow = this.canFillAtPrice(signal.side, signalPrice, price.currentPrice);

        if (canFillNow) {
          this.logger.log(`[SIM] ${session.stockCode} fill: ${signal.side} x${signal.quantity} @ ${signalPrice || price.currentPrice} | reason=${signal.reason}`);
          await this.virtualExecute(sessionId, signal, price.currentPrice);
        } else {
          if (session.strategyName === 'infinite-buy' && signal.metadata?.phase === 'take-profit-2') {
            await this.markInfiniteBuySecondTargetAttempted(sessionId);
          }
          const pending: SimulationPendingOrder = {
            sessionId,
            market: signal.market,
            exchangeCode: signal.exchangeCode,
            stockCode: signal.stockCode,
            side: signal.side as 'BUY' | 'SELL',
            quantity: signal.quantity,
            price: signalPrice,
            reason: signal.reason,
            createdAt: new Date(),
            metadata: signal.metadata,
          };
          const orders = this.pendingOrders.get(sessionId) || [];
          orders.push(pending);
          this.pendingOrders.set(sessionId, orders);
          this.logger.log(`[SIM] ${session.stockCode} pending: ${signal.side} x${signal.quantity} @ ${signalPrice} | reason=${signal.reason}`);
        }
      }

      if (['infinite-buy', 'daily-dca'].includes(session.strategyName) && !todayTrade) {
        const params = (session.strategyParams as Record<string, any>) || {};
        const hasBuySignal = signals.some((s) => s.side === 'BUY');
        const perCycleQuota = Number(session.quota) / session.maxCycles;
        const shouldCarryQuota = skipReasons.some((reason) => reason.startsWith('매수 수량 부족:'));

        if (hasBuySignal) {
          if (params.accumulatedQuota) {
            await this.prisma.simulationSession.update({
              where: { id: session.id },
              data: { strategyParams: { ...params, accumulatedQuota: 0, lastAccumulatedDate: today } },
            });
          }
        } else if (
          shouldCarryQuota
          && !hasBuySignal
          && perCycleQuota > 0
          && params.lastAccumulatedDate !== today
          && !(session.strategyName === 'infinite-buy' && (hasSecondTargetSignal || this.hasActiveInfiniteBuySecondTarget(params as Record<string, any>)))
        ) {
          const newAccumulated = (params.accumulatedQuota || 0) + perCycleQuota;
          await this.prisma.simulationSession.update({
            where: { id: session.id },
            data: { strategyParams: { ...params, accumulatedQuota: newAccumulated, lastAccumulatedDate: today } },
          });
          this.logger.log(
            `[${session.stockCode}] Accumulated quota: ${newAccumulated.toFixed(2)} ` +
            `(reason: ${skipReasons.join('; ') || 'insufficient quantity'})`,
          );
        }
      }
    } catch (e) {
      this.logger.error(`Simulation tick error for ${session.stockCode}: ${e.message}`);
    }
  }

  async triggerSessionNow(sessionId: string): Promise<{ success: boolean; message: string }> {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return { success: false, message: '시뮬레이션 세션을 찾을 수 없습니다.' };
    }

    if (session.status !== SimulationStatus.RUNNING) {
      return { success: false, message: '실행 중인 시뮬레이션만 수동 실행할 수 있습니다.' };
    }

    await this.checkPendingOrders(sessionId);
    if (this.getPendingOrderCount(sessionId) > 0) {
      return { success: false, message: '열린 pending 주문이 있어 중복 실행을 막았습니다.' };
    }

    const todayRange = this.getDayRange(this.getTodayDate());
    const todayTrade = await this.prisma.simulationTrade.findFirst({
      where: {
        sessionId,
        stockCode: session.stockCode,
        tradeStatus: SimulationTradeStatus.EXECUTED,
        createdAt: todayRange,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (todayTrade) {
      return { success: false, message: '오늘 이미 체결된 거래가 있어 중복 실행을 막았습니다.' };
    }

    await this.executeSimulationTick(sessionId, { forceExecution: true });

    const latestTrade = await this.prisma.simulationTrade.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    if (latestTrade && latestTrade.createdAt >= todayRange.gte) {
      return {
        success: true,
        message: `${latestTrade.side} ${latestTrade.quantity}주 ${latestTrade.reason || '주문 실행'}`
      };
    }

    if (this.getPendingOrderCount(sessionId) > 0) {
      return { success: true, message: '수동 실행으로 pending 주문을 생성했습니다.' };
    }

    return { success: true, message: '수동 실행을 완료했지만 새 주문은 생성되지 않았습니다.' };
  }

  calculateSessionCycle(
    session: { quota: Prisma.Decimal | number; maxCycles: number },
    position?: { totalInvested: Prisma.Decimal | number } | null,
  ): number {
    const quota = Number(session.quota);
    if (!quota || quota <= 0 || session.maxCycles <= 0) {
      return 0;
    }

    const perCycleQuota = quota / session.maxCycles;
    if (perCycleQuota <= 0) {
      return 0;
    }

    const totalInvested = position?.totalInvested ? Number(position.totalInvested) : 0;
    if (totalInvested <= 0) {
      return 0;
    }

    return Math.round((totalInvested / perCycleQuota) * 10) / 10;
  }

  private describeNoSignalReason(
    strategyName: string,
    ctx: Partial<StockStrategyContext>,
  ): string {
    if (ctx.alreadyExecutedToday) return 'already executed today';

    return 'strategy conditions not met';
  }

  private getPersistedSessionCycle(cycle: number): number {
    return Math.max(0, Math.floor(cycle));
  }

  private getTodayDate(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private getDayRange(date: string): { gte: Date; lt: Date } {
    return {
      gte: new Date(`${date}T00:00:00+09:00`),
      lt: new Date(`${date}T23:59:59.999+09:00`),
    };
  }

  private shouldExecuteNow(
    executionMode: { type: 'continuous' } | {
      type: 'once-daily';
      hours: {
        domestic: number;
        overseas: { basis: 'afterOpen' | 'beforeClose'; offsetHours: number };
      };
    },
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
  ): boolean {
    if (executionMode.type === 'continuous') return true;

    const kstHour = this.getKSTHour();
    if (market === 'DOMESTIC') return kstHour === executionMode.hours.domestic;
    return kstHour === this.getOverseasExecutionHour(exchangeCode, executionMode.hours.overseas);
  }

  private getOverseasExecutionHour(
    exchangeCode: string,
    overseas: { basis: 'afterOpen' | 'beforeClose'; offsetHours: number },
  ): number {
    const hours = MARKET_HOURS[exchangeCode];
    if (!hours) return (0 + overseas.offsetHours) % 24;

    if (overseas.basis === 'afterOpen') {
      return (hours.open.hour + overseas.offsetHours) % 24;
    }

    const closeHour = hours.overnight
      ? hours.close.hour + 24
      : hours.close.hour;
    return (closeHour - overseas.offsetHours) % 24;
  }

  private getKSTHour(): number {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.getUTCHours();
  }

  private hasActiveInfiniteBuySecondTarget(strategyParams?: Record<string, any>): boolean {
    const plan = (strategyParams as InfiniteBuyStrategyParams | undefined)?.secondaryExitPlan;
    if (!plan || !plan.firstTargetDate || plan.secondTargetQuantity <= 0) return false;

    const today = this.getTodayDate();
    if (plan.firstTargetDate >= today) return false;
    return !plan.secondTargetAttemptedDate || plan.secondTargetAttemptedDate === today;
  }

  private async updateInfiniteBuyStrategyParams(
    sessionId: string,
    updater: (params: InfiniteBuyStrategyParams) => InfiniteBuyStrategyParams,
  ): Promise<void> {
    await this.updateSessionStrategyParams(
      sessionId,
      (params) => updater(params as InfiniteBuyStrategyParams),
    );
  }

  private async updateSessionStrategyParams(
    sessionId: string,
    updater: (params: Record<string, any>) => Record<string, any>,
  ): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      select: { strategyParams: true },
    });
    if (!session) return;

    const currentParams = (session.strategyParams as Record<string, any>) || {};
    await this.prisma.simulationSession.update({
      where: { id: sessionId },
      data: { strategyParams: updater(currentParams) },
    });
  }

  private async markInfiniteBuySecondTargetAttempted(sessionId: string): Promise<void> {
    const today = this.getTodayDate();
    await this.updateInfiniteBuyStrategyParams(sessionId, (params) => {
      if (!params.secondaryExitPlan) return params;
      return {
        ...params,
        secondaryExitPlan: {
          ...params.secondaryExitPlan,
          secondTargetAttemptedDate: today,
        },
      };
    });
  }

  private async clearInfiniteBuySecondaryExitPlan(sessionId: string): Promise<void> {
    await this.updateInfiniteBuyStrategyParams(sessionId, (params) => {
      const { secondaryExitPlan: _secondaryExitPlan, ...rest } = params;
      return rest;
    });
  }

  private async persistInfiniteBuySecondaryExitPlan(
    sessionId: string,
    signal: { metadata?: Record<string, any> },
  ): Promise<void> {
    const secondTargetPrice = Number(signal.metadata?.secondaryTargetPrice);
    const secondTargetRate = Number(signal.metadata?.secondaryTargetRate);
    const secondTargetQuantity = Number(signal.metadata?.secondaryTargetQuantity);
    if (!secondTargetPrice || !secondTargetRate || !secondTargetQuantity) return;

    const today = this.getTodayDate();
    await this.updateInfiniteBuyStrategyParams(sessionId, (params) => ({
      ...params,
      secondaryExitPlan: {
        firstTargetDate: today,
        secondTargetPrice,
        secondTargetRate,
        secondTargetQuantity,
      },
    }));
  }

  private async handleMomentumBreakoutSignalFill(
    sessionId: string,
    signal: { side: string; quantity: number; metadata?: Record<string, any> },
    currentPositionQty: number,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      await this.updateSessionStrategyParams(sessionId, (params) => {
        const nextParams = { ...(params as MomentumBreakoutStrategyParams) };
        nextParams.entryDate = this.getTodayDate();
        delete nextParams.halfTakeProfitDone;
        return nextParams;
      });
      return;
    }

    if (signal.metadata?.phase === 'take-profit-half') {
      const remainingQty = Math.max(0, currentPositionQty - signal.quantity);
      if (remainingQty > 0) {
        await this.updateSessionStrategyParams(sessionId, (params) => ({
          ...(params as MomentumBreakoutStrategyParams),
          halfTakeProfitDone: true,
        }));
      } else {
        await this.updateSessionStrategyParams(sessionId, (params) => {
          const nextParams = { ...(params as MomentumBreakoutStrategyParams) };
          delete nextParams.halfTakeProfitDone;
          delete nextParams.entryDate;
          return nextParams;
        });
      }
      return;
    }

    if (
      signal.metadata?.phase === 'take-profit-full'
      || signal.metadata?.phase === 'time-stop'
      || signal.quantity >= currentPositionQty
    ) {
      await this.updateSessionStrategyParams(sessionId, (params) => {
        const nextParams = { ...(params as MomentumBreakoutStrategyParams) };
        delete nextParams.halfTakeProfitDone;
        delete nextParams.entryDate;
        return nextParams;
      });
    }
  }

  private async handleGridMeanReversionSignalFill(
    sessionId: string,
    signal: { side: string; quantity: number; metadata?: Record<string, any> },
    currentPositionQty: number,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      await this.updateSessionStrategyParams(sessionId, (params) => {
        const nextParams = { ...(params as GridMeanReversionStrategyParams) };
        const gridLevel = Number(signal.metadata?.gridLevel);

        nextParams.middleTakeProfitDone = false;

        if (signal.metadata?.phase === 'grid-entry' || currentPositionQty <= 0) {
          nextParams.completedGridLevels = [];
          return nextParams;
        }

        const completedGridLevels = new Set(nextParams.completedGridLevels || []);
        if (gridLevel > 0) {
          completedGridLevels.add(gridLevel);
        }
        nextParams.completedGridLevels = Array.from(completedGridLevels).sort((a, b) => a - b);
        return nextParams;
      });
      return;
    }

    if (signal.metadata?.phase === 'take-profit-middle') {
      const remainingQty = Math.max(0, currentPositionQty - signal.quantity);
      if (remainingQty > 0) {
        await this.updateSessionStrategyParams(sessionId, (params) => ({
          ...(params as GridMeanReversionStrategyParams),
          middleTakeProfitDone: true,
        }));
      } else {
        await this.updateSessionStrategyParams(sessionId, (params) => {
          const nextParams = { ...(params as GridMeanReversionStrategyParams) };
          delete nextParams.middleTakeProfitDone;
          delete nextParams.completedGridLevels;
          return nextParams;
        });
      }
      return;
    }

    if (signal.metadata?.phase === 'take-profit-full' || signal.quantity >= currentPositionQty) {
      await this.updateSessionStrategyParams(sessionId, (params) => {
        const nextParams = { ...(params as GridMeanReversionStrategyParams) };
        delete nextParams.middleTakeProfitDone;
        delete nextParams.completedGridLevels;
        return nextParams;
      });
    }
  }

  private async handleSimulationStrategySignalFill(
    strategyName: string,
    sessionId: string,
    signal: { side: string; quantity: number; metadata?: Record<string, any> },
    currentPositionQty: number,
  ): Promise<void> {
    if (strategyName === 'momentum-breakout') {
      await this.handleMomentumBreakoutSignalFill(sessionId, signal, currentPositionQty);
      return;
    }

    if (strategyName === 'grid-mean-reversion') {
      await this.handleGridMeanReversionSignalFill(sessionId, signal, currentPositionQty);
    }
  }

  private async syncSessionCycle(sessionId: string, exchangeCode: string, stockCode: string): Promise<void> {
    const [session, position] = await Promise.all([
      this.prisma.simulationSession.findUnique({
        where: { id: sessionId },
        select: { id: true, quota: true, maxCycles: true, cycle: true },
      }),
      this.prisma.simulationPosition.findUnique({
        where: {
          sessionId_exchangeCode_stockCode: {
            sessionId,
            exchangeCode,
            stockCode,
          },
        },
        select: { totalInvested: true },
      }),
    ]);

    if (!session) return;

    const currentCycle = this.calculateSessionCycle(session, position);
    const persistedCycle = this.getPersistedSessionCycle(currentCycle);
    if (persistedCycle === session.cycle) return;

    await this.prisma.simulationSession.update({
      where: { id: sessionId },
      data: { cycle: persistedCycle },
    });
  }

  private estimateInfiniteBuyQuota(ctx: StockStrategyContext): number {
    const { watchStock, marketCondition, stockIndicators, buyableAmount } = ctx;
    if (!watchStock.quota || watchStock.quota <= 0) return 0;

    const accumulatedQuota = Number((watchStock.strategyParams as Record<string, unknown> | undefined)?.accumulatedQuota || 0);
    const perCycleQuota = watchStock.quota / watchStock.maxCycles;
    const totalInvested = ctx.position?.totalInvested || 0;
    const cycleProgress = perCycleQuota > 0 ? totalInvested / perCycleQuota : 0;
    let adjustedQuota = cycleProgress >= watchStock.maxCycles ? 0 : perCycleQuota + accumulatedQuota;

    if (marketCondition.referenceIndexAboveMA200 === false) adjustedQuota *= 0.75;
    if (marketCondition.interestRateRising) adjustedQuota *= 0.8;
    if (stockIndicators.rsi14 !== undefined && stockIndicators.rsi14 < 30) adjustedQuota *= 1.25;
    if (this.hasNegativeConsensus(stockIndicators.consensusRating, stockIndicators.targetPriceUpside)) adjustedQuota *= 0.7;
    if ((stockIndicators.recentMaterialDisclosureCount30d ?? 0) >= 2 || (stockIndicators.recentSecForm8KCount30d ?? 0) >= 3) adjustedQuota *= 0.6;
    if (stockIndicators.loanBalanceRate !== undefined && stockIndicators.loanBalanceRate > 10) adjustedQuota *= 0.7;
    if ((stockIndicators.dividendYield ?? 0) >= 2 && (stockIndicators.consecutiveDividendYears ?? 0) >= 5) adjustedQuota *= 1.15;
    if ((stockIndicators.insiderOwnershipChangeRate ?? 0) > 0.05) adjustedQuota *= 1.1;
    if ((stockIndicators.volatility30d ?? 0) >= 45) adjustedQuota *= 0.7;
    if (this.hasStrongSellFlow(stockIndicators.foreignNetBuy, stockIndicators.institutionNetBuy, stockIndicators.programTradeDirection)) {
      adjustedQuota *= 0.7;
    }

    return Math.min(adjustedQuota, buyableAmount);
  }

  private hasNegativeConsensus(rating?: string, targetPriceUpside?: number): boolean {
    const negativeRating = /(SELL|REDUCE|비중축소|매도)/i.test(rating ?? '');
    return negativeRating || (targetPriceUpside !== undefined && targetPriceUpside < -15);
  }

  private hasStrongSellFlow(
    foreignNetBuy?: boolean,
    institutionNetBuy?: boolean,
    programTradeDirection?: string,
  ): boolean {
    const hasFlowData =
      foreignNetBuy !== undefined ||
      institutionNetBuy !== undefined ||
      programTradeDirection !== undefined;
    if (!hasFlowData) return false;
    return foreignNetBuy === false
      && institutionNetBuy === false
      && programTradeDirection === 'SELL';
  }

  /** 지정가 체결 가능 여부 판정 */
  private canFillAtPrice(side: string, signalPrice: number, currentMarketPrice: number): boolean {
    // 시장가 주문 (price=0)은 항상 체결
    if (!signalPrice || signalPrice <= 0) return true;

    // BUY 지정가: 현재가가 지정가 이하이면 체결 (가격이 내려왔으면 살 수 있음)
    if (side === 'BUY') return currentMarketPrice <= signalPrice;

    // SELL 지정가: 현재가가 지정가 이상이면 체결 (가격이 올라왔으면 팔 수 있음)
    if (side === 'SELL') return currentMarketPrice >= signalPrice;

    return false;
  }

  private async virtualExecute(
    sessionId: string,
    signal: { market: string; exchangeCode: string; stockCode: string; side: string; quantity: number; price?: number; reason: string; metadata?: Record<string, any> },
    currentMarketPrice: number,
  ): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const signalPrice = signal.price || 0;

    // 체결가: 시장가 주문이면 현재가, 지정가면 시그널 가격
    const price = signalPrice > 0 ? signalPrice : currentMarketPrice;
    const totalAmount = price * signal.quantity;

    if (signal.side === 'BUY') {
      // Check cash
      if (totalAmount > Number(session.currentCash)) {
        this.logger.warn(`Insufficient cash for BUY ${signal.stockCode}: need ${totalAmount}, have ${session.currentCash}`);
        await this.prisma.simulationTrade.create({
          data: {
            sessionId,
            market: signal.market as Market,
            exchangeCode: signal.exchangeCode,
            stockCode: signal.stockCode,
            stockName: session.stockName,
            side: Side.BUY,
            quantity: signal.quantity,
            price: new Prisma.Decimal(price),
            totalAmount: new Prisma.Decimal(totalAmount),
            tradeStatus: SimulationTradeStatus.FAILED,
            failReason: `Insufficient cash: need ${totalAmount.toLocaleString()}, have ${Number(session.currentCash).toLocaleString()}`,
            strategyName: session.strategyName,
            reason: signal.reason,
          },
        });
        return;
      }

      // Create trade
      await this.prisma.simulationTrade.create({
        data: {
          sessionId,
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName: session.stockName,
          side: Side.BUY,
          quantity: signal.quantity,
          price: new Prisma.Decimal(price),
          totalAmount: new Prisma.Decimal(totalAmount),
          strategyName: session.strategyName,
          reason: signal.reason,
        },
      });

      // Upsert position (weighted avg price)
      const existingPos = await this.prisma.simulationPosition.findUnique({
        where: { sessionId_exchangeCode_stockCode: { sessionId, exchangeCode: signal.exchangeCode, stockCode: signal.stockCode } },
      });

      if (existingPos) {
        const oldQty = existingPos.quantity;
        const oldAvgPrice = Number(existingPos.avgPrice);
        const newQty = oldQty + signal.quantity;
        const newAvgPrice = (oldAvgPrice * oldQty + price * signal.quantity) / newQty;
        const newTotalInvested = Number(existingPos.totalInvested) + totalAmount;
        const profitLoss = (price - newAvgPrice) * newQty;
        const profitRate = newAvgPrice > 0 ? (price - newAvgPrice) / newAvgPrice : 0;

        await this.prisma.simulationPosition.update({
          where: { id: existingPos.id },
          data: {
            quantity: newQty,
            avgPrice: new Prisma.Decimal(newAvgPrice),
            currentPrice: new Prisma.Decimal(price),
            totalInvested: new Prisma.Decimal(newTotalInvested),
            profitLoss: new Prisma.Decimal(profitLoss),
            profitRate: new Prisma.Decimal(profitRate),
          },
        });
      } else {
        await this.prisma.simulationPosition.create({
          data: {
            sessionId,
            market: signal.market as Market,
            exchangeCode: signal.exchangeCode,
            stockCode: signal.stockCode,
            stockName: session.stockName,
            quantity: signal.quantity,
            avgPrice: new Prisma.Decimal(price),
            currentPrice: new Prisma.Decimal(price),
            totalInvested: new Prisma.Decimal(totalAmount),
            profitLoss: new Prisma.Decimal(0),
            profitRate: new Prisma.Decimal(0),
          },
        });
      }

      // Update cash (decrement으로 race condition 방지)
      await this.prisma.simulationSession.update({
        where: { id: sessionId },
        data: { currentCash: { decrement: new Prisma.Decimal(totalAmount) } },
      });

      if (session.strategyName === 'infinite-buy') {
        await this.clearInfiniteBuySecondaryExitPlan(sessionId);
      }

      await this.handleSimulationStrategySignalFill(
        session.strategyName,
        sessionId,
        signal,
        existingPos?.quantity || 0,
      );

      await this.syncSessionCycle(sessionId, signal.exchangeCode, signal.stockCode);

      this.logger.log(`[SIM] BUY ${signal.stockCode} x${signal.quantity} @ ${price} (session: ${sessionId})`);
    } else {
      // SELL
      const existingPos = await this.prisma.simulationPosition.findUnique({
        where: { sessionId_exchangeCode_stockCode: { sessionId, exchangeCode: signal.exchangeCode, stockCode: signal.stockCode } },
      });

      if (!existingPos) {
        this.logger.warn(`No position for SELL ${signal.stockCode}`);
        await this.prisma.simulationTrade.create({
          data: {
            sessionId,
            market: signal.market as Market,
            exchangeCode: signal.exchangeCode,
            stockCode: signal.stockCode,
            stockName: session.stockName,
            side: Side.SELL,
            quantity: signal.quantity,
            price: new Prisma.Decimal(price),
            totalAmount: new Prisma.Decimal(totalAmount),
            tradeStatus: SimulationTradeStatus.FAILED,
            failReason: 'No position held',
            strategyName: session.strategyName,
            reason: signal.reason,
          },
        });
        return;
      }

      if (existingPos.quantity < signal.quantity) {
        this.logger.warn(`Insufficient quantity for SELL ${signal.stockCode}: need ${signal.quantity}, have ${existingPos.quantity}`);
        await this.prisma.simulationTrade.create({
          data: {
            sessionId,
            market: signal.market as Market,
            exchangeCode: signal.exchangeCode,
            stockCode: signal.stockCode,
            stockName: session.stockName,
            side: Side.SELL,
            quantity: signal.quantity,
            price: new Prisma.Decimal(price),
            totalAmount: new Prisma.Decimal(totalAmount),
            tradeStatus: SimulationTradeStatus.FAILED,
            failReason: `Insufficient quantity: need ${signal.quantity}, have ${existingPos.quantity}`,
            strategyName: session.strategyName,
            reason: signal.reason,
          },
        });
        return;
      }

      // Create trade
      await this.prisma.simulationTrade.create({
        data: {
          sessionId,
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          stockName: session.stockName,
          side: Side.SELL,
          quantity: signal.quantity,
          price: new Prisma.Decimal(price),
          totalAmount: new Prisma.Decimal(totalAmount),
          strategyName: session.strategyName,
          reason: signal.reason,
        },
      });

      // Update or delete position
      const newQty = existingPos.quantity - signal.quantity;
      if (newQty === 0) {
        await this.prisma.simulationPosition.delete({ where: { id: existingPos.id } });
      } else {
        const profitLoss = (price - Number(existingPos.avgPrice)) * newQty;
        const profitRate = Number(existingPos.avgPrice) > 0
          ? (price - Number(existingPos.avgPrice)) / Number(existingPos.avgPrice)
          : 0;
        const newTotalInvested = Number(existingPos.avgPrice) * newQty;

        await this.prisma.simulationPosition.update({
          where: { id: existingPos.id },
          data: {
            quantity: newQty,
            currentPrice: new Prisma.Decimal(price),
            totalInvested: new Prisma.Decimal(newTotalInvested),
            profitLoss: new Prisma.Decimal(profitLoss),
            profitRate: new Prisma.Decimal(profitRate),
          },
        });
      }

      // Update cash (increment로 race condition 방지)
      await this.prisma.simulationSession.update({
        where: { id: sessionId },
        data: { currentCash: { increment: new Prisma.Decimal(totalAmount) } },
      });

      if (session.strategyName === 'infinite-buy') {
        if (signal.metadata?.phase === 'take-profit-1' && newQty > 0) {
          await this.persistInfiniteBuySecondaryExitPlan(sessionId, signal);
        } else {
          await this.clearInfiniteBuySecondaryExitPlan(sessionId);
        }
      }

      await this.handleSimulationStrategySignalFill(
        session.strategyName,
        sessionId,
        signal,
        existingPos.quantity,
      );

      await this.syncSessionCycle(sessionId, signal.exchangeCode, signal.stockCode);

      this.logger.log(`[SIM] SELL ${signal.stockCode} x${signal.quantity} @ ${price} (session: ${sessionId})`);
    }
  }

  /** 매 tick(1분)마다 호출: pending order들을 현재가와 비교하여 체결 시도 */
  async checkPendingOrders(sessionId: string): Promise<void> {
    const orders = this.pendingOrders.get(sessionId);
    if (!orders || orders.length === 0) return;

    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.status !== SimulationStatus.RUNNING) {
      this.pendingOrders.delete(sessionId);
      return;
    }

    // 종목별 현재가 조회 (pending order에 있는 종목만)
    const stockCodes = [...new Set(orders.map((o) => o.stockCode))];
    const priceMap = new Map<string, number>();

    for (const stockCode of stockCodes) {
      try {
        const exchangeCode = session.exchangeCode || (session.market === Market.DOMESTIC ? 'KRX' : 'NASD');
        const priceData = session.market === Market.DOMESTIC
          ? await this.kisDomestic.getPrice(stockCode)
          : await this.kisOverseas.getPrice(exchangeCode, stockCode);
        priceMap.set(stockCode, priceData.currentPrice);
      } catch (e) {
        this.logger.error(`[SIM] Failed to get price for pending order ${stockCode}: ${e.message}`);
      }
    }

    // 체결 가능한 주문 처리
    const remaining: SimulationPendingOrder[] = [];
    for (const order of orders) {
      const currentPrice = priceMap.get(order.stockCode);
      if (currentPrice === undefined) {
        remaining.push(order);
        continue;
      }

      if (this.canFillAtPrice(order.side, order.price, currentPrice)) {
        this.logger.log(
          `[SIM] ${order.stockCode} pending filled: ${order.side} x${order.quantity} @ ${order.price}` +
          ` (market=${currentPrice}) | reason=${order.reason}`,
        );
        await this.virtualExecute(order.sessionId, {
          market: order.market,
          exchangeCode: order.exchangeCode,
          stockCode: order.stockCode,
          side: order.side,
          quantity: order.quantity,
          price: order.price,
          reason: order.reason,
          metadata: order.metadata,
        }, currentPrice);
      } else {
        remaining.push(order);
      }
    }

    if (remaining.length > 0) {
      this.pendingOrders.set(sessionId, remaining);
    } else {
      this.pendingOrders.delete(sessionId);
    }
  }

  /** 장 마감 시 호출: 미체결 pending order 전량 취소 */
  cancelPendingOrders(sessionId: string): void {
    const orders = this.pendingOrders.get(sessionId);
    if (!orders || orders.length === 0) return;

    for (const order of orders) {
      this.logger.log(
        `[SIM] ${order.stockCode} pending cancelled (EOD): ${order.side} x${order.quantity} @ ${order.price} | reason=${order.reason}`,
      );
    }
    this.pendingOrders.delete(sessionId);
  }

  /** 특정 세션의 pending order 개수 조회 */
  getPendingOrderCount(sessionId: string): number {
    return this.pendingOrders.get(sessionId)?.length ?? 0;
  }

  async takeSnapshot(sessionId: string): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const positions = await this.prisma.simulationPosition.findMany({ where: { sessionId } });
    const today = this.getTodayDate();

    const portfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );
    const cashBalance = Number(session.currentCash);
    const totalValue = portfolioValue + cashBalance;

    // Get previous snapshot for daily PnL
    const prevSnapshot = await this.prisma.simulationSnapshot.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    const startingCapital = Number(session.quota);
    const prevTotalValue = prevSnapshot ? Number(prevSnapshot.totalValue) : startingCapital;
    const dailyPnl = totalValue - prevTotalValue;
    const dailyPnlRate = prevTotalValue > 0 ? dailyPnl / prevTotalValue : 0;

    // Drawdown calculation
    const peakValue = prevSnapshot
      ? Math.max(Number(prevSnapshot.peakValue), totalValue)
      : Math.max(startingCapital, totalValue);
    const drawdown = peakValue > 0 ? (peakValue - totalValue) / peakValue : 0;

    // Trade count today
    const todayTrades = await this.prisma.simulationTrade.count({
      where: {
        sessionId,
        tradeStatus: SimulationTradeStatus.EXECUTED,
        createdAt: this.getDayRange(today),
      },
    });

    await this.prisma.simulationSnapshot.upsert({
      where: { sessionId_snapshotDate: { sessionId, snapshotDate: today } },
      create: {
        sessionId,
        snapshotDate: today,
        portfolioValue: new Prisma.Decimal(portfolioValue),
        cashBalance: new Prisma.Decimal(cashBalance),
        totalValue: new Prisma.Decimal(totalValue),
        dailyPnl: new Prisma.Decimal(dailyPnl),
        dailyPnlRate: new Prisma.Decimal(dailyPnlRate),
        drawdown: new Prisma.Decimal(drawdown),
        peakValue: new Prisma.Decimal(peakValue),
        positionCount: positions.length,
        tradeCount: todayTrades,
      },
      update: {
        portfolioValue: new Prisma.Decimal(portfolioValue),
        cashBalance: new Prisma.Decimal(cashBalance),
        totalValue: new Prisma.Decimal(totalValue),
        dailyPnl: new Prisma.Decimal(dailyPnl),
        dailyPnlRate: new Prisma.Decimal(dailyPnlRate),
        drawdown: new Prisma.Decimal(drawdown),
        peakValue: new Prisma.Decimal(peakValue),
        positionCount: positions.length,
        tradeCount: todayTrades,
      },
    });
  }

  async getMetrics(sessionId: string): Promise<SimulationMetrics> {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const positions = await this.prisma.simulationPosition.findMany({ where: { sessionId } });
    const snapshots = await this.prisma.simulationSnapshot.findMany({
      where: { sessionId },
      orderBy: { snapshotDate: 'asc' },
    });
    const trades = await this.prisma.simulationTrade.findMany({
      where: { sessionId, tradeStatus: SimulationTradeStatus.EXECUTED },
      orderBy: { createdAt: 'asc' },
    });

    const currentPortfolioValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );
    const currentCash = Number(session.currentCash);
    const totalValue = currentPortfolioValue + currentCash;
    const startingCapital = Number(session.quota);

    const totalReturnAmount = totalValue - startingCapital;
    const totalReturn = startingCapital > 0 ? totalReturnAmount / startingCapital : 0;

    // Max drawdown from snapshots
    const maxDrawdown = snapshots.length > 0
      ? Math.max(...snapshots.map((s) => Number(s.drawdown)))
      : 0;

    // Win rate: for each SELL trade, check if sell price > avg buy price at that time
    const sellTrades = trades.filter((t) => t.side === Side.SELL);
    let winTrades = 0;
    let lossTrades = 0;
    let totalProfit = 0;
    let totalLoss = 0;

    for (const sellTrade of sellTrades) {
      // Calculate avg buy price from all preceding buy trades for this stock
      const buyTrades = trades.filter(
        (t) => t.side === Side.BUY && t.stockCode === sellTrade.stockCode && t.createdAt <= sellTrade.createdAt,
      );
      const sellsBefore = trades.filter(
        (t) => t.side === Side.SELL && t.stockCode === sellTrade.stockCode && t.createdAt < sellTrade.createdAt,
      );

      // Replay to get avg buy price
      let totalBuyQty = 0;
      let totalBuyCost = 0;
      for (const bt of buyTrades) {
        totalBuyQty += bt.quantity;
        totalBuyCost += bt.quantity * Number(bt.price);
      }
      let totalSoldQty = 0;
      for (const st of sellsBefore) {
        totalSoldQty += st.quantity;
      }

      const remainingQty = totalBuyQty - totalSoldQty;
      const avgBuyPrice = remainingQty > 0 ? totalBuyCost / totalBuyQty : 0;

      const sellPrice = Number(sellTrade.price);
      const pnl = (sellPrice - avgBuyPrice) * sellTrade.quantity;

      if (pnl >= 0) {
        winTrades++;
        totalProfit += pnl;
      } else {
        lossTrades++;
        totalLoss += Math.abs(pnl);
      }
    }

    const totalTrades = sellTrades.length;
    const winRate = totalTrades > 0 ? winTrades / totalTrades : 0;

    // Sharpe ratio from daily returns
    let sharpeRatio = 0;
    if (snapshots.length > 1) {
      const dailyReturns = snapshots.map((s) => Number(s.dailyPnlRate));
      const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
    }

    // Profit factor
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

    // Realized PnL: net profit from all completed sell trades
    const realizedPnL = totalProfit - totalLoss;

    // Unrealized PnL: sum of open position profit/loss
    const unrealizedPnL = positions.reduce((sum, p) => sum + Number(p.profitLoss), 0);

    return {
      totalReturn,
      totalReturnAmount,
      realizedPnL,
      unrealizedPnL,
      maxDrawdown,
      winRate,
      totalTrades,
      winTrades,
      lossTrades,
      sharpeRatio,
      profitFactor: profitFactor === Infinity ? 999 : profitFactor,
      currentCash,
      currentPortfolioValue,
    };
  }

  async resetSession(sessionId: string) {
    const session = await this.prisma.simulationSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const strategyParams = ((session.strategyParams as Record<string, any> | undefined) ?? {});
    const {
      accumulatedQuota: _accumulatedQuota,
      lastAccumulatedDate: _lastAccumulatedDate,
      secondaryExitPlan: _secondaryExitPlan,
      ...resettableStrategyParams
    } = strategyParams;

    this.pendingOrders.delete(sessionId);
    await this.prisma.simulationTrade.deleteMany({ where: { sessionId } });
    await this.prisma.simulationPosition.deleteMany({ where: { sessionId } });
    await this.prisma.simulationSnapshot.deleteMany({ where: { sessionId } });

    return this.prisma.simulationSession.update({
      where: { id: sessionId },
      data: {
        currentCash: session.quota,
        cycle: 0,
        status: SimulationStatus.RUNNING,
        stoppedAt: null,
        strategyParams: Object.keys(resettableStrategyParams).length > 0 ? resettableStrategyParams : Prisma.JsonNull,
      },
    });
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    this.pendingOrders.delete(sessionId);
    await this.prisma.simulationSession.delete({ where: { id: sessionId } });
    return true;
  }

  async updatePositionPrices(sessionId: string): Promise<void> {
    const session = await this.prisma.simulationSession.findUnique({
      where: { id: sessionId },
      include: { positions: true },
    });
    if (!session) return;

    for (const pos of session.positions) {
      try {
        const exchangeCode = pos.exchangeCode;
        const price = session.market === Market.DOMESTIC
          ? await this.kisDomestic.getPrice(pos.stockCode)
          : await this.kisOverseas.getPrice(exchangeCode, pos.stockCode);

        const currentPrice = price.currentPrice;
        const avgPrice = Number(pos.avgPrice);
        const profitLoss = (currentPrice - avgPrice) * pos.quantity;
        const profitRate = avgPrice > 0 ? (currentPrice - avgPrice) / avgPrice : 0;

        await this.prisma.simulationPosition.update({
          where: { id: pos.id },
          data: {
            currentPrice: new Prisma.Decimal(currentPrice),
            profitLoss: new Prisma.Decimal(profitLoss),
            profitRate: new Prisma.Decimal(profitRate),
          },
        });
      } catch (e) {
        this.logger.error(`Failed to update price for ${pos.stockCode}: ${e.message}`);
      }
    }
  }

  async updateStatus(id: string, status: SimulationStatus) {
    const data: any = { status };
    if (status === SimulationStatus.COMPLETED) {
      data.stoppedAt = new Date();
    }
    return this.prisma.simulationSession.update({
      where: { id },
      data,
    });
  }

  async updateSettings(
    id: string,
    data: {
      name?: string;
      stopLossRate?: number;
      maxCycles?: number;
    },
  ) {
    const updateData: Prisma.SimulationSessionUpdateInput = {};

    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) {
        throw new BadRequestException('시뮬레이션 이름은 비워둘 수 없습니다.');
      }
      updateData.name = name;
    }

    if (data.stopLossRate !== undefined) {
      if (data.stopLossRate < 0 || data.stopLossRate >= 1) {
        throw new BadRequestException('손절률은 0% 이상 100% 미만이어야 합니다.');
      }
      updateData.stopLossRate = new Prisma.Decimal(data.stopLossRate);
    }

    if (data.maxCycles !== undefined) {
      if (!Number.isInteger(data.maxCycles) || data.maxCycles <= 0) {
        throw new BadRequestException('사이클 수는 1 이상의 정수여야 합니다.');
      }
      updateData.maxCycles = data.maxCycles;
    }

    return this.prisma.simulationSession.update({
      where: { id },
      data: updateData,
      include: { positions: true },
    });
  }

  async getSessions(status?: SimulationStatus) {
    const where = status ? { status } : {};
    return this.prisma.simulationSession.findMany({
      where,
      include: { positions: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSession(id: string) {
    return this.prisma.simulationSession.findUnique({
      where: { id },
      include: { positions: true },
    });
  }

  async getPositions(sessionId: string) {
    return this.prisma.simulationPosition.findMany({
      where: { sessionId },
      orderBy: { stockCode: 'asc' },
    });
  }

  async getTrades(
    sessionId: string,
    limit?: number,
    offset?: number,
    tradeStatus?: SimulationTradeStatus,
  ) {
    return this.prisma.simulationTrade.findMany({
      where: {
        sessionId,
        ...(tradeStatus ? { tradeStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit || 50,
      skip: offset || 0,
    });
  }

  async getSnapshots(sessionId: string) {
    return this.prisma.simulationSnapshot.findMany({
      where: { sessionId },
      orderBy: { snapshotDate: 'asc' },
    });
  }

  /** 시뮬레이션용 리스크 상태 평가 (실거래 RiskManagementService.evaluateRisk와 동일 로직) */
  private async evaluateSimulationRisk(
    sessionId: string,
    positions: { stockCode: string; quantity: number; avgPrice: any; currentPrice: any }[],
    currentCash: number,
  ): Promise<RiskState> {
    const reasons: string[] = [];

    const positionCount = positions.length;
    const totalCurrentValue = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.currentPrice),
      0,
    );
    const totalInvested = positions.reduce(
      (sum, p) => sum + Number(p.quantity) * Number(p.avgPrice),
      0,
    );

    const totalValue = totalCurrentValue + currentCash;
    const investedRate = totalValue > 0 ? totalCurrentValue / totalValue : 0;

    // 일일 PnL
    const dailyPnl = totalCurrentValue - totalInvested;
    const dailyPnlRate = totalInvested > 0 ? dailyPnl / totalInvested : 0;

    // MDD 계산: 시뮬레이션 스냅샷에서 peakValue 참조
    const latestSnapshot = await this.prisma.simulationSnapshot.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    // MDD는 총 자산(포지션 + 현금) 기준으로 계산해야 정확
    const peakValue = latestSnapshot
      ? Math.max(Number(latestSnapshot.peakValue), totalValue)
      : totalValue;
    const drawdown = peakValue > 0 ? (totalValue - peakValue) / peakValue : 0;

    return {
      buyBlocked: false,
      liquidateAll: false,
      positionCount,
      investedRate,
      dailyPnlRate,
      drawdown,
      reasons,
    };
  }

  /** 재무 데이터 조회 (밸류 팩터 전략용) */
  private applyOpenDartSignals(
    stockIndicators: StockStrategyContext['stockIndicators'],
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
    stockIndicators: StockStrategyContext['stockIndicators'],
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

      // 해외: 현재가상세 API에서 PER/PBR/EPS 제공
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
