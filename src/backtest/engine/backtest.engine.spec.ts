import { InfiniteBuyStrategy } from '../../trading/strategy/infinite-buy.strategy';
import { MomentumBreakoutStrategy } from '../../trading/strategy/momentum-breakout.strategy';
import {
  PerStockTradingStrategy,
  StockStrategyContext,
  StrategyEvaluationResult,
  TradingSignal,
} from '../../trading/types';
import { OHLCV } from '../data/indicator-calculator';
import { runBacktest, BacktestConfig } from './backtest.engine';
import { computeMetrics } from './metrics';

/**
 * 테스트 전용 스크립트 전략: bar 인덱스별로 미리 정해진 시그널을 그대로 반환한다.
 * loc/moc fillModel 체결 판정은 엔진 책임이므로, 실제 v4 전략 없이 엔진만 검증한다.
 */
class ScriptedStrategy implements PerStockTradingStrategy {
  name = 'scripted-test';
  displayName = 'Scripted Test Strategy';
  description = 'test-only strategy that replays a fixed signal script per bar';
  executionMode = { type: 'continuous' } as const;
  meta = {
    riskLevel: 'MEDIUM',
    mddBuyBlock: -0.1,
    mddLiquidate: -0.25,
    expectedReturn: 'n/a',
    maxLoss: 'n/a',
    investmentPeriod: 'n/a',
    tradingFrequency: 'n/a',
    suitableFor: [],
    tags: [],
  } as any;
  private callIndex = 0;

  constructor(private readonly script: TradingSignal[][]) {}

  async evaluateStock(): Promise<StrategyEvaluationResult> {
    const signals = this.script[this.callIndex] ?? [];
    this.callIndex++;
    return { signals, skipReasons: signals.length ? [] : ['scripted: no signal'] };
  }
}

/** 종가만 의미 있는 loc/moc 테스트용 flat bar 시퀀스 (open=high=low=close). */
function flatBars(closes: number[], startDate = new Date('2026-01-05')): OHLCV[] {
  const bars: OHLCV[] = [];
  const d = new Date(startDate);
  for (const close of closes) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    bars.push({ date: d.toISOString().slice(0, 10).replace(/-/g, ''), open: close, high: close, low: close, close, volume: 1_000_000 });
    d.setDate(d.getDate() + 1);
  }
  return bars;
}

function locSignal(side: 'BUY' | 'SELL', price: number, quantity: number): TradingSignal {
  return {
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    side,
    quantity,
    price,
    reason: `v4-loc-${side.toLowerCase()}`,
    metadata: { fillModel: 'loc' },
  };
}

function mocSignal(side: 'BUY' | 'SELL', quantity: number): TradingSignal {
  return {
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    side,
    quantity,
    reason: `v4-moc-${side.toLowerCase()}`,
    metadata: { fillModel: 'moc' },
  };
}

function limitTouchSignal(side: 'BUY' | 'SELL', price: number, quantity: number): TradingSignal {
  return {
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    side,
    quantity,
    price,
    reason: `v4-limit-touch-${side.toLowerCase()}`,
    metadata: { fillModel: 'limit-touch' },
  };
}

