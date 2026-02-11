import { Test, TestingModule } from '@nestjs/testing';
import { RiskManagementService } from './risk-management.service';
import { PrismaService } from '../prisma.service';

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

      const result = await service.evaluateRisk('DOMESTIC');

      expect(result.buyBlocked).toBe(false);
      expect(result.liquidateAll).toBe(false);
      expect(result.positionCount).toBe(0);
      expect(result.reasons).toHaveLength(0);
    });

    it('should block buy when position count >= 6', async () => {
      const positions = Array.from({ length: 6 }, (_, i) => ({
        id: `pos-${i}`,
        market: 'DOMESTIC',
        stockCode: `00000${i}`,
        quantity: 10,
        avgPrice: { toString: () => '100' },
        currentPrice: { toString: () => '100' },
      }));

      mockPrisma.position.findMany.mockResolvedValue(positions);
      mockPrisma.riskSnapshot.findFirst.mockResolvedValue(null);

      const result = await service.evaluateRisk('DOMESTIC');

      expect(result.buyBlocked).toBe(true);
      expect(result.positionCount).toBe(6);
      expect(result.reasons).toContainEqual(expect.stringContaining('보유 종목 6개'));
    });

    it('should block buy when invested rate >= 80%', async () => {
      // Single large position
      const positions = [
        {
          id: 'pos-1',
          market: 'DOMESTIC',
          stockCode: '005930',
          quantity: 100,
          avgPrice: { toString: () => '1000' },
          currentPrice: { toString: () => '1000' },
        },
      ];

      // Snapshot showing small total value (so investedRate > 80%)
      const snapshot = {
        portfolioValue: { toString: () => '100000' },
        cashBalance: { toString: () => '10000' },
        peakValue: { toString: () => '110000' },
      };

      mockPrisma.position.findMany.mockResolvedValue(positions);
      mockPrisma.riskSnapshot.findFirst.mockResolvedValue(snapshot);

      const result = await service.evaluateRisk('DOMESTIC');

      // currentValue = 100 * 1000 = 100000
      // totalValue = 100000 + 10000 = 110000
      // investedRate = 100000 / 110000 = 0.909 >= 0.8
      expect(result.buyBlocked).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('투자비중'));
    });

    it('should block buy when daily loss <= -2%', async () => {
      const positions = [
        {
          id: 'pos-1',
          market: 'DOMESTIC',
          stockCode: '005930',
          quantity: 100,
          avgPrice: { toString: () => '1000' },
          currentPrice: { toString: () => '970' }, // -3%
        },
      ];

      mockPrisma.position.findMany.mockResolvedValue(positions);
      mockPrisma.riskSnapshot.findFirst.mockResolvedValue(null);

      const result = await service.evaluateRisk('DOMESTIC');

      // totalInvested = 100 * 1000 = 100000
      // totalCurrentValue = 100 * 970 = 97000
      // dailyPnl = 97000 - 100000 = -3000
      // dailyPnlRate = -3000 / 100000 = -0.03 <= -0.02
      expect(result.buyBlocked).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('일일 손실'));
    });

    it('should block buy when MDD <= -10%', async () => {
      const positions = [
        {
          id: 'pos-1',
          market: 'DOMESTIC',
          stockCode: '005930',
          quantity: 100,
          avgPrice: { toString: () => '1000' },
          currentPrice: { toString: () => '890' },
        },
      ];

      const snapshot = {
        portfolioValue: { toString: () => '100000' },
        cashBalance: { toString: () => '50000' },
        peakValue: { toString: () => '100000' }, // peak was 100000
      };

      mockPrisma.position.findMany.mockResolvedValue(positions);
      mockPrisma.riskSnapshot.findFirst.mockResolvedValue(snapshot);

      const result = await service.evaluateRisk('DOMESTIC');

      // currentValue = 100 * 890 = 89000
      // peakValue = max(100000, 89000) = 100000
      // drawdown = (89000 - 100000) / 100000 = -0.11 <= -0.10
      expect(result.buyBlocked).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('MDD'));
    });

    it('should signal liquidateAll when MDD <= -15%', async () => {
      const positions = [
        {
          id: 'pos-1',
          market: 'DOMESTIC',
          stockCode: '005930',
          quantity: 100,
          avgPrice: { toString: () => '1000' },
          currentPrice: { toString: () => '840' },
        },
      ];

      const snapshot = {
        portfolioValue: { toString: () => '100000' },
        cashBalance: { toString: () => '50000' },
        peakValue: { toString: () => '100000' },
      };

      mockPrisma.position.findMany.mockResolvedValue(positions);
      mockPrisma.riskSnapshot.findFirst.mockResolvedValue(snapshot);

      const result = await service.evaluateRisk('DOMESTIC');

      // currentValue = 100 * 840 = 84000
      // drawdown = (84000 - 100000) / 100000 = -0.16 <= -0.15
      expect(result.liquidateAll).toBe(true);
      expect(result.reasons).toContainEqual(expect.stringContaining('전량 청산'));
    });
  });

  describe('checkSingleStockLimit', () => {
    it('should return false when under 15% limit', () => {
      expect(service.checkSingleStockLimit(1000, 10000)).toBe(false); // 10%
    });

    it('should return true when over 15% limit', () => {
      expect(service.checkSingleStockLimit(2000, 10000)).toBe(true); // 20%
    });

    it('should return false when exactly 15%', () => {
      expect(service.checkSingleStockLimit(1500, 10000)).toBe(false); // 15% (not > 15%)
    });

    it('should return false when portfolio value is 0', () => {
      expect(service.checkSingleStockLimit(1000, 0)).toBe(false);
    });

    it('should return false when portfolio value is negative', () => {
      expect(service.checkSingleStockLimit(1000, -100)).toBe(false);
    });
  });
});
