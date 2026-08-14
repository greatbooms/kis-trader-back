import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import {
  TradingSignal,
  PerStockTradingStrategy,
  StockStrategyContext,
  InfiniteBuyStrategyParams,
  InfiniteBuyV4Params,
  MomentumBreakoutStrategyParams,
  GridMeanReversionStrategyParams,
} from './types';
import { Broker, Market, OrderType, OrderStatus, Prisma, WatchStockExecutionEventType } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { MarketAnalysisService } from './market-analysis.service';
import { TradingSellApprovalService } from './trading-sell-approval.service';
import { TradingOrderExecutionService } from './trading-order-execution.service';
import { getMarketHours } from '../kis/types/kis-config.types';
import { roundToCent } from './strategy/infinite-buy-v4-math.util';
import { applyV4Fill, V4LedgerState } from './strategy/infinite-buy-v4-ledger.util';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);
  private readonly tradingEnabled: boolean;

  constructor(
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private marketAnalysis: MarketAnalysisService,
    private prisma: PrismaService,
    private configService: ConfigService,
    private sellApprovalService: TradingSellApprovalService,
    private orderExecutionService: TradingOrderExecutionService,
    @Optional() private slackService?: SlackService,
  ) {
    this.tradingEnabled = this.configService.get<boolean>('trading.enabled') ?? true;
  }

  private async logWatchStockExecution(
    ctx: StockStrategyContext | undefined,
    eventType: WatchStockExecutionEventType,
    message: string,
    details?: Record<string, any>,
    tradeRecordId?: string,
  ): Promise<void> {
    if (!ctx?.watchStock?.id) return;

    await this.prisma.watchStockExecutionLog.create({
      data: {
        watchStockId: ctx.watchStock.id,
        tradeRecordId,
        market: ctx.watchStock.market as Market,
        exchangeCode: ctx.watchStock.exchangeCode,
        stockCode: ctx.watchStock.stockCode,
        stockName: ctx.watchStock.stockName,
        strategyName: ctx.watchStock.strategyName,
        eventType,
        message,
        details,
      },
    });
  }

  private buildSkipExecutionMessage(
    strategyName: string,
    ctx: StockStrategyContext,
    skipReasons: string[],
    details?: Record<string, any>,
  ): string {
    if (skipReasons.length === 0) return '시그널 없음';

    if (
      ['infinite-buy', 'daily-dca'].includes(strategyName)
      && this.isQuotaCarryEligible(skipReasons)
      && ctx.watchStock.quota
    ) {
      const perCycleQuota = Number(ctx.watchStock.quota) / ctx.watchStock.maxCycles;
      const accumulatedQuota = Number((ctx.watchStock.strategyParams as Record<string, any> | undefined)?.accumulatedQuota || 0);
      const remainingQuota = Math.max(0, Number(ctx.watchStock.quota) - Number(ctx.position?.totalInvested || 0));
      const nextAccumulated = Math.min(accumulatedQuota + perCycleQuota, remainingQuota);
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
        `누적 예정 ${nextAccumulated.toFixed(0)}`,
        adjustedQuota > 0 ? `조정 할당금 ${adjustedQuota.toFixed(0)}` : null,
        minimumExecutablePrice > 0 ? `${minimumExecutablePrice.toFixed(0)} 이하에서 1주 가능` : null,
        adjustments ? `감산/가산: ${adjustments}` : null,
      ].filter(Boolean).join(' | ');
    }

    return skipReasons.join('; ');
  }

  private buildExecutionDiagnostics(
    ctx: StockStrategyContext | undefined,
    details?: Record<string, any>,
  ): Record<string, any> {
    if (!ctx) return {};

    const preCashCappedQuota = Number(details?.preCashCappedQuota ?? 0);
    const adjustedQuota = Number(details?.adjustedQuota ?? 0);
    const quotaAdjustments = Array.isArray(details?.quotaAdjustments)
      ? details.quotaAdjustments
      : undefined;
    const quotaAdjustmentSummary = quotaAdjustments?.map((item: { label?: string; multiplier?: number }) => ({
      label: item?.label,
      multiplier: item?.multiplier,
    }));
    const cashCapApplied = preCashCappedQuota > 0 && adjustedQuota > 0 && adjustedQuota < preCashCappedQuota;
    const diagnosticReasons: string[] = [];

    if ((quotaAdjustmentSummary?.length ?? 0) > 0) {
      diagnosticReasons.push('전략 가감산 적용');
    }
    if (cashCapApplied) {
      diagnosticReasons.push(`${ctx.watchStock.broker} 주문가능금액 상한 적용`);
    }

    return {
      buyableAmount: ctx.buyableAmount,
      buyableAmountSource: ctx.buyableMeta?.source,
      buyableAmountMaxQuantity: ctx.buyableMeta?.maxQuantity,
      buyableAmountPriceUsed: ctx.buyableMeta?.priceUsed,
      preCashCappedQuota: details?.preCashCappedQuota,
      adjustedQuota: details?.adjustedQuota,
      minimumExecutablePrice: details?.minimumExecutablePrice,
      baseQuota: details?.baseQuota,
      accumulatedQuota: details?.accumulatedQuota,
      cashCapApplied,
      cashCapDelta: cashCapApplied ? preCashCappedQuota - adjustedQuota : 0,
      quotaAdjustments,
      quotaAdjustmentSummary,
      diagnosticReasons,
      buy1Qty: details?.buy1Qty,
      buy2Qty: details?.buy2Qty,
      buy1Price: details?.buy1Price,
      buy2Price: details?.buy2Price,
      dipRate: details?.dipRate,
      buy2OnlyMode: details?.buy2OnlyMode,
    };
  }

  private buildSkipExecutionDetails(
    ctx: StockStrategyContext,
    skipReasons: string[],
    details?: Record<string, any>,
  ): Record<string, any> {
    const perCycleQuota = ctx.watchStock.quota ? Number(ctx.watchStock.quota) / ctx.watchStock.maxCycles : undefined;
    const accumulatedQuota = Number((ctx.watchStock.strategyParams as Record<string, any> | undefined)?.accumulatedQuota || 0);
    const remainingQuota = ctx.watchStock.quota
      ? Math.max(0, Number(ctx.watchStock.quota) - Number(ctx.position?.totalInvested || 0))
      : undefined;

    return {
      skipReasons,
      marketCondition: ctx.marketCondition.referenceIndexName,
      referenceIndexAboveMa200: ctx.marketCondition.referenceIndexAboveMA200,
      alreadyExecutedToday: ctx.alreadyExecutedToday,
      hasPosition: !!ctx.position,
      rsi14: ctx.stockIndicators.rsi14,
      ma200: ctx.stockIndicators.ma200,
      ...this.buildExecutionDiagnostics(ctx, details),
      perCycleQuota,
      accumulatedQuota,
      remainingQuota,
      carryAmountToday: this.isQuotaCarryEligible(skipReasons) ? perCycleQuota : undefined,
      nextAccumulatedQuota: this.isQuotaCarryEligible(skipReasons) && perCycleQuota !== undefined
        ? Math.min(accumulatedQuota + perCycleQuota, remainingQuota ?? accumulatedQuota + perCycleQuota)
        : undefined,
      quotaAdjustments: details?.quotaAdjustments,
    };
  }

  private isActualCashShortageSkip(
    ctx: StockStrategyContext,
    skipReasons: string[],
    details?: Record<string, any>,
  ): boolean {
    if (!this.isQuotaCarryEligible(skipReasons)) return false;
    if (ctx.buyableAmount <= 0) return true;

    const preCashCappedQuota = Number(details?.preCashCappedQuota ?? 0);
    const adjustedQuota = Number(details?.adjustedQuota ?? 0);
    const currentPrice = Number(ctx.price.currentPrice ?? 0);

    return (
      preCashCappedQuota > 0
      && preCashCappedQuota > ctx.buyableAmount
      && adjustedQuota > 0
      && adjustedQuota < currentPrice
    );
  }

  private async notifyInsufficientFundsIfNeeded(
    ctx: StockStrategyContext,
    reason: string,
    skipReasons: string[],
    details?: Record<string, any>,
  ): Promise<void> {
    if (!this.slackService?.isEnabled()) return;
    if (!this.isActualCashShortageSkip(ctx, skipReasons, details)) return;

    const todayStart = new Date(this.getTodayDate() + 'T00:00:00+09:00');
    const todayEnd = new Date(this.getTodayDate() + 'T23:59:59+09:00');
    const alreadySent = await this.prisma.watchStockExecutionLog.findFirst({
      where: {
        watchStockId: ctx.watchStock.id,
        eventType: WatchStockExecutionEventType.SKIPPED,
        message: { contains: '실예수금 부족 알림 전송' },
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });
    if (alreadySent) return;

    const carryAmountToday = this.isQuotaCarryEligible(skipReasons) && ctx.watchStock.quota
      ? Number(ctx.watchStock.quota) / ctx.watchStock.maxCycles
      : undefined;
    const accumulatedQuota = Number((ctx.watchStock.strategyParams as Record<string, any> | undefined)?.accumulatedQuota || 0);
    const remainingQuota = ctx.watchStock.quota
      ? Math.max(0, Number(ctx.watchStock.quota) - Number(ctx.position?.totalInvested || 0))
      : undefined;
    const nextAccumulatedQuota = carryAmountToday !== undefined
      ? Math.min(accumulatedQuota + carryAmountToday, remainingQuota ?? accumulatedQuota + carryAmountToday)
      : undefined;

    await this.slackService.sendInsufficientFundsAlert({
      broker: ctx.watchStock.broker,
      stockCode: ctx.watchStock.stockCode,
      stockName: ctx.watchStock.stockName,
      exchangeCode: ctx.watchStock.exchangeCode,
      market: ctx.watchStock.market,
      strategyName: ctx.watchStock.strategyName,
      reason,
      buyableAmount: ctx.buyableAmount,
      plannedAmount: details?.preCashCappedQuota,
      adjustedQuota: details?.adjustedQuota,
      currentPrice: ctx.price.currentPrice,
      minimumExecutablePrice: details?.minimumExecutablePrice,
      carryAmountToday,
      nextAccumulatedQuota,
    });

    await this.logWatchStockExecution(
      ctx,
      WatchStockExecutionEventType.SKIPPED,
      `실예수금 부족 알림 전송 | ${reason}`,
      {
        buyableAmount: ctx.buyableAmount,
        preCashCappedQuota: details?.preCashCappedQuota,
        adjustedQuota: details?.adjustedQuota,
        minimumExecutablePrice: details?.minimumExecutablePrice,
        carryAmountToday,
        nextAccumulatedQuota,
      },
    );
  }

  /** 종목별 전략 실행 */
  async executePerStockStrategy(
    strategy: PerStockTradingStrategy,
    contexts: StockStrategyContext[],
  ): Promise<void> {
    if (!this.tradingEnabled) {
      this.logger.warn(`Skipping live trading strategy execution because TRADING_ENABLED=false (${strategy.name})`);
      return;
    }

    const skipQuotaAccumulationIds = new Set<string>();
    const quotaCarryEligibleIds = new Set<string>();

    for (const ctx of contexts) {
      try {
        const { signals, skipReasons, details } = await strategy.evaluateStock(ctx);
        for (const signal of signals) {
          signal.broker = ctx.watchStock.broker;
        }
        const terminalQuotaReached = this.isTerminalQuotaExhaustedSkip(skipReasons);

        if (strategy.name === 'infinite-buy-v4' && details?.v4StateUpdate) {
          await this.persistInfiniteBuyV4State(ctx, details.v4StateUpdate);
        }

        if (signals.length === 0) {
          if (this.isQuotaCarryEligible(skipReasons)) {
            quotaCarryEligibleIds.add(ctx.watchStock.id);
          }

          if (['infinite-buy', 'daily-dca'].includes(strategy.name) && terminalQuotaReached) {
            await this.clearAccumulatedQuota(ctx.watchStock.id, 'terminal quota exhaustion');
          }

          if (this.isRoutineAlreadyExecutedSkip(skipReasons)) {
            continue;
          }

          // 관망: continuous 전략이 매분 반복하는 대기 상태 — 로그/Slack 스팸 방지
          if (this.isSilentWaitSkip(skipReasons)) {
            continue;
          }

          const reason = this.buildSkipExecutionMessage(strategy.name, ctx, skipReasons, details);

          await this.logWatchStockExecution(
            ctx,
            WatchStockExecutionEventType.SKIPPED,
            reason,
            this.buildSkipExecutionDetails(ctx, skipReasons, details),
          );

          // Send filter skip log to Slack
          if (this.slackService?.isEnabled()) {
            this.slackService.sendFilterLog({
              broker: ctx.watchStock.broker,
              stockCode: ctx.watchStock.stockCode,
              exchangeCode: ctx.watchStock.exchangeCode,
              reason,
              details: {
                marketCondition: `${ctx.marketCondition.referenceIndexName} MA200 ${ctx.marketCondition.referenceIndexAboveMA200 ? '위' : '아래'}`,
                rsi: ctx.stockIndicators.rsi14?.toFixed(1) ?? 'N/A',
                ma200: ctx.stockIndicators.ma200?.toFixed(2) ?? 'N/A',
                position: ctx.position ? `${ctx.position.quantity}주` : '없음',
              },
            });
          }

          await this.notifyInsufficientFundsIfNeeded(ctx, reason, skipReasons, details);
          continue;
        }

        this.logger.log(
          `[${ctx.watchStock.broker} ${ctx.watchStock.stockCode}] Strategy "${strategy.name}" generated ${signals.length} signal(s)`,
        );

        if (this.isQuotaCarryEligible(skipReasons)) {
          quotaCarryEligibleIds.add(ctx.watchStock.id);
        }

        await this.logWatchStockExecution(
          ctx,
          WatchStockExecutionEventType.SIGNAL_CREATED,
          `${signals.length}개 시그널 생성`,
          {
            signals: signals.map((signal) => ({
              side: signal.side,
              quantity: signal.quantity,
              price: signal.price,
              reason: signal.reason,
            })),
            ...this.buildExecutionDiagnostics(ctx, details),
          },
        );

        // 시그널이 있어도(예: SELL만 나가고 BUY는 잔고 부족으로 이월) skipReasons가 남을 수 있다.
        // SIGNAL_CREATED만 남기면 그 스킵 사유가 로그에서 사라지므로 별도 SKIPPED로 남긴다.
        // '관망:'/'오늘 이미 실행됨' 계열은 무로깅 규칙(§isSilentWaitSkip)을 그대로 따른다.
        if (
          skipReasons.length > 0
          && !this.isSilentWaitSkip(skipReasons)
          && !this.isRoutineAlreadyExecutedSkip(skipReasons)
        ) {
          await this.logWatchStockExecution(
            ctx,
            WatchStockExecutionEventType.SKIPPED,
            `매수 스킵: ${this.buildSkipExecutionMessage(strategy.name, ctx, skipReasons, details)}`,
            this.buildSkipExecutionDetails(ctx, skipReasons, details),
          );
        }

        const { executableSignals, blockedBuySignals, minProfitRate } =
          this.preventSameCycleOppositeOrders(signals);
        const allBuysBlocked =
          blockedBuySignals.length > 0
          && !executableSignals.some((signal) => signal.side === 'BUY');
        if (blockedBuySignals.length > 0) {
          this.logger.warn(
            `[${ctx.watchStock.broker} ${ctx.watchStock.stockCode}] Skipping ${blockedBuySignals.length} BUY signal(s) — same-cycle SELL does not clear minimum profit gap`,
          );
          // 전부 차단된 경우에만 quota carry 등록. 다른 가격대 BUY가 살아있으면
          // 그 시도의 성공/실패에 따라 아래에서 reset/carry가 결정된다.
          if (allBuysBlocked && ['infinite-buy', 'daily-dca'].includes(strategy.name)) {
            quotaCarryEligibleIds.add(ctx.watchStock.id);
          }
          await this.logWatchStockExecution(
            ctx,
            WatchStockExecutionEventType.SKIPPED,
            '자전거래/수수료 방지: 매수·매도 가격 간격이 부족하여 해당 매수 스킵',
            {
              skipReason: 'INSUFFICIENT_SAME_CYCLE_PROFIT_GAP',
              selfTradePrevention: true,
              minProfitRate,
              actionTaken: allBuysBlocked ? 'SELL_SUBMITTED_BUY_SKIPPED' : 'PARTIAL_BUY_SKIPPED',
              carryQueued: allBuysBlocked && ['infinite-buy', 'daily-dca'].includes(strategy.name),
              strategyName: strategy.name,
              stockCode: ctx.watchStock.stockCode,
              exchangeCode: ctx.watchStock.exchangeCode,
              currentPrice: ctx.price.currentPrice,
              buyableAmount: ctx.buyableAmount,
              positionQuantity: ctx.position?.quantity ?? 0,
              positionAvgPrice: ctx.position?.avgPrice,
              blockedSignals: blockedBuySignals.map((signal) => ({
                side: signal.side,
                quantity: signal.quantity,
                price: signal.price,
                reason: signal.reason,
                orderDivision: signal.orderDivision,
                metadata: signal.metadata,
              })),
              executableSignals: executableSignals.map((signal) => ({
                side: signal.side,
                quantity: signal.quantity,
                price: signal.price,
                reason: signal.reason,
                orderDivision: signal.orderDivision,
                metadata: signal.metadata,
              })),
              diagnostics: this.buildExecutionDiagnostics(ctx, details),
            },
          );
        }

        // v4: SELL을 BUY보다 먼저 제출 — TradeRecord.createdAt 순서를 근거로 reconciliation이
        // 매도 체결을 먼저 반영하도록 보장한다 (§3 "매도 먼저 반영 후 매수 반영", 상세는 CLAUDE.md 참조).
        const submissionOrderedSignals = strategy.name === 'infinite-buy-v4'
          ? [...executableSignals].sort((a, b) => {
              if (a.side === b.side) return 0;
              return a.side === 'SELL' ? -1 : 1;
            })
          : executableSignals;

        // 각 시그널 제출 결과를 추적 — 이월금 리셋/복구 판단에 사용
        const buySubmissionOutcomes: boolean[] = [];
        let hadBuySignal = false;
        for (const signal of submissionOrderedSignals) {
          const submitted = await this.executeSignal(signal, strategy.name, ctx, details);
          if (signal.side === 'BUY') {
            hadBuySignal = true;
            buySubmissionOutcomes.push(submitted);
          }
        }

        if (
          strategy.name === 'infinite-buy'
          && signals.some((signal) => signal.metadata?.phase === 'take-profit-2')
        ) {
          skipQuotaAccumulationIds.add(ctx.watchStock.id);
        }

        if (['infinite-buy', 'daily-dca'].includes(strategy.name) && terminalQuotaReached) {
          await this.clearAccumulatedQuota(ctx.watchStock.id, 'terminal quota exhaustion');
        }

        // 분할매수 전략: 매수 시그널 **제출 성공 시에만** 누적 quota 리셋.
        // 모든 BUY 제출이 실패했다면 리셋하지 않고, 아래에서 carry 이월 경로로 처리.
        if (['infinite-buy', 'daily-dca'].includes(strategy.name) && hadBuySignal) {
          const anyBuySubmitted = buySubmissionOutcomes.some((ok) => ok === true);
          if (anyBuySubmitted) {
            await this.resetAccumulatedQuota(ctx.watchStock.id);
          } else {
            // 전부 제출 실패 — 오늘치 perCycleQuota를 이월로 적립
            quotaCarryEligibleIds.add(ctx.watchStock.id);
          }
        }
      } catch (e) {
        await this.logWatchStockExecution(
          ctx,
          WatchStockExecutionEventType.ERROR,
          `전략 실행 오류: ${e.message}`,
          { error: e.message },
        );
        this.logger.error(
          `[${ctx.watchStock.broker ?? 'UNKNOWN'} ${ctx.watchStock.stockCode}] Error executing strategy: ${e.message}`,
        );
      }
    }

    // 분할매수 전략: 매수 시그널 없었던 종목에 대해 quota 누적
    if (['infinite-buy', 'daily-dca'].includes(strategy.name)) {
      await this.accumulateUnusedQuotas(
        strategy.name,
        contexts,
        quotaCarryEligibleIds,
        skipQuotaAccumulationIds,
      );
    }
  }

  /** 손절 시그널 여부 판별 */
  private isStopLossSignal(signal: TradingSignal): boolean {
    const reason = signal.reason || '';
    return signal.side === 'SELL' && (reason.toLowerCase().includes('stop loss') || reason.includes('손절'));
  }

  /**
   * 같은 사이클에서 BUY/SELL이 동시에 나오면 SELL 가격이 BUY 가격 대비
   * 최소 비용버퍼를 넘는 경우에만 BUY를 허용한다. 버퍼가 없으면 동일가/역전가만 차단한다.
   */
  private preventSameCycleOppositeOrders(signals: TradingSignal[]): {
    executableSignals: TradingSignal[];
    blockedBuySignals: TradingSignal[];
    minProfitRate: number;
  } {
    const sellSignals = signals.filter(
      (signal) => signal.side === 'SELL' && typeof signal.price === 'number',
    );
    if (sellSignals.length === 0) {
      return { executableSignals: signals, blockedBuySignals: [], minProfitRate: 0 };
    }

    const executableSignals: TradingSignal[] = [];
    const blockedBuySignals: TradingSignal[] = [];
    const blockedMinProfitRates: number[] = [];
    for (const signal of signals) {
      const blockingSell = signal.side === 'BUY' && typeof signal.price === 'number'
        ? sellSignals.find((sellSignal) => this.isSameCycleProfitGapInsufficient(signal, sellSignal))
        : undefined;
      if (blockingSell) {
        blockedBuySignals.push(signal);
        blockedMinProfitRates.push(this.getSameCycleMinProfitRate(blockingSell));
      } else {
        executableSignals.push(signal);
      }
    }
    return {
      executableSignals,
      blockedBuySignals,
      minProfitRate: blockedMinProfitRates.length > 0 ? Math.max(...blockedMinProfitRates) : 0,
    };
  }

  private isSameCycleProfitGapInsufficient(buySignal: TradingSignal, sellSignal: TradingSignal): boolean {
    if (typeof buySignal.price !== 'number' || typeof sellSignal.price !== 'number') {
      return false;
    }
    const minProfitRate = this.getSameCycleMinProfitRate(sellSignal);
    if (minProfitRate <= 0) {
      return sellSignal.price <= buySignal.price;
    }
    return sellSignal.price + Number.EPSILON < buySignal.price * (1 + minProfitRate);
  }

  private getSameCycleMinProfitRate(signal: TradingSignal): number {
    const configured = Number(signal.metadata?.sameCycleMinProfitRate);
    return Number.isFinite(configured) && configured >= 0 ? configured : 0;
  }

  /**
   * @deprecated Actorless approval execution is blocked. Use
   * TradingSellApprovalWorkflowService with an authenticated actor.
   */
  async executeApprovedStopLoss(approvalId: string): Promise<void> {
    const message = `[APPROVAL ${approvalId}] Deprecated actorless approved-sell execution is blocked; use TradingSellApprovalWorkflowService`;
    this.logger.warn(message);
    throw new Error(message);
  }

  /** 주문 실행 */
  private async executeSignal(
    signal: TradingSignal,
    strategyName?: string,
    ctx?: StockStrategyContext,
    executionDetails?: Record<string, any>,
  ): Promise<boolean> {
    // OrderType 결정
    let orderType: OrderType;
    if (signal.orderDivision === '34') {
      orderType = OrderType.LOC;
    } else if (signal.price) {
      orderType = OrderType.LIMIT;
    } else {
      orderType = OrderType.MARKET;
    }

    if (this.sellApprovalService.shouldRequireApproval(signal, strategyName, ctx)) {
      return this.sellApprovalService.requestApproval(signal, strategyName, ctx, orderType);
    }

    return this.orderExecutionService.execute(
      signal,
      strategyName || 'unknown',
      ctx,
      executionDetails,
    );
  }

  // ── Quota 이월 (분할매수 전략) ──

  /** 매수 성공 시 누적 quota 리셋 */
  private async resetAccumulatedQuota(watchStockId: string): Promise<void> {
    try {
      const ws = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
      if (!ws) return;
      const params = (ws.strategyParams as Record<string, any>) || {};
      const today = this.getTodayDate();
      await this.prisma.watchStock.update({
        where: { id: watchStockId },
        data: { strategyParams: { ...params, accumulatedQuota: 0, lastAccumulatedDate: today } },
      });
      if (params.accumulatedQuota) {
        this.logger.log(`[${ws.broker} ${ws.stockCode}] Accumulated quota reset after buy`);
      }
    } catch (e) {
      this.logger.warn(`[WATCH_STOCK ${watchStockId}] Failed to reset accumulated quota: ${e.message}`);
    }
  }

  /** 추가 매수가 불가능한 마지막 잔여 한도 상태에서는 누적 quota 정리 */
  private async clearAccumulatedQuota(watchStockId: string, reason: string): Promise<void> {
    try {
      const ws = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
      if (!ws) return;

      const params = (ws.strategyParams as Record<string, any>) || {};
      if (!params.accumulatedQuota) return;

      const { accumulatedQuota: _accumulatedQuota, ...rest } = params;
      await this.prisma.watchStock.update({
        where: { id: watchStockId },
        data: { strategyParams: rest },
      });
      this.logger.log(`[${ws.broker} ${ws.stockCode}] Accumulated quota cleared (${reason})`);
    } catch (e) {
      this.logger.warn(`[WATCH_STOCK ${watchStockId}] Failed to clear accumulated quota: ${e.message}`);
    }
  }

  /** 매수 시그널이 없었던 종목에 대해 quota 누적 (1주 가격 부족 시 이월) */
  private async accumulateUnusedQuotas(
    strategyName: string,
    contexts: StockStrategyContext[],
    eligibleWatchStockIds: Set<string>,
    skipWatchStockIds: Set<string> = new Set(),
  ): Promise<void> {
    const today = this.getTodayDate();

    for (const ctx of contexts) {
      if (!eligibleWatchStockIds.has(ctx.watchStock.id)) continue;
      if (ctx.alreadyExecutedToday) continue;
      if (skipWatchStockIds.has(ctx.watchStock.id)) continue;
      if (strategyName === 'infinite-buy' && this.hasActiveInfiniteBuySecondTarget(ctx.watchStock.strategyParams)) continue;

      const ws = await this.prisma.watchStock.findUnique({ where: { id: ctx.watchStock.id } });
      if (!ws || !ws.quota) continue;

      const params = (ws.strategyParams as Record<string, any>) || {};
      if (params.lastAccumulatedDate === today) continue; // 오늘 이미 누적됨

      // 이 종목에 대해 매수 시그널이 있었는지 확인 (executeSignal에서 리셋했으면 skip)
      const updatedWs = await this.prisma.watchStock.findUnique({ where: { id: ctx.watchStock.id } });
      const updatedParams = (updatedWs?.strategyParams as Record<string, any>) || {};
      if (updatedParams.lastAccumulatedDate === today) continue; // 리셋 후 이미 처리됨

      const perCycleQuota = Number(ws.quota) / ws.maxCycles;
      if (perCycleQuota <= 0) continue;

      const remainingQuota = Math.max(0, Number(ws.quota) - Number(ctx.position?.totalInvested || 0));
      if (remainingQuota <= 0) continue;

      const newAccumulated = Math.min((updatedParams.accumulatedQuota || 0) + perCycleQuota, remainingQuota);
      await this.prisma.watchStock.update({
        where: { id: ws.id },
        data: {
          strategyParams: {
            ...updatedParams,
            accumulatedQuota: newAccumulated,
            lastAccumulatedDate: today,
          },
        },
      });
      this.logger.log(
        `[${ws.broker} ${ws.stockCode}] Accumulated quota: ${newAccumulated.toFixed(2)} (insufficient quantity only)`,
      );
    }
  }

  private isQuotaCarryEligible(skipReasons: string[]): boolean {
    return skipReasons.some((reason) => reason.startsWith('매수 수량 부족:'));
  }

  private isTerminalQuotaExhaustedSkip(skipReasons: string[]): boolean {
    return skipReasons.some((reason) => reason.startsWith('최대 사이클 도달:'));
  }

  private isRoutineAlreadyExecutedSkip(skipReasons: string[]): boolean {
    return skipReasons.length > 0 && skipReasons.every((reason) => reason.startsWith('오늘 이미 실행됨'));
  }

  /**
   * '관망:' prefix 스킵은 전략의 정상 대기 상태(돌파 미달, 시간 윈도우 외 등).
   * continuous 전략은 매분 평가되므로 이를 기록하면 DB/Slack이 도배된다.
   */
  private isSilentWaitSkip(skipReasons: string[]): boolean {
    return skipReasons.length > 0 && skipReasons.every((reason) => reason.startsWith('관망'));
  }

  private getTodayDate(): string {
    return this.getKstDateString(new Date());
  }

  private getKstDateString(date: Date): string {
    return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private async updateWatchStockStrategyParams(
    watchStockId: string,
    updater: (params: Record<string, any>) => Record<string, any>,
  ): Promise<void> {
    const watchStock = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
    if (!watchStock) return;

    const currentParams = (watchStock.strategyParams as Record<string, any>) || {};
    await this.prisma.watchStock.update({
      where: { id: watchStockId },
      data: { strategyParams: updater(currentParams) },
    });
  }

  // ── 무한매수 V4 (infinite-buy-v4) ──

  /**
   * 전략 평가 결과의 details.v4StateUpdate({mode, recentCloses})를 strategyParams.v4에 영속화한다.
   * T/cashRemaining/cycleSeq/lastKnownHoldQty는 체결 확정 시점(handleInfiniteBuyV4SignalFill)에서만
   * 갱신하므로 여기서는 건드리지 않는다.
   * NORMAL→REVERSE 전환 시 Slack 알림 1회 — 전용 SlackService 템플릿이 없어(§6.3와 별개 사안)
   * logger.log + 기존 실행 로그로 대체한다 (ponytail: 필요 시 전용 sendXxx 템플릿 추가).
   */
  private async persistInfiniteBuyV4State(
    ctx: StockStrategyContext,
    update: { mode: 'NORMAL' | 'REVERSE'; recentCloses: unknown[] },
  ): Promise<void> {
    const previousMode = ((ctx.watchStock.strategyParams as Record<string, any> | undefined)?.v4 as
      | InfiniteBuyV4Params
      | undefined)?.mode ?? 'NORMAL';

    await this.updateWatchStockStrategyParams(ctx.watchStock.id, (params) => ({
      ...params,
      v4: {
        ...((params.v4 as InfiniteBuyV4Params | undefined) || {}),
        mode: update.mode,
        recentCloses: update.recentCloses,
      },
    }));

    if (previousMode !== 'REVERSE' && update.mode === 'REVERSE') {
      const message = `[${ctx.watchStock.broker} ${ctx.watchStock.stockCode}] 무한매수 V4 REVERSE 모드 진입 (T > N-1, 소진 후 리버스 전환)`;
      this.logger.log(message);
      await this.logWatchStockExecution(ctx, WatchStockExecutionEventType.SIGNAL_CREATED, message, {
        phase: 'v4-reverse-enter',
      });
    }
  }

  /**
   * 체결 확정 시점의 T/잔금 갱신 (스펙 §3/§4.5/§5.2). fillPrice는 reconciliation이 넘겨주는
   * 실제 체결가(executedPrice)를 우선 사용하고, 없으면 제출가(signal.price)로 대체한다.
   */
  private async handleInfiniteBuyV4SignalFill(
    watchStockId: string,
    signal: TradingSignal,
    previousHoldingQty: number,
    executedPrice?: number,
  ): Promise<void> {
    const watchStock = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
    if (!watchStock) return;

    const N = watchStock.maxCycles;
    const principal = watchStock.quota ? Number(watchStock.quota) : 0;
    const currentParams = (watchStock.strategyParams as Record<string, any>) || {};
    const v4 = (currentParams.v4 as InfiniteBuyV4Params | undefined) || {};
    const compoundMode = v4.compoundMode ?? true;

    const fillPrice = Number.isFinite(executedPrice) ? (executedPrice as number) : (signal.price ?? 0);
    const fillAmount = roundToCent(fillPrice * signal.quantity);
    const phase = String(signal.metadata?.phase || '');

    // v4 장부(lastKnownHoldQty)가 진실(D5) — reconciliation의 qtyBeforeFill은 pass당 1회 뜬
    // 포지션 스냅샷을 역산한 값이라, 같은 pass에 같은 종목 체결이 2건 이상이면(쿼터매도+최종매도
    // 동시 체결 등) 각 건의 "체결 전 보유수량"이 어긋난다. 장부가 있으면(최초 체결이 아니면)
    // 그 값으로 체이닝해 각 체결이 DB를 순차 갱신하는 실제 순서를 그대로 반영한다.
    const effectivePreviousHoldingQty = Number.isFinite(v4.lastKnownHoldQty)
      ? (v4.lastKnownHoldQty as number)
      : previousHoldingQty;

    const before: V4LedgerState = {
      turn: Number.isFinite(v4.turn) ? (v4.turn as number) : 0,
      cashRemaining: Number.isFinite(v4.cashRemaining) ? (v4.cashRemaining as number) : principal,
      cycleSeq: v4.cycleSeq ?? 0,
      lastKnownHoldQty: effectivePreviousHoldingQty,
    };

    const result = applyV4Fill(before, {
      side: signal.side,
      phase,
      quantity: signal.quantity,
      fillAmount,
      previousHoldingQty: effectivePreviousHoldingQty,
      // 분모는 그 leg 자체가 아니라 당일 BUY 신호 전체(사다리 포함) 총액이어야 한다 —
      // 전반전에 평단+별지점 두 leg가 모두 전량 체결되면 "당일 1회매수 전량 체결"이라
      // ΔT=+1이어야 하는데, leg 단위 분모면 각 leg가 독립적으로 거의 +1씩 더해 ΔT=+2가 된다.
      attemptAmount: Number(
        signal.metadata?.v4DayBuyAttemptTotal ?? signal.metadata?.v4AttemptAmount ?? fillAmount,
      ),
      sellRatioPrevHolding: Number(signal.metadata?.v4PrevHolding ?? effectivePreviousHoldingQty),
      N,
      quota: principal,
      compoundMode,
    });

    if (result.cycleCompleted) {
      this.logger.log(
        `[${watchStock.broker} ${watchStock.stockCode}] V4 사이클 종료: cycleSeq=${result.state.cycleSeq}, ` +
        `cashRemaining=${result.state.cashRemaining.toFixed(2)}, compoundMode=${compoundMode}` +
        (result.discardedExcess > 0 ? `, 단리 초과분 제외=${result.discardedExcess.toFixed(2)}` : ''),
      );
    }

    await this.prisma.watchStock.update({
      where: { id: watchStockId },
      data: {
        strategyParams: {
          ...currentParams,
          v4: {
            ...v4,
            turn: result.state.turn,
            cashRemaining: result.state.cashRemaining,
            cycleSeq: result.state.cycleSeq,
            lastKnownHoldQty: result.state.lastKnownHoldQty,
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private hasActiveInfiniteBuySecondTarget(strategyParams?: Record<string, any>): boolean {
    const plan = (strategyParams as InfiniteBuyStrategyParams | undefined)?.secondaryExitPlan;
    if (!plan || !plan.firstTargetDate || plan.secondTargetQuantity <= 0) return false;

    const today = this.getTodayDate();
    if (plan.firstTargetDate >= today) return false;
    return !plan.secondTargetAttemptedDate || plan.secondTargetAttemptedDate === today;
  }

  private async updateInfiniteBuyStrategyParams(
    watchStockId: string,
    updater: (params: InfiniteBuyStrategyParams) => InfiniteBuyStrategyParams,
  ): Promise<void> {
    await this.updateWatchStockStrategyParams(
      watchStockId,
      (params) => updater(params as InfiniteBuyStrategyParams),
    );
  }

  private async markInfiniteBuySecondTargetAttempted(watchStockId: string): Promise<void> {
    const today = this.getTodayDate();
    await this.updateInfiniteBuyStrategyParams(watchStockId, (params) => {
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

  private async clearInfiniteBuySecondaryExitPlan(watchStockId: string): Promise<void> {
    await this.updateInfiniteBuyStrategyParams(watchStockId, (params) => {
      const { secondaryExitPlan: _secondaryExitPlan, ...rest } = params;
      return rest;
    });
  }

  private async persistInfiniteBuySecondaryExitPlan(watchStockId: string, signal: TradingSignal): Promise<void> {
    const secondTargetPrice = Number(signal.metadata?.secondaryTargetPrice);
    const secondTargetRate = Number(signal.metadata?.secondaryTargetRate);
    const secondTargetQuantity = Number(signal.metadata?.secondaryTargetQuantity);
    if (!secondTargetPrice || !secondTargetRate || !secondTargetQuantity) return;

    const today = this.getTodayDate();
    await this.updateInfiniteBuyStrategyParams(watchStockId, (params) => ({
      ...params,
      secondaryExitPlan: {
        firstTargetDate: today,
        secondTargetPrice,
        secondTargetRate,
        secondTargetQuantity,
      },
    }));
  }

  private async handleInfiniteBuySignalFill(
    watchStockId: string,
    signal: TradingSignal,
    currentPositionQty: number,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      const watchStock = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
      const params = (watchStock?.strategyParams as InfiniteBuyStrategyParams | undefined) || {};
      if (!params.secondaryExitPlan) {
        await this.clearInfiniteBuySecondaryExitPlan(watchStockId);
      }
      return;
    }

    if (signal.metadata?.phase === 'take-profit-1') {
      const watchStock = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
      const position = watchStock
        ? await this.prisma.position.findFirst({
            where: {
              broker: watchStock.broker,
              market: watchStock.market,
              exchangeCode: watchStock.exchangeCode,
              stockCode: watchStock.stockCode,
            },
          })
        : null;
      const remainingQty = position?.quantity ?? Math.max(0, currentPositionQty - signal.quantity);
      if (remainingQty > 0) {
        const remainingSignal = {
          ...signal,
          metadata: {
            ...(signal.metadata || {}),
            secondaryTargetQuantity: remainingQty,
          },
        };
        const submittedSameDay = await this.trySubmitInfiniteBuySameDaySecondTarget(
          watchStock,
          position,
          remainingSignal,
          remainingQty,
        );
        if (!submittedSameDay) {
          await this.persistInfiniteBuySecondaryExitPlan(watchStockId, remainingSignal);
        }
      } else {
        await this.clearInfiniteBuySecondaryExitPlan(watchStockId);
      }
      return;
    }

    if (
      signal.metadata?.phase === 'take-profit-2'
      || this.isStopLossSignal(signal)
      || signal.quantity >= currentPositionQty
    ) {
      await this.clearInfiniteBuySecondaryExitPlan(watchStockId);
    }
  }

  private async trySubmitInfiniteBuySameDaySecondTarget(
    watchStock:
      | {
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
        }
      | null,
    position:
      | {
          stockCode: string;
          quantity: number;
          avgPrice: Prisma.Decimal;
          currentPrice: Prisma.Decimal;
          totalInvested: Prisma.Decimal;
        }
      | null,
    signal: TradingSignal,
    remainingQty: number,
  ): Promise<boolean> {
    if (!watchStock) return false;

    const secondTargetPrice = Number(signal.metadata?.secondaryTargetPrice);
    const secondTargetRate = Number(signal.metadata?.secondaryTargetRate);
    const secondTargetQuantity = Math.min(
      remainingQty,
      Number(signal.metadata?.secondaryTargetQuantity || 0),
    );

    if (!secondTargetPrice || !secondTargetRate || secondTargetQuantity <= 0) return false;

    const latestCtx = await this.buildInfiniteBuyFollowUpContext(watchStock, position, secondTargetPrice);
    if (!latestCtx) return false;

    if (
      !this.shouldSubmitInfiniteBuySameDaySecondTarget(
        watchStock.market as 'DOMESTIC' | 'OVERSEAS',
        watchStock.exchangeCode,
        latestCtx,
      )
    ) {
      return false;
    }
    const tValue = this.readMetadataNumber(signal.metadata, 'tValue', 'T', 't', 'postFillTValue');
    const tMetadata = tValue !== undefined ? { tValue } : {};

    const followUpSignal: TradingSignal = {
      broker: watchStock.broker,
      market: watchStock.market as 'DOMESTIC' | 'OVERSEAS',
      exchangeCode: watchStock.exchangeCode,
      stockCode: watchStock.stockCode,
      side: 'SELL',
      quantity: secondTargetQuantity,
      price: secondTargetPrice,
      reason:
        `Take profit 2: ${tValue !== undefined ? `T=${tValue.toFixed(1)}, ` : ''}` +
        `same-day trend, +${(secondTargetRate * 100).toFixed(1)}%, ` +
        `${secondTargetQuantity}주 @ ${secondTargetPrice}`,
      orderDivision: '00',
      metadata: {
        phase: 'take-profit-2',
        sameDayTriggered: true,
        ...tMetadata,
      },
    };

    const ctx: StockStrategyContext = {
      watchStock: {
        id: watchStock.id,
        broker: watchStock.broker,
        market: watchStock.market as 'DOMESTIC' | 'OVERSEAS',
        exchangeCode: watchStock.exchangeCode,
        stockCode: watchStock.stockCode,
        stockName: watchStock.stockName,
        strategyName: watchStock.strategyName || undefined,
        quota: watchStock.quota ? Number(watchStock.quota) : undefined,
        cycle: watchStock.cycle,
        maxCycles: watchStock.maxCycles,
        stopLossRate: Number(watchStock.stopLossRate),
        maxPortfolioRate: Number(watchStock.maxPortfolioRate),
        strategyParams: (watchStock.strategyParams as Record<string, any>) || undefined,
      },
      price: latestCtx.price,
      position: position
        ? {
            stockCode: position.stockCode,
            quantity: position.quantity,
            avgPrice: Number(position.avgPrice),
            currentPrice: Number(position.currentPrice),
            totalInvested: Number(position.totalInvested),
          }
        : undefined,
      alreadyExecutedToday: true,
      marketCondition: latestCtx.marketCondition,
      stockIndicators: latestCtx.stockIndicators,
      buyableAmount: 0,
      totalPortfolioValue: 0,
    };

    return this.executeSignal(followUpSignal, 'infinite-buy', ctx);
  }

  private readMetadataNumber(metadata: Record<string, any> | undefined, ...keys: string[]): number | undefined {
    for (const key of keys) {
      const parsed = Number(metadata?.[key]);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private async buildInfiniteBuyFollowUpContext(
    watchStock: {
      broker: Broker;
      market: Market;
      exchangeCode: string;
      stockCode: string;
      stockName: string;
    },
    position:
      | {
          currentPrice: Prisma.Decimal;
        }
      | null,
    fallbackPrice: number,
  ): Promise<Pick<StockStrategyContext, 'price' | 'stockIndicators' | 'marketCondition'> | null> {
    try {
      const market = watchStock.market as 'DOMESTIC' | 'OVERSEAS';
      const price = market === 'DOMESTIC'
        ? await this.kisDomestic.getPrice(watchStock.stockCode)
        : await this.kisOverseas.getPrice(watchStock.exchangeCode, watchStock.stockCode);
      const stockIndicators = await this.marketAnalysis.getStockIndicators(
        market,
        watchStock.exchangeCode,
        watchStock.stockCode,
        price.currentPrice,
      );
      const intradayVwap = await this.marketAnalysis.getIntradayVwap(
        market,
        watchStock.exchangeCode,
        watchStock.stockCode,
        price,
      );
      if (intradayVwap !== undefined) {
        stockIndicators.intradayVwap = intradayVwap;
      }

      return {
        price,
        stockIndicators,
        marketCondition: {
          referenceIndexAboveMA200: true,
          referenceIndexName: 'FOLLOW_UP_EXIT',
          interestRateRising: false,
        },
      };
    } catch (e) {
      this.logger.warn(
        `[${watchStock.broker} ${watchStock.stockCode}] Failed to refresh same-day second target context: ${e.message}`,
      );

      const currentPrice = Number(position?.currentPrice ?? fallbackPrice);
      return {
        price: {
          stockCode: watchStock.stockCode,
          stockName: watchStock.stockName,
          currentPrice,
          openPrice: currentPrice,
          highPrice: currentPrice,
          lowPrice: currentPrice,
          volume: 0,
        },
        stockIndicators: {
          currentAboveMA200: true,
        },
        marketCondition: {
          referenceIndexAboveMA200: true,
          referenceIndexName: 'FOLLOW_UP_EXIT',
          interestRateRising: false,
        },
      };
    }
  }

  private shouldSubmitInfiniteBuySameDaySecondTarget(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
    ctx: Pick<StockStrategyContext, 'price' | 'stockIndicators'>,
  ): boolean {
    const currentPrice = Number(ctx.price.currentPrice);
    const openPrice = Number(ctx.stockIndicators.todayOpen ?? ctx.price.openPrice);
    const ma20 = ctx.stockIndicators.ma20;
    const adx14 = ctx.stockIndicators.adx14;
    const rsi14 = ctx.stockIndicators.rsi14;
    const volumeRatio = ctx.stockIndicators.volumeRatio;
    const intradayVwap = ctx.stockIndicators.intradayVwap;
    const highPrice = Number(ctx.price.highPrice || currentPrice);
    const atrPercent = ctx.stockIndicators.atrPercent;
    const macdHistogram = ctx.stockIndicators.macdHistogram;
    const macdPrevHistogram = ctx.stockIndicators.macdPrevHistogram;
    const minutesToClose = this.getMinutesUntilMarketClose(market, exchangeCode);

    const aboveOpen = Number.isFinite(openPrice) ? currentPrice >= openPrice : true;
    const aboveIntradayVwap = intradayVwap === undefined ? true : currentPrice >= intradayVwap;
    const aboveMa20 = ma20 === undefined ? true : currentPrice >= ma20;
    const strongAdx = adx14 === undefined ? true : adx14 >= 20;
    const healthyMomentum = rsi14 !== undefined && rsi14 >= 55 && rsi14 < 78;
    const pullbackLimit = atrPercent !== undefined
      ? Math.min(Math.max((atrPercent / 100) * 0.75, 0.008), 0.02)
      : 0.015;
    const shallowPullback = highPrice <= 0 ? true : currentPrice >= highPrice * (1 - pullbackLimit);
    const volumeHealthy = volumeRatio === undefined ? true : volumeRatio >= 0.8;
    const momentumNotFading = (
      macdHistogram === undefined
      || macdPrevHistogram === undefined
      || macdHistogram >= macdPrevHistogram * 0.85
    );
    const enoughTime = minutesToClose === undefined ? true : minutesToClose >= 60;

    return (
      aboveOpen
      && aboveIntradayVwap
      && aboveMa20
      && strongAdx
      && healthyMomentum
      && shallowPullback
      && volumeHealthy
      && momentumNotFading
      && enoughTime
    );
  }

  private getMinutesUntilMarketClose(
    market?: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode?: string,
  ): number | undefined {
    const targetExchange = market === 'DOMESTIC' ? 'KRX' : exchangeCode;
    if (!targetExchange) return undefined;

    const hours = getMarketHours(targetExchange);
    if (!hours) return undefined;

    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentMinutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    let closeMinutes = hours.close.hour * 60 + hours.close.minute;

    if (hours.overnight && currentMinutes > closeMinutes) {
      closeMinutes += 24 * 60;
    }

    const normalizedCurrentMinutes = hours.overnight && currentMinutes < hours.open.hour * 60 + hours.open.minute
      ? currentMinutes + 24 * 60
      : currentMinutes;

    return closeMinutes - normalizedCurrentMinutes;
  }

  /** 당일청산 변동성 돌파의 전량 청산 phase — SELL 체결 시 entryDate를 정리한다 */
  private static readonly MOMENTUM_FULL_EXIT_PHASES = new Set([
    'carryover-exit',
    'intraday-stop',
    'trailing-stop',
    'take-profit',
    'eod-exit',
    'risk-liquidation',
  ]);

  private async handleMomentumBreakoutSignalFill(
    watchStockId: string,
    signal: TradingSignal,
    currentPositionQty: number,
    filledAt?: Date,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
        const nextParams = { ...params } as MomentumBreakoutStrategyParams & Record<string, any>;
        // 이월청산 판정 기준은 실제 주문 시점 — reconciliation이 자정을 넘겨 처리해도
        // 진입일이 다음 날로 밀리지 않도록 체결 레코드 시각을 우선 사용
        nextParams.entryDate = this.getKstDateString(filledAt ?? new Date());
        const entryDayHigh = Number(signal.metadata?.entryDayHigh);
        if (Number.isFinite(entryDayHigh) && entryDayHigh > 0) {
          nextParams.entryDayHigh = entryDayHigh; // 트레일링 "진입 후 고가" 판별 기준
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
      (phase && TradingService.MOMENTUM_FULL_EXIT_PHASES.has(phase))
      // 전환기 호환: 구버전 미체결 주문(reason 'stop loss' 등)이 뒤늦게 체결되는 경우
      || this.isStopLossSignal(signal)
      || signal.quantity >= currentPositionQty
    ) {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
        const nextParams = { ...params } as MomentumBreakoutStrategyParams & Record<string, any>;
        delete nextParams.entryDate;
        delete nextParams.entryDayHigh;
        delete nextParams.halfTakeProfitDone;
        return nextParams;
      });
    }
  }

  private async handleGridMeanReversionSignalFill(
    watchStockId: string,
    signal: TradingSignal,
    currentPositionQty: number,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
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
        await this.updateWatchStockStrategyParams(watchStockId, (params) => ({
          ...(params as GridMeanReversionStrategyParams),
          middleTakeProfitDone: true,
        }));
      } else {
        await this.updateWatchStockStrategyParams(watchStockId, (params) => {
          const nextParams = { ...(params as GridMeanReversionStrategyParams) };
          delete nextParams.middleTakeProfitDone;
          delete nextParams.completedGridLevels;
          return nextParams;
        });
      }
      return;
    }

    if (
      signal.metadata?.phase === 'take-profit-full'
      || this.isStopLossSignal(signal)
      || signal.quantity >= currentPositionQty
    ) {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
        const nextParams = { ...(params as GridMeanReversionStrategyParams) };
        delete nextParams.middleTakeProfitDone;
        delete nextParams.completedGridLevels;
        return nextParams;
      });
    }
  }

  async handleStrategySignalFill(
    strategyName: string | undefined,
    watchStockId: string,
    signal: TradingSignal,
    currentPositionQty: number,
    filledAt?: Date,
    executedPrice?: number,
  ): Promise<void> {
    if (strategyName === 'infinite-buy') {
      await this.handleInfiniteBuySignalFill(watchStockId, signal, currentPositionQty);
      return;
    }

    if (strategyName === 'infinite-buy-v4') {
      await this.handleInfiniteBuyV4SignalFill(watchStockId, signal, currentPositionQty, executedPrice);
      return;
    }

    if (strategyName === 'momentum-breakout') {
      await this.handleMomentumBreakoutSignalFill(watchStockId, signal, currentPositionQty, filledAt);
      return;
    }

    if (strategyName === 'grid-mean-reversion') {
      await this.handleGridMeanReversionSignalFill(watchStockId, signal, currentPositionQty);
    }
  }
}
