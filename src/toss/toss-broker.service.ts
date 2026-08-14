import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Broker, BrokerEnvironment, Market } from '@prisma/client';
import type {
  BalanceItem,
  BrokerCancelRequest,
  BrokerOrderStatus,
  BrokerPort,
  DomesticBuyableAmount,
  OrderResult,
  OverseasAccountSnapshot,
  UnfilledOrder,
} from '../common/types';
import { BrokerMutationError } from '../common/broker-mutation.error';
import { hashBrokerAccount } from '../common/utils/broker-account-hash.util';
import type { TradingSignal } from '../trading/types';
import { TossBaseService } from './toss-base.service';
import { TossVenueResolverService } from './toss-venue-resolver.service';
import type {
  TossAccount,
  TossApiResponse,
  TossBrokerOrderStatus,
  TossBuyingPower,
  TossExchangeRate,
  TossHoldingItem,
  TossHoldingsOverview,
  TossMappedOrderStatus,
  TossOrder,
  TossOrderOperationResponse,
  TossOrderRequest,
  TossOrdersResult,
} from './types';

const MAX_ORDER_PAGES = 100;
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

@Injectable()
export class TossBrokerService implements BrokerPort {
  readonly broker = Broker.TOSS;
  private readonly logger = new Logger(TossBrokerService.name);

  constructor(
    private readonly base: TossBaseService,
    private readonly config: ConfigService,
    private readonly venueResolver: TossVenueResolverService,
  ) {}

  async submitOrder(signal: TradingSignal): Promise<OrderResult> {
    const body = this.orderBody(signal);
    const callStartedAt = new Date();
    try {
      const response = await this.base.request<TossApiResponse<TossOrderOperationResponse>>(
        'ORDER',
        {
          method: 'POST',
          path: '/api/v1/orders',
          body,
          accountScoped: true,
          mutation: true,
        },
      );
      const orderNo = this.optionalString(response.result?.orderId);
      if (!orderNo) return this.unknownResult('Toss mutation response missing orderId');

      const kstTimestamp = new Date(callStartedAt.getTime() + KST_OFFSET_MS).toISOString();

      this.logger.log(
        `[TOSS ${signal.stockCode}] ${signal.exchangeCode} ${signal.side} order accepted`,
      );
      return {
        outcome: 'ACCEPTED',
        success: true,
        orderNo,
        brokerOrderDate: kstTimestamp.slice(0, 10).replace(/-/g, ''),
        orderTime: kstTimestamp.slice(11, 19).replace(/:/g, ''),
        message: `Toss ${signal.side} order accepted`,
      };
    } catch (error) {
      return this.mutationFailure(error);
    }
  }

  async cancelOrder(request: BrokerCancelRequest): Promise<OrderResult> {
    const orderId = this.requiredString(request.orderNo, 'Toss orderId');
    try {
      const response = await this.base.request<TossApiResponse<TossOrderOperationResponse>>(
        'ORDER',
        {
          method: 'POST',
          path: `/api/v1/orders/${encodeURIComponent(orderId)}/cancel`,
          body: {},
          accountScoped: true,
          mutation: true,
        },
      );
      const cancelOrderId = this.optionalString(response.result?.orderId);
      if (!cancelOrderId) return this.unknownResult('Toss cancellation response missing orderId');

      this.logger.log(
        `[TOSS ${request.stockCode}] ${request.exchangeCode} cancellation accepted`,
      );
      return {
        outcome: 'ACCEPTED',
        success: true,
        orderNo: cancelOrderId,
        message: 'Toss cancellation accepted',
      };
    } catch (error) {
      return this.mutationFailure(error);
    }
  }

  async getUnfilledOrders(market: Market): Promise<UnfilledOrder[]> {
    const orders = await this.readOrders('OPEN');
    const unfilled = orders
      .filter((order) => this.matchesMarket(order.currency, market))
      .map((order) => this.mapOrder(order))
      .filter((order) => order.remainingQuantity > 0)
      .map((order) => ({
        orderNo: order.orderNo,
        stockCode: order.stockCode,
        side: order.side,
        quantity: order.remainingQuantity,
        price: order.orderPrice || 0,
        exchangeCode: order.exchangeCode,
      }));
    return this.enrichVenues(unfilled, market);
  }

