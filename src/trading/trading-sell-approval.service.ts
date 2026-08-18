import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  ApprovalStatus,
  Broker,
  Market,
  OrderStatus,
  OrderType,
  Prisma,
  Side,
  WatchStockExecutionEventType,
} from '@prisma/client';
import { SlackService } from '../notification/slack.service';
import { PrismaService } from '../prisma.service';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { TradingOrderGuardService } from './trading-order-guard.service';
import { StockStrategyContext, TradingSignal } from './types';

@Injectable()
export class TradingSellApprovalService {
  private readonly logger = new Logger(TradingSellApprovalService.name);
  private static readonly PROVISIONAL_APPROVAL_MINUTES = 2;
  private static readonly APPROVAL_VALIDITY_MINUTES = 10;
  private static readonly SUCCESSFUL_NOTIFICATION_COOLDOWN_MINUTES = 30;
  private static readonly HIGH_T_SELL_APPROVAL_THRESHOLD = 20;
  private static readonly MANUAL_SELL_APPROVAL_PHASES = new Set([
    'carryover-exit',
    'eod-exit',
    'intraday-stop',
    'risk-liquidation',
    'stop-loss',
    'trailing-stop',
  ]);
  private static readonly PROTECTIVE_SELL_REASON_PATTERNS = [
    /^\s*(?:stop[\s-]?loss|손절(?:청산)?)(?:\s*[:：]|$)/i,
    /^\s*(?:리스크|mdd)\s*(?:전량)?청산(?:\s*[:：]|$)/i,
    /^\s*(?:당일|이월)청산(?:\s*[:：]|$)/i,
    /^\s*트레일링(?:\s*스탑)?(?:\s*[:：]|$)/i,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly brokerContext: TradingBrokerContextService,
    private readonly orderGuard: TradingOrderGuardService,
    @Optional() private readonly slackService?: SlackService,
  ) {}

  shouldRequireApproval(
    signal: TradingSignal,
    strategyName?: string,
    ctx?: StockStrategyContext,
  ): boolean {
    if (signal.side !== 'SELL') return false;
    if (this.isManualSellExitSignal(signal)) return true;
    return this.isHighTInfiniteBuyTakeProfitSignal(signal, strategyName, ctx);
  }

