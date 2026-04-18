import { bollinger, computeIndicators, OHLCV, rsi, sma, annualizedVolatility } from './indicator-calculator';

function makeBars(closes: number[]): OHLCV[] {
  return closes.map((c, i) => ({
    date: `2020-01-${String(i + 1).padStart(2, '0')}`,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1_000_000,
  }));
}

describe('indicator-calculator', () => {
  describe('sma', () => {
    it('returns undefined before enough data', () => {
      const values = [1, 2, 3];
      expect(sma(values, 1, 3)).toBeUndefined();
    });
    it('computes moving average', () => {
      const values = [10, 20, 30, 40, 50];
      expect(sma(values, 4, 3)).toBe(40); // (30+40+50)/3
      expect(sma(values, 2, 3)).toBe(20);
    });
  });

  describe('rsi', () => {
    it('returns undefined when data too short', () => {
      expect(rsi([1, 2, 3], 2, 14)).toBeUndefined();
    });
    it('returns 100 when only gains', () => {
      const values = Array.from({ length: 20 }, (_, i) => 100 + i);
      expect(rsi(values, 19, 14)).toBe(100);
    });
    it('computes RSI in valid range for mixed series', () => {
      const values = [44, 47, 46, 44, 44, 42, 43, 40, 42, 45, 48, 46, 45, 47, 49, 50];
      const r = rsi(values, 15, 14);
      expect(r).toBeDefined();
      expect(r!).toBeGreaterThan(0);
      expect(r!).toBeLessThan(100);
    });
  });

  describe('bollinger', () => {
    it('returns band structure', () => {
      const values = Array.from({ length: 25 }, (_, i) => 100 + (i % 3));
      const bb = bollinger(values, 24, 20, 2);
      expect(bb).toBeDefined();
      expect(bb!.upper).toBeGreaterThan(bb!.middle);
      expect(bb!.lower).toBeLessThan(bb!.middle);
    });
  });

  describe('annualizedVolatility', () => {
    it('returns annualized volatility as percent', () => {
      // Series with simple up moves → low-ish volatility
      const values = Array.from({ length: 35 }, (_, i) => 100 * 1.001 ** i);
      const v = annualizedVolatility(values, 34, 30);
      expect(v).toBeDefined();
      expect(v!).toBeGreaterThanOrEqual(0);
    });
  });

  describe('computeIndicators', () => {
    it('computes full bundle when sufficient data', () => {
      const closes = Array.from({ length: 210 }, (_, i) => 100 + Math.sin(i / 5) * 10);
      const bars = makeBars(closes);
      const r = computeIndicators(bars, 209);
      expect(r.ma20).toBeDefined();
      expect(r.ma60).toBeDefined();
      expect(r.ma200).toBeDefined();
      expect(r.rsi14).toBeDefined();
      expect(r.bollingerMiddle).toBeDefined();
      expect(r.atr14).toBeDefined();
      expect(r.atrPercent).toBeDefined();
      expect(r.adx14).toBeDefined();
      expect(r.volatility30d).toBeDefined();
    });
    it('returns partial bundle when short', () => {
      const bars = makeBars([100, 101, 102, 103]);
      const r = computeIndicators(bars, 3);
      expect(r.ma20).toBeUndefined();
      expect(r.rsi14).toBeUndefined();
      expect(r.atr14).toBeUndefined();
    });
  });
});
