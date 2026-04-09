import { SimulationTradeStatus } from '@prisma/client';
import { SimulationService } from './simulation.service';

describe('SimulationService', () => {
  let service: SimulationService;

  const mockPrisma = {
    simulationSession: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    simulationPosition: {
      findMany: jest.fn(),
    },
    simulationTrade: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockStrategyRegistry = {
    getStrategy: jest.fn(),
  };

  const mockMarketAnalysis = {
    getStockIndicators: jest.fn(),
    getMarketCondition: jest.fn(),
  };

  const mockMarketRegimeService = {
    getRegime: jest.fn(),
  };

  const mockKisDomestic = {
    getPrice: jest.fn(),
  };

  const mockMarketDataCache = {
    getOpenDartDomesticSignals: jest.fn(),
    getSecFundamentals: jest.fn(),
  };

  beforeEach(() => {
    mockMarketRegimeService.getRegime.mockResolvedValue(undefined);
    mockMarketAnalysis.getStockIndicators.mockResolvedValue({});
    mockMarketAnalysis.getMarketCondition.mockResolvedValue({});
    mockPrisma.simulationTrade.findFirst.mockResolvedValue(null);
    mockMarketDataCache.getOpenDartDomesticSignals.mockResolvedValue(undefined);
    mockMarketDataCache.getSecFundamentals.mockResolvedValue(undefined);

    service = new SimulationService(
      mockPrisma as any,
      mockStrategyRegistry as any,
      mockMarketAnalysis as any,
      mockMarketRegimeService as any,
      mockKisDomestic as any,
      {} as any,
      mockMarketDataCache as any,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTrades', () => {
    it('should pass tradeStatus filter to prisma when specified', async () => {
      mockPrisma.simulationTrade.findMany.mockResolvedValue([]);

      await service.getTrades('session-1', 20, 40, SimulationTradeStatus.FAILED);

      expect(mockPrisma.simulationTrade.findMany).toHaveBeenCalledWith({
        where: {
          sessionId: 'session-1',
          tradeStatus: SimulationTradeStatus.FAILED,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 40,
      });
    });

    it('should omit tradeStatus filter when not specified', async () => {
      mockPrisma.simulationTrade.findMany.mockResolvedValue([]);

      await service.getTrades('session-1', 20, 0);

      expect(mockPrisma.simulationTrade.findMany).toHaveBeenCalledWith({
        where: {
          sessionId: 'session-1',
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      });
    });
  });

  describe('updateSettings', () => {
    it('should persist editable simulation settings', async () => {
      mockPrisma.simulationSession.update.mockResolvedValue({ id: 'session-1' });

      await service.updateSettings('session-1', {
        name: '  새 이름  ',
        stopLossRate: 0.2,
        maxCycles: 50,
      });

      expect(mockPrisma.simulationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({
          name: '새 이름',
          maxCycles: 50,
        }),
        include: { positions: true },
      });
    });

    it('should reject invalid stop loss rates', async () => {
      await expect(
        service.updateSettings('session-1', { stopLossRate: 1 }),
      ).rejects.toThrow('손절률은 0% 이상 100% 미만이어야 합니다.');
    });
  });

  describe('cycle and diagnostics helpers', () => {
    it('should calculate fractional cycle progress from invested amount', () => {
      const cycle = service.calculateSessionCycle(
        { quota: 100000, maxCycles: 40 },
        { totalInvested: 3750 },
      );

      expect(cycle).toBe(1.5);
    });

    it('should not special-case infinite-buy no-signal reason for index below MA200', () => {
      const reason = (service as any).describeNoSignalReason('infinite-buy', {
        alreadyExecutedToday: false,
        watchStock: {
          quota: 100000,
          maxCycles: 40,
          stopLossRate: 0.3,
        },
        price: { currentPrice: 10000 },
        position: undefined,
        marketCondition: {
          referenceIndexAboveMA200: false,
          referenceIndexName: 'S&P500',
        },
        stockIndicators: {},
        buyableAmount: 100000,
      });

      expect(reason).toBe('strategy conditions not met');
    });

    it('should prioritize already executed reason before strategy-specific diagnosis', () => {
      const reason = (service as any).describeNoSignalReason('daily-dca', {
        alreadyExecutedToday: true,
      });

      expect(reason).toBe('already executed today');
    });

    it('should use KST date for overnight overseas sessions', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-09T16:30:00Z'));

      expect((service as any).getTodayDate()).toBe('2026-04-10');

      const range = (service as any).getDayRange('2026-04-10');
      expect(range.gte.toISOString()).toBe('2026-04-09T15:00:00.000Z');
      expect(range.lt.toISOString()).toBe('2026-04-10T14:59:59.999Z');

      jest.useRealTimers();
    });
  });

  describe('execution timing', () => {
    it('should skip once-daily strategy outside configured domestic hour', async () => {
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-1',
        status: 'RUNNING',
        strategyName: 'daily-dca',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
      });
      mockStrategyRegistry.getStrategy.mockReturnValue({
        executionMode: {
          type: 'once-daily',
          hours: {
            domestic: 10,
            overseas: { basis: 'beforeClose', offsetHours: 1 },
          },
        },
        evaluateStock: jest.fn().mockResolvedValue({ signals: [], skipReasons: [] }),
      });
      jest.spyOn(service as any, 'getKSTHour').mockReturnValue(9);

      await service.executeSimulationTick('session-1');

      expect(mockPrisma.simulationPosition.findMany).not.toHaveBeenCalled();
      expect(mockKisDomestic.getPrice).not.toHaveBeenCalled();
    });

    it('should execute once-daily strategy during configured domestic hour', async () => {
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-1',
        status: 'RUNNING',
        strategyName: 'daily-dca',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        currentCash: 100000,
      });
      mockPrisma.simulationPosition.findMany.mockResolvedValue([]);
      mockStrategyRegistry.getStrategy.mockReturnValue({
        executionMode: {
          type: 'once-daily',
          hours: {
            domestic: 10,
            overseas: { basis: 'beforeClose', offsetHours: 1 },
          },
        },
        evaluateStock: jest.fn().mockResolvedValue({ signals: [], skipReasons: [] }),
      });
      jest.spyOn(service as any, 'getKSTHour').mockReturnValue(10);
      jest.spyOn(service as any, 'evaluateSimulationRisk').mockResolvedValue(undefined);
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70000 });

      await service.executeSimulationTick('session-1');

      expect(mockPrisma.simulationPosition.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1' },
      });
      expect(mockKisDomestic.getPrice).toHaveBeenCalledWith('005930');
    });

    it('should accumulate quota only when no buy signal is caused by insufficient quantity', async () => {
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-1',
        status: 'RUNNING',
        strategyName: 'infinite-buy',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        quota: 100000,
        maxCycles: 40,
        currentCash: 100000,
        strategyParams: {},
      });
      mockPrisma.simulationPosition.findMany.mockResolvedValue([]);
      mockStrategyRegistry.getStrategy.mockReturnValue({
        executionMode: {
          type: 'once-daily',
          hours: {
            domestic: 10,
            overseas: { basis: 'beforeClose', offsetHours: 1 },
          },
        },
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [],
          skipReasons: ['매수 수량 부족: 조정 할당금 2500 < 현재가 70000'],
        }),
      });
      jest.spyOn(service as any, 'getKSTHour').mockReturnValue(10);
      jest.spyOn(service as any, 'evaluateSimulationRisk').mockResolvedValue(undefined);
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70000 });

      await service.executeSimulationTick('session-1');

      expect(mockPrisma.simulationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          strategyParams: {
            accumulatedQuota: 2500,
            lastAccumulatedDate: expect.any(String),
          },
        },
      });
    });

    it('should not accumulate quota when no buy signal comes from other skip reasons', async () => {
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-2',
        status: 'RUNNING',
        strategyName: 'infinite-buy',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        quota: 100000,
        maxCycles: 40,
        currentCash: 100000,
        strategyParams: {},
      });
      mockPrisma.simulationPosition.findMany.mockResolvedValue([]);
      mockStrategyRegistry.getStrategy.mockReturnValue({
        executionMode: {
          type: 'once-daily',
          hours: {
            domestic: 10,
            overseas: { basis: 'beforeClose', offsetHours: 1 },
          },
        },
        evaluateStock: jest.fn().mockResolvedValue({
          signals: [],
          skipReasons: ['투자유의 종목'],
        }),
      });
      jest.spyOn(service as any, 'getKSTHour').mockReturnValue(10);
      jest.spyOn(service as any, 'evaluateSimulationRisk').mockResolvedValue(undefined);
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70000 });

      await service.executeSimulationTick('session-2');

      expect(mockPrisma.simulationSession.update).not.toHaveBeenCalledWith({
        where: { id: 'session-2' },
        data: {
          strategyParams: {
            accumulatedQuota: expect.any(Number),
            lastAccumulatedDate: expect.any(String),
          },
        },
      });
    });
  });

  describe('manual trigger', () => {
    it('should block manual trigger when a pending order already exists', async () => {
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-1',
        status: 'RUNNING',
        stockCode: 'TQQQ',
      });
      jest.spyOn(service, 'checkPendingOrders').mockResolvedValue();
      jest.spyOn(service, 'getPendingOrderCount').mockReturnValue(1);

      const result = await service.triggerSessionNow('session-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('pending 주문');
    });

    it('should force one simulation tick when manual trigger is allowed', async () => {
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-1',
        status: 'RUNNING',
        stockCode: 'TQQQ',
      });
      jest.spyOn(service, 'checkPendingOrders').mockResolvedValue();
      jest.spyOn(service, 'getPendingOrderCount').mockReturnValue(0);
      mockPrisma.simulationTrade.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      const executeSpy = jest.spyOn(service, 'executeSimulationTick').mockResolvedValue();

      const result = await service.triggerSessionNow('session-1');

      expect(executeSpy).toHaveBeenCalledWith('session-1', { forceExecution: true });
      expect(result.success).toBe(true);
    });
  });
});
