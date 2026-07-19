import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Market } from '@prisma/client';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { BrokerOrderStatus, UnfilledOrder } from '../kis/types/kis-api.types';
import { PrismaService } from '../prisma.service';
import { OrderSyncOptions, OrderSyncWindow, PositionQuantitySnapshot } from './types';
import { TradingOrderReconciliationService } from './trading-order-reconciliation.service';
import { TradingAccountCashSyncService } from './trading-account-cash-sync.service';

@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);
  private readonly isPaper: boolean;
  private readonly lastSyncedAt = new Map<'DOMESTIC' | 'OVERSEAS', Date>();

  constructor(
    private orderReconciliationService: TradingOrderReconciliationService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
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
    const window = await this.getOpenOrderWindow(market);
    if (!window) return;
    if (!this.shouldSyncNow(market, window, options)) return;

    const brokerOrders = await this.getBrokerOrders(market, window.startDate, window.endDate);
    const unfilledOrders = await this.mapUnfilledOrders(market, brokerOrders);

    const result = await this.orderReconciliationService.reconcileOpenOrders(
      market,
      currentPositions,
      unfilledOrders,
      brokerOrders,
    );
    if (result.hasNewFill) {
      try {
        await this.accountCashSync.refreshMarketCash(market);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Cash refresh after ${market} fill failed: ${reason}`);
      }
    }
    this.lastSyncedAt.set(market, new Date());
  }

  async getMarketUnfilledOrders(market: 'DOMESTIC' | 'OVERSEAS'): Promise<UnfilledOrder[]> {
    const window = await this.getOpenOrderWindow(market);
    if (!window) return [];

    const brokerOrders = await this.getBrokerOrders(market, window.startDate, window.endDate);
    return this.mapUnfilledOrders(market, brokerOrders);
  }

  private async getBrokerOrders(
    market: 'DOMESTIC' | 'OVERSEAS',
    startDate: string,
    endDate: string,
  ): Promise<BrokerOrderStatus[]> {
    if (market === 'DOMESTIC') {
      return this.kisDomestic.getOrderExecutions(startDate, endDate);
    }
    return this.kisOverseas.getOrderExecutions(startDate, endDate);
  }

  private async mapUnfilledOrders(
    market: 'DOMESTIC' | 'OVERSEAS',
    brokerOrders: BrokerOrderStatus[],
  ): Promise<UnfilledOrder[]> {
    if (market === 'DOMESTIC') {
      return this.kisDomestic.getUnfilledOrders();
    }

    if (this.isPaper) {
      this.logger.debug('Using overseas order execution inquiry as paper-mode unfilled fallback');
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

    return this.kisOverseas.getUnfilledOrders();
  }

  private async getOpenOrderWindow(
    market: 'DOMESTIC' | 'OVERSEAS',
  ): Promise<OrderSyncWindow | null> {
    const openRecords = await this.prisma.tradeRecord.findMany({
      where: {
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
    market: 'DOMESTIC' | 'OVERSEAS',
    window: OrderSyncWindow,
    options: OrderSyncOptions,
  ): boolean {
    if (options.force) return true;

    const lastSyncedAt = this.lastSyncedAt.get(market);
    if (!lastSyncedAt) return true;

    const now = Date.now();
    const ageMs = Math.max(0, now - window.newestCreatedAt.getTime());
    const intervalMs = this.getSyncIntervalMs(market, ageMs, window.openOrderCount);
    return now - lastSyncedAt.getTime() >= intervalMs;
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