  async requestApproval(
    signal: TradingSignal,
    strategyName: string | undefined,
    ctx: StockStrategyContext | undefined,
    orderType: OrderType,
  ): Promise<boolean> {
    signal = this.normalizeApprovalSignal(signal);
    if (!signal.broker) {
      this.logger.warn(`[UNKNOWN ${signal.stockCode}] Broker is required before sell approval admission`);
      return false;
    }
    const avgPrice = this.asFiniteNumber(
      ctx?.position?.avgPrice,
      signal.price,
      ctx?.price?.currentPrice,
      0,
    );
    const currentPrice = this.asFiniteNumber(
      ctx?.price?.currentPrice,
      signal.price,
      avgPrice,
      0,
    );
    const expectedPnlRate = avgPrice > 0 ? (currentPrice - avgPrice) / avgPrice : 0;
    const expectedPnl = (currentPrice - avgPrice) * signal.quantity;
    const lossRate = -expectedPnlRate;
    const stockName = ctx?.watchStock?.stockName || signal.stockCode;
    const effectiveStrategyName = strategyName || ctx?.watchStock?.strategyName || 'unknown';
    const requestedAt = new Date();

    await this.expireDueApprovalPairs(signal, requestedAt);
    const brokerContext = this.brokerContext.getCurrentContext(signal.broker);
    let admitted;
    try {
      admitted = await this.orderGuard.admit(
        {
          broker: signal.broker,
          market: signal.market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          side: signal.side,
        },
        async (tx) => {
          const recentNotification = await tx.stopLossApproval.findFirst({
            where: {
              tradeRecord: { broker: signal.broker },
              market: signal.market as Market,
              exchangeCode: signal.exchangeCode,
              stockCode: signal.stockCode,
              notifiedAt: {
                gt: new Date(
                  requestedAt.getTime()
                    - TradingSellApprovalService.SUCCESSFUL_NOTIFICATION_COOLDOWN_MINUTES
                      * 60 * 1000,
                ),
              },
            },
            orderBy: { notifiedAt: 'desc' },
            select: { id: true },
          });
          if (recentNotification) {
            return {
              approval: undefined,
              tradeRecordId: undefined,
              coolingDown: true,
            };
          }

          const record = await tx.tradeRecord.create({
            data: {
              broker: signal.broker,
              market: signal.market as Market,
              exchangeCode: signal.exchangeCode,
              stockCode: signal.stockCode,
              stockName,
              side: signal.side as Side,
              orderType,
              quantity: signal.quantity,
              price: new Prisma.Decimal(this.asFiniteNumber(signal.price, 0)),
              status: OrderStatus.AWAITING_APPROVAL,
              strategyName: effectiveStrategyName,
              reason: signal.reason,
              brokerEnvironment: brokerContext.environment,
              brokerAccountHash: brokerContext.accountHash,
            },
          });
          const approval = await tx.stopLossApproval.create({
            data: {
              tradeRecordId: record.id,
              market: signal.market as Market,
              exchangeCode: signal.exchangeCode,
              stockCode: signal.stockCode,
              stockName,
              strategyName: effectiveStrategyName,
              signal: signal as unknown as Prisma.InputJsonValue,
              currentPrice: new Prisma.Decimal(currentPrice),
              avgPrice: new Prisma.Decimal(avgPrice),
              quantity: signal.quantity,
              lossRate: new Prisma.Decimal(lossRate),
              status: ApprovalStatus.PENDING,
              requestedAt,
              expiresAt: new Date(
                requestedAt.getTime()
                  + TradingSellApprovalService.PROVISIONAL_APPROVAL_MINUTES * 60 * 1000,
              ),
              timeoutMinutes: TradingSellApprovalService.APPROVAL_VALIDITY_MINUTES,
            },
          });
          return { approval, tradeRecordId: record.id, coolingDown: false };
        },
      );
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      const pendingWinnerExists = await this.reloadPendingApproval(signal);
      if (!pendingWinnerExists) throw error;
      return false;
    }

    if (!admitted) {
      await this.reloadPendingApproval(signal);
      return false;
    }
    if (admitted.coolingDown || !admitted.approval || !admitted.tradeRecordId) return false;

    const existingApproval = admitted.approval;
    const tradeRecordId = admitted.tradeRecordId;
    let slackApprovalSent = false;

    if (this.slackService?.isEnabled()) {
      let slackResult: { ts: string; channel: string } | null = null;
      let deliveryReceivedAt: Date | null = null;
      try {
        slackResult = await this.slackService.sendStopLossApproval({
          broker: signal.broker,
          approvalId: existingApproval.id,
          tradeRecordId,
          stockCode: signal.stockCode,
          stockName,
          exchangeCode: signal.exchangeCode,
          market: signal.market,
          strategyName: effectiveStrategyName,
          quantity: signal.quantity,
          currentPrice,
          avgPrice,
          lossRate,
          expectedPnl,
          expectedPnlRate,
          approvalReason: signal.reason,
          approvalType: this.resolveSellApprovalType(signal, strategyName, ctx),
          validityMinutes: TradingSellApprovalService.APPROVAL_VALIDITY_MINUTES,
          cooldownMinutes: TradingSellApprovalService.SUCCESSFUL_NOTIFICATION_COOLDOWN_MINUTES,
        });
        deliveryReceivedAt = new Date();
      } catch (error) {
        this.logger.warn(
          `[${signal.broker} ${signal.stockCode}] Sell approval Slack delivery failed: ${this.errorMessage(error)}`,
        );
      }

      const delivery = deliveryReceivedAt
        ? this.parseSlackDelivery(slackResult, requestedAt, deliveryReceivedAt)
        : null;
      if (delivery) {
        const finalized = await this.prisma.stopLossApproval.updateMany({
          where: {
            id: existingApproval.id,
            tradeRecordId,
            status: ApprovalStatus.PENDING,
            expiresAt: { gt: new Date() },
          },
          data: {
            notifiedAt: delivery.notifiedAt,
            expiresAt: new Date(
              delivery.notifiedAt.getTime()
                + TradingSellApprovalService.APPROVAL_VALIDITY_MINUTES * 60 * 1000,
            ),
            slackMessageTs: delivery.ts,
            slackChannel: delivery.channel,
            timeoutMinutes: TradingSellApprovalService.APPROVAL_VALIDITY_MINUTES,
          },
        });
        slackApprovalSent = finalized.count === 1;
      }
    }

    if (!slackApprovalSent) {
      await this.expireApprovalPair(existingApproval.id, tradeRecordId);
    }

    await this.logWatchStockExecution(
      ctx,
      WatchStockExecutionEventType.SKIPPED,
      slackApprovalSent
        ? '매도 승인 Slack 전송: 관리자 승인 대기'
        : '매도 승인 전달 실패: 승인 EXPIRED / 주문 CANCELLED',
      {
        side: signal.side,
        quantity: signal.quantity,
        price: signal.price,
        orderDivision: signal.orderDivision,
        orderType,
        reason: signal.reason,
        metadata: signal.metadata,
        approvalId: existingApproval.id,
        approvalType: this.resolveSellApprovalType(signal, strategyName, ctx),
        avgPrice,
        currentPrice,
        expectedPnl,
        expectedPnlRate,
        slackApprovalSent,
        validityMinutes: TradingSellApprovalService.APPROVAL_VALIDITY_MINUTES,
        cooldownMinutes: TradingSellApprovalService.SUCCESSFUL_NOTIFICATION_COOLDOWN_MINUTES,
      },
      tradeRecordId,
    );

    if (slackApprovalSent) {
      this.logger.log(
        `[${signal.broker} ${signal.stockCode}] Sell approval delivered; awaiting administrator decision`,
      );
    } else {
      this.logger.warn(
        `[${signal.broker} ${signal.stockCode}] Sell approval delivery failed: approval EXPIRED, trade CANCELLED`,
      );
    }
    return false;
  }