/** limit-touch 테스트용: 고가/저가가 종가와 다른 bar. */
function ohlcBars(
  bars: { open: number; high: number; low: number; close: number }[],
  startDate = new Date('2026-01-05'),
): OHLCV[] {
  const out: OHLCV[] = [];
  const d = new Date(startDate);
  for (const b of bars) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    out.push({ date: d.toISOString().slice(0, 10).replace(/-/g, ''), ...b, volume: 1_000_000 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

describe('backtest engine (loc/moc fillModel)', () => {
  const baseConfig: BacktestConfig = {
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    stockName: 'TQQQ',
    quota: 100000,
    maxCycles: 40,
    stopLossRate: 0.5,
    startingCash: 100000,
    warmupBars: 0,
    slippageRate: 0,
  };

  it('loc BUY: 종가 ≤ limit이면 종가 체결, 초과하면 미체결', async () => {
    const bars = flatBars([100, 105]);
    const strategy = new ScriptedStrategy([
      [locSignal('BUY', 105, 10)], // close 100 <= limit 105 → 체결
      [locSignal('BUY', 100, 10)], // close 105 > limit 100 → 미체결
    ]);

    const res = await runBacktest(strategy, bars, baseConfig);

    expect(res.trades).toHaveLength(1);
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 100, quantity: 10 });
    expect(res.finalPosition.quantity).toBe(10);
  });

  it('loc SELL: 종가 ≥ limit이면 종가 체결, 미달하면 미체결', async () => {
    const bars = flatBars([100, 95, 105]);
    const strategy = new ScriptedStrategy([
      [mocSignal('BUY', 10)], // 포지션 확보 (종가 100)
      [locSignal('SELL', 100, 10)], // close 95 < limit 100 → 미체결
      [locSignal('SELL', 100, 10)], // close 105 >= limit 100 → 체결
    ]);

    const res = await runBacktest(strategy, bars, baseConfig);

    expect(res.trades).toHaveLength(2);
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 100, quantity: 10 });
    expect(res.trades[1]).toMatchObject({ side: 'SELL', price: 105, quantity: 10 });
    expect(res.finalPosition.quantity).toBe(0);
  });

  it('경계값: 종가 == limit이면 BUY/SELL 모두 체결 (≤ / ≥ 는 등호 포함)', async () => {
    const bars = flatBars([100, 100]);
    const strategy = new ScriptedStrategy([
      [locSignal('BUY', 100, 10)], // close 100 == limit 100 → 체결
      [locSignal('SELL', 100, 10)], // close 100 == limit 100 → 체결
    ]);

    const res = await runBacktest(strategy, bars, baseConfig);

    expect(res.trades).toHaveLength(2);
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 100, quantity: 10 });
    expect(res.trades[1]).toMatchObject({ side: 'SELL', price: 100, quantity: 10 });
  });

  it('moc: limit 유무·방향 무관하게 당일 종가로 무조건 체결', async () => {
    const bars = flatBars([100, 110]);
    const strategy = new ScriptedStrategy([
      [mocSignal('BUY', 10)],
      [mocSignal('SELL', 10)],
    ]);

    const res = await runBacktest(strategy, bars, baseConfig);

    expect(res.trades).toHaveLength(2);
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 100, quantity: 10 });
    expect(res.trades[1]).toMatchObject({ side: 'SELL', price: 110, quantity: 10 });
  });

  it('feeConfig: stop-entry와 동일하게 loc/moc 체결에도 수수료/거래세가 적용된다', async () => {
    const bars = flatBars([100, 110]);
    const strategy = new ScriptedStrategy([
      [mocSignal('BUY', 10)],
      [locSignal('SELL', 100, 10)],
    ]);

    const res = await runBacktest(strategy, bars, {
      ...baseConfig,
      feeConfig: { buyFeeRate: 0.001, sellFeeRate: 0.001, sellTaxRate: 0.002 },
    });

    // BUY: fee 100×10×0.001 = 1, 체결가 자체는 그대로 100
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 100, quantity: 10 });
    // SELL: gross (110-100)×10=100, sellFees 110×10×0.003=3.3 → net 96.7
    expect(res.trades[1].pnl).toBeCloseTo(100 - 3.3, 6);
    expect(res.finalCash).toBeCloseTo(100000 - 1000 - 1 + 1100 - 3.3, 6);
  });
});

