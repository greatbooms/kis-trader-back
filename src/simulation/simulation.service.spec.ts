import { SimulationTradeStatus } from '@prisma/client';
import { SimulationService } from './simulation.service';

describe('SimulationService', () => {
  let service: SimulationService;

  const mockPrisma = {
    simulationSession: {
      update: jest.fn(),
    },
    simulationTrade: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    service = new SimulationService(
      mockPrisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
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

    it('should explain infinite-buy no-signal when index is below MA200', () => {
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

      expect(reason).toContain('S&P500 below MA200');
    });

    it('should prioritize already executed reason before strategy-specific diagnosis', () => {
      const reason = (service as any).describeNoSignalReason('daily-dca', {
        alreadyExecutedToday: true,
      });

      expect(reason).toBe('already executed today');
    });
  });
});
