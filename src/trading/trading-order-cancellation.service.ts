import { Injectable, Logger } from '@nestjs/common';
import {
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  TradeRecord,
} from '@prisma/client';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
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
    private readonly kisDomestic: KisDomesticService,
    private readonly kisOverseas: KisOverseasService,
    private readonly liveSwitch: TradingLiveSwitchService,
    private readonly brokerContext: TradingBrokerContextService,
    private readonly recoveryService: TradingBrokerOrderRecoveryService,
  ) {}

  async cancelUnfilledOrder(
    market: 'DOMESTIC' | 'OVERSEAS',
    order: UnfilledOrder,
  ): Promise<boolean> {
    if (!this.liveSwitch.isEnabled()) return false;

    const normalizedOrder = this.normalizeUnfilledOrder(market, order);
    if (!normalizedOrder) return false;

    const context = this.brokerContext.getCurrentContext();
    const exchangeCode = normalizedOrder.exchangeCode as string;
    const record = await this.prisma.tradeRecord.findFirst({
      where: {
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

    const claimed = await this.recoveryService.claimCancellation(record.id);
    if (!claimed) return false;

    const claimedRecord = await this.prisma.tradeRecord.findUnique({
      where: { id: record.id },
    });
    if (!this.isSameClaimedCancellationTarget(record, claimedRecord)) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        '취소 대상 주문 정보 변경',
      );
      return false;
    }

    if (!this.liveSwitch.isEnabled()) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        '실거래 비활성화로 자동 주문 취소 중단',
      );
      return false;
    }
    let matchesCurrentContext: boolean;
    try {
      matchesCurrentContext = this.brokerContext.matchesCurrentContext(
        claimedRecord.brokerEnvironment,
        claimedRecord.brokerAccountHash,
      );
    } catch (error) {
      this.logger.warn(
        `[${claimedRecord.stockCode}] Broker context recheck failed: ${this.errorMessage(error)}`,
      );
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        '브로커 컨텍스트 확인 실패로 자동 주문 취소 중단',
      );
      return false;
    }
    if (!matchesCurrentContext) {
      await this.recoveryService.releaseCancellationClaim(
        record.id,
        '브로커 컨텍스트 변경으로 자동 주문 취소 중단',
      );
      return false;
    }

    let result: OrderResult;
    try {
      result = await this.submit(market, normalizedOrder);
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`[${normalizedOrder.stockCode}] Cancellation outcome is unknown: ${message}`);
      await this.recoveryService.markCancellationUnknown(record.id, message);
      return false;
    }
    if (result.outcome === 'REJECTED') {
      await this.recoveryService.markCancellationRejected(record.id, result.message);
      return false;
    }
    if (result.outcome !== 'ACCEPTED') {
      await this.recoveryService.markCancellationUnknown(record.id, result.message);
      return false;
    }

    await this.recoveryService.markCancellationAccepted(record.id, result.message);
    return true;
  }

  private hasCompleteCancellationIdentity(
    record: TradeRecord,
    order: UnfilledOrder,
    context: BrokerContext,
  ): boolean {
    return record.orderNo?.trim() === order.orderNo
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

  private submit(
    market: 'DOMESTIC' | 'OVERSEAS',
    order: UnfilledOrder,
  ): Promise<OrderResult> {
    return market === 'DOMESTIC'
      ? this.kisDomestic.cancelOrder(order.orderNo, order.stockCode, order.quantity)
      : this.kisOverseas.cancelOrder(
        order.exchangeCode || '',
        order.orderNo,
        order.stockCode,
        order.quantity,
        order.price,
      );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