describe('backtest engine (limit-touch fillModel)', () => {
  const baseConfig: BacktestConfig = {
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    stockName: 'TQQQ',
    quota: 100000,
    maxCycles: 40,
    stopLossRate: 0.5,
    startingCash: 100000,
    warmupBars: 0,
    slippageRate: 0,
  };

  it('SELL: 장중 고가 ≥ limit이면 limit가로 체결, 미달하면 미체결', async () => {
    const bars = ohlcBars([
      { open: 100, high: 100, low: 100, close: 100 }, // 포지션 확보용 moc BUY
      { open: 100, high: 105, low: 98, close: 100 }, // high 105 < limit 110 → 미체결
      { open: 100, high: 112, low: 99, close: 105 }, // high 112 >= limit 110 → 체결 @110
    ]);
    const strategy = new ScriptedStrategy([
      [mocSignal('BUY', 10)],
      [limitTouchSignal('SELL', 110, 10)],
      [limitTouchSignal('SELL', 110, 10)],
    ]);

    const res = await runBacktest(strategy, bars, baseConfig);

    expect(res.trades).toHaveLength(2);
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 100, quantity: 10 });
    // 체결가는 limit(110) — 종가(105)도 고가(112)도 아님
    expect(res.trades[1]).toMatchObject({ side: 'SELL', price: 110, quantity: 10 });
    expect(res.finalPosition.quantity).toBe(0);
  });

  it('BUY: 장중 저가 ≤ limit이면 limit가로 체결, 미달하면 미체결', async () => {
    const bars = ohlcBars([
      { open: 100, high: 102, low: 96, close: 100 }, // low 96 > limit 95 → 미체결
      { open: 100, high: 102, low: 94, close: 100 }, // low 94 <= limit 95 → 체결 @95
    ]);
    const strategy = new ScriptedStrategy([
      [limitTouchSignal('BUY', 95, 10)],
      [limitTouchSignal('BUY', 95, 10)],
    ]);

    const res = await runBacktest(strategy, bars, baseConfig);

    expect(res.trades).toHaveLength(1);
    // 체결가는 limit(95) — 종가(100)도 저가(94)도 아님
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 95, quantity: 10 });
  });

  it('경계값: high==limit(SELL)/low==limit(BUY) 도 체결 (≥ / ≤ 는 등호 포함)', async () => {
    const bars = ohlcBars([
      { open: 105, high: 105, low: 100, close: 105 }, // low == limit 100 (BUY)
      { open: 105, high: 110, low: 100, close: 105 }, // high == limit 110 (SELL)
    ]);
    const strategy = new ScriptedStrategy([
      [limitTouchSignal('BUY', 100, 10)],
      [limitTouchSignal('SELL', 110, 10)],
    ]);

    const res = await runBacktest(strategy, bars, baseConfig);

    expect(res.trades).toHaveLength(2);
    expect(res.trades[0]).toMatchObject({ side: 'BUY', price: 100, quantity: 10 });
    expect(res.trades[1]).toMatchObject({ side: 'SELL', price: 110, quantity: 10 });
  });
});

/**
 * infinite-buy-v4 bar간 상태 스레딩(§7) 전용 스크립트 전략 — bar 인덱스별로 미리 정해진
 * {signals, details} 쌍을 그대로 반환하고, 엔진이 넘긴 ctx를 기록해 다음 bar에서
 * strategyParams.v4가 이전 bar의 체결/모드전환을 반영했는지 검증할 수 있게 한다.
 */
class ScriptedV4Strategy implements PerStockTradingStrategy {
  name = 'infinite-buy-v4';
  displayName = 'Scripted V4 Test Strategy';
  description = 'test-only strategy for backtest engine v4 threading';
  executionMode = {
    type: 'once-daily' as const,
    hours: { domestic: 11, overseas: { basis: 'afterOpen' as const, offsetHours: 2 } },
  };
  meta = {
    riskLevel: 'high',
    mddBuyBlock: -0.99,
    mddLiquidate: -0.99,
    expectedReturn: 'n/a',
    maxLoss: 'n/a',
    investmentPeriod: 'n/a',
    tradingFrequency: 'n/a',
    suitableFor: [],
    tags: [],
  } as any;
  readonly receivedCtx: StockStrategyContext[] = [];
  private callIndex = 0;

  constructor(private readonly script: { signals: TradingSignal[]; details?: Record<string, any> }[]) {}

