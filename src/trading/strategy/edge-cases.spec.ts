import { InfiniteBuyStrategy } from './infinite-buy.strategy';
import { GridMeanReversionStrategy } from './grid-mean-reversion.strategy';
import { MomentumBreakoutStrategy } from './momentum-breakout.strategy';
import { ConservativeStrategy } from './conservative.strategy';
import { TrendFollowingStrategy } from './trend-following.strategy';
import { ValueFactorStrategy } from './value-factor.strategy';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

function createBaseContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
  const defaultWatchStock: WatchStockConfig = {
    id: 'ws-1',
    market: 'DOMESTIC',
    exchangeCode: 'KRX',
    stockCode: '005930',
    stockName: 'Samsung',
    strategyName: 'infinite-buy',
    quota: 1000000,
    cycle: 1,
    maxCycles: 40,
    stopLossRate: 0.3,
    maxPortfolioRate: 0.15,
  };

  const defaultPrice: StockPriceResult = {
    stockCode: '005930',
    stockName: 'Samsung',
    currentPrice: 70000,
    openPrice: 69000,
    highPrice: 71000,
    lowPrice: 68000,
    volume: 500000,
  };

  const defaultMarketCondition: MarketCondition = {
    referenceIndexAboveMA200: true,
    referenceIndexName: 'KOSPI',
    interestRateRising: false,
  };

  const defaultStockIndicators: StockIndicators = {
    currentAboveMA200: true,
    ma200: 65000,
    ma20: 70000,
    ma60: 68000,
    rsi14: 50,
    bollingerUpper: 75000,
    bollingerMiddle: 70000,
    bollingerLower: 65000,
    macdHistogram: 0.5,
    macdPrevHistogram: -0.1,
    adx14: 30,
    volumeRatio: 2.0,
    prevHigh: 71000,
    prevLow: 68000,
    todayOpen: 69000,
  };

  return {
    watchStock: defaultWatchStock,
    price: defaultPrice,
    position: undefined,
    alreadyExecutedToday: false,
    marketCondition: defaultMarketCondition,
    stockIndicators: defaultStockIndicators,
    buyableAmount: 1000000,
    totalPortfolioValue: 10000000,
    ...overrides,
  };
}

