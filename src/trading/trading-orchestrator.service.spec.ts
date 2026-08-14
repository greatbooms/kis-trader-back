import { TradingOrchestrator } from './trading-orchestrator.service';
import { Broker } from '@prisma/client';

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
  const mockKisPort = {
    broker: Broker.KIS,
    getDomesticBuyableAmount: jest.fn(() => mockKisDomestic.getBuyableAmount()),
    getOverseasBuyableAmount: jest.fn((exchangeCode, stockCode, price) =>
      mockKisOverseas.getBuyableAmount(exchangeCode, stockCode, price)),
  };
  const mockTossPort = {
    broker: Broker.TOSS,
    getDomesticBuyableAmount: jest.fn(),
    getOverseasBuyableAmount: jest.fn(),
  };
  const mockRegistry = {
    get: jest.fn((broker: Broker) => broker === Broker.KIS ? mockKisPort : mockTossPort),
    getActive: jest.fn<any, []>(() => [mockKisPort]),
    isActive: jest.fn((broker: Broker) => mockRegistry.getActive().some((port) => port.broker === broker)),
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
    watchStockExecutionLog: {
      create: jest.fn(),
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
    mockTossPort.getDomesticBuyableAmount.mockResolvedValue({ cashAvailable: 2000000 });
    mockTossPort.getOverseasBuyableAmount.mockResolvedValue({
      foreignCurrencyAvailable: 2000000,
      maxQuantity: 100,
    });
    mockRegistry.getActive.mockReturnValue([mockKisPort]);
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
        broker: Broker.KIS,
        orderNo: 'order-1',
        stockCode: 'TQQQ',
        side: 'SELL',
        exchangeCode: 'NASD',
        quantity: 1,
        price: 58.42,
      },
      {
        broker: Broker.KIS,
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
      mockRegistry as any,
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

  it('Task 4 invariant: Toss disabled executes only the legacy KIS group with KIS cash routing', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([]);

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
      buildWatchStock(Broker.KIS, 'KIS-TQQQ'),
      buildWatchStock(Broker.TOSS, 'TOSS-TQQQ'),
    ]);

    expect(mockTradingService.executePerStockStrategy).toHaveBeenCalledTimes(1);
    expect(mockTradingService.executePerStockStrategy.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        watchStock: expect.objectContaining({ broker: Broker.KIS, stockCode: 'KIS-TQQQ' }),
        buyableAmount: 1000000,
      }),
    ]);
    expect(mockRegistry.get).toHaveBeenCalledWith(Broker.KIS);
    expect(mockRegistry.get).not.toHaveBeenCalledWith(Broker.TOSS);
  });

  it('runs active KIS and TOSS groups sequentially and warns/continues after one broker fails', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    const order: string[] = [];
    mockRegistry.getActive.mockReturnValue([mockKisPort, mockTossPort]);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([]);
    mockTradingService.executePerStockStrategy.mockImplementation(async (_strategy, contexts) => {
      const broker = contexts[0].watchStock.broker;
      order.push(broker);
      if (broker === Broker.KIS) throw new Error('KIS group failed');
    });
    const warn = jest.spyOn((orchestrator as any).logger, 'warn');

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
      buildWatchStock(Broker.KIS, 'KIS-TQQQ'),
      buildWatchStock(Broker.TOSS, 'TOSS-TQQQ'),
    ]);

    expect(order).toEqual([Broker.KIS, Broker.TOSS]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[KIS OVERSEAS]'));
  });

  it('skips only the broker whose targeted order sync fails before strategy evaluation', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    mockRegistry.getActive.mockReturnValue([mockKisPort, mockTossPort]);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([]);
    mockOrderSyncService.syncMarketOrders.mockImplementation(async (_market, _positions, options) => {
      if (options?.broker === Broker.TOSS) throw new Error('TOSS order API unavailable');
    });
    const warn = jest.spyOn((orchestrator as any).logger, 'warn');

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
      buildWatchStock(Broker.KIS, 'KIS-TQQQ'),
      buildWatchStock(Broker.TOSS, 'TOSS-TQQQ'),
    ]);

    expect(mockTradingService.executePerStockStrategy).toHaveBeenCalledTimes(1);
    expect(mockTradingService.executePerStockStrategy.mock.calls[0][1][0].watchStock.broker)
      .toBe(Broker.KIS);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[TOSS OVERSEAS] Trading group failed: TOSS order API unavailable'),
    );
  });

  it('isolates the running mutex by broker and market', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    mockRegistry.getActive.mockReturnValue([mockKisPort, mockTossPort]);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([]);
    let releaseKis!: () => void;
    const kisBlocked = new Promise<void>((resolve) => { releaseKis = resolve; });
    mockTradingService.executePerStockStrategy.mockImplementation(async (_strategy, contexts) => {
      if (contexts[0].watchStock.broker === Broker.KIS) await kisBlocked;
    });

    const firstKis = (orchestrator as any).executeMarket(
      'OVERSEAS',
      'NASD',
      [buildWatchStock(Broker.KIS, 'KIS-TQQQ')],
    );
    await Promise.resolve();
    await (orchestrator as any).executeMarket(
      'OVERSEAS',
      'NASD',
      [buildWatchStock(Broker.TOSS, 'TOSS-TQQQ')],
    );
    await (orchestrator as any).executeMarket(
      'OVERSEAS',
      'NASD',
      [buildWatchStock(Broker.KIS, 'KIS-SOXL')],
    );
    releaseKis();
    await firstKis;

    const brokers = mockTradingService.executePerStockStrategy.mock.calls
      .map(([, contexts]) => contexts[0].watchStock.broker);
    expect(brokers).toEqual([Broker.KIS, Broker.TOSS]);
  });

  it('routes each broker BUY context to that broker buyable/cash port', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    mockRegistry.getActive.mockReturnValue([mockKisPort, mockTossPort]);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([]);

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
      buildWatchStock(Broker.KIS, 'KIS-TQQQ'),
      buildWatchStock(Broker.TOSS, 'TOSS-TQQQ'),
    ]);

    const contexts = mockTradingService.executePerStockStrategy.mock.calls
      .map(([, group]) => group[0]);
    expect(contexts).toEqual([
      expect.objectContaining({
        watchStock: expect.objectContaining({ broker: Broker.KIS }),
        buyableAmount: 1000000,
      }),
      expect.objectContaining({
        watchStock: expect.objectContaining({ broker: Broker.TOSS }),
        buyableAmount: 2000000,
      }),
    ]);
    expect(mockKisPort.getOverseasBuyableAmount).toHaveBeenCalled();
    expect(mockTossPort.getOverseasBuyableAmount).toHaveBeenCalled();
  });

  it('adds display-only per-symbol cross-broker exposure to the daily risk alert', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    mockRiskManagement.evaluateRisk.mockResolvedValue({
      reasons: ['monitoring threshold'],
      liquidateAll: false,
      drawdown: -0.1,
      dailyPnlRate: -0.02,
      positionCount: 1,
      investedRate: 0.5,
    });
    mockSlackService.isEnabled.mockReturnValue(true);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([]);
    mockPrisma.position.findMany.mockImplementation(async ({ where }: any) =>
      where?.broker
        ? [{
            broker: Broker.KIS,
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            quantity: 2,
            avgPrice: 50,
            currentPrice: 60,
            totalInvested: 100,
          }]
        : [
            { broker: Broker.KIS, exchangeCode: 'NASD', stockCode: 'TQQQ', quantity: 2, currentPrice: 60 },
            { broker: Broker.TOSS, exchangeCode: 'NASD', stockCode: 'TQQQ', quantity: 3, currentPrice: 61 },
            { broker: Broker.TOSS, exchangeCode: 'NYSE', stockCode: 'TQQQ', quantity: 1, currentPrice: 70 },
          ],
    );
    mockPrisma.riskSnapshot.findFirst.mockResolvedValue({
      peakValue: 1000,
      portfolioValue: 900,
    });

    await (orchestrator as any).executeMarket(
      'OVERSEAS',
      'NASD',
      [buildWatchStock(Broker.KIS, 'TQQQ')],
    );

    expect(mockSlackService.sendRiskAlert).toHaveBeenCalledWith(expect.objectContaining({
      broker: Broker.KIS,
      details: expect.objectContaining({
        crossBrokerExposures: [
          {
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            totalValue: 303,
            brokers: [
              { broker: Broker.KIS, value: 120 },
              { broker: Broker.TOSS, value: 183 },
            ],
          },
          {
            exchangeCode: 'NYSE',
            stockCode: 'TQQQ',
            totalValue: 70,
            brokers: [{ broker: Broker.TOSS, value: 70 }],
          },
        ],
      }),
    }));
    expect(mockRiskManagement.evaluateRisk).toHaveBeenCalledTimes(1);
    expect(mockRiskManagement.evaluateRisk).toHaveBeenCalledWith(Broker.KIS, 'OVERSEAS');
  });

  function buildWatchStock(broker: Broker, stockCode: string) {
    return {
      id: `${broker}-${stockCode}`,
      broker,
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode,
      stockName: stockCode,
      strategyName: 'conservative',
      isActive: true,
      quota: null,
      cycle: 0,
      maxCycles: 40,
      stopLossRate: 0,
      maxPortfolioRate: 1,
      strategyParams: null,
    };
  }

  it('should skip overseas exchange execution on exchange holiday', async () => {
    mockPrisma.watchStock.findMany.mockResolvedValue([
      {
        id: 'ws-1',
        broker: Broker.KIS,
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
      broker: Broker.KIS,
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

  it('blocks manual execution for any locked unresolved instrument intent regardless of strategy', async () => {
    mockPrisma.watchStock.findUnique.mockResolvedValue({
      id: 'ws-locked',
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      strategyName: 'conservative',
      isActive: true,
    });
    mockMarketStateSync.isMarketOpen.mockReturnValue(true);
    mockPrisma.tradeRecord.findFirst.mockResolvedValue({
      id: 'unknown-other-strategy',
      orderNo: null,
      status: 'SUBMISSION_UNKNOWN',
      strategyName: 'daily-dca',
    });
    mockPrisma.watchStockExecutionLog.create.mockResolvedValue({});

    await expect(orchestrator.triggerWatchStockNow('ws-locked')).resolves.toEqual({
      success: false,
      message: '이미 열린 주문이 있어 중복 주문을 막았습니다.',
    });

    expect(mockPrisma.tradeRecord.findFirst).toHaveBeenCalledWith({
      where: {
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        OR: [
          {
            status: {
              in: ['AWAITING_APPROVAL', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'PENDING'],
            },
          },
          { status: 'PARTIAL', orderNo: { not: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('should map unfilled orders to hasOpenBuyOrder/hasOpenSellOrder in strategy contexts', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([
      {
        broker: Broker.KIS,
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
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'conservative',
        isActive: true,
      },
      {
        id: 'ws-2',
        broker: Broker.KIS,
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
        broker: Broker.KIS,
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

  it('treats approval/submitting/unknown as unresolved side intents without counting them executed', async () => {
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);
    mockMarketStateSync.getUnfilledOrders.mockResolvedValue([]);
    mockPrisma.tradeRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { status: 'AWAITING_APPROVAL', side: 'BUY' },
        { status: 'SUBMITTING', side: 'SELL' },
        { status: 'SUBMISSION_UNKNOWN', side: 'SELL' },
      ]);

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
      {
        id: 'ws-locked',
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'conservative',
        isActive: true,
      },
    ]);

    const context = mockTradingService.executePerStockStrategy.mock.calls[0][1][0];
    expect(context.hasOpenBuyOrder).toBe(true);
    expect(context.hasOpenSellOrder).toBe(true);
    expect(context.alreadyExecutedToday).toBe(false);
    expect(mockPrisma.tradeRecord.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        OR: [
          {
            status: {
              in: ['AWAITING_APPROVAL', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'PENDING'],
            },
          },
          { status: 'PARTIAL', orderNo: { not: null } },
        ],
      },
      select: { status: true, side: true },
    });
  });

  it('should not cancel unfilled orders when only continuous strategies exist', async () => {
    const shouldExecuteNowSpy = jest
      .spyOn(orchestrator as any, 'shouldExecuteNow')
      .mockReturnValue(true);

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
      {
        id: 'ws-1',
        broker: Broker.KIS,
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
      { broker: Broker.KIS, orderNo: 'order-1' },
    ]);

    const shouldExecuteNowSpy = jest
      .spyOn(orchestrator as any, 'shouldExecuteNow')
      .mockReturnValue(true);

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
      {
        id: 'ws-1',
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'infinite-buy',
        isActive: true,
      },
      {
        id: 'ws-2',
        broker: Broker.KIS,
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
        broker: Broker.KIS,
        orderNo: 'order-1',
        stockCode: 'TQQQ',
        side: 'SELL',
        exchangeCode: 'NASD',
        quantity: 1,
        price: 58.42,
      },
    ]);
    const cancellationQuery = mockPrisma.tradeRecord.findMany.mock.calls
      .map(([query]) => query)
      .find((query: any) => query?.where?.orderNo?.in);
    expect(cancellationQuery.where.AND[0]).toEqual({
      OR: [
        { cancellationStatus: null },
        { cancellationStatus: { in: ['REJECTED', 'RESOLVED'] } },
      ],
    });
  });

  it('does not send daily summary during once-daily strategy execution', async () => {
    mockSlackService.isEnabled.mockReturnValue(true);
    jest.spyOn(orchestrator as any, 'shouldExecuteNow').mockReturnValue(true);

    await (orchestrator as any).executeMarket('OVERSEAS', 'NASD', [
      {
        id: 'ws-1',
        broker: Broker.KIS,
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
        broker: Broker.KIS,
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
          broker: Broker.KIS,
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '027410',
          quantity: 1,
        },
      ],
      { force: true, failOnAnyError: true },
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

  it('attaches display-only cross-broker exposure to the close summary without risk evaluation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-24T06:40:00Z'));
    mockPrisma.position.findMany.mockResolvedValue([
      {
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        quantity: 1,
        currentPrice: 70_000,
      },
      {
        broker: Broker.TOSS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        quantity: 2,
        currentPrice: 71_000,
      },
    ]);

    await orchestrator.sendDomesticDailySummary();

    expect(mockSlackService.sendDailySummary).toHaveBeenCalledWith(
      expect.objectContaining({
        crossBrokerExposures: [
          {
            exchangeCode: 'KRX',
            stockCode: '005930',
            totalValue: 212_000,
            brokers: [
              { broker: Broker.KIS, value: 70_000 },
              { broker: Broker.TOSS, value: 142_000 },
            ],
          },
        ],
      }),
    );
    expect(mockRiskManagement.evaluateRisk).not.toHaveBeenCalled();

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

  it('does not build close daily summary and releases the claim when strict portfolio sync reports one broker failure', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-24T06:40:00Z')); // 15:40 KST
    mockSlackService.isEnabled.mockReturnValue(true);
    mockMarketStateSync.syncMarketPortfolioOnly.mockImplementation(async (_market, options) => {
      if (options?.failOnAnyError) throw new Error('TOSS portfolio API unavailable');
    });
    mockPrisma.position.findMany.mockResolvedValue([
      {
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        quantity: 1,
      },
      {
        broker: Broker.TOSS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        quantity: 2,
      },
    ]);

    await orchestrator.sendDomesticDailySummary();

    expect(mockMarketStateSync.syncMarketPortfolioOnly).toHaveBeenCalledWith(
      'DOMESTIC',
      { failOnAnyError: true },
    );
    expect(mockSlackCommandsService.buildDailySummary).not.toHaveBeenCalled();
    expect(mockSlackService.sendDailySummary).not.toHaveBeenCalled();
    expect(mockPrisma.appSetting.delete).toHaveBeenCalledWith({
      where: { key: 'daily-summary-sent:DOMESTIC:KRX:CLOSE:2026-06-24' },
    });

    jest.useRealTimers();
  });

  it('does not send close daily summary and releases the claim when fail-on-any order sync reports one broker failure', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-24T06:40:00Z')); // 15:40 KST
    mockSlackService.isEnabled.mockReturnValue(true);
    mockPrisma.position.findMany.mockResolvedValueOnce([
      {
        broker: Broker.TOSS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        quantity: 2,
      },
      {
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        quantity: 1,
      },
    ]);
    mockOrderSyncService.syncMarketOrders.mockImplementation(async (_market, _positions, options) => {
      if (options?.failOnAnyError) throw new Error('TOSS order API unavailable');
    });

    await orchestrator.sendDomesticDailySummary();

    expect(mockOrderSyncService.syncMarketOrders).toHaveBeenCalledWith(
      'DOMESTIC',
      [
        {
          broker: Broker.TOSS,
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          quantity: 2,
        },
        {
          broker: Broker.KIS,
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          quantity: 1,
        },
      ],
      { force: true, failOnAnyError: true },
    );
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
        broker: Broker.KIS,
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
        broker: Broker.KIS,
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
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          quantity: 37,
        },
      ],
      { force: true, failOnAnyError: true },
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

  describe('previewWatchStockExecution', () => {
    function buildV4WatchStockRow() {
      return {
        id: 'ws-1',
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'infinite-buy-v4',
        quota: 10000,
        cycle: 0,
        maxCycles: 40,
        stopLossRate: 0,
        maxPortfolioRate: 1,
        strategyParams: { v4: { turn: 12.42, cashRemaining: 250, mode: 'NORMAL' } },
      };
    }

    it('전략 평가 결과를 그대로 매핑해 반환하고 주문 제출/실행 로그는 전혀 남기지 않는다', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue(buildV4WatchStockRow());
      mockKisOverseas.getPrice.mockResolvedValue({ currentPrice: 60 });
      mockKisOverseas.getBuyableAmount.mockResolvedValue({ foreignCurrencyAvailable: 250, maxQuantity: 4 });
      mockPrisma.position.findMany.mockResolvedValueOnce([
        { broker: Broker.KIS, stockCode: 'TQQQ', exchangeCode: 'NASD', quantity: 8, avgPrice: 50, currentPrice: 60, totalInvested: 400 },
      ]);

      const evaluateStock = jest.fn().mockResolvedValue({
        signals: [
          {
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            side: 'SELL',
            quantity: 2,
            price: 61.2,
            reason: 'V4 v4-quarter-sell: 2주 @ 61.2',
            orderDivision: '34',
            metadata: { phase: 'v4-quarter-sell', fillModel: 'loc' },
          },
        ],
        skipReasons: ['매수 수량 부족: 일일 매수 시도액 6.25으로 1주 매수 불가'],
        details: {
          T: 12.42,
          mode: 'NORMAL',
          cashRemaining: 250,
          dailyBuyBudget: 6.25,
          dailyBuyBudgetCapped: 6.25,
          star: { starPct: 5.4, starPrice: 61.2, buyLimitPrice: 55.4, sellLimitPrice: 61.2 },
        },
      });
      mockStrategyRegistry.getStrategy.mockReturnValue({ name: 'infinite-buy-v4', evaluateStock });

      const result = await orchestrator.previewWatchStockExecution('ws-1');

      expect(evaluateStock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        context: {
          currentPrice: 60,
          avgPrice: 50,
          holdQty: 8,
          buyableAmount: 250,
          turn: 12.42,
          maxCycles: 40,
          cashRemaining: 250,
          mode: 'NORMAL',
          dailyBuyBudget: 6.25,
          dailyBuyBudgetCapped: 6.25,
          starPct: 5.4,
          starPrice: 61.2,
          buyLimitPrice: 55.4,
          sellLimitPrice: 61.2,
          reverseStarPrice: undefined,
        },
        signals: [
          {
            side: 'SELL',
            phase: 'v4-quarter-sell',
            quantity: 2,
            price: 61.2,
            orderDivision: '34',
            fillModel: 'loc',
            reason: 'V4 v4-quarter-sell: 2주 @ 61.2',
          },
        ],
        skipReasons: ['매수 수량 부족: 일일 매수 시도액 6.25으로 1주 매수 불가'],
        appliedQuotaOverride: undefined,
      });

      expect(mockTradingService.executePerStockStrategy).not.toHaveBeenCalled();
      expect(mockPrisma.watchStockExecutionLog.create).not.toHaveBeenCalled();
    });

    it('uses the WatchStock broker for preview risk and cash while market data remains direct KIS', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        ...buildV4WatchStockRow(),
        broker: Broker.TOSS,
      });
      mockKisOverseas.getPrice.mockResolvedValue({ currentPrice: 60 });
      mockTossPort.getOverseasBuyableAmount.mockResolvedValue({
        foreignCurrencyAvailable: 777,
        maxQuantity: 12,
      });
      mockPrisma.position.findMany.mockResolvedValueOnce([
        {
          broker: Broker.TOSS,
          stockCode: 'TQQQ',
          exchangeCode: 'NASD',
          quantity: 2,
          avgPrice: 50,
          currentPrice: 60,
          totalInvested: 100,
        },
      ]);
      const evaluateStock = jest.fn().mockResolvedValue({ signals: [], skipReasons: [] });
      mockStrategyRegistry.getStrategy.mockReturnValue({ name: 'infinite-buy-v4', evaluateStock });

      const result = await orchestrator.previewWatchStockExecution('ws-1');

      expect(mockRiskManagement.evaluateRisk).toHaveBeenCalledWith(Broker.TOSS, 'OVERSEAS');
      expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
        where: { broker: Broker.TOSS, market: 'OVERSEAS' },
      });
      expect(mockTossPort.getOverseasBuyableAmount).toHaveBeenCalledWith('NASD', 'TQQQ', 60);
      expect(mockKisOverseas.getPrice).toHaveBeenCalledWith('NASD', 'TQQQ');
      expect(evaluateStock.mock.calls[0][0].buyableMeta.source).toBe('TOSS_OVERSEAS_BUYABLE_AMOUNT');
      expect(result.context.buyableAmount).toBe(777);
    });

    it('트레이딩이 비활성화된 환경(TRADING_ENABLED=false)에서도 미리보기는 동작한다', async () => {
      mockConfigService.get.mockImplementation(
        ((key: string) => (key === 'trading.enabled' ? false : undefined)) as typeof mockConfigService.get,
      );
      mockPrisma.watchStock.findUnique.mockResolvedValue(buildV4WatchStockRow());
      const evaluateStock = jest.fn().mockResolvedValue({ signals: [], skipReasons: ['오늘 이미 실행됨'] });
      mockStrategyRegistry.getStrategy.mockReturnValue({ name: 'infinite-buy-v4', evaluateStock });
      const orchestratorWithTradingDisabled = new TradingOrchestrator(
        mockTradingService as any,
        mockMarketAnalysis as any,
        mockMarketRegimeService as any,
        mockRiskManagement as any,
        mockOrderSyncService as any,
        mockStrategyRegistry as any,
        mockMarketStateSync as any,
        mockKisDomestic as any,
        mockKisOverseas as any,
        mockRegistry as any,
        mockPrisma as any,
        mockConfigService as any,
        mockMarketDataCache as any,
        mockSlackService as any,
        mockSlackCommandsService as any,
      );

      const result = await orchestratorWithTradingDisabled.previewWatchStockExecution('ws-1');

      expect(result.skipReasons).toEqual(['오늘 이미 실행됨']);
      expect(mockTradingService.executePerStockStrategy).not.toHaveBeenCalled();
    });

    it('관심종목을 찾을 수 없으면 BadRequestException을 던진다', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue(null);

      await expect(orchestrator.previewWatchStockExecution('missing')).rejects.toThrow(
        '관심종목을 찾을 수 없습니다.',
      );
    });

    it('전략이 설정되지 않은 관심종목이면 BadRequestException을 던진다', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({ ...buildV4WatchStockRow(), strategyName: null });

      await expect(orchestrator.previewWatchStockExecution('ws-1')).rejects.toThrow(
        '전략이 설정되지 않은 관심종목입니다.',
      );
    });

    it('알 수 없는 전략이면 BadRequestException을 던진다', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({ ...buildV4WatchStockRow(), strategyName: 'ghost-strategy' });
      mockStrategyRegistry.getStrategy.mockReturnValue(undefined);

      await expect(orchestrator.previewWatchStockExecution('ws-1')).rejects.toThrow(
        '알 수 없는 전략입니다: ghost-strategy',
      );
    });

    it('가정 원금(quotaOverride) 적용 시 quota와 장부 잔금을 증감분만큼 조정한 가상 사본으로 평가하고 DB는 안 건드린다', async () => {
      // 저장값 quota 10000 / cashRemaining 250 → 가정 16000이면 delta +6000 → 가상 잔금 6250
      mockPrisma.watchStock.findUnique.mockResolvedValue(buildV4WatchStockRow());
      mockKisOverseas.getPrice.mockResolvedValue({ currentPrice: 60 });
      mockKisOverseas.getBuyableAmount.mockResolvedValue({ foreignCurrencyAvailable: 3000, maxQuantity: 50 });
      mockPrisma.position.findMany.mockResolvedValueOnce([
        { broker: Broker.KIS, stockCode: 'TQQQ', exchangeCode: 'NASD', quantity: 8, avgPrice: 50, currentPrice: 60, totalInvested: 400 },
      ]);
      const evaluateStock = jest.fn().mockResolvedValue({ signals: [], skipReasons: [], details: {} });
      mockStrategyRegistry.getStrategy.mockReturnValue({ name: 'infinite-buy-v4', evaluateStock });

      const result = await orchestrator.previewWatchStockExecution('ws-1', 16000);

      const passedContext = evaluateStock.mock.calls[0][0];
      expect(passedContext.watchStock.quota).toBe(16000);
      expect(passedContext.watchStock.strategyParams.v4.cashRemaining).toBe(6250);
      // 저장값은 그대로여야 함 (가상 사본만 조정)
      expect(passedContext.watchStock.strategyParams.v4.turn).toBe(12.42);
      expect(result.appliedQuotaOverride).toBe(16000);
      expect(mockTradingService.executePerStockStrategy).not.toHaveBeenCalled();
      expect(mockPrisma.watchStockExecutionLog.create).not.toHaveBeenCalled();
    });

    it('가정 원금이 너무 낮아 장부 잔금이 음수가 되면 거부한다', async () => {
      // quota 10000 / cashRemaining 250 → 가정 9000이면 delta -1000 → 250-1000 = -750 < 0
      mockPrisma.watchStock.findUnique.mockResolvedValue(buildV4WatchStockRow());
      mockStrategyRegistry.getStrategy.mockReturnValue({ name: 'infinite-buy-v4', evaluateStock: jest.fn() });

      await expect(orchestrator.previewWatchStockExecution('ws-1', 9000)).rejects.toThrow(
        '장부 잔금이 음수가 됩니다',
      );
    });

    it('가정 원금이 장부 잔금 범위 내 감액이면 허용한다', async () => {
      // cashRemaining 250 → 가정 9800이면 delta -200 → 잔금 50 (>= 0)
      mockPrisma.watchStock.findUnique.mockResolvedValue(buildV4WatchStockRow());
      mockKisOverseas.getPrice.mockResolvedValue({ currentPrice: 60 });
      mockKisOverseas.getBuyableAmount.mockResolvedValue({ foreignCurrencyAvailable: 3000, maxQuantity: 50 });
      mockPrisma.position.findMany.mockResolvedValueOnce([]);
      const evaluateStock = jest.fn().mockResolvedValue({ signals: [], skipReasons: [], details: {} });
      mockStrategyRegistry.getStrategy.mockReturnValue({ name: 'infinite-buy-v4', evaluateStock });

      const result = await orchestrator.previewWatchStockExecution('ws-1', 9800);

      expect(evaluateStock.mock.calls[0][0].watchStock.strategyParams.v4.cashRemaining).toBe(50);
      expect(result.appliedQuotaOverride).toBe(9800);
    });

    it('가정 원금은 infinite-buy-v4 종목만 지원한다', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({ ...buildV4WatchStockRow(), strategyName: 'infinite-buy' });
      mockStrategyRegistry.getStrategy.mockReturnValue({ name: 'infinite-buy', evaluateStock: jest.fn() });

      await expect(orchestrator.previewWatchStockExecution('ws-1', 16000)).rejects.toThrow(
        '가정 원금 미리보기는 무한매수 V4 종목만 지원합니다.',
      );
    });

    it('가정 원금이 0 이하면 거부한다', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue(buildV4WatchStockRow());
      mockStrategyRegistry.getStrategy.mockReturnValue({ name: 'infinite-buy-v4', evaluateStock: jest.fn() });

      await expect(orchestrator.previewWatchStockExecution('ws-1', 0)).rejects.toThrow(
        '가정 원금은 0보다 커야 합니다.',
      );
    });
  });
});