  async evaluateStock(ctx: StockStrategyContext): Promise<StrategyEvaluationResult> {
    // watchStock.strategyParams는 엔진이 bar마다 같은 객체를 이어서 mutate하므로,
    // 그대로 저장하면 이후 bar에서 값이 계속 바뀌어 버린다 — 캡처 시점 스냅샷으로 깊은 복사한다.
    this.receivedCtx.push({
      ...ctx,
      watchStock: { ...ctx.watchStock, strategyParams: JSON.parse(JSON.stringify(ctx.watchStock.strategyParams ?? {})) },
    });
    const entry = this.script[this.callIndex] ?? { signals: [] };
    this.callIndex++;
    return {
      signals: entry.signals,
      skipReasons: entry.signals.length ? [] : ['scripted-v4: no signal'],
      details: entry.details,
    };
  }
}

function v4Signal(
  side: 'BUY' | 'SELL',
  price: number,
  quantity: number,
  phase: string,
  metadata: Record<string, any> = {},
): TradingSignal {
  return {
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    side,
    quantity,
    price,
    reason: `V4 ${phase}`,
    metadata: { fillModel: 'loc', phase, ...metadata },
  };
}

describe('backtest engine (infinite-buy-v4 bar간 상태 스레딩)', () => {
  const baseConfig: Omit<BacktestConfig, 'strategyParams'> = {
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    quota: 1000,
    maxCycles: 40,
    stopLossRate: 0.5,
    startingCash: 2000,
    warmupBars: 0,
  };

  it('v4StateUpdate(mode/recentCloses)과 체결로 갱신된 T/잔금이 다음 bar 평가로 이어진다', async () => {
    const bars = flatBars([100, 100, 100]);
    const strategy = new ScriptedV4Strategy([
      {
        signals: [v4Signal('BUY', 100, 5, 'v4-first-buy', { v4AttemptAmount: 500 })],
        details: { v4StateUpdate: { mode: 'NORMAL', recentCloses: [{ date: '2026-01-05', close: 100 }] } },
      },
      {
        signals: [],
        details: {
          v4StateUpdate: {
            mode: 'NORMAL',
            recentCloses: [{ date: '2026-01-05', close: 100 }, { date: '2026-01-06', close: 100 }],
          },
        },
      },
      { signals: [] },
    ]);

    await runBacktest(strategy, bars, baseConfig);

    // bar1(index 1) 평가 시점 ctx는 bar0의 체결(ΔT=500/500=1, cashRemaining=1000-500)과
    // v4StateUpdate(mode/recentCloses)를 모두 반영한 상태여야 한다.
    const v4AtBar1 = strategy.receivedCtx[1].watchStock.strategyParams?.v4;
    expect(v4AtBar1?.mode).toBe('NORMAL');
    expect(v4AtBar1?.recentCloses).toHaveLength(1);
    expect(v4AtBar1?.turn).toBeCloseTo(1, 6);
    expect(v4AtBar1?.cashRemaining).toBeCloseTo(500, 2);

    // bar2는 신호가 없었던 bar1을 거친 뒤에도 그대로 이어진다 (recentCloses만 갱신).
    const v4AtBar2 = strategy.receivedCtx[2].watchStock.strategyParams?.v4;
    expect(v4AtBar2?.recentCloses).toHaveLength(2);
    expect(v4AtBar2?.turn).toBeCloseTo(1, 6);
  });

  it('같은 bar에 SELL·BUY가 함께 체결되면 신호 배열 순서와 무관하게 SELL을 먼저 장부에 반영한다', async () => {
    const bars = flatBars([1, 1, 1]);
    const strategy = new ScriptedV4Strategy([
      // bar0: 보유 100주를 만들기 위한 첫 매수 (T: 0 -> 1)
      {
        signals: [v4Signal('BUY', 1, 100, 'v4-first-buy', { v4AttemptAmount: 100 })],
        details: { v4StateUpdate: { mode: 'NORMAL', recentCloses: [] } },
      },
      // bar1: 배열에는 BUY를 SELL보다 먼저 넣어도, 엔진은 SELL을 먼저 반영해야 한다.
      {
        signals: [
          v4Signal('BUY', 1, 10, 'v4-avg-buy', { v4AttemptAmount: 10 }),
          v4Signal('SELL', 1, 25, 'v4-quarter-sell', { v4PrevHolding: 100 }),
        ],
        details: { v4StateUpdate: { mode: 'NORMAL', recentCloses: [] } },
      },
      { signals: [] },
    ]);

    await runBacktest(strategy, bars, baseConfig);

    // SELL 먼저: T = 1×(1−25/100) + (10/10) = 0.75 + 1 = 1.75
    // (BUY 먼저였다면: T = (1+1)×(1−25/100) = 1.5 — 반드시 달라야 함)
    const v4AtBar2 = strategy.receivedCtx[2].watchStock.strategyParams?.v4;
    expect(v4AtBar2?.turn).toBeCloseTo(1.75, 6);
    expect(v4AtBar2?.turn).not.toBeCloseTo(1.5, 6);
    // cashRemaining: (1000-100) + 25(매도) - 10(매수) = 915
    expect(v4AtBar2?.cashRemaining).toBeCloseTo(915, 2);
  });

  it('SELL로 보유수량이 0이 되면 사이클이 종료되어 T=0/cycleSeq+1로 다음 bar에 전달된다', async () => {
    const bars = flatBars([1, 1, 1]);
    const strategy = new ScriptedV4Strategy([
      // bar0: 10주 매수 (T: 0 -> 1)
      {
        signals: [v4Signal('BUY', 1, 10, 'v4-first-buy', { v4AttemptAmount: 10 })],
        details: { v4StateUpdate: { mode: 'NORMAL', recentCloses: [] } },
      },
      // bar1: 보유 전량(10주) 매도 — §4.5 사이클 종료
      {
        signals: [v4Signal('SELL', 1, 10, 'v4-final-sell', { v4PrevHolding: 10 })],
        details: { v4StateUpdate: { mode: 'NORMAL', recentCloses: [] } },
      },
      { signals: [] },
    ]);

    const res = await runBacktest(strategy, bars, baseConfig);

    const v4AtBar2 = strategy.receivedCtx[2].watchStock.strategyParams?.v4;
    expect(v4AtBar2?.turn).toBe(0);
    expect(v4AtBar2?.cycleSeq).toBe(1);
    expect(v4AtBar2?.lastKnownHoldQty).toBe(0);
    // compoundMode 기본값(true) — 사이클 종료 시 잔금 재투입 (원금으로 리셋하지 않음)
    expect(v4AtBar2?.cashRemaining).toBeCloseTo(1000, 2);
    expect(res.v4Summary).toMatchObject({ cycleCount: 1, finalTurn: 0, finalCashRemaining: 1000 });
  });

  it('REVERSE 진입/복귀가 반복되면 v4Summary.reverseEntryCount가 진입 횟수만큼 누적된다', async () => {
    const bars = flatBars([1, 1, 1, 1, 1]);
    const strategy = new ScriptedV4Strategy([
      { signals: [], details: { v4StateUpdate: { mode: 'NORMAL', recentCloses: [] } } },
      { signals: [], details: { v4StateUpdate: { mode: 'REVERSE', recentCloses: [] } } }, // 1차 진입
      { signals: [], details: { v4StateUpdate: { mode: 'NORMAL', recentCloses: [] } } }, // 복귀
      { signals: [], details: { v4StateUpdate: { mode: 'REVERSE', recentCloses: [] } } }, // 2차 진입
      { signals: [], details: { v4StateUpdate: { mode: 'REVERSE', recentCloses: [] } } }, // 유지(재진입 아님)
    ]);

    const res = await runBacktest(strategy, bars, baseConfig);

    expect(res.v4Summary?.reverseEntryCount).toBe(2);
    expect(res.v4Summary?.finalMode).toBe('REVERSE');
  });
});

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