  async logApprovedOrderSubmission(
    record: {
      id: string;
      broker: Broker;
      market: Market;
      exchangeCode: string;
      stockCode: string;
      stockName: string;
      strategyName?: string | null;
    },
    signal: TradingSignal,
  ): Promise<void> {
    const watchStock = await this.prisma.watchStock.findUnique({
      where: {
        broker_market_exchangeCode_stockCode: {
          broker: record.broker,
          market: record.market,
          exchangeCode: record.exchangeCode,
          stockCode: record.stockCode,
        },
      },
    });
    if (!watchStock) return;

    await this.prisma.watchStockExecutionLog.create({
      data: {
        watchStockId: watchStock.id,
        tradeRecordId: record.id,
        market: record.market,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        stockName: record.stockName,
        strategyName: record.strategyName,
        eventType: WatchStockExecutionEventType.ORDER_SUBMITTED,
        message: `주문 제출: ${signal.side} ${signal.quantity}주`,
        details: {
          side: signal.side,
          quantity: signal.quantity,
          price: signal.price,
          orderDivision: signal.orderDivision,
          reason: signal.reason,
          metadata: signal.metadata,
          approvedSell: true,
        },
      },
    });
  }

  private isManualSellExitSignal(signal: TradingSignal): boolean {
    const phase = String(signal.metadata?.phase || '');
    if (TradingSellApprovalService.MANUAL_SELL_APPROVAL_PHASES.has(phase)) {
      return true;
    }

    const reason = signal.reason || '';
    return TradingSellApprovalService.PROTECTIVE_SELL_REASON_PATTERNS.some((pattern) =>
      pattern.test(reason),
    );
  }

  private isStopLossSignal(signal: TradingSignal): boolean {
    return signal.side === 'SELL' && (signal.reason?.toLowerCase().includes('stop loss') ?? false);
  }

  private isHighTInfiniteBuyTakeProfitSignal(
    signal: TradingSignal,
    strategyName?: string,
    ctx?: StockStrategyContext,
  ): boolean {
    const effectiveStrategyName = strategyName || ctx?.watchStock?.strategyName;
    if (effectiveStrategyName !== 'infinite-buy') return false;

    const phase = String(signal.metadata?.phase || '');
    const isTakeProfit = phase.startsWith('take-profit') || this.isTakeProfitReason(signal.reason);
    if (!isTakeProfit) return false;

    const tValue = this.readSignalTValue(signal, ctx);
    return tValue !== undefined && tValue >= TradingSellApprovalService.HIGH_T_SELL_APPROVAL_THRESHOLD;
  }

