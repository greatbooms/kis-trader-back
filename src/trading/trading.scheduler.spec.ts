import { TradingScheduler } from './trading.scheduler';

describe('TradingScheduler', () => {
  let scheduler: TradingScheduler;

  const mockOrchestrator = {
    isBusy: jest.fn(() => false),
    executeDomestic: jest.fn(),
    executeOverseas: jest.fn(),
    runMarketRegimeDetection: jest.fn(),
    runMarketRegimeDetectionForExchanges: jest.fn(),
    triggerWatchStockNow: jest.fn(),
  };

  const mockMarketStateSync = {
    syncDomesticOpenOrders: jest.fn(),
    syncOverseasOpenOrders: jest.fn(),
    syncDomesticPortfolioState: jest.fn(),
    syncOverseasPortfolioState: jest.fn(),
    isMarketOpen: jest.fn(() => true),
    isExchangeHoliday: jest.fn(() => false),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'trading.enabled') return false; // onModuleInit 스킵
      return undefined;
    }),
  };

  const mockSchedulerRegistry = {
    addCronJob: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    scheduler = new TradingScheduler(
      mockOrchestrator as any,
      mockMarketStateSync as any,
      mockConfigService as any,
      mockSchedulerRegistry as any,
    );
  });

  it('should skip cron registration when trading is disabled', () => {
    scheduler.onModuleInit();
    expect(mockSchedulerRegistry.addCronJob).not.toHaveBeenCalled();
  });

  it('should expose isBusy delegating to orchestrator', () => {
    mockOrchestrator.isBusy.mockReturnValueOnce(true);
    expect(scheduler.isBusy()).toBe(true);
    expect(mockOrchestrator.isBusy).toHaveBeenCalled();
  });

  it('should expose isMarketOpen delegating to marketStateSync', () => {
    mockMarketStateSync.isMarketOpen.mockReturnValueOnce(false);
    expect(scheduler.isMarketOpen('KRX')).toBe(false);
    expect(mockMarketStateSync.isMarketOpen).toHaveBeenCalledWith('KRX');
  });

  it('should expose isExchangeHoliday delegating to marketStateSync', async () => {
    mockMarketStateSync.isExchangeHoliday.mockReturnValueOnce(Promise.resolve(true) as any);
    await expect(scheduler.isExchangeHoliday('KRX')).resolves.toBe(true);
    expect(mockMarketStateSync.isExchangeHoliday).toHaveBeenCalledWith('KRX');
  });
});
