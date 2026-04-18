import { computeMetrics, BacktestTrade } from './metrics';

describe('computeMetrics', () => {
  it('computes zero return for flat series', () => {
    const values = [100, 100, 100, 100];
    const m = computeMetrics(values, [], 100);
    expect(m.totalReturn).toBe(0);
    expect(m.cagr).toBe(0);
    expect(m.maxDrawdown).toBe(0);
  });

  it('computes positive CAGR for doubling portfolio', () => {
    const values = Array.from({ length: 252 }, (_, i) => 100 * (1 + i / 252));
    const m = computeMetrics(values, [], 100);
    expect(m.totalReturn).toBeCloseTo((values[251] - 100) / 100, 3);
    expect(m.cagr).toBeGreaterThan(0);
  });

  it('detects max drawdown', () => {
    // 100 → 150 (peak) → 75 (-50% DD) → 120
    const values = [100, 150, 75, 120];
    const m = computeMetrics(values, [], 100);
    expect(m.maxDrawdown).toBeCloseTo(-0.5, 2);
  });

  it('computes win rate and profit factor', () => {
    const trades: BacktestTrade[] = [
      { date: '2020-01-01', side: 'BUY', price: 100, quantity: 10 },
      { date: '2020-02-01', side: 'SELL', price: 110, quantity: 10, pnl: 100 },
      { date: '2020-03-01', side: 'BUY', price: 100, quantity: 10 },
      { date: '2020-04-01', side: 'SELL', price: 95, quantity: 10, pnl: -50 },
    ];
    const m = computeMetrics([1000, 1100, 1050], trades, 1000);
    expect(m.winRate).toBeCloseTo(0.5, 2);
    expect(m.profitFactor).toBeCloseTo(2, 2); // 100 / 50
  });

  it('handles single-day series', () => {
    const m = computeMetrics([100], [], 100);
    expect(m.totalReturn).toBe(0);
    expect(m.sharpeRatio).toBe(0);
  });
});
