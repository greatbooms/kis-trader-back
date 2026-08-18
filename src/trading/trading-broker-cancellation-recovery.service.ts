import { Injectable, Logger } from '@nestjs/common';
import {
  BrokerOrderAction,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  TradeRecord,
} from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { BrokerOrderStatus, UnfilledOrder } from '../kis/types/kis-api.types';
import { PrismaService } from '../prisma.service';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { BrokerActionContext } from './types/broker-action-context.type';
import { BrokerCancellationRead } from './types/broker-cancellation-read.type';

@Injectable()
export class TradingBrokerCancellationRecoveryService {
  private readonly logger = new Logger(
    TradingBrokerCancellationRecoveryService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly brokerContextService: TradingBrokerContextService,
    private readonly registry: BrokerPortRegistry,
  ) {}

  async inspectCancellation(
    tradeRecordId: string,
    context: BrokerActionContext,
  ): Promise<TradeRecord> {
    const id = this.requireTradeRecordId(tradeRecordId);
    const actor = this.requireActor(id, context.actor);
    const record = await this.loadUnknownCancellation(id);
    this.assertStoredIdentity(record);
    this.assertCurrentContext(record, `does not match current ${record.broker} context`);

    const brokerRead = await this.readCompleteBrokerState(record);
    this.assertCurrentContext(record, 'changed during cancellation inspection');

    const executionRows = this.matchingExecutions(record, brokerRead.executions);
    const openOrder = this.findOpenOrder(record, brokerRead.unfilledOrders);
    if (openOrder) {
      if (executionRows.length > 0) {
        this.aggregateExecutions(record, executionRows);
      }
      return record;
    }

    if (executionRows.length === 0) {
      throw new Error(
        `[RECOVERY ${id}] Complete ${record.broker} reads cannot prove whether the broker order is open or closed`,
      );
    }

    const execution = this.aggregateExecutions(record, executionRows);
    const previousExecutedQty = record.executedQty ?? 0;
    const executedQty = Math.min(record.quantity, execution.filledQuantity);
    if (executedQty < previousExecutedQty) {
      throw new Error(
        `[RECOVERY ${id}] Broker execution quantities are ambiguous or regressed`,
      );
    }
    const nextStatus = executedQty >= record.quantity
      ? OrderStatus.FILLED
      : executedQty > 0
        ? OrderStatus.PARTIAL
        : OrderStatus.CANCELLED;
    const cancellationMessage = this.sanitizeMessage(
      `Cancellation closure confirmed from complete ${record.broker} reads`,
    );
    const resolvedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.tradeRecord.updateMany({
        where: this.cancellationCasWhere(record),
        data: {
          status: nextStatus,
          ...(nextStatus === OrderStatus.PARTIAL ? { orderNo: null } : {}),
          executedQty,
          executedPrice: execution.filledPrice
            ?? record.executedPrice
            ?? record.price,
          cancellationStatus: CancellationAttemptStatus.RESOLVED,
          cancellationResolvedAt: resolvedAt,
          cancellationResolvedBy: actor,
          cancellationMessage,
        },
      });
      if (changed.count !== 1) {
        throw new Error(
          `[RECOVERY ${id}] Cancellation state changed before reconciliation`,
        );
      }

      await tx.brokerOrderActionAuditLog.create({
        data: {
          tradeRecordId: id,
          channel: context.channel,
          action: BrokerOrderAction.CANCELLATION_RECONCILED,
          actor,
          brokerOrderDate: record.brokerOrderDate,
          exchangeCode: this.normalizeExchange(record.market, record.exchangeCode),
          orderNo: record.orderNo,
          beforeStatus: record.status,
          afterStatus: nextStatus,
          details: {
            orderQuantity: record.quantity,
            filledQuantity: executedQty,
            remainingQuantity: execution.remainingQuantity,
            cancellationMessage,
          },
        },
      });

      const updated = await tx.tradeRecord.findUnique({ where: { id } });
      if (!updated) {
        throw new Error(`[RECOVERY ${id}] Reconciled TradeRecord disappeared`);
      }
      return updated;
    });
  }

  async confirmCancellationNotAccepted(
    tradeRecordId: string,
    context: BrokerActionContext,
  ): Promise<TradeRecord> {
    const id = this.requireTradeRecordId(tradeRecordId);
    const actor = this.requireActor(id, context.actor);
    const record = await this.loadUnknownCancellation(id);
    this.assertStoredIdentity(record);
    this.assertCurrentContext(record, `does not match current ${record.broker} context`);

    const brokerRead = await this.readCompleteBrokerState(record);
    this.assertCurrentContext(record, 'changed during cancellation confirmation');

    const executionRows = this.matchingExecutions(record, brokerRead.executions);
    if (executionRows.length > 0) {
      this.aggregateExecutions(record, executionRows);
    }
    if (!this.findOpenOrder(record, brokerRead.unfilledOrders)) {
      throw new Error(
        `[RECOVERY ${id}] Broker order is not currently open; cancellation cannot be marked not accepted`,
      );
    }

    const cancellationMessage = this.sanitizeMessage(
      `Operator confirmed cancellation was not accepted after complete ${record.broker} reads`,
    );
    const resolvedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.tradeRecord.updateMany({
        where: this.cancellationCasWhere(record),
        data: {
          cancellationStatus: CancellationAttemptStatus.REJECTED,
          cancellationResolvedAt: resolvedAt,
          cancellationResolvedBy: actor,
          cancellationMessage,
        },
      });
      if (changed.count !== 1) {
        throw new Error(
          `[RECOVERY ${id}] Cancellation state changed before confirmation`,
        );
      }

      await tx.brokerOrderActionAuditLog.create({
        data: {
          tradeRecordId: id,
          channel: context.channel,
          action: BrokerOrderAction.CANCELLATION_NOT_ACCEPTED,
          actor,
          brokerOrderDate: record.brokerOrderDate,
          exchangeCode: this.normalizeExchange(record.market, record.exchangeCode),
          orderNo: record.orderNo,
          beforeStatus: record.status,
          afterStatus: record.status,
          details: { cancellationMessage },
        },
      });

      const updated = await tx.tradeRecord.findUnique({ where: { id } });
      if (!updated) {
        throw new Error(`[RECOVERY ${id}] Confirmed TradeRecord disappeared`);
      }
      return updated;
    });
  }

  private async loadUnknownCancellation(tradeRecordId: string): Promise<TradeRecord> {
    const record = await this.prisma.tradeRecord.findFirst({
      where: {
        id: tradeRecordId,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
        orderNo: { not: null },
        cancellationStatus: CancellationAttemptStatus.UNKNOWN,
      },
    });
    if (!record) {
      throw new Error(
        `[RECOVERY ${tradeRecordId}] Trade record is not an unresolved cancellation`,
      );
    }
    return record;
  }

  private async readCompleteBrokerState(record: TradeRecord): Promise<BrokerCancellationRead> {
    const orderDate = record.brokerOrderDate as string;
    try {
      const port = this.registry.get(record.broker);
      const executions = await port.getOrderExecutions(record.market, orderDate, orderDate);
      const unfilledOrders = await port.getUnfilledOrders(record.market);
      return { executions, unfilledOrders };
    } catch (error) {
      this.logger.warn(
        `[${record.broker} ${record.stockCode}] Complete cancellation-state read failed (${record.id}): ${this.errorMessage(error)}`,
      );
      throw error;
    }
  }

  private matchingExecutions(
    record: TradeRecord,
    executions: BrokerOrderStatus[],
  ): BrokerOrderStatus[] {
    return executions.filter((execution) => (
      execution.orderDate?.trim() === record.brokerOrderDate
      && this.matchesOrderTuple(record, execution)
      && execution.orderQuantity === record.quantity
    ));
  }

  private findOpenOrder(
    record: TradeRecord,
    unfilledOrders: UnfilledOrder[],
  ): UnfilledOrder | undefined {
    return unfilledOrders.find((order) => (
      this.matchesOrderTuple(record, order)
      && Number.isInteger(order.quantity)
      && order.quantity > 0
      && order.quantity <= record.quantity
    ));
  }

  private aggregateExecutions(
    record: TradeRecord,
    executions: BrokerOrderStatus[],
  ): BrokerOrderStatus {
    for (const execution of executions) {
      if (
        execution.rejectionState !== 'NOT_REJECTED'
        || execution.rejected === true
        || !Number.isInteger(execution.filledQuantity)
        || !Number.isInteger(execution.remainingQuantity)
        || execution.filledQuantity < 0
        || execution.remainingQuantity < 0
        || execution.filledQuantity > record.quantity
        || execution.remainingQuantity > record.quantity
        || execution.filledQuantity + execution.remainingQuantity > record.quantity
      ) {
        throw new Error(
          `[RECOVERY ${record.id}] Broker execution is ambiguous or rejected`,
        );
      }
    }

    return executions.reduce((aggregate, execution) => ({
      ...aggregate,
      filledQuantity: Math.max(aggregate.filledQuantity, execution.filledQuantity),
      remainingQuantity: Math.min(
        aggregate.remainingQuantity,
        execution.remainingQuantity,
      ),
      filledPrice: execution.filledPrice ?? aggregate.filledPrice,
      orderTime: execution.orderTime ?? aggregate.orderTime,
    }));
  }

  private matchesOrderTuple(
    record: TradeRecord,
    order: Pick<BrokerOrderStatus | UnfilledOrder, 'orderNo' | 'exchangeCode' | 'stockCode' | 'side'>,
  ): boolean {
    return order.orderNo.trim() === record.orderNo?.trim()
      && this.normalizeExchange(record.market, order.exchangeCode)
        === this.normalizeExchange(record.market, record.exchangeCode)
      && order.stockCode.trim().toUpperCase() === record.stockCode.trim().toUpperCase()
      && order.side === record.side;
  }

  private cancellationCasWhere(record: TradeRecord) {
    return {
      id: record.id,
      broker: record.broker,
      status: record.status,
      orderNo: record.orderNo,
      cancellationStatus: CancellationAttemptStatus.UNKNOWN,
      brokerEnvironment: record.brokerEnvironment,
      brokerAccountHash: record.brokerAccountHash,
      brokerOrderDate: record.brokerOrderDate,
    };
  }

  private assertStoredIdentity(record: TradeRecord): void {
    if (
      !record.orderNo?.trim()
      || !record.brokerEnvironment
      || !record.brokerAccountHash?.trim()
      || !this.isValidBrokerDate(record.brokerOrderDate)
    ) {
      throw new Error(
        `[RECOVERY ${record.id}] A valid broker order date is required with complete broker context`,
      );
    }
  }

  private assertCurrentContext(record: TradeRecord, reason: string): void {
    const current = this.brokerContextService.getCurrentContext(record.broker);
    if (
      current.broker !== record.broker
      || current.environment !== record.brokerEnvironment
      || current.accountHash !== record.brokerAccountHash
    ) {
      throw new Error(`[RECOVERY ${record.id}] Stored broker context ${reason}`);
    }
  }

  private normalizeExchange(market: Market, exchangeCode?: string | null): string {
    return market === Market.DOMESTIC
      ? 'KRX'
      : exchangeCode?.trim().toUpperCase() ?? '';
  }

  private isValidBrokerDate(value?: string | null): value is string {
    if (!value || !/^\d{8}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.toISOString().slice(0, 10).replace(/-/g, '') === value;
  }

  private requireTradeRecordId(value: string): string {
    const normalized = value?.trim();
    if (!normalized) throw new Error('[RECOVERY] TradeRecord ID is required');
    return normalized;
  }

  private requireActor(tradeRecordId: string, actor: string): string {
    const normalized = actor?.trim();
    if (!normalized) {
      throw new Error(`[RECOVERY ${tradeRecordId}] Recovery actor is required`);
    }
    return normalized;
  }

  private sanitizeMessage(message: string): string {
    const normalized = typeof message === 'string' ? message.trim() : '';
    return (normalized || 'Cancellation recovery outcome').slice(0, 500);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
