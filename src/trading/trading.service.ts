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
  MomentumBreakoutStrategyParams,
  GridMeanReversionStrategyParams,
} from './types';
import { Market, Side, OrderType, OrderStatus, ApprovalStatus, Prisma, WatchStockExecutionEventType } from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { MarketAnalysisService } from './market-analysis.service';
import { TradingPositionSyncService } from './trading-position-sync.service';
import { getMarketHours } from '../kis/types/kis-config.types';

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
    private positionSyncService: TradingPositionSyncService,
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
      diagnosticReasons.push('KIS 주문가능금액 상한 적용');
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
        const terminalQuotaReached = this.isTerminalQuotaExhaustedSkip(skipReasons);

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
          `Strategy "${strategy.name}" generated ${signals.length} signal(s) for ${ctx.watchStock.stockCode}`,
        );

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

        // 각 시그널 제출 결과를 추적 — 이월금 리셋/복구 판단에 사용
        const buySubmissionOutcomes: boolean[] = [];
        let hadBuySignal = false;
        for (const signal of signals) {
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
          `Error executing strategy for ${ctx.watchStock.stockCode}: ${e.message}`,
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
    return signal.side === 'SELL' && (signal.reason?.toLowerCase().includes('stop loss') ?? false);
  }

  /** 승인된 손절 주문 실행 (SlackCommandsService에서 호출) */
  async executeApprovedStopLoss(approvalId: string): Promise<void> {
    if (!this.tradingEnabled) {
      this.logger.warn(`Skipping approved stop-loss execution because TRADING_ENABLED=false (${approvalId})`);
      return;
    }

    const approval = await this.prisma.stopLossApproval.findUnique({
      where: { id: approvalId },
      include: { tradeRecord: true },
    });

    if (!approval || approval.status !== ApprovalStatus.APPROVED) {
      this.logger.warn(`Stop-loss approval ${approvalId} not found or not approved`);
      return;
    }

    const record = approval.tradeRecord;
    const signal = approval.signal as any as TradingSignal;

    try {
      let result;
      if (signal.market === 'DOMESTIC') {
        result = await this.kisDomestic.orderSell(signal.stockCode, signal.quantity, signal.price, signal.orderDivision);
      } else {
        result = await this.kisOverseas.orderSell(signal.exchangeCode!, signal.stockCode, signal.quantity, signal.price!, signal.orderDivision);
      }

      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: {
          status: result.success ? OrderStatus.PENDING : OrderStatus.FAILED,
          orderNo: result.orderNo,
          reason: result.message,
        },
      });

      if (result.success) {
        this.logger.log(`Stop-loss order submitted (approved): SELL ${signal.stockCode} x ${signal.quantity}`);
      } else {
        this.logger.error(`Stop-loss order failed: ${result.message}`);
      }
    } catch (e) {
      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: { status: OrderStatus.FAILED, reason: e.message },
      });
      this.logger.error(`Stop-loss execution exception: ${e.message}`);
    }
  }

  /** 주문 실행 */
  private async executeSignal(
    signal: TradingSignal,
    strategyName?: string,
    ctx?: StockStrategyContext,
    executionDetails?: Record<string, any>,
  ): Promise<boolean> {
    await this.refreshMarketPositionsBeforeOrder(signal.market as 'DOMESTIC' | 'OVERSEAS');

    // OrderType 결정
    let orderType: OrderType;
    if (signal.orderDivision === '34') {
      orderType = OrderType.LOC;
    } else if (signal.price) {
      orderType = OrderType.LIMIT;
    } else {
      orderType = OrderType.MARKET;
    }

    // 손절 시그널 → Slack 알림만 전송하고, 실제 청산은 관리자가 수동 매도
    if (this.isStopLossSignal(signal)) {
      const avgPrice = ctx?.position?.avgPrice || Number(signal.price);
      const currentPrice = ctx?.price?.currentPrice || Number(signal.price);
      const lossRate = avgPrice > 0 ? (avgPrice - currentPrice) / avgPrice : 0;
      const watchStockId = ctx?.watchStock?.id;
      let alreadyAlerted = false;
      if (watchStockId) {
        const todayStart = new Date(this.getTodayDate() + 'T00:00:00+09:00');
        const todayEnd = new Date(this.getTodayDate() + 'T23:59:59+09:00');
        alreadyAlerted = !!(await this.prisma.watchStockExecutionLog.findFirst({
          where: {
            watchStockId,
            eventType: WatchStockExecutionEventType.SKIPPED,
            message: { contains: '손절 알림 전송' },
            createdAt: { gte: todayStart, lte: todayEnd },
          },
        }));
      }

      const slackService = this.slackService;
      const shouldSendSlackAlert = !alreadyAlerted && slackService?.isEnabled();
      if (shouldSendSlackAlert) {
        await slackService!.sendStopLossAlert({
          stockCode: signal.stockCode,
          stockName: ctx?.watchStock?.stockName || signal.stockCode,
          exchangeCode: signal.exchangeCode,
          market: signal.market,
          strategyName,
          quantity: signal.quantity,
          currentPrice,
          avgPrice,
          lossRate,
        });
      }

      await this.logWatchStockExecution(
        ctx,
        WatchStockExecutionEventType.SKIPPED,
        `손절 알림 전송: 포트폴리오에서 수동 매도 필요`,
        {
          side: signal.side,
          quantity: signal.quantity,
          price: signal.price,
          reason: signal.reason,
          lossRate,
          currentPrice,
          avgPrice,
          slackAlertSent: shouldSendSlackAlert,
        },
      );

      this.logger.log(`Stop-loss alert registered for ${signal.stockCode}; awaiting manual sell`);
      return false;
    }

    const record = await this.prisma.tradeRecord.create({
      data: {
        market: signal.market as Market,
        exchangeCode: signal.exchangeCode,
        stockCode: signal.stockCode,
        stockName: signal.stockCode,
        side: signal.side as Side,
        orderType,
        quantity: signal.quantity,
        price: new Prisma.Decimal(signal.price || 0),
        status: OrderStatus.PENDING,
        strategyName: strategyName || 'unknown',
        reason: signal.reason,
      },
    });

    await this.logWatchStockExecution(
      ctx,
      WatchStockExecutionEventType.ORDER_SUBMITTED,
      `주문 제출: ${signal.side} ${signal.quantity}주`,
      {
        side: signal.side,
        quantity: signal.quantity,
        price: signal.price,
        reason: signal.reason,
        orderType,
        metadata: signal.metadata,
        ...this.buildExecutionDiagnostics(ctx, executionDetails),
      },
      record.id,
    );

    if (strategyName === 'infinite-buy' && signal.metadata?.phase === 'take-profit-2' && ctx?.watchStock?.id) {
      await this.markInfiniteBuySecondTargetAttempted(ctx.watchStock.id);
    }

    try {
      let result;
      if (signal.market === 'DOMESTIC') {
        result =
          signal.side === 'BUY'
            ? await this.kisDomestic.orderBuy(signal.stockCode, signal.quantity, signal.price, signal.orderDivision)
            : await this.kisDomestic.orderSell(signal.stockCode, signal.quantity, signal.price, signal.orderDivision);
      } else {
        result =
          signal.side === 'BUY'
            ? await this.kisOverseas.orderBuy(signal.exchangeCode!, signal.stockCode, signal.quantity, signal.price!, signal.orderDivision)
            : await this.kisOverseas.orderSell(signal.exchangeCode!, signal.stockCode, signal.quantity, signal.price!, signal.orderDivision);
      }

      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: {
          status: result.success ? OrderStatus.PENDING : OrderStatus.FAILED,
          orderNo: result.orderNo,
          reason: result.message,
        },
      });

      await this.logWatchStockExecution(
        ctx,
        result.success ? WatchStockExecutionEventType.ORDER_SUBMITTED : WatchStockExecutionEventType.ORDER_FAILED,
        result.success
          ? `주문 접수: ${signal.side} ${signal.quantity}주`
          : `주문 실패: ${result.message ?? '실패'}`,
        {
          side: signal.side,
          quantity: signal.quantity,
          price: signal.price,
          orderNo: result.orderNo,
          reason: signal.reason,
          brokerMessage: result.message,
        },
        record.id,
      );

      if (result.success) {
        this.logger.log(`Order submitted: ${signal.side} ${signal.stockCode} x ${signal.quantity}`);
      } else {
        this.logger.error(`Order failed: ${result.message}`);
      }
      return result.success;
    } catch (e) {
      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: { status: OrderStatus.FAILED, reason: e.message },
      });
      await this.logWatchStockExecution(
        ctx,
        WatchStockExecutionEventType.ORDER_FAILED,
        `주문 예외: ${e.message}`,
        {
          side: signal.side,
          quantity: signal.quantity,
          price: signal.price,
          reason: signal.reason,
          error: e.message,
        },
        record.id,
      );
      this.logger.error(`Order exception: ${e.message}`);
      return false;
    }
  }

  private async refreshMarketPositionsBeforeOrder(market: 'DOMESTIC' | 'OVERSEAS'): Promise<void> {
    try {
      const balance = market === 'DOMESTIC'
        ? await this.kisDomestic.getBalance()
        : await this.kisOverseas.getBalance();
      await this.positionSyncService.syncPositions(market, balance);
    } catch (e) {
      this.logger.warn(`Failed to refresh ${market} positions before order: ${e.message}`);
    }
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
        this.logger.log(`[${ws.stockCode}] Accumulated quota reset after buy`);
      }
    } catch (e) {
      this.logger.warn(`Failed to reset accumulated quota: ${e.message}`);
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
      this.logger.log(`[${ws.stockCode}] Accumulated quota cleared (${reason})`);
    } catch (e) {
      this.logger.warn(`Failed to clear accumulated quota: ${e.message}`);
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
        `[${ws.stockCode}] Accumulated quota: ${newAccumulated.toFixed(2)} (insufficient quantity only)`,
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

  private getTodayDate(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
      await this.clearInfiniteBuySecondaryExitPlan(watchStockId);
      return;
    }

    if (signal.metadata?.phase === 'take-profit-1') {
      const watchStock = await this.prisma.watchStock.findUnique({ where: { id: watchStockId } });
      const position = watchStock
        ? await this.prisma.position.findFirst({
            where: {
              market: watchStock.market,
              exchangeCode: watchStock.exchangeCode,
              stockCode: watchStock.stockCode,
            },
          })
        : null;
      const remainingQty = position?.quantity ?? Math.max(0, currentPositionQty - signal.quantity);
      if (remainingQty > 0) {
        const submittedSameDay = await this.trySubmitInfiniteBuySameDaySecondTarget(
          watchStock,
          position,
          signal,
          remainingQty,
        );
        if (!submittedSameDay) {
          await this.persistInfiniteBuySecondaryExitPlan(watchStockId, signal);
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

    const followUpSignal: TradingSignal = {
      market: watchStock.market as 'DOMESTIC' | 'OVERSEAS',
      exchangeCode: watchStock.exchangeCode,
      stockCode: watchStock.stockCode,
      side: 'SELL',
      quantity: secondTargetQuantity,
      price: secondTargetPrice,
      reason:
        `Take profit 2: same-day trend, +${(secondTargetRate * 100).toFixed(1)}%, ` +
        `${secondTargetQuantity}주 @ ${secondTargetPrice}`,
      orderDivision: '00',
      metadata: {
        phase: 'take-profit-2',
        sameDayTriggered: true,
      },
    };

    const ctx: StockStrategyContext = {
      watchStock: {
        id: watchStock.id,
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

  private async buildInfiniteBuyFollowUpContext(
    watchStock: {
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
        `Failed to refresh same-day second target context for ${watchStock.stockCode}: ${e.message}`,
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

  private async handleMomentumBreakoutSignalFill(
    watchStockId: string,
    signal: TradingSignal,
    currentPositionQty: number,
  ): Promise<void> {
    if (signal.side === 'BUY') {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
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
        await this.updateWatchStockStrategyParams(watchStockId, (params) => ({
          ...(params as MomentumBreakoutStrategyParams),
          halfTakeProfitDone: true,
        }));
      } else {
        await this.updateWatchStockStrategyParams(watchStockId, (params) => {
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
      || this.isStopLossSignal(signal)
      || signal.quantity >= currentPositionQty
    ) {
      await this.updateWatchStockStrategyParams(watchStockId, (params) => {
        const nextParams = { ...(params as MomentumBreakoutStrategyParams) };
        delete nextParams.halfTakeProfitDone;
        delete nextParams.entryDate;
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
  ): Promise<void> {
    if (strategyName === 'infinite-buy') {
      await this.handleInfiniteBuySignalFill(watchStockId, signal, currentPositionQty);
      return;
    }

    if (strategyName === 'momentum-breakout') {
      await this.handleMomentumBreakoutSignalFill(watchStockId, signal, currentPositionQty);
      return;
    }

    if (strategyName === 'grid-mean-reversion') {
      await this.handleGridMeanReversionSignalFill(watchStockId, signal, currentPositionQty);
    }
  }
}
