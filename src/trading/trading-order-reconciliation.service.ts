import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  ApprovalStatus,
  BrokerOrderAction,
  BrokerOrderActionChannel,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  Side,
  TradeRecord,
  WatchStockExecutionEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SlackService } from '../notification/slack.service';
import type { TradeAlertContext } from '../notification/types/notification.types';
import { BrokerOrderStatus, UnfilledOrder } from '../kis/types/kis-api.types';
import { OrderReconciliationResult, PositionQuantitySnapshot, TradingSignal } from './types';
import { TradingService } from './trading.service';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { TradingOrderFailureNotificationService } from './trading-order-failure-notification.service';

@Injectable()
export class TradingOrderReconciliationService {
  private readonly logger = new Logger(TradingOrderReconciliationService.name);

  constructor(
    private prisma: PrismaService,
    private tradingService: TradingService,
    private readonly brokerContext: TradingBrokerContextService,
    private readonly failureNotifier: TradingOrderFailureNotificationService,
    @Optional() private slackService?: SlackService,
  ) {}

  async reconcileOpenOrders(
    market: 'DOMESTIC' | 'OVERSEAS',
    currentPositions: PositionQuantitySnapshot[],
    unfilledOrders: UnfilledOrder[],
    brokerOrders: BrokerOrderStatus[],
  ): Promise<OrderReconciliationResult> {
    const currentBrokerContext = this.brokerContext.getCurrentContext();
    const openRecords = await this.prisma.tradeRecord.findMany({
      where: {
        market: market as Market,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
        orderNo: { not: null },
        brokerEnvironment: currentBrokerContext.environment,
        brokerAccountHash: currentBrokerContext.accountHash,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (openRecords.length === 0) return { hasNewFill: false };

    let hasNewFill = false;

    const currentPositionMap = new Map<string, number>();
    for (const position of currentPositions) {
      currentPositionMap.set(
        this.getPositionKey(position.market, position.exchangeCode, position.stockCode),
        position.quantity,
      );
    }

    const cancelGraceMs = 2 * 60 * 1000;
    const now = Date.now();

    for (const record of openRecords) {
      const exchangeCode = record.exchangeCode || (record.market === Market.DOMESTIC ? 'KRX' : '');
      const key = this.getPositionKey(record.market as 'DOMESTIC' | 'OVERSEAS', exchangeCode, record.stockCode);
      const currentPositionQty = currentPositionMap.get(key) || 0;
      const executedQty = record.executedQty || 0;
      const brokerOrder = this.findMatchingBrokerOrder(record, brokerOrders, market);

      if (
        record.cancellationStatus === CancellationAttemptStatus.SUBMITTING
        || record.cancellationStatus === CancellationAttemptStatus.UNKNOWN
      ) {
        continue;
      }

      if (record.cancellationStatus === CancellationAttemptStatus.ACCEPTED) {
        const isStillOpen = unfilledOrders.some((order) =>
          this.matchesOrderTuple(record, order, market),
        );
        const cancellationHasNewFill = await this.reconcileAcceptedCancellation(
          record,
          brokerOrder,
          isStillOpen,
          currentPositionQty,
        );
        hasNewFill ||= cancellationHasNewFill;
        continue;
      }

      if (brokerOrder) {
        const totalExecutedQty = Math.max(
          executedQty,
          Math.min(record.quantity, brokerOrder.filledQuantity),
        );
        const filledNowQty = Math.max(0, totalExecutedQty - executedQty);
        const nextStatus = this.getBrokerOrderStatus(record.quantity, totalExecutedQty, brokerOrder);
        const isTerminalPartial = nextStatus === OrderStatus.PARTIAL
          && brokerOrder.remainingQuantity <= 0;
        const nextExecutedPrice = brokerOrder.filledPrice ?? record.executedPrice ?? record.price;
        const nextReason = this.buildBrokerOrderReason(record.reason, brokerOrder, nextStatus);

        if (
          filledNowQty > 0
          || isTerminalPartial
          || nextStatus !== record.status
          || Number(record.executedPrice ?? 0) !== Number(nextExecutedPrice ?? 0)
        ) {
          const changed = await this.prisma.tradeRecord.updateMany({
            where: {
              id: record.id,
              status: record.status,
              orderNo: record.orderNo,
              cancellationStatus: record.cancellationStatus ?? null,
            },
            data: {
              status: nextStatus,
              ...(isTerminalPartial ? { orderNo: null } : {}),
              executedQty: totalExecutedQty,
              executedPrice: nextExecutedPrice,
              reason: nextReason,
            },
          });
          if (changed.count === 0) continue;

          try {
            if (filledNowQty > 0) {
              hasNewFill = true;
              const qtyBeforeFill = record.side === Side.BUY
                ? Math.max(0, currentPositionQty - filledNowQty)
                : currentPositionQty + filledNowQty;
              await this.applyReconciledStrategyFill(record.id, nextStatus, qtyBeforeFill, filledNowQty);
            } else if (
              (nextStatus === OrderStatus.FAILED || nextStatus === OrderStatus.CANCELLED)
              && totalExecutedQty === 0
            ) {
              // 체결 없이 실패/취소 확정 — 전략에 실패 통지 (이월금 복구 등)
              await this.applyReconciledStrategyFailure(record.id, nextStatus);
            }

            await this.logReconciledOrder(record.id, nextStatus, totalExecutedQty);
          } finally {
            if (nextStatus === OrderStatus.FAILED && totalExecutedQty === 0) {
              await this.failureNotifier.notify(record.id, 'RECONCILIATION');
            }
          }
          await this.notifyTradeFill(record.id, nextStatus, filledNowQty);
        }
        continue;
      }

      if (unfilledOrders.some((order) => this.matchesOrderTuple(record, order, market))) {
        continue;
      }

      if (now - new Date(record.createdAt).getTime() < cancelGraceMs) {
        continue;
      }

      if (record.status === OrderStatus.PARTIAL) {
        const changed = await this.prisma.tradeRecord.updateMany({
          where: {
            id: record.id,
            status: record.status,
            orderNo: record.orderNo,
            cancellationStatus: record.cancellationStatus ?? null,
          },
          data: {
            orderNo: null,
            reason: record.reason ? `${record.reason} | 잔량 미체결 종료` : '잔량 미체결 종료',
          },
        });
        if (changed.count === 0) continue;
        // PARTIAL의 잔량 취소는 이미 일부 체결됐으므로 전략 측 이월금 복구 불필요
        await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, executedQty);
        continue;
      }

      if (record.status === OrderStatus.PENDING) {
        const changed = await this.prisma.tradeRecord.updateMany({
          where: {
            id: record.id,
            status: record.status,
            orderNo: record.orderNo,
            cancellationStatus: record.cancellationStatus ?? null,
          },
          data: {
            status: OrderStatus.CANCELLED,
            reason: record.reason ? `${record.reason} | 미체결 종료` : '미체결 종료',
          },
        });
        if (changed.count === 0) continue;
        // 체결 없이 취소 확정 — 전략에 실패 통지 (BUY 주문이었다면 이월금 복구)
        await this.applyReconciledStrategyFailure(record.id, OrderStatus.CANCELLED);
        await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, executedQty);
      }
    }

    return { hasNewFill };
  }

  // ── Helpers ──

  private async reconcileAcceptedCancellation(
    record: TradeRecord,
    brokerOrder: BrokerOrderStatus | undefined,
    isStillOpen: boolean,
    currentPositionQty: number,
  ): Promise<boolean> {
    if (!brokerOrder || isStillOpen || !record.orderNo) return false;

    const previousExecutedQty = record.executedQty || 0;
    const totalExecutedQty = Math.min(
      record.quantity,
      brokerOrder?.filledQuantity ?? previousExecutedQty,
    );
    const filledNowQty = Math.max(0, totalExecutedQty - previousExecutedQty);
    const nextStatus = totalExecutedQty >= record.quantity
      ? OrderStatus.FILLED
      : totalExecutedQty > 0
        ? OrderStatus.PARTIAL
        : OrderStatus.CANCELLED;
    const reasonSuffix = nextStatus === OrderStatus.FILLED
      ? '취소 요청 중 전량 체결 확인'
      : nextStatus === OrderStatus.PARTIAL
        ? '잔량 미체결 종료'
        : '미체결 종료';
    const reason = record.reason ? `${record.reason} | ${reasonSuffix}` : reasonSuffix;
    const cancellationMessage = nextStatus === OrderStatus.FILLED
      ? '취소 접수 후 전량 체결 확인'
      : nextStatus === OrderStatus.PARTIAL
        ? '취소 접수 후 일부 체결 및 잔량 종료 확인'
        : '취소 접수 후 미체결 종료 확인';

    const resolved = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.tradeRecord.updateMany({
        where: {
          id: record.id,
          status: record.status,
          cancellationStatus: CancellationAttemptStatus.ACCEPTED,
          orderNo: record.orderNo,
        },
        data: {
          status: nextStatus,
          ...(nextStatus === OrderStatus.PARTIAL ? { orderNo: null } : {}),
          ...(brokerOrder
            ? {
              executedQty: totalExecutedQty,
              executedPrice: brokerOrder.filledPrice ?? record.executedPrice ?? record.price,
            }
            : {}),
          cancellationStatus: CancellationAttemptStatus.RESOLVED,
          cancellationResolvedAt: new Date(),
          cancellationResolvedBy: 'system:reconciliation',
          cancellationMessage,
          reason,
        },
      });
      if (changed.count === 0) return false;

      await tx.brokerOrderActionAuditLog.create({
        data: {
          tradeRecordId: record.id,
          channel: BrokerOrderActionChannel.SYSTEM,
          action: BrokerOrderAction.CANCELLATION_RECONCILED,
          actor: 'system:reconciliation',
          beforeStatus: record.status,
          afterStatus: nextStatus,
          exchangeCode: record.exchangeCode,
          orderNo: record.orderNo,
          details: {
            executedQty: totalExecutedQty,
            cancellationMessage,
          },
        },
      });
      return true;
    });
    if (!resolved) return false;

