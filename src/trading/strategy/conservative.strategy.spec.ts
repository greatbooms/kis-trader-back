import { ConservativeStrategy } from './conservative.strategy';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
  RiskState,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

describe('ConservativeStrategy', () => {
  let strategy: ConservativeStrategy;

  beforeEach(() => {
    strategy = new ConservativeStrategy();
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
      strategyName: 'conservative',
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
      rsi14: 20,
      volumeRatio: 2.5,
    };

    return {
      watchStock: defaultWatchStock,
      price: defaultPrice,
      position: undefined,
      alreadyExecutedToday: false,
      marketCondition: defaultMarketCondition,
      stockIndicators: defaultStockIndicators,
      buyableAmount: 500000,
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
          currentPrice: 60000,
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

    it('should not generate liquidateAll when no position', async () => {
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
      // No position, so no liquidation signal; buy blocked so no buy either
      expect(signals).toHaveLength(0);
    });
  });

  describe('stop loss (position held)', () => {
    it('should trigger stop loss at -5% default', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 66000, // -5.7%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 66000;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(100);
      expect(signals[0].reason).toContain('손절');
    });

    it('should not trigger stop loss when within threshold', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 68000, // -2.9%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 68000;

      const signals = await strategy.evaluateStock(ctx);
      const stopLoss = signals.find((s) => s.reason?.includes('손절'));
      expect(stopLoss).toBeUndefined();
    });

    it('should use custom stopLossRate from strategyParams', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 66500, // -5%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 66500;
      ctx.watchStock.strategyParams = { stopLossRate: 0.10 }; // 10%

      const signals = await strategy.evaluateStock(ctx);
      // -5% is within custom 10% threshold
      const stopLoss = signals.find((s) => s.reason?.includes('손절'));
      expect(stopLoss).toBeUndefined();
    });
  });

  describe('take profit (position held)', () => {
    it('should trigger take profit at +3% default', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 72500, // +3.6%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 72500;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(100);
      expect(signals[0].reason).toContain('익절');
    });

    it('should not trigger take profit when below threshold', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 71000, // +1.4%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 71000;

      const signals = await strategy.evaluateStock(ctx);
      const takeProfit = signals.find((s) => s.reason?.includes('익절'));
      expect(takeProfit).toBeUndefined();
    });

    it('should use custom takeProfitRate from strategyParams', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 72500, // +3.6%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 72500;
      ctx.watchStock.strategyParams = { takeProfitRate: 0.05 }; // 5%

      const signals = await strategy.evaluateStock(ctx);
      // +3.6% is below custom 5% threshold
      const takeProfit = signals.find((s) => s.reason?.includes('익절'));
      expect(takeProfit).toBeUndefined();
    });
  });

  describe('buy entry (no position)', () => {
    it('should generate buy when RSI < 25 and volumeRatio >= 2.0', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 20,
          volumeRatio: 2.5,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      // quota=1000000, cashRate=0.7 → available=30% → 300000
      // buyQty = floor(300000 / 70000) = 4
      expect(signals[0].quantity).toBe(4);
      expect(signals[0].reason).toContain('보수적매수');
    });

    it('should not buy when RSI >= 25', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 30,
          volumeRatio: 2.5,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when volumeRatio < 2.0', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 20,
          volumeRatio: 1.5,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when rsi14 is undefined', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: undefined,
          volumeRatio: 2.5,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when volumeRatio is undefined', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 20,
          volumeRatio: undefined,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not buy when buyBlocked by risk', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 20,
          volumeRatio: 2.5,
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

    it('should cap buy amount to buyableAmount', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 20,
          volumeRatio: 2.5,
        },
        buyableAmount: 100000, // Less than quota * 0.3 (300000)
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      // buyAmount = min(300000, 100000) = 100000
      // buyQty = floor(100000 / 70000) = 1
      expect(signals[0].quantity).toBe(1);
    });

    it('should return empty when quota is 0', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 20,
          volumeRatio: 2.5,
        },
      });
      ctx.watchStock.quota = 0;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  describe('custom params via strategyParams', () => {
    it('should use custom rsiThreshold and volumeThreshold', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 35, // Above default 25, but below custom 40
          volumeRatio: 1.2, // Below default 2.0, but above custom 1.0
        },
      });
      ctx.watchStock.strategyParams = {
        rsiThreshold: 40,
        volumeThreshold: 1.0,
      };

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
    });

    it('should use custom cashRate', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 20,
          volumeRatio: 2.5,
        },
      });
      ctx.watchStock.strategyParams = { cashRate: 0.5 }; // 50% available instead of 30%

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      // quota=1000000, cashRate=0.5 → available=50% → 500000
      // buyAmount = min(500000, 500000) = 500000
      // buyQty = floor(500000 / 70000) = 7
      expect(signals[0].quantity).toBe(7);
    });
  });

  describe('overseas market', () => {
    it('should round overseas prices to 2 decimal places', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 20,
          volumeRatio: 2.5,
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

    it('should include exchangeCode for overseas sell', async () => {
      const ctx = createContext({
        position: {
          stockCode: 'AAPL',
          quantity: 10,
          avgPrice: 150,
          currentPrice: 142, // -5.3%
          totalInvested: 1500,
        },
      });
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.watchStock.stockCode = 'AAPL';
      ctx.price.currentPrice = 142;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].exchangeCode).toBe('NASD');
    });
  });

  describe('priority: stop loss before take profit', () => {
    it('stop loss takes priority (checked first)', async () => {
      // With -5% stop loss, position at -6%
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 65000, // -7.1%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 65000;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].reason).toContain('손절');
    });
  });
});
