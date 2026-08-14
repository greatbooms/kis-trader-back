import { Injectable, Logger } from '@nestjs/common';
import { Broker, Market, Prisma, Side, SimulationStatus, SimulationTradeStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { StrategyRegistryService } from '../trading/strategy/strategy-registry.service';
import { MarketAnalysisService } from '../trading/market-analysis.service';
import { MarketRegimeService } from '../trading/market-regime.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { MarketDataCacheService } from '../market-data/market-data-cache.service';
import {
  StockStrategyContext,
  WatchStockConfig,
  StockFundamentals,
  TradingSignal,
  InfiniteBuyStrategyParams,
  MomentumBreakoutStrategyParams,
  GridMeanReversionStrategyParams,
} from '../trading/types';
import { OpenDartDomesticSignals } from '../opendart/types';
import { SecFundamentals } from '../sec/types';
import { StockPriceResult } from '../kis/types/kis-api.types';
import { getMarketHours } from '../kis/types/kis-config.types';
import { SimulationPendingOrder } from './types';
import { SimulationSessionManager } from './simulation-session-manager.service';
import { SimulationPositionService } from './simulation-position.service';
import { SimulationMetricsService } from './simulation-metrics.service';

type KstExecutionTime = {
  hour: number;
  minute: number;
};

/**
 * 시뮬레이션 틱 실행 엔진.
 * - 전략 실행 루프 (컨텍스트 빌드 → 전략 평가 → 가상 체결/대기)
 * - 지정가 pending order 체결 감시 / 장 마감 취소
 * - 전략별 체결 후처리 (momentum-breakout, grid-mean-reversion, infinite-buy 등)
 * - 수동 실행 엔트리 (triggerSessionNow)
 *
 * 설계 원칙:
 * - 세션/포지션/스냅샷 상태의 "비전략" 변경은 각각 SessionManager/PositionService/MetricsService에 위임한다.
 * - 가상 체결(거래 레코드 생성 + 현금 변동 + 포지션 갱신)은 이 서비스가 책임진다.
 */
@Injectable()
export class SimulationTickEngine {
  private readonly logger = new Logger(SimulationTickEngine.name);
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
    private sessionManager: SimulationSessionManager,
    private positionService: SimulationPositionService,
    private metricsService: SimulationMetricsService,
  ) {}

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
    const riskState = await this.metricsService.evaluateSimulationRisk(
      sessionId,
      positions,
      Number(session.currentCash),
    );

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
      const currentCycle = this.positionService.calculateSessionCycle(session, pos);
      const persistedCycle = this.positionService.getPersistedSessionCycle(currentCycle);

      if (persistedCycle !== session.cycle) {
        await this.prisma.simulationSession.update({
          where: { id: session.id },
          data: { cycle: persistedCycle },
        });
      }

      const params = (session.strategyParams as Record<string, any>) || {};

      const watchStockConfig: WatchStockConfig = {
        id: session.id,
        broker: Broker.KIS,
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
        strategyParams: params,
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

      // 세션 내 pending 주문 → continuous 전략의 중복 주문 방지 플래그 (실거래와 동일 계약)
      const sessionPendingOrders = this.pendingOrders.get(sessionId) || [];

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
        hasOpenBuyOrder: sessionPendingOrders.some((order) => order.side === 'BUY'),
        hasOpenSellOrder: sessionPendingOrders.some((order) => order.side === 'SELL'),
      };

      const { signals, skipReasons, details } = await strategy.evaluateStock(ctx);
      const hasSecondTargetSignal = signals.some((signal) => signal.metadata?.phase === 'take-profit-2');
      const routineAlreadyExecutedSkip = this.isRoutineAlreadyExecutedSkip(skipReasons);
      let evaluationStatus: string | undefined;
      let evaluationDetails: Record<string, any> | undefined;

      if (signals.length === 0 && !routineAlreadyExecutedSkip) {
        evaluationStatus = this.buildSimulationSkipMessage(session, skipReasons, details);
        evaluationDetails = this.buildSimulationSkipDetails(session, skipReasons, details);
        this.logger.debug(
          `[SIM] ${session.stockCode} no signal | price=${price.currentPrice}` +
          ` ma20=${stockIndicators.ma20 ?? 'N/A'} ma60=${stockIndicators.ma60 ?? 'N/A'}` +
          ` adx14=${stockIndicators.adx14 ?? 'N/A'}` +
          ` alreadyToday=${!!todayTrade} pos=${pos ? `qty=${pos.quantity},avg=${Number(pos.avgPrice)}` : 'none'}` +
          ` cash=${Number(session.currentCash)}` +
          ` reason=${skipReasons.join('; ') || 'strategy conditions not met'}`,
        );
      } else if (signals.length > 0) {
        evaluationStatus = this.buildSimulationSignalMessage(signals);
        evaluationDetails = {
          signals: signals.map((signal) => ({
            side: signal.side,
            quantity: signal.quantity,
            price: signal.price,
            reason: signal.reason,
          })),
        };
      }

      for (const signal of signals) {
        const signalPrice = signal.price || 0;
        const canFillNow = this.canFillAtPrice(signal.side, signalPrice, price.currentPrice);

        if (canFillNow) {
          this.logger.log(`[SIM] ${session.stockCode} fill: ${signal.side} x${signal.quantity} @ ${signalPrice || price.currentPrice} | reason=${signal.reason}`);
          await this.virtualExecute(sessionId, signal, price.currentPrice);
        } else {
          if (session.strategyName === 'infinite-buy' && signal.metadata?.phase === 'take-profit-2') {
            await this.sessionManager.markInfiniteBuySecondTargetAttempted(sessionId, today);
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

      let strategyParamsUpdated = false;

      if (['infinite-buy', 'daily-dca'].includes(session.strategyName) && !todayTrade) {
        const hasBuySignal = signals.some((s) => s.side === 'BUY');
        const perCycleQuota = Number(session.quota) / session.maxCycles;
        const shouldCarryQuota = skipReasons.some((reason) => reason.startsWith('매수 수량 부족:'));
        const remainingQuota = Math.max(0, Number(session.quota) - Number(pos?.totalInvested || 0));

        if (hasBuySignal) {
          // 일일 상한 (dailyCap) 적용된 경우 미투입 잔액을 다음 날로 이월 (P7)
          const dailyCapCarryOut = Math.max(
            0,
            Math.min(Number(details?.dailyCapCarryOut) || 0, remainingQuota),
          );
          const newAccumulatedAfterBuy = dailyCapCarryOut;
          if ((params.accumulatedQuota || 0) !== newAccumulatedAfterBuy) {
            await this.prisma.simulationSession.update({
              where: { id: session.id },
              data: {
                strategyParams: this.sessionManager.mergeSimulationStrategyParams(
                  params,
                  { accumulatedQuota: newAccumulatedAfterBuy, lastAccumulatedDate: today },
                  evaluationStatus,
                  today,
                  evaluationDetails,
                ),
              },
            });
            strategyParamsUpdated = true;
          }
        } else if (
          shouldCarryQuota
          && !hasBuySignal
          && perCycleQuota > 0
          && remainingQuota > 0
          && params.lastAccumulatedDate !== today
          && !(session.strategyName === 'infinite-buy' && (hasSecondTargetSignal || this.hasActiveInfiniteBuySecondTarget(params as Record<string, any>)))
        ) {
          const newAccumulated = Math.min((params.accumulatedQuota || 0) + perCycleQuota, remainingQuota);
          evaluationStatus = this.buildSimulationSkipMessage(session, skipReasons, details, newAccumulated);
          evaluationDetails = this.buildSimulationSkipDetails(session, skipReasons, details, newAccumulated);
          await this.prisma.simulationSession.update({
            where: { id: session.id },
            data: {
              strategyParams: this.sessionManager.mergeSimulationStrategyParams(
                params,
                { accumulatedQuota: newAccumulated, lastAccumulatedDate: today },
                evaluationStatus,
                today,
                evaluationDetails,
              ),
            },
          });
          strategyParamsUpdated = true;
          this.logger.log(
            `[${session.stockCode}] Accumulated quota: ${newAccumulated.toFixed(2)} ` +
            `(reason: ${skipReasons.join('; ') || 'insufficient quantity'})`,
          );
        }
      }

      if (evaluationStatus && !routineAlreadyExecutedSkip && !strategyParamsUpdated) {
        await this.prisma.simulationSession.update({
          where: { id: session.id },
          data: {
            strategyParams: this.sessionManager.mergeSimulationStrategyParams(
              params,
              {},
              evaluationStatus,
              today,
              evaluationDetails,
            ),
          },
        });
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

  /** 세션 삭제/리셋 시 pending 큐를 비운다. */
  clearPendingOrders(sessionId: string): void {
    this.pendingOrders.delete(sessionId);
  }

  // ──────────────────────────────────────────────────────────
  // 가상 체결
  // ──────────────────────────────────────────────────────────

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
        await this.sessionManager.clearInfiniteBuySecondaryExitPlan(sessionId);
      }

      await this.handleSimulationStrategySignalFill(
        session.strategyName,
        sessionId,
        signal,
        existingPos?.quantity || 0,
      );

      await this.positionService.syncSessionCycle(sessionId, signal.exchangeCode, signal.stockCode);

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
          await this.sessionManager.persistInfiniteBuySecondaryExitPlan(
            sessionId,
            this.getTodayDate(),
            signal,
          );
        } else {
          await this.sessionManager.clearInfiniteBuySecondaryExitPlan(sessionId);
        }
      }

      await this.handleSimulationStrategySignalFill(
        session.strategyName,
        sessionId,
        signal,
        existingPos.quantity,
      );

      await this.positionService.syncSessionCycle(sessionId, signal.exchangeCode, signal.stockCode);

      this.logger.log(`[SIM] SELL ${signal.stockCode} x${signal.quantity} @ ${price} (session: ${sessionId})`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 전략별 체결 후처리
  // ──────────────────────────────────────────────────────────

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

  /** 당일청산 변동성 돌파의 전량 청산 phase — 실거래(TradingService)와 동일 목록 유지 */
  private static readonly MOMENTUM_FULL_EXIT_PHASES = new Set([
    'carryover-exit',
    'intraday-stop',
    'trailing-stop',
    'take-profit',
    'eod-exit',
    'risk-liquidation',
  ]);

  private async handleMomentumBreakoutSignalFill(
    sessionId: string,
    signal: { side: string; quantity: number; metadata?: Record<string, any> },
    currentPositionQty: number,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      await this.sessionManager.updateSessionStrategyParams(sessionId, (params) => {
        const nextParams = { ...params } as MomentumBreakoutStrategyParams & Record<string, any>;
        nextParams.entryDate = this.getTodayDate();
        // 실거래 TradingService와 동일하게 트레일링 "진입 후 고가" 기준점 기록
        const entryDayHigh = Number(signal.metadata?.entryDayHigh);
        if (Number.isFinite(entryDayHigh) && entryDayHigh > 0) {
          nextParams.entryDayHigh = entryDayHigh;
        } else {
          delete nextParams.entryDayHigh;
        }
        delete nextParams.halfTakeProfitDone; // legacy 키 정리 (구버전 부분익절 상태)
        return nextParams;
      });
      return;
    }

    const phase = signal.metadata?.phase as string | undefined;
    if (
      (phase && SimulationTickEngine.MOMENTUM_FULL_EXIT_PHASES.has(phase))
      || signal.quantity >= currentPositionQty
    ) {
      await this.sessionManager.updateSessionStrategyParams(sessionId, (params) => {
        const nextParams = { ...params } as MomentumBreakoutStrategyParams & Record<string, any>;
        delete nextParams.entryDate;
        delete nextParams.entryDayHigh;
        delete nextParams.halfTakeProfitDone;
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
      await this.sessionManager.updateSessionStrategyParams(sessionId, (params) => {
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
        await this.sessionManager.updateSessionStrategyParams(sessionId, (params) => ({
          ...(params as GridMeanReversionStrategyParams),
          middleTakeProfitDone: true,
        }));
      } else {
        await this.sessionManager.updateSessionStrategyParams(sessionId, (params) => {
          const nextParams = { ...(params as GridMeanReversionStrategyParams) };
          delete nextParams.middleTakeProfitDone;
          delete nextParams.completedGridLevels;
          return nextParams;
        });
      }
      return;
    }

    if (signal.metadata?.phase === 'take-profit-full' || signal.quantity >= currentPositionQty) {
      await this.sessionManager.updateSessionStrategyParams(sessionId, (params) => {
        const nextParams = { ...(params as GridMeanReversionStrategyParams) };
        delete nextParams.middleTakeProfitDone;
        delete nextParams.completedGridLevels;
        return nextParams;
      });
    }
  }

  // ──────────────────────────────────────────────────────────
  // 컨텍스트 빌드 보조
  // ──────────────────────────────────────────────────────────

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

  /** 재무 데이터 조회 (밸류 팩터 전략용) */
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

  // ──────────────────────────────────────────────────────────
  // 실행 타이밍 & 메시지 빌더
  // ──────────────────────────────────────────────────────────

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

    const now = this.getKSTTime();
    const target = market === 'DOMESTIC'
      ? { hour: executionMode.hours.domestic, minute: 0 }
      : this.getOverseasExecutionTime(exchangeCode, executionMode.hours.overseas);

    return now.hour === target.hour && now.minute === target.minute;
  }

  private getOverseasExecutionTime(
    exchangeCode: string,
    overseas: { basis: 'afterOpen' | 'beforeClose'; offsetHours: number },
  ): KstExecutionTime {
    const hours = getMarketHours(exchangeCode);
    if (!hours) {
      return {
        hour: ((0 + overseas.offsetHours) % 24 + 24) % 24,
        minute: 0,
      };
    }

    if (overseas.basis === 'afterOpen') {
      return {
        hour: ((hours.open.hour + overseas.offsetHours) % 24 + 24) % 24,
        minute: hours.open.minute,
      };
    }

    const closeHour = hours.overnight
      ? hours.close.hour + 24
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

  private hasActiveInfiniteBuySecondTarget(strategyParams?: Record<string, any>): boolean {
    const plan = (strategyParams as InfiniteBuyStrategyParams | undefined)?.secondaryExitPlan;
    if (!plan || !plan.firstTargetDate || plan.secondTargetQuantity <= 0) return false;

    const today = this.getTodayDate();
    if (plan.firstTargetDate >= today) return false;
    return !plan.secondTargetAttemptedDate || plan.secondTargetAttemptedDate === today;
  }

  private isRoutineAlreadyExecutedSkip(skipReasons: string[]): boolean {
    return skipReasons.length > 0 && skipReasons.every((reason) => reason.startsWith('오늘 이미 실행됨'));
  }

  private isQuotaCarryEligible(skipReasons: string[]): boolean {
    return skipReasons.some((reason) => reason.startsWith('매수 수량 부족:'));
  }

  private buildSimulationSignalMessage(signals: TradingSignal[]): string {
    const preview = signals
      .slice(0, 2)
      .map((signal) => `${signal.side} ${signal.quantity}주${signal.price ? ` @ ${signal.price}` : ''}`)
      .join(', ');
    return preview ? `${signals.length}개 시그널 생성 | ${preview}` : `${signals.length}개 시그널 생성`;
  }

  private buildSimulationSkipMessage(
    session: { strategyName: string; quota: Prisma.Decimal | number; maxCycles: number; strategyParams: Prisma.JsonValue | null },
    skipReasons: string[],
    details?: Record<string, any>,
    nextAccumulatedQuota?: number,
  ): string {
    if (skipReasons.length === 0) return '시그널 없음';

    if (['infinite-buy', 'daily-dca'].includes(session.strategyName) && this.isQuotaCarryEligible(skipReasons)) {
      const perCycleQuota = Number(session.quota) / session.maxCycles;
      const accumulatedQuota = Number((session.strategyParams as Record<string, any> | undefined)?.accumulatedQuota || 0);
      const adjustedQuota = Number(details?.adjustedQuota || 0);
      const minimumExecutablePrice = Number(details?.minimumExecutablePrice || adjustedQuota || 0);
      const adjustments = Array.isArray(details?.quotaAdjustments)
        ? details.quotaAdjustments
          .map((item: { label?: string; multiplier?: number }) =>
            item?.label ? `${item.label}${item.multiplier ? ` (${item.multiplier}x)` : ''}` : null)
          .filter(Boolean)
          .join(', ')
        : '';

      return [
        skipReasons[0],
        `오늘 이월 ${perCycleQuota.toFixed(0)}`,
        `누적 ${Number(nextAccumulatedQuota ?? accumulatedQuota + perCycleQuota).toFixed(0)}`,
        adjustedQuota > 0 ? `조정 할당금 ${adjustedQuota.toFixed(0)}` : null,
        minimumExecutablePrice > 0 ? `${minimumExecutablePrice.toFixed(0)} 이하에서 1주 가능` : null,
        adjustments ? `감산/가산: ${adjustments}` : null,
      ].filter(Boolean).join(' | ');
    }

    return skipReasons.join('; ');
  }

  private buildSimulationSkipDetails(
    session: { quota: Prisma.Decimal | number; maxCycles: number; strategyParams: Prisma.JsonValue | null },
    skipReasons: string[],
    details?: Record<string, any>,
    nextAccumulatedQuota?: number,
  ): Record<string, any> {
    const perCycleQuota = Number(session.quota) / session.maxCycles;
    const accumulatedQuota = Number((session.strategyParams as Record<string, any> | undefined)?.accumulatedQuota || 0);
    const remainingQuota = Number.isFinite(details?.remainingQuota)
      ? Number(details?.remainingQuota)
      : undefined;

    return {
      skipReasons,
      adjustedQuota: details?.adjustedQuota,
      minimumExecutablePrice: details?.minimumExecutablePrice,
      baseQuota: details?.baseQuota,
      perCycleQuota,
      accumulatedQuota,
      remainingQuota,
      carryAmountToday: this.isQuotaCarryEligible(skipReasons) ? perCycleQuota : undefined,
      nextAccumulatedQuota: this.isQuotaCarryEligible(skipReasons)
        ? Number(nextAccumulatedQuota ?? Math.min(accumulatedQuota + perCycleQuota, remainingQuota ?? accumulatedQuota + perCycleQuota))
        : undefined,
      quotaAdjustments: details?.quotaAdjustments,
    };
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
}
