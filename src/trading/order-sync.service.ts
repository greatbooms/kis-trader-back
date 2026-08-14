import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Broker, Market } from '@prisma/client';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import type { BrokerPort } from '../common/types';
import { BrokerOrderStatus, UnfilledOrder } from '../kis/types/kis-api.types';
import { PrismaService } from '../prisma.service';
import {
  BrokerScopedUnfilledOrder,
  OrderSyncOptions,
  OrderSyncWindow,
  PositionQuantitySnapshot,
} from './types';
import { TradingOrderReconciliationService } from './trading-order-reconciliation.service';
import { TradingAccountCashSyncService } from './trading-account-cash-sync.service';

@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);
  private readonly isPaper: boolean;
  private readonly lastSyncedAt = new Map<string, Date>();

  constructor(
    private orderReconciliationService: TradingOrderReconciliationService,
    private readonly registry: BrokerPortRegistry,
    private prisma: PrismaService,
    private configService: ConfigService,
    private readonly accountCashSync: TradingAccountCashSyncService,
  ) {
    this.isPaper = this.configService.get<string>('kis.env') === 'paper';
  }

  async syncMarketOrders(
    market: 'DOMESTIC' | 'OVERSEAS',
    currentPositions: PositionQuantitySnapshot[],
    options: OrderSyncOptions = {},
  ): Promise<void> {
    const ports = this.registry.getActive().filter(
      (port) => !options.broker || port.broker === options.broker,
    );
    const propagateFailure = Boolean(options.broker) || ports.length === 1;
    const errors: unknown[] = [];
    for (const port of ports) {
      try {
        await this.syncBrokerMarketOrders(port, market, currentPositions, options);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[${port.broker} ${market}] Order sync failed: ${reason}`);
        if (propagateFailure) throw error;
        errors.push(error);
      }
    }
    if (options.failOnAnyError && errors.length > 0) throw errors[0];
  }

  private async syncBrokerMarketOrders(
    port: BrokerPort,
    market: 'DOMESTIC' | 'OVERSEAS',
    currentPositions: PositionQuantitySnapshot[],
    options: OrderSyncOptions,
  ): Promise<void> {
    const window = await this.getOpenOrderWindow(port.broker, market);
    if (!window) return;
    if (!this.shouldSyncNow(port.broker, market, window, options)) return;

    const brokerOrders = await port.getOrderExecutions(market as Market, window.startDate, window.endDate);
    const unfilledOrders = await this.mapUnfilledOrders(port, market, brokerOrders);

    const result = await this.orderReconciliationService.reconcileOpenOrders(
      port.broker,
      market,
      currentPositions.filter((position) => position.broker === port.broker),
      unfilledOrders,
      brokerOrders,
    );
    if (result.hasNewFill) {
      try {
        await this.accountCashSync.refreshMarketCash(port.broker, market);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[${port.broker} ${market}] Cash refresh after fill failed: ${reason}`);
      }
    }
    this.lastSyncedAt.set(this.syncKey(port.broker, market), new Date());
  }

  async getMarketUnfilledOrders(
    market: 'DOMESTIC' | 'OVERSEAS',
    broker?: Broker,
  ): Promise<BrokerScopedUnfilledOrder[]> {
    const scopedOrders: BrokerScopedUnfilledOrder[] = [];
    const ports = this.registry.getActive().filter(
      (port) => !broker || port.broker === broker,
    );
    const propagateFailure = Boolean(broker) || ports.length === 1;
    for (const port of ports) {
      try {
        const window = await this.getOpenOrderWindow(port.broker, market);
        if (!window) continue;
        const brokerOrders = await port.getOrderExecutions(
          market as Market,
          window.startDate,
          window.endDate,
        );
        const unfilledOrders = await this.mapUnfilledOrders(port, market, brokerOrders);
        scopedOrders.push(...unfilledOrders.map((order) => ({ ...order, broker: port.broker })));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[${port.broker} ${market}] Unfilled order sync failed: ${reason}`);
        if (propagateFailure) throw error;
      }
    }
    return scopedOrders;
  }

  private async mapUnfilledOrders(
    port: BrokerPort,
    market: 'DOMESTIC' | 'OVERSEAS',
    brokerOrders: BrokerOrderStatus[],
  ): Promise<UnfilledOrder[]> {
    if (market === 'DOMESTIC') {
      return port.getUnfilledOrders(Market.DOMESTIC);
    }

    if (port.broker === Broker.KIS && this.isPaper) {
      this.logger.debug('[KIS OVERSEAS] Using order execution inquiry as paper-mode unfilled fallback');
      return brokerOrders
        .filter((order) => order.remainingQuantity > 0)
        .map((order) => ({
          orderNo: order.orderNo,
          stockCode: order.stockCode,
          side: order.side,
          quantity: order.remainingQuantity,
          price: order.orderPrice || 0,
          exchangeCode: order.exchangeCode,
        }));
    }

    return port.getUnfilledOrders(Market.OVERSEAS);
  }

  private async getOpenOrderWindow(
    broker: Broker,
    market: 'DOMESTIC' | 'OVERSEAS',
  ): Promise<OrderSyncWindow | null> {
    const openRecords = await this.prisma.tradeRecord.findMany({
      where: {
        broker,
        market: market as Market,
        status: { in: ['PENDING', 'PARTIAL'] },
        orderNo: { not: null },
      },
      select: {
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (openRecords.length === 0) return null;

    const oldestCreatedAt = openRecords[0].createdAt;
    const newestCreatedAt = openRecords[openRecords.length - 1].createdAt;
    return {
      startDate: this.formatKisDate(this.addDays(oldestCreatedAt, -1)),
      endDate: this.formatKisDate(new Date()),
      openOrderCount: openRecords.length,
      newestCreatedAt,
    };
  }

  private shouldSyncNow(
    broker: Broker,
    market: 'DOMESTIC' | 'OVERSEAS',
    window: OrderSyncWindow,
    options: OrderSyncOptions,
  ): boolean {
    if (options.force) return true;

    const lastSyncedAt = this.lastSyncedAt.get(this.syncKey(broker, market));
    if (!lastSyncedAt) return true;

    const now = Date.now();
    const ageMs = Math.max(0, now - window.newestCreatedAt.getTime());
    const intervalMs = this.getSyncIntervalMs(market, ageMs, window.openOrderCount);
    return now - lastSyncedAt.getTime() >= intervalMs;
  }

  private syncKey(broker: Broker, market: 'DOMESTIC' | 'OVERSEAS'): string {
    return `${broker}:${market}`;
  }

  private getSyncIntervalMs(
    market: 'DOMESTIC' | 'OVERSEAS',
    newestOrderAgeMs: number,
    openOrderCount: number,
  ): number {
    const minute = 60_000;

    if (market === 'DOMESTIC') {
      if (openOrderCount >= 3 || newestOrderAgeMs <= 2 * minute) return 10_000;
      if (newestOrderAgeMs <= 15 * minute) return 30_000;
      return 60_000;
    }

    if (openOrderCount >= 3 || newestOrderAgeMs <= 5 * minute) return 15_000;
    if (newestOrderAgeMs <= 20 * minute) return 45_000;
    return 90_000;
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private formatKisDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}
