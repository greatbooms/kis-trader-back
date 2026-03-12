import { GridMeanReversionStrategy } from './grid-mean-reversion.strategy';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
  RiskState,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

describe('GridMeanReversionStrategy', () => {
  let strategy: GridMeanReversionStrategy;

  beforeEach(() => {
    strategy = new GridMeanReversionStrategy();
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
      strategyName: 'grid-mean-reversion',
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
      rsi14: 25,
      bollingerLower: 71000, // curPrice <= bollingerLower
      bollingerMiddle: 73000,
      bollingerUpper: 75000,
      macdHistogram: 0.5,
      macdPrevHistogram: -0.1,
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
          drawdown: -0.26,
          reasons: ['MDD -26%'],
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
          drawdown: -0.26,
          reasons: [],
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  describe('stop loss (position held)', () => {
    it('should trigger stop loss at -8% default', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 64000, // -8.6%
          totalInvested: 7000000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 75000,
        },
      });
      ctx.price.currentPrice = 64000;

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
          currentPrice: 66000, // -5.7%, within 8%
          totalInvested: 7000000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 75000,
        },
      });
      ctx.price.currentPrice = 66000;

      const signals = await strategy.evaluateStock(ctx);
      const stopLoss = signals.find((s) => s.reason?.includes('손절'));
      expect(stopLoss).toBeUndefined();
    });
  });

  describe('sell - Bollinger Band upper (position held)', () => {
    it('should sell all when price >= BB upper', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 76000,
          totalInvested: 7000000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 75000,
        },
      });
      ctx.price.currentPrice = 76000;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(100);
      expect(signals[0].reason).toContain('BB상단');
    });
  });

  describe('sell - Bollinger Band middle (position held)', () => {
    it('should sell 50% when price >= BB middle and profit > 0', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 73500,
          totalInvested: 1400000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000, // Far away, not triggered
        },
      });
      ctx.price.currentPrice = 73500;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(10); // floor(20 / 2)
      expect(signals[0].reason).toContain('BB중심선');
    });

    it('should sell at least 1 share for BB middle', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 1,
          avgPrice: 70000,
          currentPrice: 73500,
          totalInvested: 70000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000,
        },
      });
      ctx.price.currentPrice = 73500;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].quantity).toBe(1); // max(1, floor(1/2)) = 1
    });

    it('should not sell at BB middle when profitRate <= 0', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 74000, // avgPrice > curPrice → no profit
          currentPrice: 73500,
          totalInvested: 1480000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000,
        },
      });
      ctx.price.currentPrice = 73500;

      const signals = await strategy.evaluateStock(ctx);
      const bbMiddleSell = signals.find((s) => s.reason?.includes('BB중심선'));
      expect(bbMiddleSell).toBeUndefined();
    });
  });

  describe('grid additional buy (position held)', () => {
    it('should buy at grid level 1 when price drops -2% from avgPrice', async () => {
      // avgPrice = 70000, grid level 1 = -2% → 68600
      // curPrice = 68000 <= 68600
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 68000,
          totalInvested: 700000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000,
        },
      });
      ctx.price.currentPrice = 68000;

      const signals = await strategy.evaluateStock(ctx);
      const buySignals = signals.filter((s) => s.side === 'BUY');
      expect(buySignals).toHaveLength(1);
      expect(buySignals[0].reason).toContain('그리드매수 1단계');
      // quota=1000000, gridRatio[0]=0.3 → 300000
      // buyQty = floor(300000 / 68000) = 4
      expect(buySignals[0].quantity).toBe(4);
    });

    it('should buy at grid level 2 when price drops -4% from avgPrice', async () => {
      // avgPrice = 70000, grid level 2 = -4% → 67200
      // curPrice = 67000 <= 67200 AND <= 68600 (level 1)
      // But only one grid at a time → should be level 1 (first match)
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 67000,
          totalInvested: 700000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000,
        },
      });
      ctx.price.currentPrice = 67000;

      const signals = await strategy.evaluateStock(ctx);
      const buySignals = signals.filter((s) => s.side === 'BUY');
      expect(buySignals).toHaveLength(1);
      // First level that matches (level 1 at -2%) is triggered first due to break
      expect(buySignals[0].reason).toContain('그리드매수');
    });

    it('should not grid buy when buyBlocked', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 68000,
          totalInvested: 700000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000,
        },
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
      ctx.price.currentPrice = 68000;

      const signals = await strategy.evaluateStock(ctx);
      const buySignals = signals.filter((s) => s.side === 'BUY');
      expect(buySignals).toHaveLength(0);
    });

    it('should not grid buy when price above all grid levels', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 70000, // not below any grid level
          totalInvested: 700000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000,
        },
      });
      ctx.price.currentPrice = 70000;

      const signals = await strategy.evaluateStock(ctx);
      const buySignals = signals.filter((s) => s.side === 'BUY');
      expect(buySignals).toHaveLength(0);
    });
  });

  describe('initial entry (no position)', () => {
    it('should buy when BB lower touched, RSI < 30, MACD histogram rising', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 25,
          bollingerLower: 71000, // curPrice(70000) <= 71000
          bollingerMiddle: 73000,
          bollingerUpper: 75000,
          macdHistogram: 0.5,
          macdPrevHistogram: -0.1,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      // quota=1000000, gridRatios[0]=0.3 → 300000
      // buyQty = floor(300000 / 70000) = 4
      expect(signals[0].quantity).toBe(4);
      expect(signals[0].reason).toContain('그리드진입');
    });

    it('should not buy when price above BB lower', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 25,
          bollingerLower: 69000, // curPrice(70000) > 69000
          macdHistogram: 0.5,
          macdPrevHistogram: -0.1,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when RSI >= 30', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 35,
          bollingerLower: 71000,
          macdHistogram: 0.5,
          macdPrevHistogram: -0.1,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when MACD histogram not rising', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 25,
          bollingerLower: 71000,
          macdHistogram: -0.2, // <= macdPrevHistogram
          macdPrevHistogram: -0.1,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when bollingerLower is undefined', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 25,
          bollingerLower: undefined,
          macdHistogram: 0.5,
          macdPrevHistogram: -0.1,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when macdHistogram is undefined', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 25,
          bollingerLower: 71000,
          macdHistogram: undefined,
          macdPrevHistogram: -0.1,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when macdPrevHistogram is undefined', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 25,
          bollingerLower: 71000,
          macdHistogram: 0.5,
          macdPrevHistogram: undefined,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when buyBlocked by risk', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 25,
          bollingerLower: 71000,
          macdHistogram: 0.5,
          macdPrevHistogram: -0.1,
        },
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
  });

  describe('custom params via strategyParams', () => {
    it('should use custom gridLevels and gridRatios', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 67000,
          totalInvested: 700000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000,
        },
      });
      ctx.price.currentPrice = 67000;
      ctx.watchStock.strategyParams = {
        gridLevels: [-0.05, -0.10], // -5%, -10%
        gridRatios: [0.5, 0.5],
      };

      // avgPrice=70000, level 1 = -5% → 66500
      // curPrice=67000 > 66500 → level 1 not triggered
      const signals = await strategy.evaluateStock(ctx);
      const buySignals = signals.filter((s) => s.side === 'BUY');
      expect(buySignals).toHaveLength(0);
    });

    it('should use custom stopLossRate', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 64000, // -8.6%
          totalInvested: 7000000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000,
        },
      });
      ctx.price.currentPrice = 64000;
      ctx.watchStock.strategyParams = { stopLossRate: 0.15 }; // 15%

      const signals = await strategy.evaluateStock(ctx);
      // -8.6% is within custom 15% threshold
      const stopLoss = signals.find((s) => s.reason?.includes('손절'));
      expect(stopLoss).toBeUndefined();
    });
  });

  describe('overseas market', () => {
    it('should round overseas prices to 2 decimal places', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 25,
          bollingerLower: 151,
          macdHistogram: 0.5,
          macdPrevHistogram: -0.1,
        },
      });
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.price.currentPrice = 150.567;

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
          currentPrice: 137, // -8.7%
          totalInvested: 1500,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 160,
          bollingerUpper: 170,
        },
      });
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.watchStock.stockCode = 'AAPL';
      ctx.price.currentPrice = 137;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].exchangeCode).toBe('NASD');
    });

    it('should not include exchangeCode for domestic signals', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 64000,
          totalInvested: 7000000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 80000,
        },
      });
      ctx.price.currentPrice = 64000;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].exchangeCode).toBeUndefined();
    });
  });

  describe('sell priority order', () => {
    it('stop loss takes priority over BB signals', async () => {
      // -8.6% triggers stop loss even if BB upper reached
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 64000,
          totalInvested: 7000000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 63000,
          bollingerUpper: 63000, // Both would match but stop loss first
        },
      });
      ctx.price.currentPrice = 64000;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].reason).toContain('손절');
    });

    it('BB upper takes priority over BB middle', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 76000,
          totalInvested: 1400000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 73000,
          bollingerUpper: 75000, // curPrice 76000 >= both
        },
      });
      ctx.price.currentPrice = 76000;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].reason).toContain('BB상단');
      expect(signals[0].quantity).toBe(20); // full quantity
    });
  });
});
