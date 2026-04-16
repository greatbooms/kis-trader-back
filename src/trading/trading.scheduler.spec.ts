import { TradingScheduler } from './trading.scheduler';

describe('TradingScheduler', () => {
  let scheduler: TradingScheduler;

  const mockTradingService = {
    executePerStockStrategy: jest.fn(),
    syncPositions: jest.fn(),
  };

  const mockMarketAnalysis = {
    getMarketCondition: jest.fn(),
    getStockIndicators: jest.fn(),
  };

  const mockMarketRegimeService = {
    getRegime: jest.fn(),
  };

  const mockRiskManagement = {
    evaluateRisk: jest.fn(),
    saveRiskSnapshot: jest.fn(),
  };

  const mockOrderSyncService = {
    syncMarketOrders: jest.fn(),
    getMarketUnfilledOrders: jest.fn(),
  };

  const mockStrategyRegistry = {
    getAllStrategies: jest.fn(),
    getStrategy: jest.fn(),
  };

  const mockKisDomestic = {
    getPrice: jest.fn(),
    getBuyableAmount: jest.fn(),
  };
  const mockKisOverseas = {
    getPrice: jest.fn(),
    getBuyableAmount: jest.fn(),
  };

  const mockPrisma = {
    position: {
      findMany: jest.fn(),
    },
    tradeRecord: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    riskSnapshot: {
      findFirst: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'trading.enabled') return true;
      if (key === 'kis.env') return 'paper';
      return undefined;
    }),
  };

  const mockSchedulerRegistry = {
    addCronJob: jest.fn(),
  };

  const mockMarketDataCache = {
    getSecFundamentals: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockMarketRegimeService.getRegime.mockResolvedValue({});
    mockRiskManagement.evaluateRisk.mockResolvedValue({ reasons: [] });
    mockRiskManagement.saveRiskSnapshot.mockResolvedValue(undefined);
    mockTradingService.executePerStockStrategy.mockResolvedValue(undefined);
    mockTradingService.syncPositions.mockResolvedValue(undefined);
    mockMarketAnalysis.getMarketCondition.mockResolvedValue({});
    mockMarketAnalysis.getStockIndicators.mockResolvedValue({});
    mockPrisma.position.findMany.mockResolvedValue([]);
    mockPrisma.tradeRecord.findMany.mockResolvedValue([]);
    mockPrisma.tradeRecord.findFirst.mockResolvedValue(null);
    mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70000 });
    mockKisDomestic.getBuyableAmount.mockResolvedValue({ cashAvailable: 1000000 });
    mockKisOverseas.getPrice.mockResolvedValue({ currentPrice: 54.6 });
    mockKisOverseas.getBuyableAmount.mockResolvedValue({ foreignCurrencyAvailable: 1000000 });
    mockMarketDataCache.getSecFundamentals.mockResolvedValue(undefined);
    mockOrderSyncService.syncMarketOrders.mockResolvedValue(undefined);
    mockOrderSyncService.getMarketUnfilledOrders.mockResolvedValue([
      {
        orderNo: 'order-1',
        stockCode: 'TQQQ',
        side: 'SELL',
        exchangeCode: 'NASD',
        quantity: 1,
        price: 58.42,
      },
      {
        orderNo: 'order-2',
        stockCode: 'AAPL',
        side: 'SELL',
        exchangeCode: 'NASD',
        quantity: 1,
        price: 200,
      },
    ]);
    mockStrategyRegistry.getStrategy.mockImplementation((name: string) => {
      if (name === 'conservative') {
        return { name, executionMode: { type: 'continuous' } };
      }
      if (name === 'infinite-buy') {
        return {
          name,
          executionMode: {
            type: 'once-daily',
            hours: { domestic: 11, overseas: { basis: 'afterOpen', offsetHours: 2 } },
          },
        };
      }
      return undefined;
    });

    scheduler = new TradingScheduler(
      mockTradingService as any,
      mockMarketAnalysis as any,
      mockMarketRegimeService as any,
      mockRiskManagement as any,
      mockOrderSyncService as any,
      mockStrategyRegistry as any,
      mockKisDomestic as any,
      mockKisOverseas as any,
      mockPrisma as any,
      mockConfigService as any,
      mockSchedulerRegistry as any,
      mockMarketDataCache as any,
    );
  });

  it('should not cancel unfilled orders when only continuous strategies exist', async () => {
    const shouldExecuteNowSpy = jest
      .spyOn(scheduler as any, 'shouldExecuteNow')
      .mockReturnValue(true);
    const cancelUnfilledOrdersSpy = jest
      .spyOn(scheduler as any, 'cancelUnfilledOrders')
      .mockResolvedValue(undefined);

    await (scheduler as any).executeMarket('OVERSEAS', 'NASD', [
      {
        id: 'ws-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'conservative',
        isActive: true,
      },
    ]);

    expect(shouldExecuteNowSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conservative' }),
      'OVERSEAS',
      'NASD',
    );
    expect(cancelUnfilledOrdersSpy).not.toHaveBeenCalled();
  });

  it('should cancel only matching once-daily watch stock orders when scheduled now', async () => {
    mockPrisma.tradeRecord.findMany.mockResolvedValue([
      { orderNo: 'order-1' },
    ]);

    const shouldExecuteNowSpy = jest
      .spyOn(scheduler as any, 'shouldExecuteNow')
      .mockReturnValue(true);
    const cancelUnfilledOrdersSpy = jest
      .spyOn(scheduler as any, 'cancelUnfilledOrders')
      .mockResolvedValue(undefined);

    await (scheduler as any).executeMarket('OVERSEAS', 'NASD', [
      {
        id: 'ws-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'infinite-buy',
        isActive: true,
      },
      {
        id: 'ws-2',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'AAPL',
        stockName: 'AAPL',
        strategyName: 'conservative',
        isActive: true,
      },
    ]);

    expect(shouldExecuteNowSpy).toHaveBeenCalled();
    expect(cancelUnfilledOrdersSpy).toHaveBeenCalledWith('OVERSEAS', [
      {
        orderNo: 'order-1',
        stockCode: 'TQQQ',
        side: 'SELL',
        exchangeCode: 'NASD',
        quantity: 1,
        price: 58.42,
      },
    ]);
  });
});
