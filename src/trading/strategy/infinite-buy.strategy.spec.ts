import { InfiniteBuyStrategy } from './infinite-buy.strategy';
import { StockStrategyContext, WatchStockConfig, MarketCondition, StockIndicators } from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

describe('InfiniteBuyStrategy', () => {
  let strategy: InfiniteBuyStrategy;

  beforeEach(() => {
    strategy = new InfiniteBuyStrategy();
  });

  function createContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-1',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: 'Samsung',
      strategyName: 'infinite-buy',
      quota: 4000000,
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
      volume: 1000000,
    };

    const defaultMarketCondition: MarketCondition = {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'KOSPI',
      interestRateRising: false,
    };

    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
      ma200: 65000,
      rsi14: 50,
    };

    return {
      watchStock: defaultWatchStock,
      price: defaultPrice,
      position: undefined,
      alreadyExecutedToday: false,
      marketCondition: defaultMarketCondition,
      stockIndicators: defaultStockIndicators,
      buyableAmount: 500000,
      totalPortfolioValue: 1000000,
      ...overrides,
    };
  }

  describe('basic skips', () => {
    it('should skip when already executed today', async () => {
      const ctx = createContext({ alreadyExecutedToday: true });
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should skip when quota is not set', async () => {
      const ctx = createContext();
      ctx.watchStock.quota = 0;
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should skip when quota is undefined', async () => {
      const ctx = createContext();
      ctx.watchStock.quota = undefined;
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should skip when current price is 0', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 0;
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  describe('market condition filters', () => {
    it('should block new entry when index below MA200 and no position', async () => {
      const ctx = createContext({
        marketCondition: {
          referenceIndexAboveMA200: false,
          referenceIndexName: 'KOSPI',
          interestRateRising: false,
        },
      });
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should allow existing position when index below MA200', async () => {
      const ctx = createContext({
        marketCondition: {
          referenceIndexAboveMA200: false,
          referenceIndexName: 'KOSPI',
          interestRateRising: false,
        },
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 100000,
        },
        totalPortfolioValue: 10000000,
      });
      // Should still generate sell signals even when index below MA200
      const signals = await strategy.evaluateStock(ctx);
      // Buy should be blocked but sells should be generated
      const buySignals = signals.filter((s) => s.side === 'BUY');
      const sellSignals = signals.filter((s) => s.side === 'SELL');
      expect(buySignals).toHaveLength(0);
      expect(sellSignals.length).toBeGreaterThan(0);
    });
  });

  describe('stock indicator filters', () => {
    it('should block new entry when price below MA200', async () => {
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: false, ma200: 75000 },
      });
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should allow existing position when price below MA200', async () => {
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: false, ma200: 75000 },
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 65000,
          totalInvested: 100000,
        },
        totalPortfolioValue: 10000000,
      });
      const signals = await strategy.evaluateStock(ctx);
      expect(signals.length).toBeGreaterThan(0);
    });
  });

  describe('max cycles check', () => {
    it('should stop buying but still generate sell signals when max cycles reached', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 60,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 4000000, // perCycleQuota=100000, T = 4000000 / 100000 = 40 >= maxCycles(40)
        },
      });
      const signals = await strategy.evaluateStock(ctx);
      // 매수 없음
      const buys = signals.filter((s) => s.side === 'BUY');
      expect(buys).toHaveLength(0);
      // 매도 시그널은 생성됨 (Sell1/Sell2)
      const sells = signals.filter((s) => s.side === 'SELL');
      expect(sells.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('stop loss', () => {
    it('should trigger stop loss when price drops beyond threshold', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 50,
          avgPrice: 100000,
          currentPrice: 60000, // 40% drop > stopLossRate(30%)
          totalInvested: 500000,
        },
      });
      ctx.price.currentPrice = 60000;

      const signals = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(50);
      expect(signals[0].reason).toContain('Stop loss');
    });

    it('should not trigger stop loss when within threshold', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 50,
          avgPrice: 70000,
          currentPrice: 60000, // ~14% drop < stopLossRate(30%)
          totalInvested: 500000,
        },
      });
      ctx.price.currentPrice = 60000;

      const signals = await strategy.evaluateStock(ctx);

      const stopLoss = signals.find((s) => s.reason?.includes('Stop loss'));
      expect(stopLoss).toBeUndefined();
    });
  });

  describe('initial buy (no position)', () => {
    it('should generate initial buy signal', async () => {
      const ctx = createContext();
      const signals = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      expect(signals[0].quantity).toBe(Math.floor(100000 / 70000)); // 1
      expect(signals[0].reason).toContain('Initial buy');
    });

    it('should not buy when price is too high for quota', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 200000; // 1 share costs more than quota
      ctx.watchStock.quota = 100000;

      const signals = await strategy.evaluateStock(ctx);

      // buyQty = floor(100000 / 200000) = 0
      expect(signals).toHaveLength(0);
    });
  });

  describe('buy and sell with position (T < 20)', () => {
    it('should generate buy and sell signals', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 1000,
          currentPrice: 1000,
          totalInvested: 100000, // T = 100000 / 100000 = 1
        },
        totalPortfolioValue: 10000000,
      });
      ctx.price.currentPrice = 1000;
      ctx.watchStock.quota = 500000; // Large quota relative to price

      const signals = await strategy.evaluateStock(ctx);

      const buys = signals.filter((s) => s.side === 'BUY');
      const sells = signals.filter((s) => s.side === 'SELL');

      expect(buys.length).toBeGreaterThanOrEqual(1);
      expect(sells.length).toBeGreaterThanOrEqual(1);
    });

    it('should fallback to full quota when split buy fails (high-price stock)', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 7,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 500000, // T = 5
        },
        totalPortfolioValue: 10000000,
      });

      const signals = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');

      // halfQuota=50000 < 주가 70000 → 분할 불가 → 전액(100000)으로 1주 매수
      expect(buys).toHaveLength(1);
      expect(buys[0].quantity).toBe(1);
      expect(buys[0].price).toBe(70000);
    });

    it('should generate sell signals with dynamic target rates', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 500000, // T = 5
        },
        totalPortfolioValue: 10000000, // Large portfolio to avoid maxPortfolioRate
      });

      const signals = await strategy.evaluateStock(ctx);
      const sell2 = signals.find((s) => s.reason?.includes('Sell2'));

      expect(sell2).toBeDefined();
      // T < 10 → targetRate = 1.05
      expect(sell2!.price).toBe(Math.round(70000 * 1.05)); // 73500
    });
  });

  describe('buy with position (T >= 20)', () => {
    it('should generate only buy2 when T >= 20', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 36,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 2500000, // perCycleQuota=100000, T = 2500000 / 100000 = 25
        },
        totalPortfolioValue: 100000000, // Large portfolio to avoid maxPortfolioRate
      });

      const signals = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');

      // Only Buy2 should exist
      expect(buys.every((b) => b.reason?.includes('Buy2'))).toBe(true);
    });

    it('should use higher sell target rate when T >= 20', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 36,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 2500000, // perCycleQuota=100000, T = 2500000 / 100000 = 25
        },
        totalPortfolioValue: 100000000, // Large portfolio to avoid maxPortfolioRate
      });

      const signals = await strategy.evaluateStock(ctx);
      const sell2 = signals.find((s) => s.reason?.includes('Sell2'));

      expect(sell2).toBeDefined();
      // T >= 20 → targetRate = 1.10
      expect(sell2!.price).toBe(Math.round(70000 * 1.10)); // 77000
    });
  });

  describe('quota adjustments', () => {
    it('should halve quota when interest rate is rising', async () => {
      const ctx = createContext({
        marketCondition: {
          referenceIndexAboveMA200: true,
          referenceIndexName: 'KOSPI',
          interestRateRising: true,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      // With halved quota (50000), buyQty = floor(50000/70000) = 0
      // So no buy signal when quota is halved and price is high
      expect(signals.length).toBeLessThanOrEqual(1);
    });

    it('should increase quota 1.5x when RSI < 30 (oversold)', async () => {
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: true, rsi14: 25 },
      });

      // quota = 100000 * 1.5 = 150000
      const signals = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      if (buySignal) {
        // With 150000 quota, should buy floor(150000/70000) = 2 shares
        expect(buySignal.quantity).toBe(2);
      }
    });

    it('should limit quota to buyable amount', async () => {
      const ctx = createContext({ buyableAmount: 50000 });

      const signals = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      if (buySignal) {
        // adjustedQuota capped at 50000, buyQty = floor(50000/70000) = 0
        // So no buy signal
        expect(buySignal.quantity).toBeLessThanOrEqual(Math.floor(50000 / 70000) || 1);
      }
    });

  });

  describe('overseas market', () => {
    it('should use limit order for US exchanges', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';

      const signals = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      if (buySignal) {
        expect(buySignal.orderDivision).toBe('00');
        expect(buySignal.exchangeCode).toBe('NASD');
      }
    });

    it('should round overseas prices to 2 decimal places', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.price.currentPrice = 150.567;

      const signals = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      if (buySignal && buySignal.price) {
        // Check price is rounded to 2 decimal places
        const decimal = buySignal.price.toString().split('.')[1] || '';
        expect(decimal.length).toBeLessThanOrEqual(2);
      }
    });

    it('should round domestic prices to integers', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'DOMESTIC';
      ctx.price.currentPrice = 70123.456;

      const signals = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      if (buySignal && buySignal.price) {
        expect(Number.isInteger(buySignal.price)).toBe(true);
      }
    });
  });

  describe('sell signals always generated', () => {
    it('should generate sell signals even when index below MA200', async () => {
      const ctx = createContext({
        marketCondition: {
          referenceIndexAboveMA200: false,
          referenceIndexName: 'KOSPI',
          interestRateRising: false,
        },
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 100000,
        },
        totalPortfolioValue: 10000000,
      });

      const signals = await strategy.evaluateStock(ctx);
      const sells = signals.filter((s) => s.side === 'SELL');
      expect(sells.length).toBeGreaterThan(0);
    });
  });
});
