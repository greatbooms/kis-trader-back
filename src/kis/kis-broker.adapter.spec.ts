import { Broker, Market } from '@prisma/client';
import { KisBrokerAdapter } from './kis-broker.adapter';

describe('KisBrokerAdapter', () => {
  const accepted = {
    outcome: 'ACCEPTED' as const,
    success: true,
    orderNo: 'O-100',
    brokerOrderDate: '20260714',
    orderTime: '101112',
    message: 'accepted',
  };
  const domestic = {
    orderBuy: jest.fn().mockResolvedValue(accepted),
    orderSell: jest.fn().mockResolvedValue(accepted),
    cancelOrder: jest.fn().mockResolvedValue(accepted),
    getUnfilledOrders: jest.fn().mockResolvedValue([]),
    getOrderExecutions: jest.fn().mockResolvedValue([]),
    getBalance: jest.fn().mockResolvedValue([]),
    getBuyableAmount: jest.fn().mockResolvedValue({ cashAvailable: 1_000 }),
  };
  const overseas = {
    orderBuy: jest.fn().mockResolvedValue(accepted),
    orderSell: jest.fn().mockResolvedValue(accepted),
    cancelOrder: jest.fn().mockResolvedValue(accepted),
    getUnfilledOrders: jest.fn().mockResolvedValue([]),
    getOrderExecutions: jest.fn().mockResolvedValue([]),
    getBalance: jest.fn().mockResolvedValue([]),
    getBuyableAmount: jest.fn().mockResolvedValue({
      foreignCurrencyAvailable: 900,
      maxQuantity: 4,
    }),
    getAccountSnapshot: jest.fn().mockResolvedValue({ balance: [], cashBalances: [] }),
  };
  const config = {
    get: jest.fn((key: string) => ({
      'kis.accountNo': '12345678',
      'kis.prodCode': '01',
      'kis.env': 'paper',
    })[key]),
  };

  let adapter: KisBrokerAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new KisBrokerAdapter(domestic as never, overseas as never, config as never);
  });

  it.each([
    [
      'domestic BUY',
      { market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', side: 'BUY', quantity: 2, price: 70_000, orderDivision: '00', reason: 'buy' },
      domestic.orderBuy,
      ['005930', 2, 70_000, '00'],
    ],
    [
      'domestic SELL',
      { market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', side: 'SELL', quantity: 3, price: undefined, orderDivision: undefined, reason: 'sell' },
      domestic.orderSell,
      ['005930', 3, undefined, undefined],
    ],
    [
      'overseas BUY',
      { market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'AAPL', side: 'BUY', quantity: 1, price: 250, orderDivision: '00', reason: 'buy' },
      overseas.orderBuy,
      ['NASD', 'AAPL', 1, 250, '00'],
    ],
    [
      'overseas SELL',
      { market: 'OVERSEAS', exchangeCode: 'NYSE', stockCode: 'IBM', side: 'SELL', quantity: 4, price: undefined, orderDivision: undefined, reason: 'sell' },
      overseas.orderSell,
      ['NYSE', 'IBM', 4, 0, undefined],
    ],
  ] as const)('dispatches %s order arguments unchanged', async (_label, signal, expected, args) => {
    await expect(adapter.submitOrder({ ...signal, broker: Broker.KIS })).resolves.toEqual(accepted);
    expect(expected).toHaveBeenCalledWith(...args);
  });

  it.each([
    [Market.DOMESTIC, domestic.cancelOrder, ['O-1', '005930', 2]],
    [Market.OVERSEAS, overseas.cancelOrder, ['NASD', 'O-1', 'AAPL', 2, 250]],
  ] as const)('dispatches %s cancellation arguments unchanged', async (market, expected, args) => {
    await expect(adapter.cancelOrder({
      market,
      exchangeCode: market === Market.DOMESTIC ? 'KRX' : 'NASD',
      orderNo: 'O-1',
      stockCode: market === Market.DOMESTIC ? '005930' : 'AAPL',
      qty: 2,
      price: 250,
    })).resolves.toEqual(accepted);
    expect(expected).toHaveBeenCalledWith(...args);
  });

  it.each([
    [Market.DOMESTIC, domestic.getBalance],
    [Market.OVERSEAS, overseas.getBalance],
  ] as const)('dispatches %s balance reads', async (market, expected) => {
    await expect(adapter.getBalance(market)).resolves.toEqual([]);
    expect(expected).toHaveBeenCalledTimes(1);
  });

  it('dispatches order-state and buyable-account reads', async () => {
    await adapter.getUnfilledOrders(Market.OVERSEAS);
    await adapter.getOrderExecutions(Market.DOMESTIC, '20260713', '20260714');
    await expect(adapter.getDomesticBuyableAmount()).resolves.toEqual({ cashAvailable: 1_000 });
    await expect(adapter.getOverseasBuyableAmount('NASD', 'AAPL', 250)).resolves.toEqual({
      foreignCurrencyAvailable: 900,
      maxQuantity: 4,
    });
    await expect(adapter.getOverseasAccountSnapshot('840')).resolves.toEqual({
      balance: [],
      cashBalances: [],
    });

    expect(overseas.getUnfilledOrders).toHaveBeenCalledTimes(1);
    expect(domestic.getOrderExecutions).toHaveBeenCalledWith('20260713', '20260714');
    expect(domestic.getBuyableAmount).toHaveBeenCalledTimes(1);
    expect(overseas.getBuyableAmount).toHaveBeenCalledWith('NASD', 'AAPL', 250);
    expect(overseas.getAccountSnapshot).toHaveBeenCalledWith('840');
  });

  it('returns the KIS broker context from validated config', () => {
    expect(adapter.getBrokerContext()).toEqual({
      broker: Broker.KIS,
      environment: 'PAPER',
      accountHash: '9efc1f8b3b71dc3a241956261458f960cc2ceaf34da9ccb340f737a3f35b7cb5',
    });
  });
});
