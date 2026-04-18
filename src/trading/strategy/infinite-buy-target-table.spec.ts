import {
  INFINITE_BUY_TARGET_TABLE,
  lookupTargetProfitRate,
  lookupSecondaryBonusRate,
} from './infinite-buy-target-table';

describe('infinite-buy-target-table', () => {
  describe('default table', () => {
    it.each([
      [0, 0.170],
      [1, 0.170],
      [1.9, 0.170],
      [2, 0.150],
      [3.5, 0.150],
      [4, 0.135],
      [9, 0.110],
      [11.5, 0.100],
      [15.5, 0.090],
      [19.9, 0.080],
      [20, 0.077],
      [27.9, 0.074],
      [31.5, 0.072],
      [35.9, 0.070],
      [39.9, 0.068],
      [40, 0.050], // 완주 후 (P2)
      [50, 0.050],
    ])('T=%s → primary target %d', (T, expected) => {
      expect(lookupTargetProfitRate(T)).toBeCloseTo(expected, 4);
    });

    it.each([
      [0, 0.030],
      [3, 0.030],
      [4, 0.026],
      [10, 0.022],
      [15, 0.018],
      [20, 0.014],
      [28, 0.011],
      [40, 0.011],
    ])('T=%s → secondary bonus %d', (T, expected) => {
      expect(lookupSecondaryBonusRate(T)).toBeCloseTo(expected, 4);
    });
  });

  describe('override table', () => {
    it('uses override when provided', () => {
      const override = [
        { maxT: 10, primary: 0.20, bonus: 0.05 },
        { maxT: Infinity, primary: 0.10, bonus: 0.02 },
      ];
      expect(lookupTargetProfitRate(5, override)).toBe(0.20);
      expect(lookupTargetProfitRate(15, override)).toBe(0.10);
      expect(lookupSecondaryBonusRate(5, override)).toBe(0.05);
    });

    it('falls back to default when override is empty', () => {
      expect(lookupTargetProfitRate(5, [])).toBe(INFINITE_BUY_TARGET_TABLE[2].primary);
    });
  });
});
