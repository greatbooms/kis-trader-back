import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Market, OrderStatus } from '@prisma/client';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import { HolidayItem, UnfilledOrder } from '../kis/types/kis-api.types';
import { EXCHANGE_CODE_MAP, MarketHours, getMarketHours } from '../kis/types/kis-config.types';
import { PositionQuantitySnapshot } from './types';
import { TradingPositionSyncService } from './trading-position-sync.service';
import { OrderSyncService } from './order-sync.service';
import { TradingOrderCancellationService } from './trading-order-cancellation.service';

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

  // 휴장일 캐시 (시장별, 일 1회)
  private domesticHolidayCache: { date: string; holidays: HolidayItem[] } | null = null;
  private overseasHolidayCache: { date: string; holidays: HolidayItem[] } | null = null;

  constructor(
    private positionSyncService: TradingPositionSyncService,
    private orderSyncService: OrderSyncService,
    private kisDomestic: KisDomesticService,
    private kisOverseas: KisOverseasService,
    private prisma: PrismaService,
    private configService: ConfigService,
    private readonly orderCancellationService: TradingOrderCancellationService,
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
          const accepted = await this.orderCancellationService.cancelUnfilledOrder(
            'OVERSEAS',
            order,
          );
          if (accepted) {
            cancelledCount += 1;
          }
        }
        if (cancelledCount > 0) {
          this.logger.log(`Cancelled ${cancelledCount} overseas unfilled orders`);
        }
      } else {
        let cancelledCount = 0;
        for (const order of orders) {
          this.logger.log(`Cancelling domestic unfilled order: ${order.stockCode} #${order.orderNo}`);
          const accepted = await this.orderCancellationService.cancelUnfilledOrder(
            'DOMESTIC',
            order,
          );
          if (accepted) {
            cancelledCount += 1;
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

  async isHoliday(marketType: 'DOMESTIC' | 'OVERSEAS', exchangeCode?: string): Promise<boolean> {
    const now = new Date();

    if (marketType === 'DOMESTIC') {
      if (this.isExchangeWeekend('KRX', now)) return true;
      if (this.isPaper) return false;

      const todayStr = this.getExchangeDateString('KRX', now);
      await this.ensureDomesticHolidayCache(todayStr);

      if (!this.domesticHolidayCache) return false;

      const holiday = this.domesticHolidayCache.holidays.find((h) => h.date === todayStr);
      return holiday ? !holiday.isOpen : false;
    }

    if (!exchangeCode) return false;
    if (this.isExchangeWeekend(exchangeCode, now)) return true;
    if (this.isPaper) return false;

    const tradeDate = this.getExchangeDateString(exchangeCode, now);
    await this.ensureOverseasHolidayCache(tradeDate);

    if (!this.overseasHolidayCache) return false;

    const holiday = this.overseasHolidayCache.holidays.find((h) =>
      h.date === tradeDate && this.matchesExchangeHoliday(h, exchangeCode),
    );
    return holiday ? !holiday.isOpen : false;
  }

  async isExchangeHoliday(exchangeCode: string): Promise<boolean> {
    if (exchangeCode === 'KRX') {
      return this.isHoliday('DOMESTIC', exchangeCode);
    }
    return this.isHoliday('OVERSEAS', exchangeCode);
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

  private async ensureDomesticHolidayCache(todayStr: string): Promise<void> {
    if (this.domesticHolidayCache?.date === todayStr) return;

    try {
      const holidays = await this.kisDomestic.getHolidays(todayStr);
      this.domesticHolidayCache = { date: todayStr, holidays };
    } catch (e) {
      this.logger.warn(`Failed to fetch domestic holidays: ${e.message}`);
    }
  }

  private async ensureOverseasHolidayCache(tradeDate: string): Promise<void> {
    if (this.overseasHolidayCache?.date === tradeDate) return;

    try {
      const holidays = await this.kisOverseas.getOverseasHolidays(tradeDate);
      this.overseasHolidayCache = { date: tradeDate, holidays };
    } catch (e) {
      this.logger.warn(`Failed to fetch overseas holidays: ${e.message}`);
    }
  }

  private getExchangeDateString(exchangeCode: string, date: Date): string {
    const timeZone = this.getExchangeTimeZone(exchangeCode);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return `${year}${month}${day}`;
  }

  private getExchangeTimeZone(exchangeCode: string): string {
    switch (exchangeCode) {
      case 'NASD':
      case 'NYSE':
      case 'AMEX':
        return 'America/New_York';
      case 'SEHK':
        return 'Asia/Hong_Kong';
      case 'SHAA':
      case 'SZAA':
        return 'Asia/Shanghai';
      case 'TKSE':
        return 'Asia/Tokyo';
      case 'HASE':
      case 'VNSE':
        return 'Asia/Ho_Chi_Minh';
      case 'KRX':
      default:
        return 'Asia/Seoul';
    }
  }

  private isExchangeWeekend(exchangeCode: string, date: Date): boolean {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: this.getExchangeTimeZone(exchangeCode),
      weekday: 'short',
    }).format(date);
    return weekday === 'Sat' || weekday === 'Sun';
  }

  private matchesExchangeHoliday(holiday: HolidayItem, exchangeCode: string): boolean {
    const holidayExchangeCode = this.normalizeExchangeCode(holiday.exchangeCode);
    if (holidayExchangeCode) {
      return holidayExchangeCode === exchangeCode;
    }

    const countryCodes = this.getExchangeCountryCodes(exchangeCode);
    const holidayCountryCode = holiday.countryCode?.toUpperCase();
    return !!holidayCountryCode && countryCodes.includes(holidayCountryCode);
  }

  private normalizeExchangeCode(exchangeCode?: string): string | undefined {
    const normalized = exchangeCode?.trim().toUpperCase();
    if (!normalized) return undefined;
    if (EXCHANGE_CODE_MAP[normalized]) return normalized;

    return Object.entries(EXCHANGE_CODE_MAP).find(([, kisCode]) => kisCode === normalized)?.[0] ?? normalized;
  }

  private getExchangeCountryCodes(exchangeCode: string): string[] {
    switch (exchangeCode) {
      case 'NASD':
      case 'NYSE':
      case 'AMEX':
        return ['US', 'USA'];
      case 'SEHK':
        return ['HK', 'HKG'];
      case 'SHAA':
      case 'SZAA':
        return ['CN', 'CHN'];
      case 'TKSE':
        return ['JP', 'JPN'];
      case 'HASE':
      case 'VNSE':
        return ['VN', 'VNM'];
      default:
        return [];
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
