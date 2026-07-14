import { MarketStateSyncService } from './market-state-sync.service';

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
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      },
    ]);

    expect(cancellation.cancelUnfilledOrder).toHaveBeenCalledWith(
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
        orderNo: 'switch-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      },
    ]);

    expect(cancellation.cancelUnfilledOrder).toHaveBeenCalledWith(
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
        orderNo: 'accepted-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      },
    ]);

    expect(cancellation.cancelUnfilledOrder).toHaveBeenCalledWith(
      'DOMESTIC',
      expect.objectContaining({ orderNo: 'accepted-order' }),
    );
    expect(mockKisDomestic.cancelOrder).not.toHaveBeenCalled();
  });
});
