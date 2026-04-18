import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Market, OrderStatus } from '@prisma/client';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import { HolidayItem, UnfilledOrder } from '../kis/types/kis-api.types';
import { MarketHours, getMarketHours } from '../kis/types/kis-config.types';
import { PositionQuantitySnapshot } from './types';
import { TradingPositionSyncService } from './trading-position-sync.service';
import { TradingOrderReconciliationService } from './trading-order-reconciliation.service';
import { OrderSyncService } from './order-sync.service';

/**
 * 장중 broker 상태 동기화 담당.
 * - 미체결 주문 동기화 (KIS 주문 체결내역 ↔ DB tradeRecord)
 * - 포트폴리오 상태 동기화 (KIS 잔고 ↔ DB position)
 * - 휴장일 캐시 및 시장 오픈 판단 헬퍼
 */
@Injectable()
export class MarketStateSyncService {
  private readonly logger = new Logger(MarketStateSyncService.name);
  private readonly isPaper: boolean;

  // 루프 중복 실행 방지용 mutex
  private isDomesticOrderSyncRunning = false;
  private isOverseasOrderSyncRunning = false;

  // 휴장일 캐시 (국내, 일 1회)
  private holidayCache: { date: string; domestic: HolidayItem[] } | null = null;

  constructor(
    private positionSyncService: TradingPositionSyncService,
    private orderReconciliationService: TradingOrderReconciliationService,
    private orderSyncService: OrderSyncService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.isPaper = this.configService.get<string>('kis.env') === 'paper';
  }

  // ========== Cron 엔트리 포인트 ==========

  async syncDomesticOpenOrders(orchestratorBusy: () => boolean = () => false): Promise<void> {
    if (!this.isMarketOpen('KRX')) return;
    if (orchestratorBusy() || this.isDomesticOrderSyncRunning) return;
    this.isDomesticOrderSyncRunning = true;

    try {
      if (await this.isHoliday('DOMESTIC')) return;
      if (!(await this.hasOpenOrders('DOMESTIC'))) return;
      await this.syncMarketOrdersOnly('DOMESTIC');
    } catch (e) {
      this.logger.error(`Domestic order sync error: ${e.message}`);
    } finally {
      this.isDomesticOrderSyncRunning = false;
    }
  }

  async syncOverseasOpenOrders(orchestratorBusy: () => boolean = () => false): Promise<void> {
    if (orchestratorBusy() || this.isOverseasOrderSyncRunning) return;
    this.isOverseasOrderSyncRunning = true;

    try {
      if (!(await this.hasOpenOrders('OVERSEAS'))) return;
      await this.syncMarketOrdersOnly('OVERSEAS');
    } catch (e) {
      this.logger.error(`Overseas order sync error: ${e.message}`);
    } finally {
      this.isOverseasOrderSyncRunning = false;
    }
  }

  async syncDomesticPortfolioState(orchestratorBusy: () => boolean = () => false): Promise<void> {
    if (!this.isMarketOpen('KRX')) return;
    if (orchestratorBusy() || this.isDomesticOrderSyncRunning) return;

    try {
      if (await this.isHoliday('DOMESTIC')) return;
      if (!(await this.hasPortfolioState('DOMESTIC'))) return;
      await this.syncMarketPortfolioOnly('DOMESTIC');
    } catch (e) {
      this.logger.error(`Domestic portfolio sync error: ${e.message}`);
    }
  }

  async syncOverseasPortfolioState(orchestratorBusy: () => boolean = () => false): Promise<void> {
    if (orchestratorBusy() || this.isOverseasOrderSyncRunning) return;

    try {
      if (!(await this.hasPortfolioState('OVERSEAS'))) return;
      await this.syncMarketPortfolioOnly('OVERSEAS');
    } catch (e) {
      this.logger.error(`Overseas portfolio sync error: ${e.message}`);
    }
  }

  // ========== 동기화 공용 로직 ==========

  async syncMarketOrdersOnly(market: 'DOMESTIC' | 'OVERSEAS'): Promise<void> {
    await this.syncMarketPortfolioOnly(market);

    const positions = await this.prisma.position.findMany({
      where: { market: market as Market },
    });

    await this.orderSyncService.syncMarketOrders(
      market,
      positions.map((position) => this.toPositionSnapshot(position)),
    );
  }

  async syncMarketPortfolioOnly(market: 'DOMESTIC' | 'OVERSEAS'): Promise<void> {
    const balance = market === 'DOMESTIC'
      ? await this.kisDomestic.getBalance()
      : await this.kisOverseas.getBalance();

    await this.positionSyncService.syncPositions(market, balance);
  }

  async hasPortfolioState(market: 'DOMESTIC' | 'OVERSEAS'): Promise<boolean> {
    const [activeWatchStocks, positions, openOrders] = await Promise.all([
      this.prisma.watchStock.count({
        where: {
          market: market as Market,
          isActive: true,
          NOT: { strategyName: null },
        },
      }),
      this.prisma.position.count({
        where: { market: market as Market },
      }),
      this.prisma.tradeRecord.count({
        where: {
          market: market as Market,
          status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
          orderNo: { not: null },
        },
      }),
    ]);

    return activeWatchStocks > 0 || positions > 0 || openOrders > 0;
  }