  private readSignalTValue(signal: TradingSignal, ctx?: StockStrategyContext): number | undefined {
    const metadata = signal.metadata || {};
    const candidates = [
      metadata.tValue,
      metadata.T,
      metadata.t,
      metadata.postFillTValue,
    ];

    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    const reasonMatch = signal.reason?.match(/\bT\s*=\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (reasonMatch) {
      const parsed = Number(reasonMatch[1]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    const quota = Number(ctx?.watchStock?.quota || 0);
    const maxCycles = Number(ctx?.watchStock?.maxCycles || 0);
    const totalInvested = Number(ctx?.position?.totalInvested || 0);
    const perCycleQuota = quota > 0 && maxCycles > 0 ? quota / maxCycles : 0;
    if (perCycleQuota > 0 && totalInvested > 0) {
      return totalInvested / perCycleQuota;
    }

    return undefined;
  }

  private isTakeProfitReason(reason?: string): boolean {
    const value = reason || '';
    return value.includes('익절') || value.toLowerCase().includes('take profit');
  }

  private resolveSellApprovalType(
    signal: TradingSignal,
    strategyName?: string,
    ctx?: StockStrategyContext,
  ): 'STOP_LOSS' | 'LIQUIDATION' | 'HIGH_T_TAKE_PROFIT' {
    if (this.isHighTInfiniteBuyTakeProfitSignal(signal, strategyName, ctx)) {
      return 'HIGH_T_TAKE_PROFIT';
    }

    const reason = signal.reason || '';
    if (this.isStopLossSignal(signal) || reason.includes('손절')) {
      return 'STOP_LOSS';
    }

    return 'LIQUIDATION';
  }

  private asFiniteNumber(...values: unknown[]): number {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  private parseSlackDelivery(
    result: { ts: string; channel: string } | null,
    requestedAt: Date,
    deliveryReceivedAt: Date,
  ): { ts: string; channel: string; notifiedAt: Date } | null {
    if (typeof result?.ts !== 'string' || typeof result.channel !== 'string') return null;

    const ts = result.ts.trim();
    const channel = result.channel.trim();
    if (!ts || !channel || !/^\d+(?:\.\d+)?$/.test(ts)) return null;

    const epochSeconds = Number(ts);
    if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;

    const notifiedAt = new Date(epochSeconds * 1000);
    if (Number.isNaN(notifiedAt.getTime())) return null;
    if (notifiedAt < requestedAt || notifiedAt > deliveryReceivedAt) return null;
    return { ts, channel, notifiedAt };
  }

  private normalizeApprovalSignal(signal: TradingSignal): TradingSignal {
    return {
      ...signal,
      exchangeCode: signal.market === 'DOMESTIC'
        ? 'KRX'
        : signal.exchangeCode.trim().toUpperCase(),
      stockCode: signal.stockCode.trim().toUpperCase(),
    };
  }

  private async expireApprovalPair(
    approvalId: string,
    tradeRecordId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const expired = await tx.stopLossApproval.updateMany({
        where: {
          id: approvalId,
          tradeRecordId,
          status: ApprovalStatus.PENDING,
        },
        data: { status: ApprovalStatus.EXPIRED },
      });
      if (expired.count === 0) return;

      const cancelled = await tx.tradeRecord.updateMany({
        where: {
          id: tradeRecordId,
          status: OrderStatus.AWAITING_APPROVAL,
        },
        data: { status: OrderStatus.CANCELLED },
      });
      if (cancelled.count !== 1) {
        throw new Error('Failed to cancel undelivered approval trade');
      }
    });
  }

  private async expireDueApprovalPairs(
    signal: TradingSignal,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const dueApprovals = await tx.stopLossApproval.findMany({
        where: {
          tradeRecord: { broker: signal.broker },
          market: signal.market as Market,
          exchangeCode: signal.exchangeCode,
          stockCode: signal.stockCode,
          status: ApprovalStatus.PENDING,
          expiresAt: { lte: now },
        },
        select: { id: true, tradeRecordId: true },
      });

      for (const approval of dueApprovals) {
        const expired = await tx.stopLossApproval.updateMany({
          where: {
            id: approval.id,
            status: ApprovalStatus.PENDING,
            expiresAt: { lte: now },
          },
          data: { status: ApprovalStatus.EXPIRED },
        });
        if (expired.count === 0) continue;

        const cancelled = await tx.tradeRecord.updateMany({
          where: {
            id: approval.tradeRecordId,
            status: OrderStatus.AWAITING_APPROVAL,
          },
          data: { status: OrderStatus.CANCELLED },
        });
        if (cancelled.count !== 1) {
          throw new Error('Failed to cancel expired approval trade');
        }
      }
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002';
  }

  private async reloadPendingApproval(signal: TradingSignal): Promise<boolean> {
    const pendingApproval = await this.prisma.stopLossApproval.findFirst({
      where: {
        tradeRecord: { broker: signal.broker },
        market: signal.market as Market,
        exchangeCode: signal.exchangeCode,
        stockCode: signal.stockCode,
        status: ApprovalStatus.PENDING,
      },
      orderBy: { requestedAt: 'desc' },
    });
    return pendingApproval !== null;
  }

  private async logWatchStockExecution(
    ctx: StockStrategyContext | undefined,
    eventType: WatchStockExecutionEventType,
    message: string,
    details?: Record<string, any>,
    tradeRecordId?: string,
  ): Promise<void> {
    if (!ctx?.watchStock?.id) return;

    try {
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
    } catch (error) {
      this.logger.warn(
        `[${ctx.watchStock.broker} ${ctx.watchStock.stockCode}] Sell approval execution log failed: ${this.errorMessage(error)}`,
      );
    }
  }
}
