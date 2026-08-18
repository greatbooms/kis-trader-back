import { Injectable, Logger } from '@nestjs/common';
import {
  Broker,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  TradeRecord,
} from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { UnfilledOrder } from '../kis/types/kis-api.types';
import { OVERSEAS_ORDER_TR_IDS } from '../kis/types/kis-config.types';
import { OrderResult } from '../kis/types';
import { PrismaService } from '../prisma.service';
import { TradingBrokerContextService } from './trading-broker-context.service';
import { TradingBrokerOrderRecoveryService } from './trading-broker-order-recovery.service';
import { TradingLiveSwitchService } from './trading-live-switch.service';
import { BrokerContext } from './types/broker-context.type';

@Injectable()
export class TradingOrderCancellationService {
  private readonly logger = new Logger(TradingOrderCancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: BrokerPortRegistry,
    private readonly liveSwitch: TradingLiveSwitchService,
    private readonly brokerContext: TradingBrokerContextService,
    private readonly recoveryService: TradingBrokerOrderRecoveryService,
  ) {}

  async cancelUnfilledOrder(
    broker: Broker,
    market: 'DOMESTIC' | 'OVERSEAS',
    order: UnfilledOrder,
  ): Promise<boolean> {
    if (!this.liveSwitch.isEnabled()) return false;

    const normalizedOrder = this.normalizeUnfilledOrder(market, order);
    if (!normalizedOrder) return false;
    if (!this.registry.isActive(broker)) return false;

    const context = this.brokerContext.getCurrentContext(broker);
    const exchangeCode = normalizedOrder.exchangeCode as string;
    const record = await this.prisma.tradeRecord.findFirst({
      where: {
        broker,
        brokerEnvironment: context.environment,
        brokerAccountHash: context.accountHash,
        market: market as Market,
        exchangeCode,
        stockCode: normalizedOrder.stockCode,
        side: normalizedOrder.side,
        orderNo: normalizedOrder.orderNo,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
      },
    });
    if (!record) return false;
    if (!this.hasCompleteCancellationIdentity(
      record,
      normalizedOrder,
      context,
    )) return false;

    const executedQuantity = record.executedQty ?? 0;
    if (
      !Number.isInteger(record.quantity)
      || !Number.isInteger(executedQuantity)
      || executedQuantity < 0
      || normalizedOrder.quantity !== record.quantity - executedQuantity
    ) return false;

    const claimed = await this.recoveryService.claimCancellation(record.id, broker);
    if (!claimed) return false;

    const claimedRecord = await this.prisma.tradeRecord.findUnique({
      where: { id: record.id, broker },
    });
    if (!this.isSameClaimedCancellationTarget(record, claimedRecord)) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        broker,
        '취소 대상 주문 정보 변경',
      );
      return false;
    }

    if (!this.liveSwitch.isEnabled()) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        broker,
        '실거래 비활성화로 자동 주문 취소 중단',
      );
      return false;
    }
    let matchesCurrentContext: boolean;
    try {
      matchesCurrentContext = this.brokerContext.matchesCurrentContext(
        broker,
        claimedRecord.brokerEnvironment,
        claimedRecord.brokerAccountHash,
      );
    } catch (error) {
      this.logger.warn(
        `[${broker} ${claimedRecord.stockCode}] Broker context recheck failed: ${this.errorMessage(error)}`,
      );
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        broker,
        '브로커 컨텍스트 확인 실패로 자동 주문 취소 중단',
      );
      return false;
    }
    if (!matchesCurrentContext) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        broker,
        '브로커 컨텍스트 변경으로 자동 주문 취소 중단',
      );
      return false;
    }
    if (!this.registry.isActive(broker)) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        broker,
        '브로커 비활성화로 자동 주문 취소 중단',
      );
      return false;
    }

    let result: OrderResult;
    try {
      result = await this.registry.requireActive(broker).cancelOrder({
        market: claimedRecord.market,
        exchangeCode: normalizedOrder.exchangeCode || '',
        orderNo: normalizedOrder.orderNo,
        stockCode: normalizedOrder.stockCode,
        qty: normalizedOrder.quantity,
        price: normalizedOrder.price,
      });
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`[${broker} ${normalizedOrder.stockCode}] Cancellation outcome is unknown: ${message}`);
      await this.recoveryService.markCancellationUnknown(record.id, broker, message);
      return false;
    }
    if (result.outcome === 'REJECTED') {
      await this.recoveryService.markCancellationRejected(
        record.id,
        broker,
        result.message,
      );
      return false;
    }
    if (result.outcome !== 'ACCEPTED') {
      await this.recoveryService.markCancellationUnknown(
        record.id,
        broker,
        result.message,
      );
      return false;
    }

    await this.recoveryService.markCancellationAccepted(
      record.id,
      broker,
      result.message,
    );
    return true;
  }

  private hasCompleteCancellationIdentity(
    record: TradeRecord,
    order: UnfilledOrder,
    context: BrokerContext,
  ): boolean {
    return record.orderNo?.trim() === order.orderNo
      && record.broker === context.broker
      && this.isValidBrokerOrderDate(record.brokerOrderDate)
      && record.brokerEnvironment === context.environment
      && record.brokerAccountHash === context.accountHash;
  }

  private isValidBrokerOrderDate(value: string | null): value is string {
    if (!/^\d{8}$/.test(value ?? '')) return false;

    const date = value as string;
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(4, 6));
    const day = Number(date.slice(6, 8));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }

  private isSameClaimedCancellationTarget(
    initial: TradeRecord,
    claimed: TradeRecord | null,
  ): claimed is TradeRecord {
    return claimed !== null
      && claimed.broker === initial.broker
      && claimed.cancellationStatus === CancellationAttemptStatus.SUBMITTING
      && claimed.brokerEnvironment === initial.brokerEnvironment
      && claimed.brokerAccountHash === initial.brokerAccountHash
      && claimed.market === initial.market
      && claimed.exchangeCode === initial.exchangeCode
      && claimed.stockCode === initial.stockCode
      && claimed.side === initial.side
      && claimed.orderNo === initial.orderNo
      && claimed.brokerOrderDate === initial.brokerOrderDate
      && claimed.quantity === initial.quantity
      && claimed.executedQty === initial.executedQty
      && claimed.price.toString() === initial.price.toString()
      && claimed.status === initial.status;
  }

  private normalizeUnfilledOrder(
    market: 'DOMESTIC' | 'OVERSEAS',
    order: UnfilledOrder,
  ): UnfilledOrder | null {
    if (
      typeof order.orderNo !== 'string'
      || !order.orderNo.trim()
      || typeof order.stockCode !== 'string'
      || !order.stockCode.trim()
      || (order.side !== 'BUY' && order.side !== 'SELL')
      || !Number.isInteger(order.quantity)
      || order.quantity <= 0
    ) {
      return null;
    }

    const suppliedExchange = typeof order.exchangeCode === 'string'
      ? order.exchangeCode.trim().toUpperCase()
      : '';
    if (market === 'DOMESTIC' && suppliedExchange && suppliedExchange !== 'KRX') {
      return null;
    }
    if (
      market === 'OVERSEAS'
      && !Object.prototype.hasOwnProperty.call(
        OVERSEAS_ORDER_TR_IDS,
        suppliedExchange,
      )
    ) {
      return null;
    }

    return {
      ...order,
      orderNo: order.orderNo.trim(),
      stockCode: order.stockCode.trim().toUpperCase(),
      exchangeCode: market === 'DOMESTIC' ? 'KRX' : suppliedExchange,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