  async getOrderExecutions(
    market: Market,
    startDate: string,
    endDate: string,
  ): Promise<BrokerOrderStatus[]> {
    const from = this.apiDate(startDate);
    const to = this.apiDate(endDate);
    const [open, closed] = await Promise.all([
      this.readOrders('OPEN', from, to),
      this.readOrders('CLOSED', from, to),
    ]);
    const byOrderId = new Map<string, TossBrokerOrderStatus>();
    for (const order of [...open, ...closed]) {
      if (!this.matchesMarket(order.currency, market)) continue;
      const mapped = this.mapOrder(order);
      byOrderId.set(mapped.orderNo, mapped);
    }
    return this.enrichVenues(Array.from(byOrderId.values()), market);
  }

  async getBalance(market: Market): Promise<BalanceItem[]> {
    const response = await this.base.request<TossApiResponse<TossHoldingsOverview>>('ASSET', {
      method: 'GET',
      path: '/api/v1/holdings',
      accountScoped: true,
    });
    return this.enrichVenues(this.mapHoldings(response.result, market), market);
  }

  async getDomesticBuyableAmount(): Promise<DomesticBuyableAmount> {
    const buyingPower = await this.getBuyingPower('KRW');
    return { cashAvailable: buyingPower };
  }

  async getOverseasBuyableAmount(
    _exchangeCode: string,
    _stockCode: string,
    _price: number,
  ): Promise<{ foreignCurrencyAvailable: number; maxQuantity: number }> {
    if (!Number.isFinite(_price) || _price <= 0) {
      throw new Error('Invalid Toss overseas buyable-amount price');
    }
    const buyingPower = await this.getBuyingPower('USD');
    return {
      foreignCurrencyAvailable: buyingPower,
      maxQuantity: Math.floor(buyingPower / _price),
    };
  }

  async getOverseasAccountSnapshot(_nationCode?: string): Promise<OverseasAccountSnapshot> {
    const accounts = await this.base.request<TossApiResponse<TossAccount[]>>('ACCOUNT', {
      method: 'GET',
      path: '/api/v1/accounts',
    });
    if (!Array.isArray(accounts.result) || accounts.result.length === 0) {
      throw new Error('Toss account snapshot returned no account');
    }

    const holdings = await this.base.request<TossApiResponse<TossHoldingsOverview>>('ASSET', {
      method: 'GET',
      path: '/api/v1/holdings',
      accountScoped: true,
    });
    const exchangeRate = await this.base.request<TossApiResponse<TossExchangeRate>>('MARKET_DATA', {
      method: 'GET',
      path: '/api/v1/exchange-rate',
      query: { baseCurrency: 'USD', quoteCurrency: 'KRW' },
    });
    this.number(exchangeRate.result?.rate, 'Toss exchange rate');

    return {
      balance: await this.enrichVenues(
        this.mapHoldings(holdings.result, Market.OVERSEAS),
        Market.OVERSEAS,
      ),
      cashBalances: [{ currencyCode: 'USD', currencyName: '', amount: 0 }],
    };
  }

  getBrokerContext() {
    const account = this.config.get<string>('toss.accountNo')?.trim();
    if (!account) throw new Error('Invalid Toss broker configuration');
    return {
      broker: Broker.TOSS,
      environment: BrokerEnvironment.PROD,
      accountHash: hashBrokerAccount(account),
    };
  }

