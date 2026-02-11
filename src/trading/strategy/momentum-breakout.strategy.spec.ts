import { MomentumBreakoutStrategy } from './momentum-breakout.strategy';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
  RiskState,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

describe('MomentumBreakoutStrategy', () => {
  let strategy: MomentumBreakoutStrategy;

  beforeEach(() => {
    strategy = new MomentumBreakoutStrategy();
  });

  function createContext(
    overrides: Partial<StockStrategyContext> = {},
  ): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-1',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: 'Samsung',
      strategyName: 'momentum-breakout',
      quota: 1000000,
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.3,
      maxPortfolioRate: 0.15,
    };

    const defaultPrice: StockPriceResult = {
      stockCode: '005930',
      stockName: 'Samsung',
      currentPrice: 72000,
      openPrice: 69000,
      highPrice: 73000,
      lowPrice: 68000,
      volume: 1000000,
    };

    const defaultMarketCondition: MarketCondition = {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'KOSPI',
      interestRateRising: false,
    };

    // Default indicators satisfy all buy conditions:
    // curPrice(72000) > ma20(70000), RSI 60 in [50,70],
    // volumeRatio(2.0) >= 1.5,
    // breakout: todayOpen(69000) + (prevHigh(71000)-prevLow(67000)) * 0.5 = 69000 + 2000 = 71000
    // curPrice(72000) >= 71000
    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
      ma200: 65000,
      ma20: 70000,
      rsi14: 60,
      volumeRatio: 2.0,
      prevHigh: 71000,
      prevLow: 67000,
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

  describe('basic guards', () => {
    it('should return empty when price is 0', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 0;
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should return empty when price is negative', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = -100;
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  describe('risk management - liquidateAll', () => {
    it('should generate full sell when liquidateAll and has position', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 50,
          avgPrice: 70000,
          currentPrice: 58000,
          totalInvested: 3500000,
        },
        riskState: {
          buyBlocked: true,
          liquidateAll: true,
          positionCount: 1,
          investedRate: 0.5,
          dailyPnlRate: -0.05,
          drawdown: -0.16,
          reasons: ['MDD -16%'],
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(50);
      expect(signals[0].reason).toContain('리스크 전량청산');
    });

    it('should not generate liquidateAll signal when no position', async () => {
      const ctx = createContext({
        riskState: {
          buyBlocked: true,
          liquidateAll: true,
          positionCount: 0,
          investedRate: 0,
          dailyPnlRate: 0,
          drawdown: -0.16,
          reasons: [],
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  describe('stop loss (position held)', () => {
    it('should trigger stop loss at -3% default', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 67500, // -3.6%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 67500;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(100);
      expect(signals[0].reason).toContain('손절');
    });

    it('should not trigger stop loss within threshold', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 69000, // -1.4%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 69000;
      ctx.price.highPrice = 69000; // Prevent trailing stop

      const signals = await strategy.evaluateStock(ctx);
      const stopLoss = signals.find((s) => s.reason?.includes('손절'));
      expect(stopLoss).toBeUndefined();
    });
  });

  describe('trailing stop (position held)', () => {
    it('should trigger trailing stop when price drops 2% from high', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 71000,
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 71000;
      ctx.price.highPrice = 73000; // 71000 < 73000 * 0.98 (71540) → triggers
      // Wait, 71000 < 71540 → true, trailing stop triggered

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(100);
      expect(signals[0].reason).toContain('트레일링스탑');
    });

    it('should not trigger trailing stop when price near high', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 72500,
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 72500;
      ctx.price.highPrice = 73000; // 72500 < 73000 * 0.98 (71540)? No, 72500 > 71540

      const signals = await strategy.evaluateStock(ctx);
      const trailing = signals.find((s) => s.reason?.includes('트레일링스탑'));
      expect(trailing).toBeUndefined();
    });

    it('should not trigger trailing stop when highPrice is 0', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 71000,
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 71000;
      ctx.price.highPrice = 0;

      const signals = await strategy.evaluateStock(ctx);
      const trailing = signals.find((s) => s.reason?.includes('트레일링스탑'));
      expect(trailing).toBeUndefined();
    });
  });

  describe('take profit full (position held)', () => {
    it('should sell all at +8% profit', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 76000, // +8.6%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 76000;
      ctx.price.highPrice = 76000; // No trailing stop

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(100);
      expect(signals[0].reason).toContain('익절(전량)');
    });
  });

  describe('take profit half (position held)', () => {
    it('should sell 50% at +5% profit', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 73800, // +5.4%
          totalInvested: 1400000,
        },
      });
      ctx.price.currentPrice = 73800;
      ctx.price.highPrice = 73800; // No trailing stop

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(10); // floor(20/2)
      expect(signals[0].reason).toContain('익절(반)');
    });

    it('should sell at least 1 share for half take profit', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 1,
          avgPrice: 70000,
          currentPrice: 73800,
          totalInvested: 70000,
        },
      });
      ctx.price.currentPrice = 73800;
      ctx.price.highPrice = 73800;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].quantity).toBe(1); // max(1, floor(1/2)) = 1
    });
  });

  describe('buy entry (no position)', () => {
    it('should buy when all conditions met', async () => {
      const ctx = createContext();
      // All default indicators satisfy buy conditions

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      // quota=1000000, buyAmount=min(1000000, 1000000)=1000000
      // buyQty = floor(1000000 / 72000) = 13
      expect(signals[0].quantity).toBe(13);
      expect(signals[0].reason).toContain('모멘텀돌파');
    });

    it('should not buy when price <= MA20', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 73000, // curPrice(72000) <= ma20
          rsi14: 60,
          volumeRatio: 2.0,
          prevHigh: 71000,
          prevLow: 67000,
          todayOpen: 69000,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when RSI < 50', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          rsi14: 45,
          volumeRatio: 2.0,
          prevHigh: 71000,
          prevLow: 67000,
          todayOpen: 69000,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when RSI > 70', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          rsi14: 75,
          volumeRatio: 2.0,
          prevHigh: 71000,
          prevLow: 67000,
          todayOpen: 69000,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when volumeRatio < 1.5', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          rsi14: 60,
          volumeRatio: 1.2,
          prevHigh: 71000,
          prevLow: 67000,
          todayOpen: 69000,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when price below breakout level', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          rsi14: 60,
          volumeRatio: 2.0,
          prevHigh: 75000, // range = 75000 - 67000 = 8000
          prevLow: 67000,
          todayOpen: 69000, // breakout = 69000 + 8000*0.5 = 73000
        },
      });
      // curPrice(72000) < breakout(73000)

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when ma20 is undefined', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: undefined,
          rsi14: 60,
          volumeRatio: 2.0,
          prevHigh: 71000,
          prevLow: 67000,
          todayOpen: 69000,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when prevHigh/prevLow/todayOpen is undefined', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          rsi14: 60,
          volumeRatio: 2.0,
          prevHigh: undefined,
          prevLow: undefined,
          todayOpen: undefined,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when buyBlocked by risk', async () => {
      const ctx = createContext({
        riskState: {
          buyBlocked: true,
          liquidateAll: false,
          positionCount: 6,
          investedRate: 0.9,
          dailyPnlRate: 0,
          drawdown: 0,
          reasons: ['보유 종목 6개'],
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should cap buy amount to buyableAmount', async () => {
      const ctx = createContext({
        buyableAmount: 200000,
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      // buyAmount = min(1000000, 200000) = 200000
      // buyQty = floor(200000 / 72000) = 2
      expect(signals[0].quantity).toBe(2);
    });

    it('should return empty when quota is 0', async () => {
      const ctx = createContext();
      ctx.watchStock.quota = 0;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  describe('custom params via strategyParams', () => {
    it('should use custom kValue', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          rsi14: 60,
          volumeRatio: 2.0,
          prevHigh: 71000,
          prevLow: 67000, // range = 4000
          todayOpen: 69000,
        },
      });
      // default kValue=0.5 → breakout = 69000 + 4000*0.5 = 71000
      // curPrice(72000) >= 71000 → would buy

      // custom kValue=0.9 → breakout = 69000 + 4000*0.9 = 72600
      // curPrice(72000) < 72600 → should NOT buy
      ctx.watchStock.strategyParams = { kValue: 0.9 };

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should use custom volumeThreshold', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          rsi14: 60,
          volumeRatio: 2.0,
          prevHigh: 71000,
          prevLow: 67000,
          todayOpen: 69000,
        },
      });
      ctx.watchStock.strategyParams = { volumeThreshold: 3.0 };
      // volumeRatio(2.0) < 3.0 → should NOT buy

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should use custom stopLossRate', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 67500, // -3.6%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 67500;
      ctx.price.highPrice = 67500; // No trailing stop
      ctx.watchStock.strategyParams = { stopLossRate: 0.05 }; // 5%

      const signals = await strategy.evaluateStock(ctx);
      // -3.6% within custom 5% threshold
      const stopLoss = signals.find((s) => s.reason?.includes('손절'));
      expect(stopLoss).toBeUndefined();
    });

    it('should use custom takeProfitHalf and takeProfitFull', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 73800, // +5.4%
          totalInvested: 1400000,
        },
      });
      ctx.price.currentPrice = 73800;
      ctx.price.highPrice = 73800;
      ctx.watchStock.strategyParams = {
        takeProfitHalf: 0.10, // 10%
        takeProfitFull: 0.15, // 15%
      };

      const signals = await strategy.evaluateStock(ctx);
      // +5.4% is below custom 10% half threshold
      const takeProfit = signals.find((s) => s.reason?.includes('익절'));
      expect(takeProfit).toBeUndefined();
    });

    it('should use custom trailingStopRate', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 71000,
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 71000;
      ctx.price.highPrice = 73000;
      // default trailingStopRate=0.02: 71000 < 73000*0.98(71540) → trigger
      // custom trailingStopRate=0.05: 71000 < 73000*0.95(69350)? No → no trigger
      ctx.watchStock.strategyParams = { trailingStopRate: 0.05 };

      const signals = await strategy.evaluateStock(ctx);
      const trailing = signals.find((s) => s.reason?.includes('트레일링스탑'));
      expect(trailing).toBeUndefined();
    });
  });

  describe('sell priority order', () => {
    it('stop loss has highest priority', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 67500, // -3.6%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 67500;
      ctx.price.highPrice = 75000; // trailing stop would also trigger

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].reason).toContain('손절');
    });

    it('trailing stop checked before take profit', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 65000,
          currentPrice: 71000, // +9.2% profit → full take profit eligible
          totalInvested: 6500000,
        },
      });
      ctx.price.currentPrice = 71000;
      ctx.price.highPrice = 80000; // 71000 < 80000*0.98(78400) → trailing stop

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].reason).toContain('트레일링스탑');
    });

    it('full take profit checked before half', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 76000, // +8.6% → both half(5%) and full(8%) eligible
          totalInvested: 1400000,
        },
      });
      ctx.price.currentPrice = 76000;
      ctx.price.highPrice = 76000;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].reason).toContain('익절(전량)');
      expect(signals[0].quantity).toBe(20);
    });
  });

  describe('overseas market', () => {
    it('should round overseas prices to 2 decimal places', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.price.currentPrice = 150.567;
      ctx.stockIndicators.ma20 = 148;
      ctx.stockIndicators.prevHigh = 151;
      ctx.stockIndicators.prevLow = 147;
      ctx.stockIndicators.todayOpen = 149;
      // breakout = 149 + (151-147)*0.5 = 149 + 2 = 151
      // curPrice(150.567) < 151 → no buy
      // Change to make it trigger
      ctx.stockIndicators.todayOpen = 148;
      // breakout = 148 + 4*0.5 = 150
      // curPrice(150.567) >= 150 → buy

      const signals = await strategy.evaluateStock(ctx);
      if (signals.length > 0 && signals[0].price) {
        const decimal = signals[0].price.toString().split('.')[1] || '';
        expect(decimal.length).toBeLessThanOrEqual(2);
      }
    });

    it('should include exchangeCode for overseas signals', async () => {
      const ctx = createContext({
        position: {
          stockCode: 'AAPL',
          quantity: 10,
          avgPrice: 150,
          currentPrice: 145, // -3.3%
          totalInvested: 1500,
        },
      });
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.watchStock.stockCode = 'AAPL';
      ctx.price.currentPrice = 145;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].exchangeCode).toBe('NASD');
    });
  });

  describe('single stock portfolio limit', () => {
    it('should not buy when position exceeds 15% of portfolio', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 0, // No actual quantity, but totalInvested > 15%
          avgPrice: 70000,
          currentPrice: 72000,
          totalInvested: 2000000, // 2000000 / 10000000 = 20% > 15%
        },
        totalPortfolioValue: 10000000,
      });

      const signals = await strategy.evaluateStock(ctx);
      // hasPosition is false (quantity=0), but single stock limit checked
      // Actually, quantity=0 means hasPosition=false, and the limit check
      // is inside the no-position branch with `if (position && ...)`,
      // position exists but quantity=0, so it goes to else branch
      // and position is still defined, so the limit check runs
      expect(signals).toHaveLength(0);
    });
  });
});
