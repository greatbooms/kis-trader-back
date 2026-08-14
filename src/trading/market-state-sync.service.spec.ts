import { MarketStateSyncService } from './market-state-sync.service';
import { Broker } from '@prisma/client';

describe('MarketStateSyncService holiday checks', () => {
  let service: MarketStateSyncService;

  const mockKisDomestic = {
    getHolidays: jest.fn(),
    cancelOrder: jest.fn(),
  };

  const mockKisOverseas = {
    getOverseasHolidays: jest.fn(),
    cancelOrder: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'kis.env') return 'prod';
      return undefined;
    }),
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-25T15:30:00Z'));
    jest.clearAllMocks();

    service = new MarketStateSyncService(
      {} as any,
      {} as any,
      mockKisDomestic as any,
      mockKisOverseas as any,
      {} as any,
      {} as any,
      mockConfigService as any,
      {} as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should use the exchange local date for US overseas holidays', async () => {
    mockKisOverseas.getOverseasHolidays.mockResolvedValue([
      {
        date: '20260525',
        name: 'Memorial Day',
        isOpen: false,
        countryCode: 'US',
      },
    ]);

    await expect(service.isExchangeHoliday('NASD')).resolves.toBe(true);
    expect(mockKisOverseas.getOverseasHolidays).toHaveBeenCalledWith('20260525');
  });

  it('should ignore holidays for a different overseas country', async () => {
    mockKisOverseas.getOverseasHolidays.mockResolvedValue([
      {
        date: '20260525',
        name: 'Hong Kong holiday',
        isOpen: false,
        countryCode: 'HK',
      },
    ]);

    await expect(service.isExchangeHoliday('NASD')).resolves.toBe(false);
  });

  it('should match overseas holiday rows by KIS exchange code', async () => {
    mockKisOverseas.getOverseasHolidays.mockResolvedValue([
      {
        date: '20260525',
        name: 'Memorial Day',
        isOpen: false,
        exchangeCode: 'NAS',
      },
    ]);

    await expect(service.isExchangeHoliday('NASD')).resolves.toBe(true);
  });

  it('uses the shared cancellation claim and skips POST when another caller wins', async () => {
    const cancellation = {
      cancelUnfilledOrder: jest.fn().mockResolvedValue(false),
    };
    (service as any).orderCancellationService = cancellation;

    await service.cancelUnfilledOrders('DOMESTIC', [
      {
        broker: Broker.KIS,
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      },
    ]);

    expect(cancellation.cancelUnfilledOrder).toHaveBeenCalledWith(
      Broker.KIS,
      'DOMESTIC',
      expect.objectContaining({ orderNo: 'broker-order' }),
    );
    expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
  });

  it('releases the automatic cancellation claim when live trading closes before POST', async () => {
    const cancellation = {
      cancelUnfilledOrder: jest.fn().mockResolvedValue(false),
    };
    (service as any).orderCancellationService = cancellation;

    await service.cancelUnfilledOrders('DOMESTIC', [
      {
        broker: Broker.KIS,
        orderNo: 'switch-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      },
    ]);

    expect(cancellation.cancelUnfilledOrder).toHaveBeenCalledWith(
      Broker.KIS,
      'DOMESTIC',
      expect.objectContaining({ orderNo: 'switch-order' }),
    );
    expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
  });

  it('persists automatic cancellation acceptance without terminalizing the original order', async () => {
    const cancellation = {
      cancelUnfilledOrder: jest.fn().mockResolvedValue(true),
    };
    (service as any).orderCancellationService = cancellation;

    await service.cancelUnfilledOrders('DOMESTIC', [
      {
        broker: Broker.KIS,
        orderNo: 'accepted-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      },
    ]);

    expect(cancellation.cancelUnfilledOrder).toHaveBeenCalledWith(
      Broker.KIS,
      'DOMESTIC',
      expect.objectContaining({ orderNo: 'accepted-order' }),
    );
    expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
  });

  it('continues TOSS automatic cancellation when KIS cancellation fails', async () => {
    const cancellation = {
      cancelUnfilledOrder: jest
        .fn()
        .mockRejectedValueOnce(new Error('KIS cancellation unavailable'))
        .mockResolvedValueOnce(true),
    };
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    (service as any).orderCancellationService = cancellation;

    await service.cancelUnfilledOrders('DOMESTIC', [
      {
        broker: Broker.KIS,
        orderNo: 'kis-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      },
      {
        broker: Broker.TOSS,
        orderNo: 'toss-order',
        stockCode: '005930',
        quantity: 1,
        price: 70_000,
        side: 'BUY',
      },
    ]);

    expect(cancellation.cancelUnfilledOrder).toHaveBeenNthCalledWith(
      1,
      Broker.KIS,
      'DOMESTIC',
      expect.objectContaining({ orderNo: 'kis-order' }),
    );
    expect(cancellation.cancelUnfilledOrder).toHaveBeenNthCalledWith(
      2,
      Broker.TOSS,
      'DOMESTIC',
      expect.objectContaining({ orderNo: 'toss-order' }),
    );
    expect(warn).toHaveBeenCalledWith(
      '[KIS 005930] DOMESTIC automatic cancellation failed for #kis-order: KIS cancellation unavailable',
    );
  });

  it('preserves KIS portfolio synchronization when Toss is inactive by default', async () => {
    const balance = [{ stockCode: '005930' }];
    const kis = { broker: Broker.KIS, getBalance: jest.fn().mockResolvedValue(balance) };
    const positionSync = { syncPositions: jest.fn().mockResolvedValue(undefined) };
    const registry = { getActive: jest.fn().mockReturnValue([kis]) };
    (service as any).registry = registry;
    (service as any).positionSyncService = positionSync;

    await service.syncMarketPortfolioOnly('DOMESTIC');

    expect(kis.getBalance).toHaveBeenCalledWith('DOMESTIC');
    expect(positionSync.syncPositions).toHaveBeenCalledWith(
      Broker.KIS,
      'DOMESTIC',
      balance,
    );
  });

  it('warns and continues to the next active broker when a portfolio lookup fails', async () => {
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const kis = {
      broker: Broker.KIS,
      getBalance: jest.fn().mockRejectedValue(new Error('KIS unavailable')),
    };
    const tossBalance = [{ stockCode: 'TQQQ' }];
    const toss = {
      broker: Broker.TOSS,
      getBalance: jest.fn().mockResolvedValue(tossBalance),
    };
    const positionSync = { syncPositions: jest.fn().mockResolvedValue(undefined) };
    (service as any).registry = { getActive: jest.fn().mockReturnValue([kis, toss]) };
    (service as any).positionSyncService = positionSync;

    await service.syncMarketPortfolioOnly('OVERSEAS');

    expect(warn).toHaveBeenCalledWith(
      '[KIS OVERSEAS] Portfolio sync failed: KIS unavailable',
    );
    expect(positionSync.syncPositions).toHaveBeenCalledWith(
      Broker.TOSS,
      'OVERSEAS',
      tossBalance,
    );
  });

  it('retains broker identity when passing DB positions to order reconciliation', async () => {
    const kis = { broker: Broker.KIS, getBalance: jest.fn().mockResolvedValue([]) };
    const orderSync = { syncMarketOrders: jest.fn().mockResolvedValue(undefined) };
    (service as any).registry = { getActive: jest.fn().mockReturnValue([kis]) };
    (service as any).positionSyncService = { syncPositions: jest.fn() };
    (service as any).orderSyncService = orderSync;
    (service as any).prisma = {
      position: {
        findMany: jest.fn().mockResolvedValue([
          { broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', quantity: 1 },
          { broker: Broker.TOSS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', quantity: 4 },
        ]),
      },
    };

    await service.syncMarketOrdersOnly('OVERSEAS');

    expect(orderSync.syncMarketOrders).toHaveBeenCalledWith('OVERSEAS', [
      { broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', quantity: 1 },
      { broker: Broker.TOSS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', quantity: 4 },
    ]);
  });
});
