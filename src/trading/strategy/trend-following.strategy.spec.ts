import { TrendFollowingStrategy } from './trend-following.strategy';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
  RiskState,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

describe('TrendFollowingStrategy', () => {
  let strategy: TrendFollowingStrategy;

  beforeEach(() => {
    strategy = new TrendFollowingStrategy();
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
      strategyName: 'trend-following',
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

    // Default: golden cross + strong trend + price > MA20
    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
      ma200: 65000,
      ma20: 70000,
      ma60: 68000,
      adx14: 30,
      rsi14: 55,
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

  describe('metadata', () => {
    it('should have correct name and displayName', () => {
      expect(strategy.name).toBe('trend-following');
      expect(strategy.displayName).toBe('추세 추종');
    });

    it('should have once-daily execution mode', () => {
      expect(strategy.executionMode).toEqual({
        type: 'once-daily',
        hours: { domestic: 15, overseas: { basis: 'beforeClose', offsetHours: 1 } },
      });
    });
  });

  describe('basic guards', () => {
    it('should return empty when price is 0', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 0;
      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should return empty when price is negative', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = -100;
      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should return empty when already executed today', async () => {
      const ctx = createContext({ alreadyExecutedToday: true });
      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should return empty when ma20 is undefined', async () => {
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: true, ma20: undefined, ma60: 68000, adx14: 30 },
      });
      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should return empty when ma60 is undefined', async () => {
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: true, ma20: 70000, ma60: undefined, adx14: 30 },
      });
      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should return empty when adx14 is undefined', async () => {
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: true, ma20: 70000, ma60: 68000, adx14: undefined },
      });
      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
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
          drawdown: -0.21,
          reasons: ['MDD -21%'],
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
          drawdown: -0.21,
          reasons: [],
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  describe('buy entry (no position)', () => {
    it('should buy when golden cross + strong trend + price > MA20', async () => {
      const ctx = createContext();
      // ma20(70000) > ma60(68000), adx14(30) > 25, curPrice(72000) > ma20(70000)

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      expect(signals[0].quantity).toBe(13); // floor(1000000/72000)
      expect(signals[0].reason).toContain('추세진입');
    });

    it('should not buy when dead cross (ma20 < ma60)', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 67000,
          ma60: 68000,
          adx14: 30,
        },
      });

      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should not buy when weak trend (adx < 25)', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          ma60: 68000,
          adx14: 20,
        },
      });

      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should not buy when price <= MA20', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 69000; // below ma20(70000)

      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
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

      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should cap buy amount to buyableAmount', async () => {
      const ctx = createContext({ buyableAmount: 200000 });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].quantity).toBe(2); // floor(200000/72000)
    });

    it('should return empty when quota is 0', async () => {
      const ctx = createContext();
      ctx.watchStock.quota = 0;

      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });
  });

  describe('stop loss (position held)', () => {
    it('should trigger stop loss at -7% default', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 64900, // -7.3%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 64900;

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
          currentPrice: 66000, // -5.7%, within 7%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 66000;

      const signals = await strategy.evaluateStock(ctx);
      const stopLoss = signals.find((s) => s.reason?.includes('손절'));
      expect(stopLoss).toBeUndefined();
    });

    it('should use custom stopLossRate', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 64900, // -7.3%
          totalInvested: 7000000,
        },
      });
      ctx.price.currentPrice = 64900;
      ctx.watchStock.strategyParams = { stopLossRate: 0.10 }; // 10%

      const signals = await strategy.evaluateStock(ctx);
      // -7.3% within custom 10% threshold → no stop loss, check trend exit instead
      const stopLoss = signals.find((s) => s.reason?.includes('손절'));
      expect(stopLoss).toBeUndefined();
    });
  });

  describe('trend exit (position held)', () => {
    it('should sell on dead cross', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 50,
          avgPrice: 70000,
          currentPrice: 72000,
          totalInvested: 3500000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 67000, // dead cross
          ma60: 68000,
          adx14: 30,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(50);
      expect(signals[0].reason).toContain('데드크로스');
    });

    it('should sell on weak trend (adx < 20)', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 50,
          avgPrice: 70000,
          currentPrice: 72000,
          totalInvested: 3500000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          ma60: 68000, // golden cross still
          adx14: 18, // weak trend
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(50);
      expect(signals[0].reason).toContain('추세소멸');
    });

    it('should use custom adxExitThreshold', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 50,
          avgPrice: 70000,
          currentPrice: 72000,
          totalInvested: 3500000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          ma60: 68000,
          adx14: 18,
        },
      });
      ctx.watchStock.strategyParams = { adxExitThreshold: 15 };

      // adx14(18) >= custom threshold(15) → no exit
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });
  });

  describe('pyramiding (position held, trend continues)', () => {
    it('should add to position when profit > 5% and trend strong', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 13,
          avgPrice: 68000,
          currentPrice: 72000, // +5.9%
          totalInvested: 884000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          ma60: 68000,
          adx14: 30,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      // pyramidAmount = min(1000000 * 0.5, 1000000) = 500000
      // pyramidQty = floor(500000 / 72000) = 6
      expect(signals[0].quantity).toBe(6);
      expect(signals[0].reason).toContain('피라미딩');
    });

    it('should not pyramid when profit < 5%', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 13,
          avgPrice: 70000,
          currentPrice: 72000, // +2.9%
          totalInvested: 910000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          ma60: 68000,
          adx14: 30,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not pyramid when trend is weak', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 13,
          avgPrice: 68000,
          currentPrice: 72000, // +5.9%
          totalInvested: 884000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          ma60: 68000,
          adx14: 22, // below 25 threshold → weak for pyramiding but above 20 exit
        },
      });

      // adx14(22) < adxThreshold(25) → no pyramiding
      // adx14(22) >= adxExitThreshold(20) → no exit either
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should not pyramid when buyBlocked', async () => {
      const ctx = createContext({
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
        riskState: {
          buyBlocked: true,
          liquidateAll: false,
          positionCount: 5,
          investedRate: 0.9,
          dailyPnlRate: 0,
          drawdown: 0,
          reasons: ['투자비율 초과'],
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should cap pyramiding amount to buyableAmount', async () => {
      const ctx = createContext({
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
        buyableAmount: 100000,
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      // pyramidAmount = min(500000, 100000) = 100000
      // pyramidQty = floor(100000 / 72000) = 1
      expect(signals[0].quantity).toBe(1);
    });
  });

  describe('sell priority', () => {
    it('stop loss has higher priority than trend exit', async () => {
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
          ma20: 67000, // dead cross too
          ma60: 68000,
          adx14: 18, // weak trend too
        },
      });
      ctx.price.currentPrice = 64000;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].reason).toContain('손절');
    });
  });

  describe('overseas market', () => {
    it('should round overseas prices to 2 decimal places', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.watchStock.stockCode = 'AAPL';
      ctx.price.currentPrice = 185.567;
      ctx.stockIndicators.ma20 = 180;
      ctx.stockIndicators.ma60 = 175;
      ctx.stockIndicators.adx14 = 30;

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].exchangeCode).toBe('NASD');
      if (signals[0].price) {
        const decimal = signals[0].price.toString().split('.')[1] || '';
        expect(decimal.length).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('custom params via strategyParams', () => {
    it('should use custom adxThreshold', async () => {
      const ctx = createContext({
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          ma60: 68000,
          adx14: 30,
        },
      });
      ctx.watchStock.strategyParams = { adxThreshold: 35 };
      // adx14(30) < custom threshold(35) → no buy

      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should use custom pyramidingProfitRate', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 13,
          avgPrice: 68000,
          currentPrice: 72000, // +5.9%
          totalInvested: 884000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          ma60: 68000,
          adx14: 30,
        },
      });
      ctx.watchStock.strategyParams = { pyramidingProfitRate: 0.10 };
      // +5.9% < 10% → no pyramiding

      expect(await strategy.evaluateStock(ctx)).toHaveLength(0);
    });

    it('should use custom pyramidingRatio', async () => {
      const ctx = createContext({
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
      ctx.watchStock.strategyParams = { pyramidingRatio: 0.3 };

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      // pyramidAmount = min(1000000 * 0.3, 1000000) = 300000
      // pyramidQty = floor(300000 / 72000) = 4
      expect(signals[0].quantity).toBe(4);
    });
  });
});
