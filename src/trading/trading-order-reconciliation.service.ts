import { Injectable, Logger, Optional } from '@nestjs/common';
import { Market, OrderStatus, Side, WatchStockExecutionEventType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SlackService } from '../notification/slack.service';
import { BrokerOrderStatus, UnfilledOrder } from '../kis/types/kis-api.types';
import { PositionQuantitySnapshot, TradingSignal } from './types';
import { TradingService } from './trading.service';

@Injectable()
export class TradingOrderReconciliationService {
  private readonly logger = new Logger(TradingOrderReconciliationService.name);

  constructor(
    private prisma: PrismaService,
    private tradingService: TradingService,
    @Optional() private slackService?: SlackService,
  ) {}

  async reconcileOpenOrders(
    market: 'DOMESTIC' | 'OVERSEAS',
    currentPositions: PositionQuantitySnapshot[],
    unfilledOrders: UnfilledOrder[],
    brokerOrders: BrokerOrderStatus[],
  ): Promise<void> {
    const openRecords = await this.prisma.tradeRecord.findMany({
      where: {
        market: market as Market,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
        orderNo: { not: null },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (openRecords.length === 0) return;

    const currentPositionMap = new Map<string, number>();
    for (const position of currentPositions) {
      currentPositionMap.set(
        this.getPositionKey(position.market, position.exchangeCode, position.stockCode),
        position.quantity,
      );
    }

    const brokerOrderMap = this.groupBrokerOrdersByOrderNo(brokerOrders);
    const unfilledOrderNos = new Set(unfilledOrders.map((order) => order.orderNo));
    const cancelGraceMs = 2 * 60 * 1000;
    const now = Date.now();

    for (const record of openRecords) {
      const exchangeCode = record.exchangeCode || (record.market === Market.DOMESTIC ? 'KRX' : '');
      const key = this.getPositionKey(record.market as 'DOMESTIC' | 'OVERSEAS', exchangeCode, record.stockCode);
      const currentPositionQty = currentPositionMap.get(key) || 0;
      const executedQty = record.executedQty || 0;
      const brokerOrder = record.orderNo ? brokerOrderMap.get(record.orderNo) : undefined;

      if (brokerOrder) {
        const totalExecutedQty = Math.min(record.quantity, brokerOrder.filledQuantity);
        const filledNowQty = Math.max(0, totalExecutedQty - executedQty);
        const nextStatus = this.getBrokerOrderStatus(record.quantity, totalExecutedQty, brokerOrder);
        const nextExecutedPrice = brokerOrder.filledPrice ?? record.executedPrice ?? record.price;
        const nextReason = this.buildBrokerOrderReason(record.reason, brokerOrder, nextStatus);

        if (
          filledNowQty > 0
          || nextStatus !== record.status
          || Number(record.executedPrice ?? 0) !== Number(nextExecutedPrice ?? 0)
        ) {
          await this.prisma.tradeRecord.update({
            where: { id: record.id },
            data: {
              status: nextStatus,
              executedQty: totalExecutedQty,
              executedPrice: nextExecutedPrice,
              reason: nextReason,
            },
          });

          if (filledNowQty > 0) {
            const qtyBeforeFill = record.side === Side.BUY
              ? Math.max(0, currentPositionQty - filledNowQty)
              : currentPositionQty + filledNowQty;
            await this.applyReconciledStrategyFill(record.id, nextStatus, qtyBeforeFill, filledNowQty);
          } else if (nextStatus === OrderStatus.FAILED || nextStatus === OrderStatus.CANCELLED) {
            // 체결 없이 실패/취소 확정 — 전략에 실패 통지 (이월금 복구 등)
            await this.applyReconciledStrategyFailure(record.id, nextStatus);
          }

          await this.logReconciledOrder(record.id, nextStatus, totalExecutedQty);
          await this.notifyTradeFill(record.id, nextStatus, filledNowQty);
        }
        continue;
      }

      if (record.orderNo && unfilledOrderNos.has(record.orderNo)) {
        continue;
      }

      if (now - new Date(record.createdAt).getTime() < cancelGraceMs) {
        continue;
      }

      if (record.status === OrderStatus.PARTIAL) {
        await this.prisma.tradeRecord.update({
          where: { id: record.id },
          data: {
            orderNo: null,
            reason: record.reason ? `${record.reason} | 잔량 미체결 종료` : '잔량 미체결 종료',
          },
        });
        // PARTIAL의 잔량 취소는 이미 일부 체결됐으므로 전략 측 이월금 복구 불필요
        await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, executedQty);
        continue;
      }

      if (record.status === OrderStatus.PENDING) {
        await this.prisma.tradeRecord.update({
          where: { id: record.id },
          data: {
            status: OrderStatus.CANCELLED,
            reason: record.reason ? `${record.reason} | 미체결 종료` : '미체결 종료',
          },
        });
        // 체결 없이 취소 확정 — 전략에 실패 통지 (BUY 주문이었다면 이월금 복구)
        await this.applyReconciledStrategyFailure(record.id, OrderStatus.CANCELLED);
        await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, executedQty);
      }
    }
  }

  async markOpenOrderCancelled(
    market: 'DOMESTIC' | 'OVERSEAS',
    orderNo: string,
    reason: string,
  ): Promise<void> {
    const records = await this.prisma.tradeRecord.findMany({
      where: {
        market: market as Market,
        orderNo,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const record of records) {
      const nextReason = record.reason ? `${record.reason} | ${reason}` : reason;

      if (record.status === OrderStatus.PARTIAL) {
        await this.prisma.tradeRecord.update({
          where: { id: record.id },
          data: {
            orderNo: null,
            reason: nextReason,
          },
        });
        await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, record.executedQty || 0);
        continue;
      }

      await this.prisma.tradeRecord.update({
        where: { id: record.id },
        data: {
          status: OrderStatus.CANCELLED,
          reason: nextReason,
        },
      });
      // 체결 이력 없이 취소 확정 — 전략에 실패 통지
      if ((record.executedQty || 0) === 0) {
        await this.applyReconciledStrategyFailure(record.id, OrderStatus.CANCELLED);
      }
      await this.logReconciledOrder(record.id, OrderStatus.CANCELLED, record.executedQty || 0);
    }
  }

  // ── Helpers ──

  private getPositionKey(
    market: 'DOMESTIC' | 'OVERSEAS',
    exchangeCode: string,
    stockCode: string,
  ): string {
    return `${market}:${exchangeCode}:${stockCode}`;
  }

  private groupBrokerOrdersByOrderNo(orders: BrokerOrderStatus[]): Map<string, BrokerOrderStatus> {
    const grouped = new Map<string, BrokerOrderStatus>();

    for (const order of orders) {
      const existing = grouped.get(order.orderNo);
      if (!existing) {
        grouped.set(order.orderNo, order);
        continue;
      }

      grouped.set(order.orderNo, {
        ...existing,
        filledQuantity: Math.max(existing.filledQuantity, order.filledQuantity),
        remainingQuantity: Math.min(existing.remainingQuantity, order.remainingQuantity),
        filledPrice: order.filledPrice ?? existing.filledPrice,
        rejected: existing.rejected || order.rejected,
        rejectedReason: order.rejectedReason || existing.rejectedReason,
        orderTime: order.orderTime || existing.orderTime,
      });
    }

    return grouped;
  }

  private getBrokerOrderStatus(
    requestedQuantity: number,
    executedQuantity: number,
    brokerOrder: BrokerOrderStatus,
  ): OrderStatus {
    if (brokerOrder.rejected) return OrderStatus.FAILED;
    if (executedQuantity <= 0) return OrderStatus.PENDING;
    if (executedQuantity >= requestedQuantity || brokerOrder.remainingQuantity <= 0) {
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
    const executionLog = await this.prisma.watchStockExecutionLog.findFirst({
      where: {
        tradeRecordId,
        eventType: WatchStockExecutionEventType.ORDER_SUBMITTED,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!executionLog) return undefined;

    const details = (executionLog.details as Record<string, any> | null) || {};
    if (!details.side || !details.quantity) return undefined;

    return {
      market: executionLog.market as 'DOMESTIC' | 'OVERSEAS',
      exchangeCode: executionLog.exchangeCode,
      stockCode: executionLog.stockCode,
      side: details.side as 'BUY' | 'SELL',
      quantity: Number(details.quantity),
      price: details.price !== undefined ? Number(details.price) : undefined,
      orderDivision: details.orderDivision as string | undefined,
      reason: details.reason || executionLog.message,
      metadata: details.metadata as Record<string, any> | undefined,
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
    if (!signal) return;

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

    await this.slackService.sendTradeAlert({
      signal: {
        ...signal,
        quantity: filledNowQty,
        price: executedPrice,
      },
      result: {
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
    });
  }
}
