import { Test, TestingModule } from '@nestjs/testing';
import { MarketRegimeService } from './market-regime.service';
import { MarketAnalysisService } from './market-analysis.service';
import { PrismaService } from '../prisma.service';

describe('MarketRegimeService', () => {
  let service: MarketRegimeService;

  const mockMarketAnalysis = {
    fetchIndexDailyPrices: jest.fn(),
    calculateMA: jest.fn(),
    calculateADX: jest.fn(),
  };

  const mockPrisma = {
    marketRegimeSnapshot: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketRegimeService,
        { provide: MarketAnalysisService, useValue: mockMarketAnalysis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MarketRegimeService>(MarketRegimeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRegime', () => {
    it('should return SIDEWAYS for unknown exchange code', async () => {
      const result = await service.getRegime('DOMESTIC', 'UNKNOWN');
      expect(result).toBe('SIDEWAYS');
    });

    it('should return TRENDING_UP when ADX > 25, MA20 > MA60, price > MA60', async () => {
      const prices = generateMockPrices(200);
      // Ensure closes[0] > MA60 (we'll set MA60 = 90)
      mockMarketAnalysis.fetchIndexDailyPrices.mockResolvedValue(prices);
      mockMarketAnalysis.calculateMA.mockImplementation((_closes: number[], period: number) => {
        if (period === 20) return 110; // MA20
        if (period === 60) return 90;  // MA60 — indexPrice ~100 > 90
        return 0;
      });
      mockMarketAnalysis.calculateADX.mockReturnValue(30); // > 25
      mockPrisma.marketRegimeSnapshot.create.mockResolvedValue({});

      const result = await service.getRegime('DOMESTIC', 'KRX');

      // indexPrice = closes[0] ~100 > MA60=90, MA20=110 > MA60=90, ADX=30 > 25
      expect(result).toBe('TRENDING_UP');
    });

    it('should return TRENDING_DOWN when ADX > 25, MA20 < MA60, price < MA60', async () => {
      const prices = generateMockPrices(200);
      // Make closes[0] low
      prices[0] = Object.assign({}, prices[0], { close: 80 });
      mockMarketAnalysis.fetchIndexDailyPrices.mockResolvedValue(prices);
      mockMarketAnalysis.calculateMA.mockImplementation((_closes: number[], period: number) => {
        if (period === 20) return 90;  // MA20 < MA60
        if (period === 60) return 100; // MA60
        return 0;
      });
      mockMarketAnalysis.calculateADX.mockReturnValue(30);
      mockPrisma.marketRegimeSnapshot.create.mockResolvedValue({});

      const result = await service.getRegime('DOMESTIC', 'KRX');
      expect(result).toBe('TRENDING_DOWN');
    });

    it('should return SIDEWAYS when ADX <= 25', async () => {
      const prices = generateMockPrices(200);
      mockMarketAnalysis.fetchIndexDailyPrices.mockResolvedValue(prices);
      mockMarketAnalysis.calculateMA.mockImplementation((_closes: number[], period: number) => {
        if (period === 20) return 110;
        if (period === 60) return 100;
        return 0;
      });
      mockMarketAnalysis.calculateADX.mockReturnValue(20); // <= 25
      mockPrisma.marketRegimeSnapshot.create.mockResolvedValue({});

      const result = await service.getRegime('DOMESTIC', 'KRX');
      expect(result).toBe('SIDEWAYS');
    });

    it('should return SIDEWAYS when insufficient data', async () => {
      mockMarketAnalysis.fetchIndexDailyPrices.mockResolvedValue(
        generateMockPrices(30), // < 60
      );
      mockPrisma.marketRegimeSnapshot.create.mockResolvedValue({});

      const result = await service.getRegime('DOMESTIC', 'KRX');
      expect(result).toBe('SIDEWAYS');
    });

    it('should use cache for second call', async () => {
      const prices = generateMockPrices(200);
      mockMarketAnalysis.fetchIndexDailyPrices.mockResolvedValue(prices);
      mockMarketAnalysis.calculateMA.mockReturnValue(100);
      mockMarketAnalysis.calculateADX.mockReturnValue(20);
      mockPrisma.marketRegimeSnapshot.create.mockResolvedValue({});

      await service.getRegime('DOMESTIC', 'KRX');
      await service.getRegime('DOMESTIC', 'KRX');

      expect(mockMarketAnalysis.fetchIndexDailyPrices).toHaveBeenCalledTimes(1);
    });

    it('should return SIDEWAYS on API error', async () => {
      mockMarketAnalysis.fetchIndexDailyPrices.mockRejectedValue(new Error('API error'));

      const result = await service.getRegime('DOMESTIC', 'KRX');
      expect(result).toBe('SIDEWAYS');
    });
  });

  describe('detectAndSave', () => {
    it('should detect regime and update cache', async () => {
      const prices = generateMockPrices(200);
      mockMarketAnalysis.fetchIndexDailyPrices.mockResolvedValue(prices);
      mockMarketAnalysis.calculateMA.mockReturnValue(100);
      mockMarketAnalysis.calculateADX.mockReturnValue(20);
      mockPrisma.marketRegimeSnapshot.create.mockResolvedValue({});

      const result = await service.detectAndSave('DOMESTIC', 'KRX');
      expect(result).toBe('SIDEWAYS');

      // Subsequent getRegime should use updated cache
      const cached = await service.getRegime('DOMESTIC', 'KRX');
      expect(cached).toBe('SIDEWAYS');
      // fetchIndexDailyPrices called only once (for detectAndSave)
      expect(mockMarketAnalysis.fetchIndexDailyPrices).toHaveBeenCalledTimes(1);
    });
  });
});

interface MockPrice {
  date: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

function generateMockPrices(count: number): MockPrice[] {
  const prices: MockPrice[] = [];
  for (let i = 0; i < count; i++) {
    const base = 100 + Math.sin(i * 0.1) * 10;
    prices.push({
      date: `20260101`,
      close: base,
      open: base - 1,
      high: base + 3,
      low: base - 3,
      volume: 10000,
    });
  }
  return prices;
}