  async hasOpenOrders(market: 'DOMESTIC' | 'OVERSEAS'): Promise<boolean> {
    const openOrders = await this.prisma.tradeRecord.count({
      where: {
        market: market as Market,
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
        orderNo: { not: null },
      },
    });

    return openOrders > 0;
  }

  // ========== 미체결 주문 조회/취소 ==========

  async getUnfilledOrders(market: 'DOMESTIC' | 'OVERSEAS'): Promise<UnfilledOrder[]> {
    return this.orderSyncService.getMarketUnfilledOrders(market);
  }

  async cancelUnfilledOrders(
    marketType: 'DOMESTIC' | 'OVERSEAS',
    orders: UnfilledOrder[],
  ): Promise<void> {
    try {
      if (marketType === 'OVERSEAS') {
        let cancelledCount = 0;
        for (const order of orders) {
          this.logger.log(`Cancelling overseas unfilled order: ${order.stockCode} #${order.orderNo}`);
          const result = await this.kisOverseas.cancelOrder(
            order.exchangeCode ?? '',
            order.orderNo,
            order.stockCode,
            order.quantity,
            order.price,
          );
          if (result.success) {
            cancelledCount += 1;
            await this.orderReconciliationService.markOpenOrderCancelled(
              'OVERSEAS',
              order.orderNo,
              '장중 재실행 전 미체결 주문 취소',
            );
          } else {
            this.logger.warn(`Failed to cancel overseas unfilled order ${order.stockCode} #${order.orderNo}: ${result.message}`);
          }
        }
        if (cancelledCount > 0) {
          this.logger.log(`Cancelled ${cancelledCount} overseas unfilled orders`);
        }
      } else {
        let cancelledCount = 0;
        for (const order of orders) {
          this.logger.log(`Cancelling domestic unfilled order: ${order.stockCode} #${order.orderNo}`);
          const result = await this.kisDomestic.cancelOrder(order.orderNo, order.stockCode, order.quantity);
          if (result.success) {
            cancelledCount += 1;
            await this.orderReconciliationService.markOpenOrderCancelled(
              'DOMESTIC',
              order.orderNo,
              '장중 재실행 전 미체결 주문 취소',
            );
          } else {
            this.logger.warn(`Failed to cancel domestic unfilled order ${order.stockCode} #${order.orderNo}: ${result.message}`);
          }
        }
        if (cancelledCount > 0) {
          this.logger.log(`Cancelled ${cancelledCount} domestic unfilled orders`);
        }
      }
    } catch (e) {
      this.logger.error(`Failed to cancel unfilled orders (${marketType}): ${e.message}`);
    }
  }

  // ========== 휴장일 / 시장 오픈 판단 ==========

  async isHoliday(marketType: 'DOMESTIC' | 'OVERSEAS'): Promise<boolean> {
    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return true;

    if (this.isPaper) return false;

    if (marketType !== 'DOMESTIC') return false;

    const todayStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    await this.ensureHolidayCache(todayStr);

    if (!this.holidayCache) return false;

    const holiday = this.holidayCache.domestic.find((h) => h.date === todayStr);
    return holiday ? !holiday.isOpen : false;
  }

  async isExchangeHoliday(exchangeCode: string): Promise<boolean> {
    if (exchangeCode === 'KRX') {
      return this.isHoliday('DOMESTIC');
    }
    return false;
  }

  isMarketOpen(exchangeCode: string): boolean {
    const hours = getMarketHours(exchangeCode);
    if (!hours) return false;

    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const day = kst.getUTCDay();

    if (!hours.overnight && (day === 0 || day === 6)) return false;

    if (hours.overnight) {
      if (day === 0) return false;
      if (day === 6) {
        const currentMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
        const closeMin = hours.close.hour * 60 + hours.close.minute;
        return currentMin < closeMin;
      }
    }

    return this.isWithinHours(kst, hours);
  }

  // ========== 내부 헬퍼 ==========

  private async ensureHolidayCache(todayStr: string): Promise<void> {
    if (this.holidayCache?.date === todayStr) return;

    try {
      const domestic = await this.kisDomestic.getHolidays(todayStr);
      this.holidayCache = { date: todayStr, domestic };
    } catch (e) {
      this.logger.warn(`Failed to fetch holidays: ${e.message}`);
    }
  }

  private isWithinHours(kst: Date, hours: MarketHours): boolean {
    const currentMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    const openMin = hours.open.hour * 60 + hours.open.minute;
    const closeMin = hours.close.hour * 60 + hours.close.minute;

    if (hours.overnight) {
      return currentMin >= openMin || currentMin < closeMin;
    }

    return currentMin >= openMin && currentMin < closeMin;
  }

  private toPositionSnapshot(position: {
    market: Market;
    exchangeCode: string;
    stockCode: string;
    quantity: number;
  }): PositionQuantitySnapshot {
    return {
      market: position.market as 'DOMESTIC' | 'OVERSEAS',
      exchangeCode: position.exchangeCode,
      stockCode: position.stockCode,
      quantity: position.quantity,
    };
  }
}