  private orderBody(signal: TradingSignal): TossOrderRequest {
    const symbol = this.requiredString(signal.stockCode, 'Toss stock code');
    if (signal.market === 'DOMESTIC' ? !/^\d{6}$/.test(symbol) : !/^[A-Za-z0-9.-]+$/.test(symbol)) {
      throw new Error('Invalid Toss stock code');
    }
    if (!Number.isInteger(signal.quantity) || signal.quantity <= 0) {
      throw new Error('Invalid Toss order quantity');
    }

    const common = {
      symbol,
      side: signal.side,
      quantity: String(signal.quantity),
    };
    if (signal.orderDivision === '01') {
      return { ...common, orderType: 'MARKET' };
    }
    if (signal.orderDivision !== '00' && signal.orderDivision !== '34') {
      throw new Error(`Unsupported Toss order division: ${signal.orderDivision ?? 'missing'}`);
    }
    if (!Number.isFinite(signal.price) || (signal.price as number) <= 0) {
      throw new Error('Invalid Toss limit order price');
    }
    return {
      ...common,
      orderType: 'LIMIT',
      timeInForce: signal.orderDivision === '34' ? 'CLS' : 'DAY',
      price: String(signal.price),
    };
  }

  private async readOrders(
    status: 'OPEN' | 'CLOSED',
    from?: string,
    to?: string,
  ): Promise<TossOrder[]> {
    const orders: TossOrder[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_ORDER_PAGES; page++) {
      const response = await this.base.request<TossApiResponse<TossOrdersResult>>('ORDER_INFO', {
        method: 'GET',
        path: '/api/v1/orders',
        query: {
          status,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(cursor ? { cursor } : {}),
          ...(status === 'CLOSED' ? { limit: 100 } : {}),
        },
        accountScoped: true,
      });
      const result = response.result;
      if (!result || !Array.isArray(result.orders) || typeof result.hasNext !== 'boolean') {
        throw new Error('Malformed Toss order-list response');
      }
      orders.push(...result.orders);
      if (!result.hasNext) return orders;

      const nextCursor = this.optionalString(result.nextCursor);
      if (!nextCursor || seenCursors.has(nextCursor)) {
        throw new Error('Invalid Toss order-list continuation');
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error(`Toss order-list exceeded ${MAX_ORDER_PAGES} pages`);
  }

  private mapOrder(order: TossOrder): TossBrokerOrderStatus {
    const orderNo = this.requiredString(order.orderId, 'Toss orderId');
    const stockCode = this.requiredString(order.symbol, 'Toss order symbol');
    const orderQuantity = this.number(order.quantity, 'Toss order quantity');
    const filledQuantity = this.number(order.execution?.filledQuantity, 'Toss filled quantity');
    if (orderQuantity < 0 || filledQuantity < 0 || filledQuantity > orderQuantity) {
      throw new Error('Invalid Toss order quantities');
    }
    if (order.side !== 'BUY' && order.side !== 'SELL') {
      throw new Error('Invalid Toss order side');
    }

    const status = this.mapStatus(order.status, stockCode);
    const rejected = status === 'FAILED';
    const isOpen = status === 'PENDING' || status === 'PARTIAL';
    const timestamp = this.orderTimestamp(order.orderedAt);
    return {
      orderNo,
      stockCode,
      side: order.side,
      orderQuantity,
      filledQuantity,
      remainingQuantity: isOpen ? Math.max(0, orderQuantity - filledQuantity) : 0,
      orderPrice: order.price === null ? undefined : this.number(order.price, 'Toss order price'),
      filledPrice: order.execution.averageFilledPrice === null
        ? undefined
        : this.number(order.execution.averageFilledPrice, 'Toss filled price'),
      exchangeCode: this.exchangeCode(order.currency),
      orderDate: timestamp.orderDate,
      orderTime: timestamp.orderTime,
      status,
      rejectionState: rejected ? 'REJECTED' : 'NOT_REJECTED',
      rejected,
      ...(rejected ? { rejectedReason: 'Toss order rejected' } : {}),
    };
  }

  private mapStatus(status: string, stockCode: string): TossMappedOrderStatus {
    switch (status) {
      case 'FILLED': return 'FILLED';
      case 'PARTIAL_FILLED': return 'PARTIAL';
      case 'PENDING':
      case 'PENDING_CANCEL':
      case 'PENDING_REPLACE': return 'PENDING';
      case 'CANCELED': return 'CANCELLED';
      case 'REJECTED': return 'FAILED';
      case 'REPLACED':
        this.logger.warn(`[TOSS ${stockCode}] REPLACED order closed; replacement linkage unavailable`);
        return 'CANCELLED';
      default: throw new Error(`Unsupported Toss order status: ${status}`);
    }
  }

  private mapHoldings(result: TossHoldingsOverview, market: Market): BalanceItem[] {
    if (!result || !Array.isArray(result.items)) {
      throw new Error('Malformed Toss holdings response');
    }
    return result.items
      .filter((item) => this.matchesHoldingMarket(item, market))
      .map((item) => this.mapHolding(item));
  }

  private mapHolding(item: TossHoldingItem): BalanceItem {
    return {
      stockCode: this.requiredString(item.symbol, 'Toss holding symbol'),
      stockName: this.requiredString(item.name, 'Toss holding name'),
      quantity: this.number(item.quantity, 'Toss holding quantity'),
      avgPrice: this.number(item.averagePurchasePrice, 'Toss average purchase price'),
      currentPrice: this.number(item.lastPrice, 'Toss holding last price'),
      profitLoss: this.number(item.profitLoss?.amount, 'Toss holding profit/loss'),
      profitRate: Number((this.number(item.profitLoss?.rate, 'Toss holding profit rate') * 100).toFixed(10)),
      exchangeCode: item.marketCountry === 'KR' ? 'KRX' : 'US',
    };
  }

  private async getBuyingPower(currency: 'KRW' | 'USD'): Promise<number> {
    const response = await this.base.request<TossApiResponse<TossBuyingPower>>('ASSET', {
      method: 'GET',
      path: '/api/v1/buying-power',
      query: { currency },
      accountScoped: true,
    });
    if (response.result?.currency !== currency) {
      throw new Error('Unexpected Toss buying-power currency');
    }
    return this.number(response.result.cashBuyingPower, 'Toss cash buying power');
  }

  private async enrichVenues<T extends { stockCode: string; exchangeCode?: string }>(
    items: T[],
    market: Market,
  ): Promise<T[]> {
    if (market !== Market.OVERSEAS || items.length === 0) return items;
    const venues = await this.venueResolver.resolveVenues(items.map((item) => item.stockCode));
    return items.map((item) => ({
      ...item,
      exchangeCode: venues.get(item.stockCode.trim().toUpperCase()) ?? 'US',
    }));
  }

  private mutationFailure(error: unknown): OrderResult {
    const message = error instanceof Error ? error.message : 'Toss mutation failed';
    return error instanceof BrokerMutationError && error.kind === 'TRANSPORT_UNKNOWN'
      ? this.unknownResult(message)
      : { outcome: 'REJECTED', success: false, message };
  }

  private unknownResult(message: string): OrderResult {
    return { outcome: 'UNKNOWN', success: false, message };
  }

  private matchesMarket(currency: string, market: Market): boolean {
    return market === Market.DOMESTIC ? currency === 'KRW' : currency === 'USD';
  }

  private matchesHoldingMarket(item: TossHoldingItem, market: Market): boolean {
    return market === Market.DOMESTIC
      ? item.marketCountry === 'KR'
      : item.marketCountry === 'US';
  }

  private exchangeCode(currency: string): string {
    if (currency === 'KRW') return 'KRX';
    if (currency === 'USD') return 'US';
    throw new Error(`Unsupported Toss order currency: ${currency}`);
  }

  private apiDate(value: string): string {
    if (!/^\d{8}$/.test(value)) throw new Error('Invalid Toss order-history date');
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      throw new Error('Invalid Toss order-history date');
    }
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  private orderTimestamp(value: string): { orderDate: string; orderTime: string } {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
    if (!match) throw new Error('Invalid Toss order timestamp');
    return {
      orderDate: `${match[1]}${match[2]}${match[3]}`,
      orderTime: `${match[4]}${match[5]}${match[6]}`,
    };
  }

  private number(value: unknown, label: string): number {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}`);
    return parsed;
  }

  private requiredString(value: unknown, label: string): string {
    const normalized = this.optionalString(value);
    if (!normalized) throw new Error(`Invalid ${label}`);
    return normalized;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
