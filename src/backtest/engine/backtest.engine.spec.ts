import { InfiniteBuyStrategy } from '../../trading/strategy/infinite-buy.strategy';
import { OHLCV } from '../data/indicator-calculator';
import { runBacktest, BacktestConfig } from './backtest.engine';
import { computeMetrics } from './metrics';

/** Generate synthetic OHLCV series: sinusoidal price around base with light drift. */
function synth(
  n: number,
  base = 50,
  amplitude = 5,
  drift = 0.0002,
  period = 60,
  startDate = new Date('2020-01-01'),
): OHLCV[] {
  const out: OHLCV[] = [];
  const d = new Date(startDate);
  for (let i = 0; i < n; i++) {
    const price = base * (1 + drift) ** i + Math.sin((i / period) * 2 * Math.PI) * amplitude;
    d.setDate(d.getDate() + 1);
    // Skip weekends
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    out.push({
      date: d.toISOString().slice(0, 10).replace(/-/g, ''),
      open: price * 0.998,
      high: price * 1.012,
      low: price * 0.988,
      close: price,
      volume: 1_000_000,
    });
  }
  return out;
}

describe('backtest engine (infinite-buy)', () => {
  it('produces some trades and a valid value series on synthetic data', async () => {
    const bars = synth(500);
    const strategy = new InfiniteBuyStrategy();
    const config: BacktestConfig = {
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'SYNTH',
      stockName: 'Synthetic',
      quota: 4000,
      maxCycles: 40,
      stopLossRate: 0.5,
      startingCash: 10000,
      warmupBars: 210,
    };

    const res = await runBacktest(strategy, bars, config);

    expect(res.dailyValues.length).toBe(bars.length);
    expect(res.dailyDates.length).toBe(bars.length);
    expect(res.trades.length).toBeGreaterThan(0);

    const m = computeMetrics(res.dailyValues, res.trades, config.startingCash);
    expect(m.totalDays).toBe(bars.length);
    expect(Number.isFinite(m.totalReturn)).toBe(true);
    expect(Number.isFinite(m.cagr)).toBe(true);
    expect(Number.isFinite(m.sharpeRatio)).toBe(true);
  });

  it('behaves differently for rsiPolicy=none vs legacy-hard vs continuous', async () => {
    const bars = synth(500);
    const strategy = new InfiniteBuyStrategy();
    const base: BacktestConfig = {
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'SYNTH',
      quota: 4000,
      maxCycles: 40,
      stopLossRate: 0.5,
      startingCash: 10000,
      warmupBars: 210,
    };

    const resNone = await runBacktest(strategy, bars, { ...base, strategyParams: { rsiPolicy: 'none' } });
    const resLegacy = await runBacktest(strategy, bars, { ...base, strategyParams: { rsiPolicy: 'legacy-hard' } });
    const resCont = await runBacktest(strategy, bars, { ...base, strategyParams: { rsiPolicy: 'continuous' } });

    // 적어도 하나는 다른 거래 횟수나 다른 종료 자본을 가져야 함
    const uniques = new Set([
      resNone.finalCash + resNone.finalPosition.quantity * bars[bars.length - 1].close,
      resLegacy.finalCash + resLegacy.finalPosition.quantity * bars[bars.length - 1].close,
      resCont.finalCash + resCont.finalPosition.quantity * bars[bars.length - 1].close,
    ]);
    expect(uniques.size).toBeGreaterThan(1);
  });
});
