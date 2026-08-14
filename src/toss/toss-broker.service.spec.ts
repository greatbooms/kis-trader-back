import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Broker, BrokerEnvironment, Market } from '@prisma/client';
import { TradingBrokerOrderMatcherService } from '../trading/trading-broker-order-matcher.service';
import { TossBaseService } from './toss-base.service';
import { TossBrokerService } from './toss-broker.service';
import { TossMutationError } from './toss-mutation.error';
import { TossVenueResolverService } from './toss-venue-resolver.service';
import type { TossOrder } from './types/toss-order.type';

describe('TossBrokerService', () => {
  let service: TossBrokerService;
  let base: { request: jest.Mock };
  let config: ConfigService;
  let venueResolver: { resolveVenues: jest.Mock };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    base = { request: jest.fn() };
    config = {
      get: jest.fn((key: string) => key === 'toss.accountNo' ? 'account-seq' : undefined),
    } as unknown as ConfigService;
    venueResolver = {
      resolveVenues: jest.fn(async (symbols: string[]) => new Map(
        symbols.map((symbol) => [symbol, 'US']),
      )),
    };
    service = new TossBrokerService(
      base as unknown as TossBaseService,
      config,
      venueResolver as unknown as TossVenueResolverService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const signal = {
    broker: Broker.TOSS,
    market: 'OVERSEAS' as const,
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    side: 'BUY' as const,
    quantity: 2,
    price: 55.25,
    reason: 'test',
  };

  function order(overrides: Partial<TossOrder> = {}): TossOrder {
    return {
      orderId: 'order-1',
      symbol: 'AAPL',
      side: 'BUY',
      orderType: 'LIMIT',
      timeInForce: 'DAY',
      status: 'PENDING',
      price: '185.5',
      quantity: '5',
      orderAmount: null,
      currency: 'USD',
      orderedAt: '2026-08-14T09:30:01+09:00',
      canceledAt: null,
      execution: {
        filledQuantity: '0',
        averageFilledPrice: null,
        filledAmount: null,
        commission: null,
        tax: null,
        filledAt: null,
        settlementDate: null,
      },
      ...overrides,
    };
  }

  function ordersResponse(orders: TossOrder[], hasNext = false, nextCursor: string | null = null) {
    return { result: { orders, hasNext, nextCursor } };
  }

  it.each([
    ['00', { orderType: 'LIMIT', timeInForce: 'DAY', price: '55.25' }],
    ['34', { orderType: 'LIMIT', timeInForce: 'CLS', price: '55.25' }],
    ['01', { orderType: 'MARKET' }],
  ])('maps KIS order division %s to the Toss order contract', async (orderDivision, mapped) => {
    base.request.mockResolvedValue({ result: { orderId: 'toss-order-id' } });

    await expect(service.submitOrder({ ...signal, orderDivision })).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      success: true,
      orderNo: 'toss-order-id',
    });

    const expectedBody = {
      symbol: 'TQQQ',
      side: 'BUY',
      quantity: '2',
      ...mapped,
    };
    expect(base.request).toHaveBeenCalledWith('ORDER', {
      method: 'POST',
      path: '/api/v1/orders',
      body: expectedBody,
      accountScoped: true,
      mutation: true,
    });
    if (orderDivision === '01') {
      expect(expectedBody).not.toHaveProperty('price');
      expect(expectedBody).not.toHaveProperty('timeInForce');
    }
  });

  it('returns the complete accepted-order identity required by the execution pipeline', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-14T15:01:02.000Z'));
    base.request.mockResolvedValue({ result: { orderId: 'toss-order-id' } });

    try {
      await expect(service.submitOrder({ ...signal, orderDivision: '00' })).resolves.toMatchObject({
        outcome: 'ACCEPTED',
        orderNo: 'toss-order-id',
        brokerOrderDate: '20260815',
        orderTime: '000102',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([undefined, '', '33', '99'])('fails closed before HTTP for division %p', async (orderDivision) => {
    await expect(service.submitOrder({ ...signal, orderDivision })).rejects.toThrow(
      'Unsupported Toss order division',
    );
    expect(base.request).not.toHaveBeenCalled();
  });

  it('fails closed before HTTP when a limit order has no positive price', async () => {
    await expect(service.submitOrder({
      ...signal,
      orderDivision: '00',
      price: undefined,
    })).rejects.toThrow('Invalid Toss limit order price');
    expect(base.request).not.toHaveBeenCalled();
  });

  it.each([
    [new TossMutationError('TRANSPORT_UNKNOWN', 'timeout'), 'UNKNOWN'],
    [new TossMutationError('BUSINESS_REJECTION', 'declined'), 'REJECTED'],
    [new Error('Toss API request rejected (HTTP 422)'), 'REJECTED'],
  ] as const)('maps mutation failure semantics without losing UNKNOWN', async (error, outcome) => {
    base.request.mockRejectedValue(error);

    await expect(service.submitOrder({ ...signal, orderDivision: '00' })).resolves.toMatchObject({
      outcome,
      success: false,
    });
  });

  it('treats a successful POST with a missing orderId as UNKNOWN', async () => {
    base.request.mockResolvedValue({ result: {} });

    await expect(service.submitOrder({ ...signal, orderDivision: '00' })).resolves.toMatchObject({
      outcome: 'UNKNOWN',
      success: false,
    });
  });

  it('cancels by Toss orderId', async () => {
    base.request.mockResolvedValue({ result: { orderId: 'cancel-operation-id' } });

    await expect(service.cancelOrder({
      market: Market.OVERSEAS,
      exchangeCode: 'NASD',
      orderNo: 'order-1',
      stockCode: 'AAPL',
      qty: 2,
      price: 185.5,
    })).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      orderNo: 'cancel-operation-id',
    });
    expect(base.request).toHaveBeenCalledWith('ORDER', {
      method: 'POST',
      path: '/api/v1/orders/order-1/cancel',
      body: {},
      accountScoped: true,
      mutation: true,
    });
  });

  it('maps only matching-market open orders to remaining quantities', async () => {
    base.request.mockResolvedValue(ordersResponse([
      order({
        status: 'PARTIAL_FILLED',
        execution: {
          ...order().execution,
          filledQuantity: '2',
          averageFilledPrice: '185.25',
        },
      }),
      order({ orderId: 'domestic', symbol: '005930', currency: 'KRW' }),
    ]));

    await expect(service.getUnfilledOrders(Market.OVERSEAS)).resolves.toEqual([{
      orderNo: 'order-1',
      stockCode: 'AAPL',
      side: 'BUY',
      quantity: 3,
      price: 185.5,
      exchangeCode: 'US',
    }]);
  });

  it('matches a stored NASD recovery tuple after enriching a Toss execution', async () => {
    base.request.mockImplementation((_group, options) => Promise.resolve(
      ordersResponse(options.query.status === 'OPEN' ? [order()] : []),
    ));
    venueResolver.resolveVenues.mockResolvedValue(new Map([['AAPL', 'NASD']]));
    const matcher = new TradingBrokerOrderMatcherService(
      {
        getCurrentContext: jest.fn(() => ({
          environment: BrokerEnvironment.PROD,
          accountHash: 'stable-account-hash',
        })),
      } as never,
      { get: jest.fn(() => service) } as never,
    );

    const candidates = await matcher.findSubmissionCandidates({
      tradeRecordId: 'stored-toss-order',
      broker: Broker.TOSS,
      market: Market.OVERSEAS,
      exchangeCode: 'NASD',
      stockCode: 'AAPL',
      side: 'BUY',
      quantity: 5,
      submissionStartedAt: new Date('2026-08-14T00:30:01.000Z'),
      brokerEnvironment: BrokerEnvironment.PROD,
      brokerAccountHash: 'stable-account-hash',
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        orderNo: 'order-1',
        stockCode: 'AAPL',
        exchangeCode: 'NASD',
      }),
    ]);
  });

  it('enriches NYSE and AMEX executions with canonical venues', async () => {
    base.request.mockImplementation((_group, options) => Promise.resolve(
      ordersResponse(options.query.status === 'OPEN'
        ? [order({ orderId: 'nyse', symbol: 'IBM' }), order({ orderId: 'amex', symbol: 'SPY' })]
        : []),
    ));
    venueResolver.resolveVenues.mockResolvedValue(new Map([
      ['IBM', 'NYSE'],
      ['SPY', 'AMEX'],
    ]));

    const executions = await service.getOrderExecutions(
      Market.OVERSEAS,
      '20260814',
      '20260814',
    );

    expect(executions.map(({ stockCode, exchangeCode }) => ({ stockCode, exchangeCode }))).toEqual([
      { stockCode: 'IBM', exchangeCode: 'NYSE' },
      { stockCode: 'SPY', exchangeCode: 'AMEX' },
    ]);
  });

  it('returns KRX for domestic listings without overseas venue resolution', async () => {
    base.request.mockResolvedValue(ordersResponse([
      order({ orderId: 'domestic', symbol: '005930', currency: 'KRW' }),
    ]));

    await expect(service.getUnfilledOrders(Market.DOMESTIC)).resolves.toEqual([
      expect.objectContaining({ stockCode: '005930', exchangeCode: 'KRX' }),
    ]);
    expect(venueResolver.resolveVenues).not.toHaveBeenCalled();
  });

  it('reuses batched stock metadata on a second listing call', async () => {
    const integrationBase = {
      request: jest.fn((_group, options) => {
        if (options.path === '/api/v1/stocks') {
          return Promise.resolve({
            result: [{
              symbol: 'AAPL',
              name: 'Apple Inc.',
              englishName: 'Apple Inc.',
              isinCode: 'US0378331005',
              market: 'NASDAQ',
              securityType: 'STOCK',
              isCommonShare: true,
              status: 'ACTIVE',
              currency: 'USD',
              sharesOutstanding: '1000000',
            }],
          });
        }
        return Promise.resolve(ordersResponse([order()]));
      }),
    };
    const actualResolver = new TossVenueResolverService(
      integrationBase as unknown as TossBaseService,
    );
    const broker = new TossBrokerService(
      integrationBase as unknown as TossBaseService,
      config,
      actualResolver,
    );

    await expect(broker.getUnfilledOrders(Market.OVERSEAS)).resolves.toEqual([
      expect.objectContaining({ stockCode: 'AAPL', exchangeCode: 'NASD' }),
    ]);
    await expect(broker.getUnfilledOrders(Market.OVERSEAS)).resolves.toEqual([
      expect.objectContaining({ stockCode: 'AAPL', exchangeCode: 'NASD' }),
    ]);
    expect(integrationBase.request.mock.calls.filter(([, options]) => (
      options.path === '/api/v1/stocks'
    ))).toHaveLength(1);
  });

  it('maps every specified Toss order status', async () => {
    const open = [
      order({ orderId: 'pending', status: 'PENDING' }),
      order({ orderId: 'pending-cancel', status: 'PENDING_CANCEL' }),
      order({ orderId: 'pending-replace', status: 'PENDING_REPLACE' }),
      order({
        orderId: 'partial',
        status: 'PARTIAL_FILLED',
        execution: { ...order().execution, filledQuantity: '2', averageFilledPrice: '184' },
      }),
    ];
    const closed = [
      order({
        orderId: 'filled',
        status: 'FILLED',
        execution: { ...order().execution, filledQuantity: '5', averageFilledPrice: '183' },
      }),
      order({ orderId: 'canceled', status: 'CANCELED' }),
      order({ orderId: 'rejected', status: 'REJECTED' }),
      order({ orderId: 'replaced', status: 'REPLACED' }),
    ];
    base.request.mockImplementation((_group, options) => Promise.resolve(
      ordersResponse(options.query.status === 'OPEN' ? open : closed),
    ));

    const result: any[] = await service.getOrderExecutions(
      Market.OVERSEAS,
      '20260813',
      '20260814',
    );

    expect(Object.fromEntries(result.map((item) => [item.orderNo, item.status]))).toEqual({
      pending: 'PENDING',
      'pending-cancel': 'PENDING',
      'pending-replace': 'PENDING',
      partial: 'PARTIAL',
      filled: 'FILLED',
      canceled: 'CANCELLED',
      rejected: 'FAILED',
      replaced: 'CANCELLED',
    });
    expect(result.find((item) => item.orderNo === 'rejected')).toMatchObject({
      rejectionState: 'REJECTED',
      rejected: true,
      remainingQuantity: 0,
    });
    expect(result.find((item) => item.orderNo === 'partial')).toMatchObject({
      filledQuantity: 2,
      remainingQuantity: 3,
      filledPrice: 184,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[TOSS AAPL]'));
  });

  it('fails the complete order read for an unmapped status', async () => {
    base.request.mockImplementation((_group, options) => Promise.resolve(
      ordersResponse(options.query.status === 'OPEN'
        ? [order({ status: 'CANCEL_REJECTED' })]
        : []),
    ));

    await expect(service.getOrderExecutions(
      Market.OVERSEAS,
      '20260813',
      '20260814',
    )).rejects.toThrow('Unsupported Toss order status');
  });

  it('reads every CLOSED page before returning executions', async () => {
    base.request.mockImplementation((_group, options) => {
      if (options.query.status === 'OPEN') return Promise.resolve(ordersResponse([]));
      return Promise.resolve(options.query.cursor
        ? ordersResponse([order({ orderId: 'page-2', status: 'FILLED' })])
        : ordersResponse([order({ orderId: 'page-1', status: 'FILLED' })], true, 'next'));
    });

    const result = await service.getOrderExecutions(
      Market.OVERSEAS,
      '20260813',
      '20260814',
    );

    expect(result.map((item) => item.orderNo)).toEqual(['page-1', 'page-2']);
  });

  it('maps holdings and filters by market', async () => {
    base.request.mockResolvedValue({
      result: {
        totalPurchaseAmount: { krw: '6500000', usd: '1553' },
        marketValue: {
          amount: { krw: '7200000', usd: '1785' },
          amountAfterCost: { krw: '7050000', usd: '1771.43' },
        },
        profitLoss: {
          amount: { krw: '700000', usd: '232' },
          amountAfterCost: { krw: '550000', usd: '218.43' },
          rate: '0.1516',
          rateAfterCost: '0.1406',
        },
        dailyProfitLoss: {
          amount: { krw: '100000', usd: '25' },
          rate: '0.0185',
        },
        items: [
          {
            symbol: 'AAPL',
            name: 'Apple Inc.',
            marketCountry: 'US',
            currency: 'USD',
            quantity: '10',
            lastPrice: '178.5',
            averagePurchasePrice: '155.3',
            marketValue: { purchaseAmount: '1553', amount: '1785', amountAfterCost: '1771.43' },
            profitLoss: { amount: '232', amountAfterCost: '218.43', rate: '0.1494', rateAfterCost: '0.1406' },
            dailyProfitLoss: { amount: '25', rate: '0.0142' },
            cost: { commission: '3.57', tax: '10' },
          },
          {
            symbol: '005930',
            name: '삼성전자',
            marketCountry: 'KR',
            currency: 'KRW',
            quantity: '100',
            lastPrice: '72000',
            averagePurchasePrice: '65000',
            marketValue: { purchaseAmount: '6500000', amount: '7200000', amountAfterCost: '7050000' },
            profitLoss: { amount: '700000', amountAfterCost: '550000', rate: '0.1077', rateAfterCost: '0.0846' },
            dailyProfitLoss: { amount: '100000', rate: '0.0141' },
            cost: { commission: '14400', tax: '135600' },
          },
        ],
      },
    });

    await expect(service.getBalance(Market.OVERSEAS)).resolves.toEqual([{
      stockCode: 'AAPL',
      stockName: 'Apple Inc.',
      quantity: 10,
      avgPrice: 155.3,
      currentPrice: 178.5,
      profitLoss: 232,
      profitRate: 14.94,
      exchangeCode: 'US',
    }]);
  });

  it('maps KRW and USD buying power through the plan ASSET group', async () => {
    base.request.mockImplementation((_group, options) => Promise.resolve({
      result: {
        currency: options.query.currency,
        cashBuyingPower: options.query.currency === 'KRW' ? '5000000' : '3500.5',
      },
    }));

    await expect(service.getDomesticBuyableAmount()).resolves.toEqual({ cashAvailable: 5_000_000 });
    await expect(service.getOverseasBuyableAmount('NASD', 'AAPL', 185)).resolves.toEqual({
      foreignCurrencyAvailable: 3_500.5,
      maxQuantity: 18,
    });
    expect(base.request).toHaveBeenNthCalledWith(1, 'ASSET', expect.objectContaining({
      path: '/api/v1/buying-power',
      query: { currency: 'KRW' },
    }));
    expect(base.request).toHaveBeenNthCalledWith(2, 'ASSET', expect.objectContaining({
      query: { currency: 'USD' },
    }));
  });

  it('builds the overseas snapshot from accounts, holdings, and exchange rate', async () => {
    base.request.mockImplementation((group, options) => {
      if (options.path === '/api/v1/accounts') {
        return Promise.resolve({ result: [{ accountNo: 'masked-fixture', accountSeq: 1, accountType: 'BROKERAGE' }] });
      }
      if (options.path === '/api/v1/holdings') {
        return Promise.resolve({
          result: {
            totalPurchaseAmount: { krw: '0', usd: null },
            marketValue: { amount: { krw: '0', usd: null }, amountAfterCost: { krw: '0', usd: null } },
            profitLoss: { amount: { krw: '0', usd: null }, amountAfterCost: { krw: '0', usd: null }, rate: '0', rateAfterCost: '0' },
            dailyProfitLoss: { amount: { krw: '0', usd: null }, rate: '0' },
            items: [],
          },
        });
      }
      expect(group).toBe('MARKET_DATA');
      return Promise.resolve({
        result: {
          baseCurrency: 'USD', quoteCurrency: 'KRW', rate: '1380.5', midRate: '1375',
          basisPoint: '40', rateChangeType: 'UP', validFrom: '2026-08-14T09:30:00+09:00',
          validUntil: '2026-08-14T09:31:00+09:00',
        },
      });
    });

    await expect(service.getOverseasAccountSnapshot()).resolves.toEqual({
      balance: [],
      cashBalances: [{ currencyCode: 'USD', currencyName: '', amount: 0 }],
    });
    expect(base.request.mock.calls.map(([, options]) => options.path)).toEqual([
      '/api/v1/accounts',
      '/api/v1/holdings',
      '/api/v1/exchange-rate',
    ]);
  });

  it('returns an always-PROD Toss broker context with a SHA-256 account hash', () => {
    expect(service.broker).toBe(Broker.TOSS);
    expect(service.getBrokerContext()).toEqual({
      broker: Broker.TOSS,
      environment: BrokerEnvironment.PROD,
      accountHash: 'da2c49ea998bd79d0b823bdea6b3105f60ba13718048e16be919b7f2ee21bad5',
    });
  });
});