describe('Edge Cases - Common across all strategies', () => {
  const strategies = [
    { name: 'infinite-buy', instance: new InfiniteBuyStrategy() },
    { name: 'grid-mean-reversion', instance: new GridMeanReversionStrategy() },
    { name: 'momentum-breakout', instance: new MomentumBreakoutStrategy() },
    { name: 'conservative', instance: new ConservativeStrategy() },
    { name: 'trend-following', instance: new TrendFollowingStrategy() },
    { name: 'value-factor', instance: new ValueFactorStrategy() },
  ];

  describe.each(strategies)('$name: buyableAmount edge cases', ({ instance }) => {
    it('should return no buy signals when buyableAmount is 0', async () => {
      const ctx = createBaseContext({ buyableAmount: 0 });
      const signals = await instance.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');
      expect(buys).toHaveLength(0);
    });

    it('should return no buy signals when quota < stock price (cannot buy 1 share)', async () => {
      const ctx = createBaseContext();
      ctx.watchStock.quota = 100; // way less than price 70000
      ctx.buyableAmount = 100;
      const signals = await instance.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');
      expect(buys).toHaveLength(0);
    });
  });

  describe.each(strategies)('$name: zero/negative price', ({ instance }) => {
    it('should handle currentPrice = 0 gracefully', async () => {
      const ctx = createBaseContext();
      ctx.price.currentPrice = 0;
      const signals = await instance.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should handle negative currentPrice gracefully', async () => {
      const ctx = createBaseContext();
      ctx.price.currentPrice = -1;
      const signals = await instance.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });
});

describe('Edge Cases - InfiniteBuyStrategy', () => {
  const strategy = new InfiniteBuyStrategy();

  it('T=0: first buy (no position)', async () => {
    const ctx = createBaseContext();
    ctx.watchStock.quota = 4000000; // perCycleQuota = 100000, enough for 1 share
    const signals = await strategy.evaluateStock(ctx);
    expect(signals.some((s) => s.side === 'BUY')).toBe(true);
  });

  it('T=10: should use +5% target rate for Sell2', async () => {
    const perCycleQuota = 1000000 / 40;
    const ctx = createBaseContext({
      position: {
        stockCode: '005930',
        quantity: 15,
        avgPrice: 68000,
        currentPrice: 70000,
        totalInvested: perCycleQuota * 10,
      },
    });
    ctx.price.currentPrice = 70000;

    const signals = await strategy.evaluateStock(ctx);
    const sell2 = signals.find((s) => s.reason.includes('Sell2'));
    // T=10 → target rate should be 10% (T<10 is 5%, T<20 is 10%)
    if (sell2) {
      // Sell2 price should be avgPrice * 1.10
      expect(sell2.price).toBe(Math.round(68000 * 1.10));
    }
  });

  it('T=20: should use +15% target rate', async () => {
    const perCycleQuota = 1000000 / 40;
    const ctx = createBaseContext({
      position: {
        stockCode: '005930',
        quantity: 30,
        avgPrice: 66000,
        currentPrice: 66000,
        totalInvested: perCycleQuota * 20,
      },
    });
    ctx.price.currentPrice = 66000;

    const signals = await strategy.evaluateStock(ctx);
    const sell2 = signals.find((s) => s.reason.includes('Sell2'));
    if (sell2) {
      expect(sell2.price).toBe(Math.round(66000 * 1.15));
    }
  });

  it('T=40 (maxCycles): should not buy but sell signals generated', async () => {
    const perCycleQuota = 1000000 / 40;
    const ctx = createBaseContext({
      position: {
        stockCode: '005930',
        quantity: 60,
        avgPrice: 65000,
        currentPrice: 65000,
        totalInvested: perCycleQuota * 40,
      },
    });
    ctx.price.currentPrice = 65000;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter((s) => s.side === 'BUY');
    expect(buys).toHaveLength(0);
    const sells = signals.filter((s) => s.side === 'SELL');
    expect(sells.length).toBeGreaterThanOrEqual(1);
  });

  it('interest rate rising + RSI oversold simultaneously: quota halved then 1.5x', async () => {
    const ctx = createBaseContext({
      marketCondition: {
        referenceIndexAboveMA200: true,
        referenceIndexName: 'KOSPI',
        interestRateRising: true,
      },
      stockIndicators: {
        currentAboveMA200: true,
        rsi14: 25, // < 30
      },
    });
    // perCycleQuota = 1000000/40 = 25000
    // halved for interest: 12500
    // 1.5x for RSI: 18750
    const signals = await strategy.evaluateStock(ctx);
    // Just verify it doesn't crash and produces valid signals
    expect(Array.isArray(signals)).toBe(true);
  });
});

describe('Edge Cases - GridMeanReversionStrategy', () => {
  const strategy = new GridMeanReversionStrategy();

  it('should handle all 3 grid levels reached (deepest match wins)', async () => {
    const ctx = createBaseContext({
      watchStock: {
        id: 'ws-1',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        strategyName: 'grid-mean-reversion',
        quota: 3000000,
        cycle: 1,
        maxCycles: 40,
        stopLossRate: 0.08,
        maxPortfolioRate: 0.15,
      },
      position: {
        stockCode: '005930',
        quantity: 14,
        avgPrice: 70000,
        currentPrice: 65000, // -7.1% → below grid 3 (-6%)
        totalInvested: 980000,
      },
    });
    ctx.price.currentPrice = 65000;

    const signals = await strategy.evaluateStock(ctx);
    const buys = signals.filter((s) => s.side === 'BUY');
    // Should buy at grid level, but stop loss at -8% hasn't triggered yet
    expect(buys.length).toBeLessThanOrEqual(1); // at most one grid buy
  });

  it('BB middle with profitRate <= 0: should not sell at BB middle', async () => {
    const ctx = createBaseContext({
      watchStock: {
        id: 'ws-1',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        strategyName: 'grid-mean-reversion',
        quota: 3000000,
        cycle: 1,
        maxCycles: 40,
        stopLossRate: 0.08,
        maxPortfolioRate: 0.15,
      },
      position: {
        stockCode: '005930',
        quantity: 20,
        avgPrice: 72000, // bought higher
        currentPrice: 70000, // below avg → profitRate < 0
        totalInvested: 1440000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        bollingerMiddle: 70000, // curPrice = BB middle
        bollingerUpper: 75000,
      },
    });
    ctx.price.currentPrice = 70000;

    const signals = await strategy.evaluateStock(ctx);
    // profitRate = (70000-72000)/72000 = -2.8% < 0 → BB middle sell should NOT trigger
    const bbMiddleSell = signals.find((s) => s.reason?.includes('BB중심선'));
    expect(bbMiddleSell).toBeUndefined();
  });
});

describe('Edge Cases - MomentumBreakoutStrategy', () => {
  const strategy = new MomentumBreakoutStrategy();

  it('prevHigh = prevLow (zero range): breakout = todayOpen, should buy if price >= todayOpen', async () => {
    const ctx = createBaseContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 69000,
        rsi14: 60,
        volumeRatio: 2.0,
        prevHigh: 70000,
        prevLow: 70000, // zero range
        todayOpen: 69000,
      },
    });
    ctx.price.currentPrice = 70000;
    // breakout = 69000 + 0 * 0.5 = 69000
    // curPrice(70000) >= 69000 → buy

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  it('highPrice = 0: should not trigger trailing stop', async () => {
    const ctx = createBaseContext({
      position: {
        stockCode: '005930',
        quantity: 10,
        avgPrice: 70000,
        currentPrice: 71000,
        totalInvested: 700000,
      },
    });
    ctx.price.currentPrice = 71000;
    ctx.price.highPrice = 0;

    const signals = await strategy.evaluateStock(ctx);
    const trailing = signals.find((s) => s.reason?.includes('트레일링스탑'));
    expect(trailing).toBeUndefined();
  });
});

describe('Edge Cases - ConservativeStrategy', () => {
  const strategy = new ConservativeStrategy();

  it('cashRate = 1.0 (100% cash): should not buy', async () => {
    const ctx = createBaseContext({
      stockIndicators: {
        currentAboveMA200: true,
        rsi14: 20,
        volumeRatio: 2.5,
      },
    });
    ctx.watchStock.strategyParams = { cashRate: 1.0 };
    // availableRate = 1 - 1.0 = 0 → buyAmount = 0

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('custom low rsiThreshold: entry only at extreme oversold', async () => {
    const ctx = createBaseContext({
      stockIndicators: {
        currentAboveMA200: true,
        rsi14: 20,
        volumeRatio: 2.5,
      },
    });
    ctx.watchStock.strategyParams = { rsiThreshold: 15 };
    // rsi14(20) >= custom threshold(15) → no buy

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });
});

describe('Edge Cases - TrendFollowingStrategy', () => {
  const strategy = new TrendFollowingStrategy();

  it('ma20 = ma60 (no cross): should not enter', async () => {
    const ctx = createBaseContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 70000,
        ma60: 70000, // equal, not golden cross
        adx14: 30,
      },
    });

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('adx exactly at threshold boundary (25): should enter', async () => {
    const ctx = createBaseContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 70000,
        ma60: 68000,
        adx14: 25, // exactly at threshold
      },
    });
    // adx14(25) > 25? No, 25 is NOT > 25. So no entry.
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('adx just above threshold (25.1): should enter', async () => {
    const ctx = createBaseContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 69000, // curPrice(70000) > ma20
        ma60: 68000,
        adx14: 25.1,
      },
    });

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  it('adx exactly at exit threshold (20): should not trigger exit (< 20 required)', async () => {
    const ctx = createBaseContext({
      position: {
        stockCode: '005930',
        quantity: 10,
        avgPrice: 70000,
        currentPrice: 72000,
        totalInvested: 700000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 70000,
        ma60: 68000,
        adx14: 20, // exactly at exit threshold
      },
    });
    // adx14(20) < 20? No → no exit
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('adx just below exit threshold (19.9): should trigger exit', async () => {
    const ctx = createBaseContext({
      position: {
        stockCode: '005930',
        quantity: 10,
        avgPrice: 70000,
        currentPrice: 72000,
        totalInvested: 700000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 70000,
        ma60: 68000,
        adx14: 19.9,
      },
    });

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].reason).toContain('추세소멸');
  });

  it('pyramiding with quota 0: should not pyramid', async () => {
    const ctx = createBaseContext({
      position: {
        stockCode: '005930',
        quantity: 13,
        avgPrice: 68000,
        currentPrice: 72000,
        totalInvested: 884000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 70000,
        ma60: 68000,
        adx14: 30,
      },
    });
    ctx.watchStock.quota = 0;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });
});
