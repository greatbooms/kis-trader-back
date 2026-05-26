import { MarketStateSyncService } from './market-state-sync.service';

describe('MarketStateSyncService holiday checks', () => {
  let service: MarketStateSyncService;

  const mockKisDomestic = {
    getHolidays: jest.fn(),
  };

  const mockKisOverseas = {
    getOverseasHolidays: jest.fn(),
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
      {} as any,
      mockKisDomestic as any,
      mockKisOverseas as any,
      {} as any,
      mockConfigService as any,
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
});
