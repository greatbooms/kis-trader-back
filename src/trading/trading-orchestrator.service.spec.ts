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
    appSetting: {
      create: jest.fn(),
      delete: jest.fn(),
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

  const mockSlackService = {
    isConfigured: jest.fn(),
    isEnabled: jest.fn(),
    sendDailySummary: jest.fn(),
    sendRiskAlert: jest.fn(),
  };

  const mockSlackCommandsService = {
    buildDailySummary: jest.fn(),
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
    mockPrisma.appSetting.create.mockResolvedValue({});
    mockPrisma.appSetting.delete.mockResolvedValue({});
    mockSlackService.isConfigured.mockReturnValue(true);
    mockSlackService.isEnabled.mockReturnValue(false);
    mockSlackService.sendDailySummary.mockResolvedValue(true);
    mockSlackService.sendRiskAlert.mockResolvedValue(undefined);
    mockSlackCommandsService.buildDailySummary.mockResolvedValue({
      positions: [],
      todayBuyCount: 1,
      todaySellCount: 0,
      skipCount: 0,
      skipReasons: [],
      totalInvested: 100,
      totalEvaluation: 101,
      totalPnl: 1,
      totalPnlRate: 1,
      marketSummaries: [
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          label: '미국',
          positions: [],
          totalInvested: 100,
          totalEvaluation: 101,
          totalPnl: 1,
          totalPnlRate: 1,
        },
      ],
      marketConditions: [],
    });
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
      mockSlackService as any,
      mockSlackCommandsService as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
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

  it('당일 PENDING 레코드는 broker 미체결 목록에 없어도 hasOpen*Order에 반영 — reconciliation 공백 중복 주문 가드', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    // 시장가 주문이 즉시 체결되면 broker 미체결 목록에는 이미 없지만,
    // reconciliation 전이라 로컬 레코드는 PENDING — 이 공백에 중복 매수가 나가면 안 된다
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([]);
    mockPrisma.tradeRecord.findMany.mockResolvedValue([
      { status: 'PENDING', side: 'BUY' },
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
    ]);

    const contexts = mockTradingService.executePerStockStrategy.mock.calls[0][1];
    const tqqq = contexts.find((c: any) => c.watchStock.stockCode === 'TQQQ');
    expect(tqqq.hasOpenBuyOrder).toBe(true);
    expect(tqqq.hasOpenSellOrder).toBe(false);
    expect(tqqq.alreadyExecutedToday).toBe(false); // PENDING은 아직 체결 확정이 아님
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

  it('does not send daily summary during once-daily strategy execution', async () => {
    mockSlackService.isEnabled.mockReturnValue(true);
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);

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
    ]);

    expect(mockSlackCommandsService.buildDailySummary).not.toHaveBeenCalled();
    expect(mockSlackService.sendDailySummary).not.toHaveBeenCalled();
  });

  it('sends domestic daily summary after domestic close using only domestic scope', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-24T06:40:00Z')); // 15:40 KST
    mockSlackService.isEnabled.mockReturnValue(true);
    mockPrisma.position.findMany.mockResolvedValueOnce([
      {
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '027410',
        quantity: 1,
      },
    ]);

    await orchestrator.sendDomesticDailySummary();

    expect(mockOrderSyncService.syncMarketOrders).toHaveBeenCalledWith(
      'DOMESTIC',
      [
        {
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '027410',
          quantity: 1,
        },
      ],
      { force: true },
    );
    expect(mockSlackCommandsService.buildDailySummary).toHaveBeenCalledWith({
      summaryTitle: '국내장 매매 요약 | 2026-06-24',
      market: 'DOMESTIC',
      exchangeCodes: ['KRX'],
      tradeStart: new Date('2026-06-24T00:00:00+09:00'),
      tradeEnd: new Date('2026-06-24T23:59:59.999+09:00'),
    });
    expect(mockSlackService.sendDailySummary).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('does not send close daily summary when latest market state sync fails and releases the claim', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-24T06:40:00Z')); // 15:40 KST
    mockSlackService.isEnabled.mockReturnValue(true);
    mockMarketStateSync.syncMarketPortfolioOnly.mockRejectedValueOnce(new Error('KIS timeout'));

    await orchestrator.sendDomesticDailySummary();

    expect(mockSlackCommandsService.buildDailySummary).not.toHaveBeenCalled();
    expect(mockSlackService.sendDailySummary).not.toHaveBeenCalled();
    expect(mockPrisma.appSetting.delete).toHaveBeenCalledWith({
      where: { key: 'daily-summary-sent:DOMESTIC:KRX:CLOSE:2026-06-24' },
    });

    jest.useRealTimers();
  });

  it('sends close daily summary when session trades exist even if no positions remain', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-24T06:40:00Z')); // 15:40 KST
    mockSlackService.isEnabled.mockReturnValue(true);
    mockSlackCommandsService.buildDailySummary.mockResolvedValueOnce({
      positions: [],
      todayBuyCount: 1,
      todaySellCount: 1,
      skipCount: 0,
      skipReasons: [],
      totalInvested: 0,
      totalEvaluation: 0,
      totalPnl: 0,
      totalPnlRate: 0,
      marketSummaries: [],
      marketConditions: [],
    });

    await orchestrator.sendDomesticDailySummary();

    expect(mockSlackService.sendDailySummary).toHaveBeenCalledWith(
      expect.objectContaining({
        todayBuyCount: 1,
        todaySellCount: 1,
        marketSummaries: [],
      }),
    );
    expect(mockPrisma.appSetting.delete).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('attempts close daily summary even when Slack socket is disconnected so SlackService can reconnect', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-24T06:40:00Z')); // 15:40 KST
    mockSlackService.isEnabled.mockReturnValue(false);
    mockPrisma.position.findMany.mockResolvedValue([
      {
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '027410',
        quantity: 1,
      },
    ]);

    await orchestrator.sendDomesticDailySummary();

    expect(mockSlackService.sendDailySummary).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('skips close daily summary before broker sync when Slack is not configured', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-24T06:40:00Z')); // 15:40 KST
    mockSlackService.isConfigured.mockReturnValue(false);

    await orchestrator.sendDomesticDailySummary();

    expect(mockPrisma.appSetting.create).not.toHaveBeenCalled();
    expect(mockMarketStateSync.syncMarketPortfolioOnly).not.toHaveBeenCalled();
    expect(mockSlackCommandsService.buildDailySummary).not.toHaveBeenCalled();
    expect(mockSlackService.sendDailySummary).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('sends US daily summary after US close using the previous KST session date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-24T20:10:00Z')); // 2026-06-25 05:10 KST, US DST close + 10m
    mockSlackService.isEnabled.mockReturnValue(true);
    mockPrisma.position.findMany.mockResolvedValueOnce([
      {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        quantity: 37,
      },
    ]);

    await orchestrator.sendUsDailySummary();

    expect(mockOrderSyncService.syncMarketOrders).toHaveBeenCalledWith(
      'OVERSEAS',
      [
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          quantity: 37,
        },
      ],
      { force: true },
    );
    expect(mockSlackCommandsService.buildDailySummary).toHaveBeenCalledWith({
      summaryTitle: '미국장 매매 요약 | 2026-06-24 거래일',
      market: 'OVERSEAS',
      exchangeCodes: ['NASD', 'NYSE', 'AMEX'],
      tradeStart: new Date('2026-06-24T22:30:00+09:00'),
      tradeEnd: new Date('2026-06-25T05:00:00+09:00'),
    });
    expect(mockSlackService.sendDailySummary).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
