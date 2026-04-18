import { SimulationTradeStatus } from '@prisma/client';
import { SimulationService } from './simulation.service';
import { SimulationSessionManager } from './simulation-session-manager.service';
import { SimulationPositionService } from './simulation-position.service';
import { SimulationMetricsService } from './simulation-metrics.service';
import { SimulationTickEngine } from './simulation-tick-engine.service';

describe('SimulationService', () => {
  let service: SimulationService;
  let sessionManager: SimulationSessionManager;
  let positionService: SimulationPositionService;
  let metricsService: SimulationMetricsService;
  let tickEngine: SimulationTickEngine;

  const mockPrisma = {
    simulationSession: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    simulationPosition: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
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

  const mockKisOverseas = {
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

    sessionManager = new SimulationSessionManager(mockPrisma as any);
    positionService = new SimulationPositionService(
      mockPrisma as any,
      mockKisDomestic as any,
      mockKisOverseas as any,
    );
    metricsService = new SimulationMetricsService(mockPrisma as any);
    tickEngine = new SimulationTickEngine(
      mockPrisma as any,
      mockStrategyRegistry as any,
      mockMarketAnalysis as any,
      mockMarketRegimeService as any,
      mockKisDomestic as any,
      mockKisOverseas as any,
      mockMarketDataCache as any,
      sessionManager,
      positionService,
      metricsService,
    );
    service = new SimulationService(sessionManager, positionService, metricsService, tickEngine);
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
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        strategyName: 'momentum-breakout',
        quota: 10000,
        currentCash: 7000,
        maxCycles: 40,
        strategyParams: null,
      });
      mockPrisma.simulationSession.update.mockResolvedValue({ id: 'session-1' });

      await service.updateSettings('session-1', {
        name: '  새 이름  ',
        quota: 12000,
        stopLossRate: 0.2,
        maxCycles: 50,
      });

      expect(mockPrisma.simulationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({
          name: '새 이름',
          quota: expect.anything(),
          currentCash: expect.anything(),
          maxCycles: 50,
        }),
        include: { positions: true },
      });
    });

    it('should rebase infinite-buy cycle and accumulated quota when quota changes', async () => {
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-2',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        strategyName: 'infinite-buy',
        quota: 4000000,
        currentCash: 2500000,
        maxCycles: 40,
        strategyParams: {
          accumulatedQuota: 200000,
          custom: true,
        },
      });
      mockPrisma.simulationPosition.findFirst.mockResolvedValue({
        totalInvested: 1500000,
      });
      mockPrisma.simulationSession.update.mockResolvedValue({ id: 'session-2' });

      await service.updateSettings('session-2', {
        quota: 8000000,
      });

      expect(mockPrisma.simulationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-2' },
        data: expect.objectContaining({
          quota: expect.anything(),
          currentCash: expect.anything(),
          cycle: 7,
          strategyParams: {
            accumulatedQuota: 400000,
            custom: true,
          },
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

    it('should use KST date for overnight overseas sessions', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-09T16:30:00Z'));

      // TickEngine의 내부 KST 날짜 산정이 여전히 동일하게 동작하는지 검증
      expect((tickEngine as any).getTodayDate()).toBe('2026-04-10');

      const range = (tickEngine as any).getDayRange('2026-04-10');
      expect(range.gte.toISOString()).toBe('2026-04-09T15:00:00.000Z');
      expect(range.lt.toISOString()).toBe('2026-04-10T14:59:59.999Z');

      jest.useRealTimers();
    });
  });

  describe('execution timing', () => {
    it('should skip once-daily strategy outside configured domestic time', async () => {
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
      jest.spyOn(tickEngine as any, 'getKSTTime').mockReturnValue({ hour: 10, minute: 1 });

      await service.executeSimulationTick('session-1');

      expect(mockPrisma.simulationPosition.findMany).not.toHaveBeenCalled();
      expect(mockKisDomestic.getPrice).not.toHaveBeenCalled();
    });

    it('should execute once-daily strategy at configured domestic time', async () => {
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
      jest.spyOn(tickEngine as any, 'getKSTTime').mockReturnValue({ hour: 10, minute: 0 });
      jest.spyOn(metricsService, 'evaluateSimulationRisk').mockResolvedValue(undefined as any);
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70000 });

      await service.executeSimulationTick('session-1');

      expect(mockPrisma.simulationPosition.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1' },
      });
      expect(mockKisDomestic.getPrice).toHaveBeenCalledWith('005930');
    });

    it('should skip overseas once-daily strategy before configured minute in the same hour', async () => {
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-1',
        status: 'RUNNING',
        strategyName: 'infinite-buy',
        market: 'OVERSEAS',
        exchangeCode: 'AMEX',
      });
      mockStrategyRegistry.getStrategy.mockReturnValue({
        executionMode: {
          type: 'once-daily',
          hours: {
            domestic: 11,
            overseas: { basis: 'afterOpen', offsetHours: 2 },
          },
        },
        evaluateStock: jest.fn().mockResolvedValue({ signals: [], skipReasons: [] }),
      });
      jest.spyOn(tickEngine as any, 'getKSTTime').mockReturnValue({ hour: 0, minute: 29 });

      await service.executeSimulationTick('session-1');

      expect(mockPrisma.simulationPosition.findMany).not.toHaveBeenCalled();
      expect(mockKisOverseas.getPrice).not.toHaveBeenCalled();
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
      jest.spyOn(tickEngine as any, 'getKSTTime').mockReturnValue({ hour: 10, minute: 0 });
      jest.spyOn(metricsService, 'evaluateSimulationRisk').mockResolvedValue(undefined as any);
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70000 });

      await service.executeSimulationTick('session-1');

      expect(mockPrisma.simulationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          strategyParams: expect.objectContaining({
            accumulatedQuota: 2500,
            lastAccumulatedDate: expect.any(String),
            lastExecutionStatus: expect.stringContaining('오늘 이월 2500'),
          }),
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
      jest.spyOn(tickEngine as any, 'getKSTTime').mockReturnValue({ hour: 10, minute: 0 });
      jest.spyOn(metricsService, 'evaluateSimulationRisk').mockResolvedValue(undefined as any);
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70000 });

      await service.executeSimulationTick('session-2');

      const accumulatedQuotaUpdate = mockPrisma.simulationSession.update.mock.calls.find(
        ([arg]: any[]) => arg?.where?.id === 'session-2' && arg?.data?.strategyParams?.accumulatedQuota !== undefined,
      );
      expect(accumulatedQuotaUpdate).toBeUndefined();
    });

    it('should cap accumulated quota at remaining quota', async () => {
      mockPrisma.simulationSession.findUnique.mockResolvedValue({
        id: 'session-3',
        status: 'RUNNING',
        strategyName: 'infinite-buy',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        quota: 100000,
        maxCycles: 40,
        currentCash: 100000,
        strategyParams: {
          accumulatedQuota: 95000,
        },
      });
      mockPrisma.simulationPosition.findMany.mockResolvedValue([
        {
          stockCode: '005930',
          quantity: 1,
          avgPrice: 5000,
          currentPrice: 5000,
          totalInvested: 98000,
        },
      ]);
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
          skipReasons: ['매수 수량 부족: 주문가능금액 0으로 1주 매수 불가'],
        }),
      });
      jest.spyOn(tickEngine as any, 'getKSTTime').mockReturnValue({ hour: 10, minute: 0 });
      jest.spyOn(metricsService, 'evaluateSimulationRisk').mockResolvedValue(undefined as any);
      mockKisDomestic.getPrice.mockResolvedValue({ currentPrice: 70000 });

      await service.executeSimulationTick('session-3');

      expect(mockPrisma.simulationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-3' },
        data: {
          strategyParams: expect.objectContaining({
            accumulatedQuota: 2000,
            lastAccumulatedDate: expect.any(String),
          }),
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
      jest.spyOn(tickEngine, 'checkPendingOrders').mockResolvedValue();
      jest.spyOn(tickEngine, 'getPendingOrderCount').mockReturnValue(1);

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
      jest.spyOn(tickEngine, 'checkPendingOrders').mockResolvedValue();
      jest.spyOn(tickEngine, 'getPendingOrderCount').mockReturnValue(0);
      mockPrisma.simulationTrade.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      const executeSpy = jest.spyOn(tickEngine, 'executeSimulationTick').mockResolvedValue();

      const result = await service.triggerSessionNow('session-1');

      expect(executeSpy).toHaveBeenCalledWith('session-1', { forceExecution: true });
      expect(result.success).toBe(true);
    });
  });
});
