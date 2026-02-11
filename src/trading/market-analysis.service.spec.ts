import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MarketAnalysisService } from './market-analysis.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';

describe('MarketAnalysisService', () => {
  let service: MarketAnalysisService;

  const mockKisDomestic = {
    getDailyPrices: jest.fn(),
    getIndexDailyPrices: jest.fn(),
    getInterestRates: jest.fn(),
  };

  const mockKisOverseas = {
    getDailyPrices: jest.fn(),
    getOverseasIndexDailyPrices: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'kis.env') return 'paper';
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketAnalysisService,
        { provide: KisDomesticService, useValue: mockKisDomestic },
        { provide: KisOverseasService, useValue: mockKisOverseas },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MarketAnalysisService>(MarketAnalysisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---- calculateMA ----
  describe('calculateMA', () => {
    it('should calculate simple moving average correctly', () => {
      const prices = [10, 20, 30, 40, 50];
      expect(service.calculateMA(prices, 3)).toBeCloseTo(20); // (10+20+30)/3
    });

    it('should calculate MA with period equal to array length', () => {
      const prices = [10, 20, 30];
      expect(service.calculateMA(prices, 3)).toBeCloseTo(20);
    });

    it('should return 0 when prices are fewer than period', () => {
      expect(service.calculateMA([10, 20], 5)).toBe(0);
    });

    it('should use only first N elements (most recent)', () => {
      const prices = [100, 200, 300, 400, 500]; // [0] is most recent
      expect(service.calculateMA(prices, 2)).toBeCloseTo(150); // (100+200)/2
    });
  });

  // ---- calculateRSI ----
  describe('calculateRSI', () => {
    it('should return 50 when not enough data', () => {
      expect(service.calculateRSI([10, 20], 14)).toBe(50);
    });

    it('should return 100 when all changes are positive (uptrend)', () => {
      // prices[0] is newest. Uptrend means newest > oldest.
      // So prices descending from newest to oldest: [290, 280, ..., 100]
      const prices: number[] = [];
      for (let i = 0; i < 20; i++) {
        prices.push(290 - i * 10); // [290, 280, ..., 100] newest first
      }
      // changes[i] = prices[i] - prices[i+1] = all positive (10)
      const rsi = service.calculateRSI(prices, 14);
      expect(rsi).toBe(100);
    });

    it('should return close to 0 when all changes are negative (downtrend)', () => {
      // Downtrend: newest is smallest
      const prices: number[] = [];
      for (let i = 0; i < 20; i++) {
        prices.push(100 + i * 10); // [100, 110, ..., 290] newest first (smallest first)
      }
      // changes[i] = prices[i] - prices[i+1] = all negative (-10)
      const rsi = service.calculateRSI(prices, 14);
      expect(rsi).toBeCloseTo(0, 0);
    });

    it('should return around 50 for mixed changes', () => {
      // Alternating up/down of same magnitude
      const prices: number[] = [];
      for (let i = 0; i < 30; i++) {
        prices.push(100 + (i % 2 === 0 ? 5 : -5));
      }
      const rsi = service.calculateRSI(prices, 14);
      expect(rsi).toBeGreaterThan(30);
      expect(rsi).toBeLessThan(70);
    });

    it('should handle period exactly matching data length', () => {
      const prices = [50, 48, 46, 44, 42, 40, 38, 36, 34, 32, 30, 28, 26, 24, 22];
      // 15 prices = period(14) + 1
      const rsi = service.calculateRSI(prices, 14);
      expect(rsi).toBeGreaterThanOrEqual(0);
      expect(rsi).toBeLessThanOrEqual(100);
    });
  });

  // ---- calculateEMA ----
  describe('calculateEMA', () => {
    it('should return empty array when prices < period', () => {
      expect(service.calculateEMA([10, 20], 5)).toEqual([]);
    });

    it('should return correct EMA values', () => {
      // Simple case: 5-period EMA
      const prices = [50, 45, 40, 35, 30, 25, 20]; // newest first
      const ema = service.calculateEMA(prices, 5);
      expect(ema.length).toBeGreaterThan(0);
      // First EMA should be SMA of the oldest 5 values
      // reversed: [20,25,30,35,40,45,50], SMA of first 5 = (20+25+30+35+40)/5 = 30
      // Then EMA for 45: (45-30)*2/6 + 30 = 35
      // Then EMA for 50: (50-35)*2/6 + 35 = 40
      expect(ema[ema.length - 1]).toBeCloseTo(30); // oldest EMA (SMA)
      expect(ema).toHaveLength(3);
    });

    it('should have newest value at index 0', () => {
      const prices = [100, 90, 80, 70, 60];
      const ema = service.calculateEMA(prices, 3);
      // The most recent EMA should reflect more recent prices
      expect(ema[0]).toBeGreaterThan(ema[ema.length - 1]);
    });
  });

  // ---- calculateBollingerBands ----
  describe('calculateBollingerBands', () => {
    it('should calculate Bollinger Bands correctly', () => {
      // 20 prices all equal to 100 → stdDev = 0
      const closes = Array(20).fill(100);
      const bb = service.calculateBollingerBands(closes, 20, 2);
      expect(bb.middle).toBeCloseTo(100);
      expect(bb.upper).toBeCloseTo(100);
      expect(bb.lower).toBeCloseTo(100);
    });

    it('should have upper > middle > lower for varied prices', () => {
      const closes: number[] = [];
      for (let i = 0; i < 20; i++) {
        closes.push(100 + Math.sin(i) * 10);
      }
      const bb = service.calculateBollingerBands(closes, 20, 2);
      expect(bb.upper).toBeGreaterThan(bb.middle);
      expect(bb.middle).toBeGreaterThan(bb.lower);
    });

    it('should widen with higher multiplier', () => {
      const closes: number[] = [];
      for (let i = 0; i < 20; i++) {
        closes.push(100 + i);
      }
      const bb2 = service.calculateBollingerBands(closes, 20, 2);
      const bb3 = service.calculateBollingerBands(closes, 20, 3);
      expect(bb3.upper - bb3.lower).toBeGreaterThan(bb2.upper - bb2.lower);
    });
  });

  // ---- calculateMACD ----
  describe('calculateMACD', () => {
    it('should return zeros for insufficient data', () => {
      const macd = service.calculateMACD([10, 20]);
      expect(macd.line).toBe(0);
      expect(macd.signal).toBe(0);
      expect(macd.histogram).toBe(0);
    });

    it('should calculate MACD for sufficient data', () => {
      // Generate 40 prices (enough for EMA26 + signal9)
      const closes: number[] = [];
      for (let i = 0; i < 40; i++) {
        closes.push(100 + i * 0.5);
      }
      const macd = service.calculateMACD(closes);
      expect(typeof macd.line).toBe('number');
      expect(typeof macd.signal).toBe('number');
      expect(typeof macd.histogram).toBe('number');
      expect(typeof macd.prevHistogram).toBe('number');
    });

    it('should have histogram = line - signal', () => {
      const closes: number[] = [];
      for (let i = 0; i < 50; i++) {
        closes.push(100 + Math.sin(i * 0.3) * 20);
      }
      const macd = service.calculateMACD(closes);
      expect(macd.histogram).toBeCloseTo(macd.line - macd.signal, 10);
    });
  });

  // ---- calculateADX ----
  describe('calculateADX', () => {
    it('should return 0 for insufficient data', () => {
      const adx = service.calculateADX([10], [5], [8], 14);
      expect(adx).toBe(0);
    });

    it('should return a value between 0 and 100', () => {
      const n = 50;
      const highs: number[] = [];
      const lows: number[] = [];
      const closes: number[] = [];
      for (let i = 0; i < n; i++) {
        const base = 100 + i * 2;
        highs.push(base + 5);
        lows.push(base - 5);
        closes.push(base);
      }
      const adx = service.calculateADX(highs, lows, closes, 14);
      expect(adx).toBeGreaterThanOrEqual(0);
      expect(adx).toBeLessThanOrEqual(100);
    });

    it('should return higher ADX for strong trend', () => {
      const n = 50;
      // Strong uptrend
      const trendHighs: number[] = [];
      const trendLows: number[] = [];
      const trendCloses: number[] = [];
      for (let i = 0; i < n; i++) {
        // newest first, strong uptrend
        const base = 200 - i * 3;
        trendHighs.push(base + 2);
        trendLows.push(base - 1);
        trendCloses.push(base);
      }

      // Sideways
      const sideHighs: number[] = [];
      const sideLows: number[] = [];
      const sideCloses: number[] = [];
      for (let i = 0; i < n; i++) {
        const base = 100 + Math.sin(i) * 2;
        sideHighs.push(base + 1);
        sideLows.push(base - 1);
        sideCloses.push(base);
      }

      const adxTrend = service.calculateADX(trendHighs, trendLows, trendCloses, 14);
      const adxSide = service.calculateADX(sideHighs, sideLows, sideCloses, 14);
      expect(adxTrend).toBeGreaterThan(adxSide);
    });
  });

  // ---- calculateAvgVolume ----
  describe('calculateAvgVolume', () => {
    it('should return 0 for insufficient data', () => {
      expect(service.calculateAvgVolume([100, 200], 5)).toBe(0);
    });

    it('should calculate average of first N volumes', () => {
      const volumes = [100, 200, 300, 400, 500];
      expect(service.calculateAvgVolume(volumes, 3)).toBeCloseTo(200); // (100+200+300)/3
    });
  });

  // ---- Cache ----
  describe('cache', () => {
    it('should set and get cache value', () => {
      service.setCache('test-key', { value: 42 });
      const result = service.getCache<{ value: number }>('test-key');
      expect(result).toEqual({ value: 42 });
    });

    it('should return null for missing key', () => {
      expect(service.getCache('nonexistent')).toBeNull();
    });

    it('should return null for expired cache', () => {
      service.setCache('expired-key', { value: 1 }, -1); // TTL = -1ms (already expired)
      const result = service.getCache('expired-key');
      expect(result).toBeNull();
    });
  });

  // ---- getStockIndicators ----
  describe('getStockIndicators', () => {
    it('should return default when insufficient price data', async () => {
      mockKisDomestic.getDailyPrices.mockResolvedValue([
        { date: '20260101', close: 100, open: 99, high: 101, low: 98, volume: 1000 },
      ]);

      const result = await service.getStockIndicators('DOMESTIC', 'KRX', '005930', 100);
      expect(result.currentAboveMA200).toBe(true);
    });

    it('should calculate all indicators for sufficient data', async () => {
      const prices = generateDailyPrices(200);
      mockKisDomestic.getDailyPrices.mockResolvedValue(prices);

      const result = await service.getStockIndicators('DOMESTIC', 'KRX', '005930', 100);

      expect(result.ma200).toBeDefined();
      expect(result.rsi14).toBeDefined();
      expect(result.ma20).toBeDefined();
      expect(result.ma60).toBeDefined();
      expect(result.bollingerUpper).toBeDefined();
      expect(result.bollingerMiddle).toBeDefined();
      expect(result.bollingerLower).toBeDefined();
      expect(result.macdLine).toBeDefined();
      expect(result.macdSignal).toBeDefined();
      expect(result.adx14).toBeDefined();
      expect(result.avgVolume20).toBeDefined();
      expect(result.volumeRatio).toBeDefined();
      expect(result.prevHigh).toBeDefined();
      expect(result.prevLow).toBeDefined();
      expect(result.prevClose).toBeDefined();
      expect(result.todayOpen).toBeDefined();
    });

    it('should use cache on second call', async () => {
      const prices = generateDailyPrices(200);
      mockKisDomestic.getDailyPrices.mockResolvedValue(prices);

      await service.getStockIndicators('DOMESTIC', 'KRX', '005930', 100);
      await service.getStockIndicators('DOMESTIC', 'KRX', '005930', 100);

      expect(mockKisDomestic.getDailyPrices).toHaveBeenCalledTimes(1);
    });

    it('should return default on error', async () => {
      mockKisDomestic.getDailyPrices.mockRejectedValue(new Error('API error'));

      const result = await service.getStockIndicators('DOMESTIC', 'KRX', '005930', 100);
      expect(result.currentAboveMA200).toBe(true);
    });

    it('should call overseas API for overseas market', async () => {
      const prices = generateDailyPrices(200);
      mockKisOverseas.getDailyPrices.mockResolvedValue(prices);

      await service.getStockIndicators('OVERSEAS', 'NASD', 'AAPL', 150);

      expect(mockKisOverseas.getDailyPrices).toHaveBeenCalledWith('NASD', 'AAPL', 200);
    });
  });
});

// Helper: generate mock daily price data
function generateDailyPrices(count: number): Array<{ date: string; close: number; open: number; high: number; low: number; volume: number }> {
  const prices: Array<{ date: string; close: number; open: number; high: number; low: number; volume: number }> = [];
  for (let i = 0; i < count; i++) {
    const base = 100 + Math.sin(i * 0.1) * 20;
    prices.push({
      date: `2026${String(Math.floor(i / 30) + 1).padStart(2, '0')}${String((i % 30) + 1).padStart(2, '0')}`,
      close: base,
      open: base - 1,
      high: base + 3,
      low: base - 3,
      volume: 10000 + i * 100,
    });
  }
  return prices;
}
