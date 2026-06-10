import { TradingOrchestrator } from './trading-orchestrator.service';

describe('TradingOrchestrator', () => {
  let orchestrator: TradingOrchestrator;

  const mockTradingService = {
    executePerStockStrategy: jest.fn(),
  };

  const mockMarketAnalysis = {
    getMarketCondition: jest.fn(),
    getStockIndicators: jest.fn(),
  };

  const mockMarketRegimeService = {
    getRegime: jest.fn(),
    detectAndSave: jest.fn(),
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

  const mockMarketStateSync = {
    isMarketOpen: jest.fn(() => true),
    isHoliday: jest.fn(() => Promise.resolve(false)),
    isExchangeHoliday: jest.fn(() => Promise.resolve(false)),
    syncMarketPortfolioOnly: jest.fn(),
    cancelUnfilledOrders: jest.fn(),
    getUnfilledOrders: jest.fn(),
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
    watchStock: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'trading.enabled') return true;
      if (key === 'kis.env') return 'paper';
      return undefined;
    }),
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
    mockMarketAnalysis.getMarketCondition.mockResolvedValue({});
    mockMarketAnalysis.getStockIndicators.mockResolvedValue({});
    mockPrisma.position.findMany.mockResolvedValue([]);
    mockPrisma.tradeRecord.findMany.mockResolvedValue([]);
    mockPrisma.tradeRecord.findFirst.mockResolvedValue(null);
    mockPrisma.watchStock.findMany.mockResolvedValue([]);
    mockPrisma.watchStock.findUnique.mockResolvedValue(null);
    mockMarketStateSync.isExchangeHoliday.mockResolvedValue(false);
    mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70000 });
    mockKisDomestic.getBuyableAmount.mockResolvedValue({ cashAvailable: 1000000 });
    mockKisOverseas.getPrice.mockResolvedValue({ currentPrice: 54.6 });
    mockKisOverseas.getBuyableAmount.mockResolvedValue({ foreignCurrencyAvailable: 1000000 });
    mockMarketDataCache.getSecFundamentals.mockResolvedValue(undefined);
    mockOrderSyncService.syncMarketOrders.mockResolvedValue(undefined);
    mockMarketStateSync.cancelUnfilledOrders.mockResolvedValue(undefined);
    mockMarketStateSync.syncMarketPortfolioOnly.mockResolvedValue(undefined);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([
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

    orchestrator = new TradingOrchestrator(
      mockTradingService as any,
      mockMarketAnalysis as any,
      mockMarketRegimeService as any,
      mockRiskManagement as any,
      mockOrderSyncService as any,
      mockStrategyRegistry as any,
      mockMarketStateSync as any,
      mockKisDomestic as any,
      mockKisOverseas as any,
      mockPrisma as any,
      mockConfigService as any,
      mockMarketDataCache as any,
    );
  });

  it('should skip overseas exchange execution on exchange holiday', async () => {
    mockPrisma.watchStock.findMany.mockResolvedValue([
      {
        id: 'ws-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'infinite-buy',
        isActive: true,
      },
    ]);
    mockMarketStateSync.isMarketOpen.mockReturnValue(true);
    mockMarketStateSync.isExchangeHoliday.mockResolvedValue(true);

    await orchestrator.executeOverseas();

    expect(mockMarketStateSync.isExchangeHoliday).toHaveBeenCalledWith('NASD');
    expect(mockTradingService.executePerStockStrategy).not.toHaveBeenCalled();
  });

  it('should block manual overseas execution on exchange holiday', async () => {
    mockPrisma.watchStock.findUnique.mockResolvedValue({
      id: 'ws-1',
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      strategyName: 'infinite-buy',
      isActive: true,
    });
    mockMarketStateSync.isMarketOpen.mockReturnValue(true);
    mockMarketStateSync.isExchangeHoliday.mockResolvedValue(true);

    const result = await orchestrator.triggerWatchStockNow('ws-1');

    expect(result).toEqual({
      success: false,
      message: '현재 휴장일이라 수동 실행할 수 없습니다.',
    });
    expect(mockMarketStateSync.isExchangeHoliday).toHaveBeenCalledWith('NASD');
    expect(mockPrisma.tradeRecord.findFirst).not.toHaveBeenCalled();
  });

  it('should map unfilled orders to hasOpenBuyOrder/hasOpenSellOrder in strategy contexts', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([
      {
        orderNo: 'order-1',
        stockCode: 'TQQQ',
        side: 'SELL',
        exchangeCode: 'NASD',
        quantity: 1,
        price: 58.42,
      },
    ]);

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
      {
        id: 'ws-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'conservative',
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

    expect(mockTradingService.executePerStockStrategy).toHaveBeenCalledTimes(1);
    const contexts = mockTradingService.executePerStockStrategy.mock.calls[0][1];
    const tqqq = contexts.find((c: any) => c.watchStock.stockCode === 'TQQQ');
    const aapl = contexts.find((c: any) => c.watchStock.stockCode === 'AAPL');

    expect(tqqq.hasOpenSellOrder).toBe(true);
    expect(tqqq.hasOpenBuyOrder).toBe(false);
    expect(aapl.hasOpenSellOrder).toBe(false);
    expect(aapl.hasOpenBuyOrder).toBe(false);
  });

  it('should not cancel unfilled orders when only continuous strategies exist', async () => {
    const shouldExecuteNowSpy = jest
      .spyOn(orchestrator as any, 'shouldExecuteNow')
      .mockReturnValue(true);

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
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
    expect(mockMarketStateSync.cancelUnfilledOrders).not.toHaveBeenCalled();
  });

  it('should cancel only matching once-daily watch stock orders when scheduled now', async () => {
    mockPrisma.tradeRecord.findMany.mockResolvedValue([
      { orderNo: 'order-1' },
    ]);

    const shouldExecuteNowSpy = jest
      .spyOn(orchestrator as any, 'shouldExecuteNow')
      .mockReturnValue(true);

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
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
    expect(mockMarketStateSync.cancelUnfilledOrders).toHaveBeenCalledWith('OVERSEAS', [
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
