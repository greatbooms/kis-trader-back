import { Test, TestingModule } from '@nestjs/testing';
import { RiskManagementService } from './risk-management.service';
import { PrismaService } from '../prisma.service';
import { Broker } from '@prisma/client';

describe('RiskManagementService', () => {
  let service: RiskManagementService;

  const mockPrisma = {
    position: {
      findMany: jest.fn(),
    },
    riskSnapshot: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskManagementService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<RiskManagementService>(RiskManagementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('evaluateRisk', () => {
    it('should return safe state when no positions and no snapshot', async () => {
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.riskSnapshot.findFirst.mockResolvedValue(null);

      const result = await service.evaluateRisk(Broker.KIS, 'DOMESTIC');

      expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
        where: { broker: Broker.KIS, market: 'DOMESTIC' },
      });
      expect(mockPrisma.riskSnapshot.findFirst).toHaveBeenCalledWith({
        where: { broker: Broker.KIS, market: 'DOMESTIC' },
        orderBy: { createdAt: 'desc' },
      });

      expect(result.buyBlocked).toBe(false);
      expect(result.liquidateAll).toBe(false);
      expect(result.positionCount).toBe(0);
      expect(result.investedRate).toBe(0);
      expect(result.dailyPnlRate).toBe(0);
      expect(result.drawdown).toBe(0);
      expect(result.reasons).toHaveLength(0);
    });

    it('should expose monitoring metrics without applying global risk blocks', async () => {
      const positions = Array.from({ length: 6 }, (_, i) => ({
        id: `pos-${i}`,
        market: 'DOMESTIC',
        stockCode: `00000${i}`,
        quantity: 10,
        avgPrice: { toString: () => '100' },
        currentPrice: { toString: () => '95' },
      }));

      const snapshot = {
        cashBalance: { toString: () => '4000' },
        peakValue: { toString: () => '7000' },
      };

      mockPrisma.position.findMany.mockResolvedValue(positions);
      mockPrisma.riskSnapshot.findFirst.mockResolvedValue(snapshot);

      const result = await service.evaluateRisk(Broker.TOSS, 'DOMESTIC');

      expect(result.buyBlocked).toBe(false);
      expect(result.liquidateAll).toBe(false);
      expect(result.positionCount).toBe(6);
      expect(result.investedRate).toBeCloseTo(5700 / 9700, 6);
      expect(result.dailyPnlRate).toBeCloseTo(-0.05, 6);
      expect(result.drawdown).toBeCloseTo((5700 - 7000) / 7000, 6);
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe('saveRiskSnapshot', () => {
    it('persists and calculates a snapshot only for the requested broker account', async () => {
      mockPrisma.riskSnapshot.findFirst.mockResolvedValue(null);
      mockPrisma.position.findMany.mockResolvedValue([{ broker: Broker.TOSS }]);
      mockPrisma.riskSnapshot.upsert.mockResolvedValue({});

      await service.saveRiskSnapshot(Broker.TOSS, 'OVERSEAS', 5000, 2000);

      expect(mockPrisma.riskSnapshot.findFirst).toHaveBeenCalledWith({
        where: { broker: Broker.TOSS, market: 'OVERSEAS' },
        orderBy: { createdAt: 'desc' },
      });
      expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
        where: { broker: Broker.TOSS, market: 'OVERSEAS' },
      });
      expect(mockPrisma.riskSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          broker_market_snapshotDate: expect.objectContaining({ broker: Broker.TOSS }),
        },
        create: expect.objectContaining({ broker: Broker.TOSS }),
      }));
    });
  });

  describe('checkSingleStockLimit', () => {
    it('should return false when under 15% limit', () => {
      expect(service.checkSingleStockLimit(1000, 10000)).toBe(false);
    });

    it('should return true when over 15% limit', () => {
      expect(service.checkSingleStockLimit(2000, 10000)).toBe(true);
    });

    it('should return false when exactly 15%', () => {
      expect(service.checkSingleStockLimit(1500, 10000)).toBe(false);
    });

    it('should return false when portfolio value is 0', () => {
      expect(service.checkSingleStockLimit(1000, 0)).toBe(false);
    });

    it('should return false when portfolio value is negative', () => {
      expect(service.checkSingleStockLimit(1000, -100)).toBe(false);
    });
  });
});
