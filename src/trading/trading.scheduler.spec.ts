import { TradingScheduler } from './trading.scheduler';
import { CronJob } from 'cron';

describe('TradingScheduler', () => {
  let scheduler: TradingScheduler;

  const mockOrchestrator = {
    isBusy: jest.fn(() => false),
    executeDomestic: jest.fn(),
    executeOverseas: jest.fn(),
    sendDomesticDailySummary: jest.fn(),
    sendUsDailySummary: jest.fn(),
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

  const mockRecoveryService = {
    takeOverStartupState: jest.fn().mockResolvedValue({
      submissionUnknown: 0,
      submissionCancelled: 0,
      cancellationUnknown: 0,
      unresolvedCount: 0,
    }),
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
      mockRecoveryService as any,
      mockConfigService as any,
      mockSchedulerRegistry as any,
    );
  });

  it('runs cold-start recovery but skips cron registration when trading is disabled', async () => {
    await scheduler.onModuleInit();

    expect(mockRecoveryService.takeOverStartupState).toHaveBeenCalledTimes(1);
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

  it('registers separate domestic and US close daily summary retry windows when trading is enabled', async () => {
    const startSpy = jest.spyOn(CronJob.prototype, 'start').mockImplementation(() => undefined as any);
    const enabledConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'trading.enabled') return true;
        return undefined;
      }),
    };
    scheduler = new TradingScheduler(
      mockOrchestrator as any,
      mockMarketStateSync as any,
      mockRecoveryService as any,
      enabledConfigService as any,
      mockSchedulerRegistry as any,
    );

    await scheduler.onModuleInit();

    const registeredJobs = new Map<string, CronJob>(
      mockSchedulerRegistry.addCronJob.mock.calls.map(([name, job]) => [name, job]),
    );
    expect((registeredJobs.get('daily-summary-domestic-close') as any).cronTime.source)
      .toBe('40,45,50 15 * * 1-5');
    expect((registeredJobs.get('daily-summary-us-close-dst') as any).cronTime.source)
      .toBe('10,15,20 5 * * 2-6');
    expect((registeredJobs.get('daily-summary-us-close-standard') as any).cronTime.source)
      .toBe('10,15,20 6 * * 2-6');

    startSpy.mockRestore();
  });

  it('does not execute a registered trading callback before cold-start recovery is ready', async () => {
    const startSpy = jest.spyOn(CronJob.prototype, 'start').mockImplementation(() => undefined as any);
    let releaseRecovery: ((value: {
      submissionUnknown: number;
      submissionCancelled: number;
      cancellationUnknown: number;
      unresolvedCount: number;
    }) => void) | undefined;
    mockRecoveryService.takeOverStartupState.mockReturnValueOnce(new Promise((resolve) => {
      releaseRecovery = resolve;
    }));
    const enabledConfigService = {
      get: jest.fn((key: string) => key === 'trading.enabled' ? true : undefined),
    };
    scheduler = new TradingScheduler(
      mockOrchestrator as any,
      mockMarketStateSync as any,
      mockRecoveryService as any,
      enabledConfigService as any,
      mockSchedulerRegistry as any,
    );

    const initialization = scheduler.onModuleInit();
    const domesticJob = mockSchedulerRegistry.addCronJob.mock.calls
      .find(([name]) => name === 'trading-domestic')?.[1] as CronJob;
    expect(domesticJob).toBeDefined();

    const callback = (domesticJob as any)._callbacks[0] as () => Promise<void>;
    const callbackCompletion = callback();
    expect(mockOrchestrator.executeDomestic).not.toHaveBeenCalled();

    releaseRecovery?.({
      submissionUnknown: 1,
      submissionCancelled: 0,
      cancellationUnknown: 0,
      unresolvedCount: 1,
    });
    await initialization;
    await callbackCompletion;

    expect(mockOrchestrator.executeDomestic).toHaveBeenCalledTimes(1);
    startSpy.mockRestore();
  });

  it('keeps every registered callback blocked when cold-start recovery fails', async () => {
    const startSpy = jest
      .spyOn(CronJob.prototype, 'start')
      .mockImplementation(() => undefined as any);
    mockRecoveryService.takeOverStartupState.mockRejectedValueOnce(
      new Error('recovery database unavailable'),
    );
    const enabledConfigService = {
      get: jest.fn((key: string) => key === 'trading.enabled' ? true : undefined),
    };
    scheduler = new TradingScheduler(
      mockOrchestrator as any,
      mockMarketStateSync as any,
      mockRecoveryService as any,
      enabledConfigService as any,
      mockSchedulerRegistry as any,
    );

    await scheduler.onModuleInit();

    const registeredJobs = mockSchedulerRegistry.addCronJob.mock.calls
      .map(([, job]) => job as CronJob);
    expect(registeredJobs).toHaveLength(22);
    for (const job of registeredJobs) {
      const callback = (job as any)._callbacks[0] as () => Promise<void>;
      await callback();
    }

    expect(mockOrchestrator.executeDomestic).not.toHaveBeenCalled();
    expect(mockOrchestrator.executeOverseas).not.toHaveBeenCalled();
    expect(mockOrchestrator.sendDomesticDailySummary).not.toHaveBeenCalled();
    expect(mockOrchestrator.sendUsDailySummary).not.toHaveBeenCalled();
    expect(mockOrchestrator.runMarketRegimeDetection).not.toHaveBeenCalled();
    expect(mockOrchestrator.runMarketRegimeDetectionForExchanges).not.toHaveBeenCalled();
    expect(mockMarketStateSync.syncDomesticOpenOrders).not.toHaveBeenCalled();
    expect(mockMarketStateSync.syncOverseasOpenOrders).not.toHaveBeenCalled();
    expect(mockMarketStateSync.syncDomesticPortfolioState).not.toHaveBeenCalled();
    expect(mockMarketStateSync.syncOverseasPortfolioState).not.toHaveBeenCalled();
    startSpy.mockRestore();
  });
});
