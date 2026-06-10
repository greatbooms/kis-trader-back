import { InfiniteBuyStrategy } from '../../trading/strategy/infinite-buy.strategy';
import { MomentumBreakoutStrategy } from '../../trading/strategy/momentum-breakout.strategy';
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

describe('backtest engine (momentum-breakout 당일청산 변동성 돌파)', () => {
  /**
   * 수제 시리즈 (warmup 21):
   * - bars[0..19]: 지그재그 9900/9960 (RSI ≈ 50, MA20 ≈ 9930 < 진입일 시가 — MA20 필터 통과)
   * - bars[20]: 전일 봉 — high 10200 / low 9800 (range 400)
   * - bars[21]: 돌파+종가청산 — 돌파가 10200, high 10300 체결, low 10000 > stop(9996), close 10250
   * - bars[22]: 돌파 미달 — 돌파가 10150, high 10100
   * - bars[23]: 돌파+손절 — 돌파가 10075, stop 9874, high 10080 체결, low 9870 ≤ stop
   * - bars[24]: 마감 봉 (무거래)
   */
  function craftedBars(): OHLCV[] {
    const bars: OHLCV[] = [];
    const d = new Date('2026-01-05'); // 월요일
    const pushBar = (bar: Omit<OHLCV, 'date'>) => {
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      bars.push({ date: d.toISOString().slice(0, 10).replace(/-/g, ''), ...bar });
      d.setDate(d.getDate() + 1);
    };

    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        pushBar({ open: 9900, high: 9970, low: 9890, close: 9960, volume: 1_000_000 });
      } else {
        pushBar({ open: 9960, high: 9970, low: 9890, close: 9900, volume: 1_000_000 });
      }
    }
    pushBar({ open: 10000, high: 10200, low: 9800, close: 10000, volume: 1_000_000 }); // [20]
    pushBar({ open: 10000, high: 10300, low: 10000, close: 10250, volume: 1_500_000 }); // [21]
    pushBar({ open: 10000, high: 10100, low: 9950, close: 10000, volume: 1_000_000 }); // [22]
    pushBar({ open: 10000, high: 10080, low: 9870, close: 9900, volume: 1_200_000 }); // [23]
    pushBar({ open: 9900, high: 9900, low: 9900, close: 9900, volume: 800_000 }); // [24]
    return bars;
  }

  const baseConfig: BacktestConfig = {
    market: 'DOMESTIC',
    exchangeCode: 'KRX',
    stockCode: '005930',
    stockName: '삼성전자',
    quota: 1020000,
    maxCycles: 40,
    stopLossRate: 0.3,
    startingCash: 2000000,
    warmupBars: 21,
    slippageRate: 0, // 검증 결정성을 위해 0
  };

  it('돌파 체결 → 같은 bar 종가 청산, 미돌파 bar는 무거래', async () => {
    const strategy = new MomentumBreakoutStrategy();
    const res = await runBacktest(strategy, craftedBars(), baseConfig);

    expect(res.trades).toHaveLength(4);

    // bars[21]: 돌파가 10200 체결 → 종가 10250 청산
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 10200, quantity: 100 });
    expect(res.trades[1]).toMatchObject({ side: 'SELL', price: 10250, quantity: 100 });
    expect(res.trades[1].pnl).toBeCloseTo(5000, 6);

    // bars[23]: 돌파가 10075 체결 → 손절가 = 체결가×0.98 = 9873.5,
    // 장중 low(9870) ≤ stop → 손절가 청산
    expect(res.trades[2]).toMatchObject({ side: 'BUY', price: 10075, quantity: 101 });
    expect(res.trades[3]).toMatchObject({ side: 'SELL', price: 9873.5, quantity: 101 });
    expect(res.trades[3].pnl).toBeCloseTo(-20351.5, 6);

    // 포지션 이월 없음 (당일청산)
    expect(res.finalPosition.quantity).toBe(0);
    expect(res.finalCash).toBeCloseTo(2000000 + 5000 - 20351.5, 6);
  });

  it('stopFill=close 모드: 종가가 stop 위면 손절 대신 종가 청산', async () => {
    const strategy = new MomentumBreakoutStrategy();
    const res = await runBacktest(strategy, craftedBars(), {
      ...baseConfig,
      stopFill: 'close',
    });

    // bars[23]: low(9870) ≤ stop(9873.5)이지만 close(9900) > stop → 종가 청산
    expect(res.trades[3]).toMatchObject({ side: 'SELL', price: 9900, quantity: 101 });
    expect(res.trades[3].pnl).toBeCloseTo((9900 - 10075) * 101, 6);
  });

  it('takeProfitEnabled: 장중 고가가 익절가 도달 시 익절가 청산', async () => {
    const bars = craftedBars().slice(0, 22);
    // bars[21]을 익절 시나리오로 교체: tp = round(10200×1.05) = 10710
    bars[21] = { ...bars[21], high: 10800, low: 10100, close: 10500 };

    const strategy = new MomentumBreakoutStrategy();
    const res = await runBacktest(strategy, bars, {
      ...baseConfig,
      strategyParams: { takeProfitEnabled: true },
    });

    expect(res.trades).toHaveLength(2);
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 10200 });
    expect(res.trades[1]).toMatchObject({ side: 'SELL', price: 10710 });
  });

  it('feeConfig: 수수료/거래세가 현금과 거래 손익에 반영된다', async () => {
    const strategy = new MomentumBreakoutStrategy();
    const res = await runBacktest(strategy, craftedBars(), {
      ...baseConfig,
      feeConfig: { buyFeeRate: 0.001, sellFeeRate: 0.001, sellTaxRate: 0.002 },
    });

    // bars[21]: gross +5000, buyFee 1020, sellFees 3075 → net 905
    expect(res.trades[1].pnl).toBeCloseTo(5000 - 1020 - 3075, 4);

    // bars[23]: stop = 10075×0.98 = 9873.5 → gross -20351.5,
    // buyFee 1017.575, sellFees(9873.5×101×0.003) 2991.6705 → net -24360.7455
    expect(res.trades[3].pnl).toBeCloseTo(-24360.7455, 2);

    // 현금 흐름: 2,000,000 + 905 - 24,360.7455
    expect(res.finalCash).toBeCloseTo(2000000 + 905 - 24360.7455, 2);
  });

  it('진입 비용(수수료 포함)이 현금을 초과하면 수량을 줄여 체결 (조용한 드랍 금지)', async () => {
    const strategy = new MomentumBreakoutStrategy();
    const res = await runBacktest(strategy, craftedBars().slice(0, 22), {
      ...baseConfig,
      startingCash: 1020000, // 전략 수량 100주 × 10200 = 1,020,000 — 수수료만큼 부족
      feeConfig: { buyFeeRate: 0.001, sellFeeRate: 0, sellTaxRate: 0 },
    });

    expect(res.trades).toHaveLength(2);
    // floor(1,020,000 / (10200 × 1.001)) = 99주로 축소 체결
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 10200, quantity: 99 });
  });

  it('슬리피지 포함 체결가가 당일 고가를 넘으면 미체결 (불가능한 체결 금지)', async () => {
    const strategy = new MomentumBreakoutStrategy();

    // bars[21]: trigger 10200, 슬리피지 0.001 → 체결가 10210.2
    // high 10205: trigger는 닿았지만 체결가에 못 미침 → 미체결
    const barsTouch = craftedBars().slice(0, 22);
    barsTouch[21] = { ...barsTouch[21], high: 10205, close: 10100 };
    const resTouch = await runBacktest(strategy, barsTouch, {
      ...baseConfig,
      slippageRate: 0.001,
    });
    expect(resTouch.trades).toHaveLength(0);

    // high 10211: 체결가(10210.2)까지 도달 → 체결, 가격은 고가 이내
    const barsFill = craftedBars().slice(0, 22);
    barsFill[21] = { ...barsFill[21], high: 10211, close: 10100 };
    const resFill = await runBacktest(strategy, barsFill, {
      ...baseConfig,
      slippageRate: 0.001,
    });
    expect(resFill.trades).toHaveLength(2);
    expect(resFill.trades[0].price).toBeCloseTo(10210.2, 6);
    expect(resFill.trades[0].price).toBeLessThanOrEqual(10211);
  });

  it('indicatorLag=1: 당일 종가가 진입 지표에 새지 않음 (lookahead 제거)', async () => {
    const bars = craftedBars().slice(0, 22);
    bars[21] = { ...bars[21], high: 13100, low: 10000, close: 13000 }; // 당일 +30% 급등
    const strategy = new MomentumBreakoutStrategy();

    // lag 0 (기본): 당일 종가가 RSI/MA20에 포함 → 과열·MA20 상회로 차단 (lookahead)
    const lag0 = await runBacktest(strategy, bars, baseConfig);
    expect(lag0.trades).toHaveLength(0);

    // lag 1: 전일까지의 지표로 판단 → 정상 진입 + 종가 청산
    const lag1 = await runBacktest(strategy, bars, { ...baseConfig, indicatorLag: 1 });
    expect(lag1.trades).toHaveLength(2);
    expect(lag1.trades[0]).toMatchObject({ side: 'BUY', price: 10200 });
    expect(lag1.trades[1]).toMatchObject({ side: 'SELL', price: 13000 });
  });

  it('feeConfig 미설정 시 기존 infinite-buy 경로 결과는 변하지 않는다', async () => {
    const bars = synth(500);
    const strategy = new InfiniteBuyStrategy();
    const config: BacktestConfig = {
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'SYNTH',
      quota: 4000,
      maxCycles: 40,
      stopLossRate: 0.5,
      startingCash: 10000,
      warmupBars: 210,
    };

    const resA = await runBacktest(strategy, bars, config);
    const resB = await runBacktest(strategy, bars, { ...config, feeConfig: undefined });

    expect(resA.finalCash).toBe(resB.finalCash);
    expect(resA.trades.length).toBe(resB.trades.length);
  });
});