    if (filledNowQty > 0) {
      const qtyBeforeFill = record.side === Side.BUY
        ? Math.max(0, currentPositionQty - filledNowQty)
        : currentPositionQty + filledNowQty;
      await this.applyReconciledStrategyFill(record.id, nextStatus, qtyBeforeFill, filledNowQty);
    } else if (nextStatus === OrderStatus.CANCELLED) {
      await this.applyReconciledStrategyFailure(record.id, nextStatus);
    }
    await this.logReconciledOrder(record.id, nextStatus, totalExecutedQty);
    await this.notifyTradeFill(record.id, nextStatus, filledNowQty);
    return filledNowQty > 0;
  }

  private getPositionKey(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
    stockCode: string,
  ): string {
    return `${market}:${exchangeCode}:${stockCode}`;
  }

  private findMatchingBrokerOrder(
    record: TradeRecord,
    orders: BrokerOrderStatus[],
    market: 'DOMESTIC' | 'OVERSEAS',
  ): BrokerOrderStatus | undefined {
    const matches = orders.filter((order) => (
      this.matchesOrderTuple(record, order, market)
      && (!record.brokerOrderDate || order.orderDate === record.brokerOrderDate)
    ));

    return matches.reduce<BrokerOrderStatus | undefined>((existing, order) => {
      if (!existing) return order;
      return {
        ...existing,
        filledQuantity: Math.max(existing.filledQuantity, order.filledQuantity),
        remainingQuantity: Math.min(existing.remainingQuantity, order.remainingQuantity),
        filledPrice: order.filledPrice ?? existing.filledPrice,
        rejected: existing.rejected || order.rejected,
        rejectedReason: order.rejectedReason || existing.rejectedReason,
        orderTime: order.orderTime || existing.orderTime,
      };
    }, undefined);
  }

  private matchesOrderTuple(
    record: TradeRecord,
    order: Pick<BrokerOrderStatus | UnfilledOrder, 'orderNo' | 'exchangeCode' | 'stockCode' | 'side'>,
    market: 'DOMESTIC' | 'OVERSEAS',
  ): boolean {
    return record.orderNo === order.orderNo
      && this.normalizeExchangeCode(market, record.exchangeCode)
        === this.normalizeExchangeCode(market, order.exchangeCode)
      && record.stockCode.trim().toUpperCase() === order.stockCode.trim().toUpperCase()
      && record.side === order.side;
  }

  private normalizeExchangeCode(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode?: string | null,
  ): string {
    const normalized = exchangeCode?.trim().toUpperCase() || '';
    return market === 'DOMESTIC' ? normalized || 'KRX' : normalized;
  }

  private getBrokerOrderStatus(
    requestedQuantity: number,
    executedQuantity: number,
    brokerOrder: BrokerOrderStatus,
  ): OrderStatus {
    if (brokerOrder.rejected) return OrderStatus.FAILED;
    if (executedQuantity <= 0) return OrderStatus.PENDING;
    if (executedQuantity >= requestedQuantity) {
      return OrderStatus.FILLED;
    }
    return OrderStatus.PARTIAL;
  }

  private buildBrokerOrderReason(
    existingReason: string | null | undefined,
    brokerOrder: BrokerOrderStatus,
    nextStatus: OrderStatus,
  ): string | undefined {
    const baseReason = existingReason || undefined;
    const brokerDetails = this.formatBrokerOrderDetails(brokerOrder, nextStatus);
    if (!brokerDetails) return baseReason;
    if (!baseReason) return brokerDetails;
    if (baseReason.includes(brokerDetails)) return baseReason;
    return `${baseReason} | ${brokerDetails}`;
  }

  private formatBrokerOrderDetails(
    brokerOrder: BrokerOrderStatus,
    nextStatus: OrderStatus,
  ): string | undefined {
    if (nextStatus === OrderStatus.FAILED) {
      if (brokerOrder.rejectedReason) {
        return `브로커 거부: ${brokerOrder.rejectedReason}`;
      }
      return '브로커 거부';
    }

    if (nextStatus === OrderStatus.PARTIAL) {
      const fragments = [`부분체결 ${brokerOrder.filledQuantity}/${brokerOrder.orderQuantity}주`];
      if (brokerOrder.remainingQuantity > 0) {
        fragments.push(`잔량 ${brokerOrder.remainingQuantity}주`);
      }
      if (brokerOrder.filledPrice) {
        fragments.push(`평균체결가 ${brokerOrder.filledPrice}`);
      }
      return fragments.join(', ');
    }

    if (nextStatus === OrderStatus.FILLED && brokerOrder.filledPrice) {
      return `평균체결가 ${brokerOrder.filledPrice}`;
    }

    return undefined;
  }

  private async getSubmittedSignal(tradeRecordId: string): Promise<TradingSignal | undefined> {
    const executionLogs = await this.prisma.watchStockExecutionLog.findMany({
      where: {
        tradeRecordId,
        eventType: WatchStockExecutionEventType.ORDER_SUBMITTED,
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const executionLog of executionLogs) {
      const details = (executionLog.details as Record<string, any> | null) || {};
      const quantity = Number(details.quantity);
      if (
        (details.side !== 'BUY' && details.side !== 'SELL')
        || !Number.isFinite(quantity)
        || quantity <= 0
      ) {
        continue;
      }

      return {
        market: executionLog.market as 'DOMESTIC' | 'OVERSEAS',
        exchangeCode: executionLog.exchangeCode,
        stockCode: executionLog.stockCode,
        side: details.side,
        quantity,
        price: details.price !== undefined ? Number(details.price) : undefined,
        orderDivision: details.orderDivision as string | undefined,
        reason: details.reason || executionLog.message,
        metadata: details.metadata as Record<string, any> | undefined,
      };
    }

    const approval = await this.prisma.stopLossApproval.findFirst({
      where: {
        tradeRecordId,
        status: ApprovalStatus.APPROVED,
      },
      orderBy: { respondedAt: 'desc' },
      select: { signal: true },
    });
    return this.normalizeStoredSignal(approval?.signal);
  }

  private normalizeStoredSignal(value: unknown): TradingSignal | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

    const signal = value as Record<string, unknown>;
    if (
      (signal.market !== 'DOMESTIC' && signal.market !== 'OVERSEAS')
      || (signal.side !== 'BUY' && signal.side !== 'SELL')
      || typeof signal.exchangeCode !== 'string'
      || !signal.exchangeCode.trim()
      || typeof signal.stockCode !== 'string'
      || !signal.stockCode.trim()
      || typeof signal.reason !== 'string'
    ) {
      return undefined;
    }

    const quantity = Number(signal.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return undefined;
    const price = signal.price === undefined ? undefined : Number(signal.price);
    if (price !== undefined && !Number.isFinite(price)) return undefined;

    return {
      market: signal.market,
      exchangeCode: signal.exchangeCode,
      stockCode: signal.stockCode,
      side: signal.side,
      quantity,
      price,
      orderDivision: typeof signal.orderDivision === 'string'
        ? signal.orderDivision
        : undefined,
      reason: signal.reason,
      metadata: signal.metadata && typeof signal.metadata === 'object'
        && !Array.isArray(signal.metadata)
        ? signal.metadata as Record<string, any>
        : undefined,
    };
  }

  private async applyReconciledStrategyFill(
    tradeRecordId: string,
    status: OrderStatus,
    currentPositionQty: number,
    filledNowQty: number,
  ): Promise<void> {
    const record = await this.prisma.tradeRecord.findUnique({
      where: { id: tradeRecordId },
    });
    if (!record?.strategyName) return;

    const watchStock = await this.prisma.watchStock.findUnique({
      where: {
        market_exchangeCode_stockCode: {
          market: record.market,
          exchangeCode: record.exchangeCode,
          stockCode: record.stockCode,
        },
      },
    });
    if (!watchStock) return;

    const signal = await this.getSubmittedSignal(tradeRecordId);
    if (!signal) return;

    // 실제 체결가(broker 평균체결가). LOC/MOC는 제출가(지정/시장)와 다를 수 있어
    // v4 등 금액 기반 장부(cashRemaining/T)를 쓰는 전략은 이 값을 우선한다.
    const executedPrice = record.executedPrice !== null ? Number(record.executedPrice) : undefined;

    if (record.side === Side.BUY && filledNowQty > 0) {
      await this.tradingService.handleStrategySignalFill(
        record.strategyName,
        watchStock.id,
        {
          ...signal,
          quantity: filledNowQty,
        },
        currentPositionQty,
        record.createdAt, // entryDate 등 날짜 상태는 주문 시각 기준 (reconciliation 지연에 영향받지 않게)
        executedPrice,
      );
      return;
    }

    if (record.side === Side.SELL && status === OrderStatus.FILLED) {
      await this.tradingService.handleStrategySignalFill(
        record.strategyName,
        watchStock.id,
        signal,
        currentPositionQty,
        record.createdAt,
        executedPrice,
      );
    }
  }

  /**
   * 주문이 체결 없이 FAILED/CANCELLED로 확정된 경우 전략에 실패를 통지.
   * BUY 주문 실패 시 이월금(accumulatedQuota)을 perCycleQuota만큼 복구한다.
   * SELL 주문 실패는 포지션/이월금에 영향 없음 (다음 스케줄에서 재평가).
   */
  private async applyReconciledStrategyFailure(
    tradeRecordId: string,
    status: OrderStatus,
  ): Promise<void> {
    const record = await this.prisma.tradeRecord.findUnique({
      where: { id: tradeRecordId },
    });
    if (!record?.strategyName) return;
    if (record.side !== Side.BUY) return;
    if (!['infinite-buy', 'daily-dca'].includes(record.strategyName)) return;

    const watchStock = await this.prisma.watchStock.findUnique({
      where: {
        market_exchangeCode_stockCode: {
          market: record.market,
          exchangeCode: record.exchangeCode,
          stockCode: record.stockCode,
        },
      },
    });
    if (!watchStock || !watchStock.quota) return;

    const params = (watchStock.strategyParams as Record<string, any>) || {};
    const today = this.getTodayKstDate();

    // 중복 누적 방지: 같은 날 이미 `executePerStockStrategy` 경로에서 carry 처리됐다면 재적립 금지.
    // (BUY 제출 전부 실패 시 quotaCarryEligibleIds → accumulateUnusedQuotas가 lastAccumulatedDate=today 기록)
    if (params.lastAccumulatedDate === today) {
      this.logger.debug(
        `[${watchStock.stockCode}] Quota already accumulated today (${today}), skipping restore on ${status}`,
      );
      return;
    }

    const perCycleQuota = Number(watchStock.quota) / watchStock.maxCycles;
    if (perCycleQuota <= 0) return;

    const position = await this.prisma.position.findFirst({
      where: {
        market: record.market,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
      },
    });
    const totalInvested = Number(position?.totalInvested || 0);
    const remainingQuota = Math.max(0, Number(watchStock.quota) - totalInvested);
    if (remainingQuota <= 0) return;

    const currentAccumulated = Number(params.accumulatedQuota || 0);
    const nextAccumulated = Math.min(currentAccumulated + perCycleQuota, remainingQuota);

    await this.prisma.watchStock.update({
      where: { id: watchStock.id },
      data: {
        strategyParams: {
          ...params,
          accumulatedQuota: nextAccumulated,
          lastAccumulatedDate: today,
        },
      },
    });

    this.logger.log(
      `[${watchStock.stockCode}] Quota restored after ${status} order: +${perCycleQuota.toFixed(2)} → ${nextAccumulated.toFixed(2)}`,
    );
  }

  private getTodayKstDate(): string {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private async logReconciledOrder(
    tradeRecordId: string,
    status: OrderStatus,
    executedQty: number,
  ): Promise<void> {
    const record = await this.prisma.tradeRecord.findUnique({
      where: { id: tradeRecordId },
    });
    if (!record) return;

    const watchStock = await this.prisma.watchStock.findUnique({
      where: {
        market_exchangeCode_stockCode: {
          market: record.market,
          exchangeCode: record.exchangeCode,
          stockCode: record.stockCode,
        },
      },
    });
    if (!watchStock) return;

    const remainingQty = Math.max(0, record.quantity - executedQty);
    const isCancelledRemainder = status === OrderStatus.CANCELLED && record.status === OrderStatus.PARTIAL && executedQty > 0;
    const eventType =
      status === OrderStatus.FAILED    ? WatchStockExecutionEventType.ORDER_FAILED :
      status === OrderStatus.CANCELLED ? WatchStockExecutionEventType.ORDER_CANCELLED :
                                         WatchStockExecutionEventType.ORDER_FILLED;
    const message = (() => {
      if (status === OrderStatus.FAILED) {
        return `주문 실패 확인: ${record.side} ${record.quantity}주 (브로커 거부)`;
      }
      if (isCancelledRemainder) {
        return `주문 잔량 취소 확인: ${record.side} ${executedQty}/${record.quantity}주 체결, 잔량 ${remainingQty}주 종료`;
      }
      if (status === OrderStatus.CANCELLED) {
        return `주문 취소 확인: ${record.side} ${record.quantity}주`;
      }
      if (status === OrderStatus.PARTIAL) {
        return `주문 일부 체결 확인: ${record.side} ${executedQty}/${record.quantity}주`;
      }
      return `주문 체결 확인: ${record.side} ${record.quantity}주`;
    })();

    await this.prisma.watchStockExecutionLog.create({
      data: {
        watchStockId: watchStock.id,
        tradeRecordId: record.id,
        market: record.market,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
        stockName: record.stockName,
        strategyName: record.strategyName,
        eventType,
        message,
        details: {
          status,
          orderNo: record.orderNo,
          executedQty,
          executedPrice: record.executedPrice,
          remainingQty,
          cancelledRemainder: isCancelledRemainder,
        },
      },
    });
  }

  private async notifyTradeFill(
    tradeRecordId: string,
    status: OrderStatus,
    filledNowQty: number,
  ): Promise<void> {
    if (!this.slackService?.isEnabled()) return;
    if (filledNowQty <= 0) return;
    if (status !== OrderStatus.FILLED && status !== OrderStatus.PARTIAL) return;

    const record = await this.prisma.tradeRecord.findUnique({
      where: { id: tradeRecordId },
    });
    if (!record) return;

    const signal = await this.getSubmittedSignal(tradeRecordId);
    if (!signal) {
      this.logger.warn(
        `[${record.stockCode}] Slack fill alert skipped: submitted signal unavailable for trade ${tradeRecordId}`,
      );
      return;
    }

    const position = await this.prisma.position.findFirst({
      where: {
        market: record.market,
        exchangeCode: record.exchangeCode,
        stockCode: record.stockCode,
      },
    });

    const executedPrice = Number(record.executedPrice ?? signal.price ?? record.price);
    const totalExecutedQty = record.executedQty || filledNowQty;
    const remainingQty = Math.max(0, record.quantity - totalExecutedQty);
    const strategyDetails = await this.buildTradeAlertStrategyDetails(record, signal, position);

    await this.slackService.sendTradeAlert({
      signal: {
        ...signal,
        quantity: filledNowQty,
        price: executedPrice,
      },
      result: {
        outcome: 'ACCEPTED',
        success: true,
        orderNo: record.orderNo ?? undefined,
        message: status === OrderStatus.PARTIAL ? '부분 체결' : '체결 완료',
      },
      execution: {
        quantity: filledNowQty,
        price: executedPrice,
        remainingQuantity: remainingQty,
        status: status as 'FILLED' | 'PARTIAL',
      },
      position: position
        ? {
            stockCode: position.stockCode,
            stockName: position.stockName,
            exchangeCode: position.exchangeCode,
            market: position.market,
            quantity: position.quantity,
            avgPrice: Number(position.avgPrice),
            currentPrice: Number(position.currentPrice),
            profitLoss: Number(position.profitLoss),
            profitRate: Number(position.profitRate),
            totalInvested: Number(position.totalInvested),
          }
        : undefined,
      ...(strategyDetails ? { strategyDetails } : {}),
    });
  }

  private async buildTradeAlertStrategyDetails(
    record: {
      strategyName?: string | null;
      market: Market;
      exchangeCode: string;
      stockCode: string;
    },
    signal: TradingSignal,
    position?: { totalInvested: unknown } | null,
  ): Promise<TradeAlertContext['strategyDetails'] | undefined> {
    if (record.strategyName !== 'infinite-buy') return undefined;

    const tValue = this.extractInfiniteBuyTValue(signal);
    if (tValue === undefined) return undefined;

    const watchStock = await this.prisma.watchStock.findUnique({
      where: {
        market_exchangeCode_stockCode: {
          market: record.market,
          exchangeCode: record.exchangeCode,
          stockCode: record.stockCode,
        },
      },
      select: { quota: true, maxCycles: true },
    });

    const quota = Number(watchStock?.quota ?? 0);
    const maxCycles = watchStock?.maxCycles;
    const perCycleQuota = quota > 0 && maxCycles ? quota / maxCycles : 0;
    const totalInvested = Number(position?.totalInvested ?? 0);
    const postFillTValue = perCycleQuota > 0 && totalInvested > 0
      ? totalInvested / perCycleQuota
      : undefined;

    return {
      tValue,
      postFillTValue,
      maxCycles,
    };
  }

  private extractInfiniteBuyTValue(signal: TradingSignal): number | undefined {
    const metadataTValue = Number(signal.metadata?.tValue ?? signal.metadata?.T);
    if (Number.isFinite(metadataTValue)) return metadataTValue;

    const match = signal.reason.match(/\bT=(\d+(?:\.\d+)?)/);
    if (!match) return undefined;

    const tValue = Number(match[1]);
    return Number.isFinite(tValue) ? tValue : undefined;
  }
}
