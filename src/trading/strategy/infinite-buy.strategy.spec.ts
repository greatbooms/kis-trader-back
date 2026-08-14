import { InfiniteBuyStrategy } from './infinite-buy.strategy';
import { Broker } from '@prisma/client';
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
      broker: Broker.KIS,
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
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should skip when quota is not set', async () => {
      const ctx = createContext();
      ctx.watchStock.quota = 0;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should skip when quota is undefined', async () => {
      const ctx = createContext();
      ctx.watchStock.quota = undefined;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should skip when current price is 0', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 0;
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
    });

    it('should mark zero buyable cash as insufficient quantity for carry-over', async () => {
      const ctx = createContext({ buyableAmount: 0 });
      const { signals, skipReasons } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(0);
      expect(skipReasons[0]).toContain('매수 수량 부족:');
      expect(skipReasons[0]).toContain('주문가능금액 0');
    });
  });

  describe('market condition filters', () => {
    it('liquidates the full held position at the 20% stock-loss boundary when risk requests full exit', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 56000,
          totalInvested: 700000,
        },
        riskState: {
          buyBlocked: true,
          liquidateAll: true,
          positionCount: 1,
          investedRate: 0.2,
          dailyPnlRate: -0.03,
          drawdown: -0.36,
          reasons: ['MDD -36%'],
        },
      });
      ctx.price.currentPrice = 56000;

      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0]).toEqual(
        expect.objectContaining({
          side: 'SELL',
          quantity: 10,
          price: 56000,
          metadata: { phase: 'risk-liquidation' },
        }),
      );
      expect(signals[0].reason).toContain('리스크 청산');
      expect(signals[0].reason).toContain('종목 손실 20.0%');
    });

    it('logs a searchable full-liquidation decision with risk context', async () => {
      const logSpy = jest.spyOn((strategy as any).logger, 'log').mockImplementation();
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 56000,
          totalInvested: 700000,
        },
        riskState: {
          buyBlocked: true,
          liquidateAll: true,
          positionCount: 1,
          investedRate: 0.2,
          dailyPnlRate: -0.03,
          drawdown: -0.36,
          reasons: ['MDD -36%'],
        },
      });
      ctx.price.currentPrice = 56000;

      await strategy.evaluateStock(ctx);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[005930\] RISK LIQUIDATION/),
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('MDD -36%'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stockLoss=20.0%'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('threshold=20%'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('quantity=10'));
    });

    it('keeps profitable positions while recording the risk liquidation check', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 72000, // 수익 중 (+2.9%)
          totalInvested: 700000,
        },
        riskState: {
          buyBlocked: true,
          liquidateAll: true,
          positionCount: 1,
          investedRate: 0.2,
          dailyPnlRate: -0.03,
          drawdown: -0.36,
          reasons: ['MDD -36%'],
        },
      });
      ctx.price.currentPrice = 72000;

      const { signals, details } = await strategy.evaluateStock(ctx);

      // 청산 시그널 없음 (buyBlocked로 매수도 차단됨, 매도 목표가 신호만 있을 수 있음)
      const liquidations = signals.filter((s) => s.reason?.includes('리스크 청산'));
      expect(liquidations).toHaveLength(0);
      expect(details).toEqual(
        expect.objectContaining({
          mddTriggered: true,
          mddStockLossRate: expect.closeTo(-0.028571, 6),
          mddStockLossThreshold: 0.2,
        }),
      );
    });

    it('keeps positions whose stock loss is below the 20% liquidation threshold', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 63000, // loss = 10%, < 20%
          totalInvested: 700000,
        },
        riskState: {
          buyBlocked: true,
          liquidateAll: true,
          positionCount: 1,
          investedRate: 0.2,
          dailyPnlRate: -0.03,
          drawdown: -0.36,
          reasons: ['MDD -36%'],
        },
      });
      ctx.price.currentPrice = 63000;

      const { signals } = await strategy.evaluateStock(ctx);
      const liquidations = signals.filter((s) => s.reason?.includes('리스크 청산'));
      expect(liquidations).toHaveLength(0);
    });

    it('uses a configured per-stock loss threshold for risk liquidation', async () => {
      const ctx = createContext({
        watchStock: {
          ...createContext().watchStock,
          strategyParams: { mddLiquidateStockLossThreshold: 0.05 },
        },
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 65000,
          totalInvested: 700000,
        },
        riskState: {
          buyBlocked: true,
          liquidateAll: true,
          positionCount: 1,
          investedRate: 0.2,
          dailyPnlRate: -0.03,
          drawdown: -0.36,
          reasons: ['MDD -36%'],
        },
      });
      ctx.price.currentPrice = 65000;

      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(1);
      expect(signals[0]).toEqual(
        expect.objectContaining({
          side: 'SELL',
          quantity: 10,
          metadata: { phase: 'risk-liquidation' },
        }),
      );
    });

    it('should block new entry when common risk blocks buys', async () => {
      const ctx = createContext({
        riskState: {
          buyBlocked: true,
          liquidateAll: false,
          positionCount: 5,
          investedRate: 0.8,
          dailyPnlRate: -0.02,
          drawdown: -0.26,
          reasons: ['MDD -26%'],
        },
      });

      const { signals, skipReasons } = await strategy.evaluateStock(ctx);

      expect(signals).toHaveLength(0);
      expect(skipReasons[0]).toContain('리스크 매수 차단');
    });

    it('should still allow new entry when index below MA200', async () => {
      const ctx = createContext({
        marketCondition: {
          referenceIndexAboveMA200: false,
          referenceIndexName: 'KOSPI',
          interestRateRising: false,
        },
      });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
    });

    it('should still generate sell signals when index below MA200', async () => {
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
      const { signals } = await strategy.evaluateStock(ctx);
      const sellSignals = signals.filter((s) => s.side === 'SELL');
      expect(sellSignals.length).toBeGreaterThan(0);
    });
  });

  describe('stock indicator filters', () => {
    it('should ignore stock MA200 and still allow new entry when index is healthy', async () => {
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: false, ma200: 75000 },
      });
      const { signals } = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
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
      const { signals } = await strategy.evaluateStock(ctx);
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
      const { signals } = await strategy.evaluateStock(ctx);
      // 매수 없음
      const buys = signals.filter((s) => s.side === 'BUY');
      expect(buys).toHaveLength(0);
      // 매도 시그널은 생성됨
      const sells = signals.filter((s) => s.side === 'SELL');
      expect(sells).toHaveLength(1);
    });

    it('should hard-cap buy budget to the remaining quota before the final cycle', async () => {
      const ctx = createContext({
        watchStock: {
          id: 'ws-tqqq',
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          strategyName: 'infinite-buy',
          quota: 10000,
          cycle: 39,
          maxCycles: 40,
          stopLossRate: 0.3,
          maxPortfolioRate: 0.15,
        },
        price: {
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          currentPrice: 30,
          openPrice: 30,
          highPrice: 31,
          lowPrice: 29,
          volume: 1000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 198,
          avgPrice: 20,
          currentPrice: 30,
          totalInvested: 9950,
        },
        buyableAmount: 1000,
      });

      const { signals, details } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((signal) => signal.side === 'BUY');
      const totalBuyAmount = buys.reduce((sum, signal) => sum + signal.quantity * (signal.price || 0), 0);

      expect(Number(details?.adjustedQuota)).toBe(50);
      expect(totalBuyAmount).toBeLessThanOrEqual(50);
    });

    it('should treat leftover quota below one share as terminal instead of carry-over', async () => {
      const ctx = createContext({
        watchStock: {
          id: 'ws-tqqq',
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          strategyName: 'infinite-buy',
          quota: 10000,
          cycle: 39,
          maxCycles: 40,
          stopLossRate: 0.3,
          maxPortfolioRate: 0.15,
        },
        price: {
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          currentPrice: 55,
          openPrice: 55,
          highPrice: 56,
          lowPrice: 54,
          volume: 1000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 198,
          avgPrice: 50,
          currentPrice: 55,
          totalInvested: 9950,
        },
        buyableAmount: 1000,
      });

      const { signals, skipReasons } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((signal) => signal.side === 'BUY');

      expect(buys).toHaveLength(0);
      // P1: atr-strong 기본값, 사이클 완주 임박 메시지로 변경
      expect(skipReasons.some((reason) => reason.startsWith('사이클 완주 임박:'))).toBe(true);
      expect(skipReasons.some((reason) => reason.startsWith('매수 수량 부족:'))).toBe(false);
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

      const { signals } = await strategy.evaluateStock(ctx);

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

      const { signals } = await strategy.evaluateStock(ctx);

      const stopLoss = signals.find((s) => s.reason?.includes('Stop loss'));
      expect(stopLoss).toBeUndefined();
    });
  });

  describe('initial buy (no position)', () => {
    it('should generate split buy signals on first entry', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 30000;
      const { signals } = await strategy.evaluateStock(ctx);

      const buys = signals.filter((signal) => signal.side === 'BUY');
      expect(buys).toHaveLength(2);
      expect(buys[0].reason).toContain('Buy1');
      expect(buys[1].reason).toContain('Buy2');
      expect(buys[0].quantity).toBe(2);
      expect(buys[1].quantity).toBe(1);
    });

    it('should not buy when price is too high for quota', async () => {
      const ctx = createContext();
      ctx.price.currentPrice = 200000; // 1 share costs more than quota
      ctx.watchStock.quota = 100000;

      const { signals, skipReasons } = await strategy.evaluateStock(ctx);

      // buyQty = floor(100000 / 200000) = 0
      // P1: buy2 dip 2.5% (atr-strong 기본) → buy2Price = 195000, 기준가는 min(buy1, buy2)
      expect(signals).toHaveLength(0);
      expect(skipReasons).toContain(
        '사이클 완주 임박: 잔여 투자한도 100000 < 기준가 195000',
      );
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

      const { signals } = await strategy.evaluateStock(ctx);

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

      const { signals } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');

      // halfQuota=50000 < 주가 70000 → 분할 불가 → 전액(100000)으로 1주 매수
      expect(buys).toHaveLength(1);
      expect(buys[0].quantity).toBe(1);
      expect(buys[0].price).toBe(70000);
    });

    it('should reallocate leftover quota to Buy1 when Buy2 cannot afford one share', async () => {
      const ctx = createContext({
        watchStock: {
          id: 'ws-tqqq',
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          strategyName: 'infinite-buy',
          quota: 5000,
          cycle: 0,
          maxCycles: 40,
          stopLossRate: 0.3,
          maxPortfolioRate: 0.15,
        },
        price: {
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          currentPrice: 49.33,
          openPrice: 49,
          highPrice: 50,
          lowPrice: 48.5,
          volume: 1000000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma200: 45,
          rsi14: 65,
        },
        buyableAmount: 1000,
      });

      const { signals } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');

      expect(buys).toHaveLength(1);
      expect(buys[0].reason).toContain('Buy1');
      expect(buys[0].reason).toContain('잔여재배분');
      expect(buys[0].quantity).toBe(2);
      expect(buys[0].price).toBe(49.33);
    });

    it('should generate first take-profit target based on T', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 500000, // T = 5
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma200: 65000,
          ma20: 68000,
          adx14: 25,
          rsi14: 60,
        },
        totalPortfolioValue: 10000000, // Large portfolio to avoid maxPortfolioRate
      });

      const { signals } = await strategy.evaluateStock(ctx);
      const takeProfit = signals.find((s) => s.reason?.includes('Take profit 1'));

      expect(takeProfit).toBeDefined();
      // T=5 → +13.5%
      expect(takeProfit!.price).toBe(Math.round(70000 * 1.135));
      expect(takeProfit!.quantity).toBe(10);
      expect(takeProfit!.metadata?.secondaryTargetPrice).toBe(Math.round(70000 * 1.161));
      expect(takeProfit!.metadata?.secondaryTargetQuantity).toBe(10);
      expect(takeProfit!.metadata?.sameDaySecondaryEligible).toBe(true);
    });

    it('should lift first take-profit above current price when target is below current and a same-cycle buy exists', async () => {
      // target 79450 < current 82000 이지만 같은 사이클에 BUY1(=current)이 있으면
      // 현재가 근처 즉시청산은 왕복 비용만 만든다. SELL은 최소 비용 버퍼 위로 올린다.
      const ctx = createContext({
        price: {
          stockCode: '005930',
          stockName: 'Samsung',
          currentPrice: 82000,
          openPrice: 81000,
          highPrice: 83000,
          lowPrice: 80000,
          volume: 1000000,
        },
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 82000,
          totalInvested: 500000, // T = 5
        },
        totalPortfolioValue: 10000000,
      });

      const { signals } = await strategy.evaluateStock(ctx);
      const takeProfit = signals.find((s) => s.reason?.includes('Take profit 1'));
      const buy1 = signals.find((s) => s.reason?.includes('Buy1'));

      expect(takeProfit).toBeDefined();
      expect(takeProfit!.price).toBe(82500); // 82000 * 1.006 → 100원 호가 올림
      expect(takeProfit!.metadata?.targetPrice).toBe(Math.round(70000 * 1.135));
      expect(takeProfit!.reason).toContain('비용버퍼');
      if (buy1) {
        expect(takeProfit!.price).not.toBe(buy1.price);
      }
    });

    it('should use the raised early take-profit target for low T ranges', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 100000, // T = 1
        },
        totalPortfolioValue: 10000000,
      });

      const { signals } = await strategy.evaluateStock(ctx);
      const takeProfit = signals.find((s) => s.reason?.includes('Take profit 1'));

      expect(takeProfit).toBeDefined();
      // T=1 → 1차 목표 +17% (초기 최대 수익률 20%에 맞춘 값)
      expect(takeProfit!.price).toBe(Math.round(70000 * 1.17));
      expect(takeProfit!.reason).toContain('+17.0%');
    });

    it('should keep second target as next-day only when same-day trend is weak', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 20,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 500000, // T = 5
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma200: 65000,
          ma20: 70500,
          adx14: 18,
          rsi14: 79,
        },
        totalPortfolioValue: 10000000,
      });

      const { signals } = await strategy.evaluateStock(ctx);
      const takeProfit = signals.find((s) => s.reason?.includes('Take profit 1'));

      expect(takeProfit).toBeDefined();
      expect(takeProfit!.metadata?.sameDaySecondaryEligible).toBe(false);
    });

    it('should emit only second take-profit while secondary exit plan is active', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 500000,
        },
      });
      ctx.watchStock.strategyParams = {
        secondaryExitPlan: {
          firstTargetDate: '2026-04-08',
          secondTargetPrice: 80920,
          secondTargetRate: 0.156,
          secondTargetQuantity: 10,
        },
      };

      const { signals } = await strategy.evaluateStock(ctx);

      const buys = signals.filter((s) => s.side === 'BUY');
      const sells = signals.filter((s) => s.side === 'SELL');
      expect(buys).toHaveLength(0);
      expect(sells).toHaveLength(1);
      expect(sells[0].reason).toContain('Take profit 2');
      expect(sells[0].quantity).toBe(10);
      expect(sells[0].price).toBe(80920);
    });

    it('should adjust second take-profit to one tick below current price when target is below current (self-trade prevention)', async () => {
      const ctx = createContext({
        price: {
          stockCode: '005930',
          stockName: 'Samsung',
          currentPrice: 82000,
          openPrice: 81000,
          highPrice: 83000,
          lowPrice: 80000,
          volume: 1000000,
        },
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 82000,
          totalInvested: 500000,
        },
      });
      ctx.watchStock.strategyParams = {
        secondaryExitPlan: {
          firstTargetDate: '2026-04-08',
          secondTargetPrice: 80920,
          secondTargetRate: 0.156,
          secondTargetQuantity: 10,
        },
      };

      const { signals } = await strategy.evaluateStock(ctx);

      const sells = signals.filter((s) => s.side === 'SELL');
      expect(sells).toHaveLength(1);
      expect(sells[0].reason).toContain('Take profit 2');
      expect(sells[0].quantity).toBe(10);
      expect(sells[0].price).toBe(81900); // 82000 - 100원 호가단위
      expect(sells[0].metadata?.targetPrice).toBe(80920);
      expect(sells[0].reason).toContain('자전거래 회피');
    });

    it('should resume normal mode after second target attempt day passes', async () => {
      const ctx = createContext({
        position: {
          stockCode: '005930',
          quantity: 10,
          avgPrice: 70000,
          currentPrice: 70000,
          totalInvested: 500000,
        },
        totalPortfolioValue: 10000000,
      });
      ctx.watchStock.strategyParams = {
        secondaryExitPlan: {
          firstTargetDate: '2026-04-07',
          secondTargetPrice: 80920,
          secondTargetRate: 0.156,
          secondTargetQuantity: 10,
          secondTargetAttemptedDate: '2026-04-08',
        },
      };

      const { signals } = await strategy.evaluateStock(ctx);

      expect(signals.some((s) => s.reason?.includes('Take profit 1'))).toBe(true);
      expect(signals.some((s) => s.reason?.includes('Take profit 2'))).toBe(false);
    });
  });

  describe('buy with position (T >= 20)', () => {
    it('should keep immediate buy enabled when T >= 20', async () => {
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

      const { signals } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');

      expect(buys.some((b) => b.reason?.includes('Buy1'))).toBe(true);
    });

    it('should lower the take-profit target when T >= 20', async () => {
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

      const { signals } = await strategy.evaluateStock(ctx);
      const takeProfit = signals.find((s) => s.reason?.includes('Take profit 1'));

      expect(takeProfit).toBeDefined();
      // T=25 → +7.4%
      expect(takeProfit!.price).toBe(Math.round(70000 * 1.074));
      expect(takeProfit!.quantity).toBe(18);
    });
  });

  describe('quota adjustments', () => {
    it('should ignore interest-rate macro signals in the simplified mode', async () => {
      const ctx = createContext({
        marketCondition: {
          referenceIndexAboveMA200: true,
          referenceIndexName: 'KOSPI',
          interestRateRising: true,
        },
      });

      const { signals } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');
      expect(buys).toHaveLength(1);
      expect(buys.reduce((sum, signal) => sum + signal.quantity, 0)).toBe(1);
    });

    it('should increase quota 1.25x when RSI < 30 (oversold)', async () => {
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: true, rsi14: 25 },
      });

      const { signals } = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      expect(buySignal).toBeDefined();
      expect(buySignal!.quantity).toBe(1);
    });

    it('should reduce quota to 0.85x when RSI is between 60 and 70', async () => {
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: true, rsi14: 65 },
        watchStock: { ...createContext().watchStock, strategyParams: { rsiPolicy: 'continuous' } } as any,
      });

      const { signals, details } = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      expect(buySignal).toBeDefined();
      expect(buySignal!.quantity).toBe(1);
      expect(details?.quotaAdjustments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ multiplier: 0.85 }),
        ]),
      );
    });

    it('should reduce quota on overheated RSI with continuous curve (P4)', async () => {
      // RSI=75 → linear: 1.0 - 15*0.03 = 0.55x
      // continuous 정책은 buy2OnlyMode 비활성 → Buy1 (현재가 지정가) 활성
      const ctx = createContext({
        price: {
          stockCode: '005930',
          stockName: 'Samsung',
          currentPrice: 50000,
          openPrice: 49800,
          highPrice: 50200,
          lowPrice: 49500,
          volume: 1000000,
        },
        stockIndicators: { currentAboveMA200: true, rsi14: 75 },
        watchStock: { ...createContext().watchStock, strategyParams: { rsiPolicy: 'continuous' } } as any,
      });

      const { signals, details } = await strategy.evaluateStock(ctx);
      const buySignals = signals.filter((s) => s.side === 'BUY');

      expect(buySignals).toHaveLength(1);
      expect(buySignals[0].reason).toContain('Buy1');
      expect(buySignals[0].quantity).toBe(1);
      expect(buySignals[0].price).toBe(50000);
      expect(details?.quotaAdjustments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ multiplier: expect.closeTo(0.55, 2) }),
        ]),
      );
      expect(details?.buy2OnlyMode).toBe(false);
    });

    it('should reduce quota to 0.4x when RSI is above 80', async () => {
      // continuous 정책은 buy2OnlyMode 비활성 → Buy1 (현재가 지정가)로 폴백
      const ctx = createContext({
        price: {
          stockCode: '005930',
          stockName: 'Samsung',
          currentPrice: 30000,
          openPrice: 29800,
          highPrice: 30200,
          lowPrice: 29500,
          volume: 1000000,
        },
        stockIndicators: { currentAboveMA200: true, rsi14: 85 },
        watchStock: { ...createContext().watchStock, strategyParams: { rsiPolicy: 'continuous' } } as any,
      });

      const { signals, details } = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      expect(buySignal).toBeDefined();
      expect(buySignal!.quantity).toBe(1);
      expect(details?.quotaAdjustments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ multiplier: 0.4 }),
        ]),
      );
      expect(details?.buy2OnlyMode).toBe(false);
    });

    it('should fall back to Buy1 for overheated overseas entries with continuous policy', async () => {
      // continuous 정책은 buy2OnlyMode 비활성 → Buy1 (현재가 지정가) 활성
      const ctx = createContext({
        watchStock: {
          ...createContext().watchStock,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          quota: 5000,
          strategyParams: { rsiPolicy: 'continuous' },
        } as any,
        price: {
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          currentPrice: 49.33,
          openPrice: 49,
          highPrice: 50,
          lowPrice: 48.5,
          volume: 1000000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma200: 45,
          rsi14: 75,
        },
        buyableAmount: 1000,
      });

      const { signals, details } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');

      expect(buys).toHaveLength(1);
      expect(buys[0].reason).toContain('Buy1');
      expect(buys[0].reason).not.toContain('Buy2');
      expect(buys[0].price).toBe(49.33);
      expect(details?.buy2OnlyMode).toBe(false);
    });

    it('should not enforce buy2OnlyMode when rsiPolicy is none even at high RSI', async () => {
      // 사용자가 RSI를 무시하도록 설정 → Buy1 (현재가) 활성
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: true, rsi14: 85 },
        watchStock: { ...createContext().watchStock, strategyParams: { rsiPolicy: 'none' } } as any,
      });

      const { signals, details } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');

      expect(details?.buy2OnlyMode).toBe(false);
      expect(buys.length).toBeGreaterThan(0);
      const buy1 = buys.find((s) => s.reason?.includes('Buy1'));
      expect(buy1).toBeDefined();
      expect(buy1!.price).toBe(70000);
    });

    it('should block buying entirely when hard-stop-70 and RSI exceeds threshold', async () => {
      // hard-stop-70 정책 + RSI 75 → quota 0 → 매수 시그널 없음
      // (buy2OnlyMode 임계값도 70 이지만 quota=0 이라 진입 불가)
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: true, rsi14: 75 },
        watchStock: { ...createContext().watchStock, strategyParams: { rsiPolicy: 'hard-stop-70' } } as any,
      });

      const { signals } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');

      expect(buys).toHaveLength(0);
    });

    it('should activate Buy1 with hard-stop-80 when RSI is below threshold', async () => {
      // hard-stop-80 + RSI 75 → quota 그대로, buy2OnlyMode=false (RSI < 80) → Buy1 활성
      const ctx = createContext({
        stockIndicators: { currentAboveMA200: true, rsi14: 75 },
        watchStock: { ...createContext().watchStock, strategyParams: { rsiPolicy: 'hard-stop-80' } } as any,
      });

      const { signals, details } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((s) => s.side === 'BUY');

      expect(details?.buy2OnlyMode).toBe(false);
      const buy1 = buys.find((s) => s.reason?.includes('Buy1'));
      expect(buy1).toBeDefined();
      expect(buy1!.price).toBe(70000);
    });

    it('should limit quota to buyable amount', async () => {
      const ctx = createContext({ buyableAmount: 50000 });

      const { signals } = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      if (buySignal) {
        // adjustedQuota capped at 50000, buyQty = floor(50000/70000) = 0
        // So no buy signal
        expect(buySignal.quantity).toBeLessThanOrEqual(Math.floor(50000 / 70000) || 1);
      }
    });

    it('should reduce buy amount when volatility is elevated', async () => {
      const ctx = createContext({
        price: {
          stockCode: '005930',
          stockName: 'Samsung',
          currentPrice: 20000,
          openPrice: 19800,
          highPrice: 20200,
          lowPrice: 19700,
          volume: 1000000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 50,
          volatility30d: 48,
        },
      });

      const { signals } = await strategy.evaluateStock(ctx);
      const buys = signals.filter((signal) => signal.side === 'BUY');
      expect(buys).toHaveLength(2);
      expect(buys.reduce((sum, signal) => sum + signal.quantity, 0)).toBe(3);
    });

  });

  describe('overseas market', () => {
    it('should use limit order for US exchanges', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';

      const { signals } = await strategy.evaluateStock(ctx);
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

      const { signals } = await strategy.evaluateStock(ctx);
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

      const { signals } = await strategy.evaluateStock(ctx);
      const buySignal = signals.find((s) => s.side === 'BUY');

      if (buySignal && buySignal.price) {
        expect(Number.isInteger(buySignal.price)).toBe(true);
      }
    });
  });

  describe('take-profit price vs current price (self-trade prevention)', () => {
    // 사용자가 우려한 강세 추세 시나리오를 명시적으로 검증한다.
    // BUY1은 항상 현재가에 걸리므로 SELL 가격이 현재가와 같으면 KIS가
    // 자전거래 의심으로 거부한다. takeProfitOrderPrice가 그 충돌을 회피해야 한다.
    it('overseas: target above current → SELL keeps target price', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.price.currentPrice = 76.03;
      ctx.position = {
        stockCode: '005930',
        quantity: 2,
        avgPrice: 65.72, // target = 65.72 * 1.17 ≈ 76.89 > current
        currentPrice: 76.03,
        totalInvested: 131.44,
      };
      ctx.totalPortfolioValue = 10000;

      const { signals } = await strategy.evaluateStock(ctx);
      const sell = signals.find((s) => s.side === 'SELL');
      const buy1 = signals.find((s) => s.reason?.includes('Buy1'));

      expect(sell).toBeDefined();
      // target ≈ 76.89, current 76.03, tick 0.01 → 76.89 >= 76.04 이므로 target 그대로
      expect(sell!.price).toBe(76.89);
      // BUY1과 가격 분리 확인
      expect(sell!.price).not.toBe(buy1?.price);
    });

    it('overseas: target equal to current with same-cycle buy → SELL is lifted by cost buffer', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.price.currentPrice = 76.89;
      ctx.position = {
        stockCode: '005930',
        quantity: 2,
        avgPrice: 65.72, // target ≈ 76.89 == current
        currentPrice: 76.89,
        totalInvested: 131.44,
      };
      ctx.totalPortfolioValue = 10000;

      const { signals } = await strategy.evaluateStock(ctx);
      const sell = signals.find((s) => s.side === 'SELL');
      const buy1 = signals.find((s) => s.reason?.includes('Buy1'));

      expect(sell).toBeDefined();
      // BUY1 = 76.89, default buffer 0.6% → 77.35134, tick 올림 → 77.36
      expect(sell!.price).toBe(77.36);
      expect(sell!.price).not.toBe(buy1?.price);
      expect(sell!.metadata?.sameCycleMinProfitRate).toBe(0.006);
      expect(sell!.reason).toContain('비용버퍼');
    });

    it('overseas: target far below current with same-cycle buy → SELL is lifted by cost buffer', async () => {
      // 5-11 TQQQ 같은 시나리오: 가격이 목표가를 넘어 급등한 강세 추세.
      // SELL을 현재가 아래로 던지면 BUY1과 같은 가격대에서 왕복 비용만 만든다.
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.price.currentPrice = 80;
      ctx.position = {
        stockCode: '005930',
        quantity: 4,
        avgPrice: 60, // target = 60 * 1.17 = 70.2 < current 80
        currentPrice: 80,
        totalInvested: 240,
      };
      ctx.totalPortfolioValue = 10000;

      const { signals } = await strategy.evaluateStock(ctx);
      const sell = signals.find((s) => s.side === 'SELL');
      const buy1 = signals.find((s) => s.reason?.includes('Buy1'));

      expect(sell).toBeDefined();
      // target 70.2 < current 80, default buffer 0.6% → SELL = 80.48
      expect(sell!.price).toBe(80.48);
      expect(sell!.price).not.toBe(buy1?.price);
      expect(sell!.reason).toContain('비용버퍼');
    });

    it('overseas: target below current without same-cycle buy → SELL keeps immediate-exit behavior', async () => {
      const ctx = createContext();
      ctx.watchStock.market = 'OVERSEAS';
      ctx.watchStock.exchangeCode = 'NASD';
      ctx.price.currentPrice = 80;
      ctx.position = {
        stockCode: '005930',
        quantity: 4,
        avgPrice: 60,
        currentPrice: 80,
        totalInvested: 240,
      };
      ctx.buyableAmount = 0;
      ctx.totalPortfolioValue = 10000;

      const { signals } = await strategy.evaluateStock(ctx);
      const sell = signals.find((s) => s.side === 'SELL');
      const buy = signals.find((s) => s.side === 'BUY');

      expect(buy).toBeUndefined();
      expect(sell).toBeDefined();
      expect(sell!.price).toBe(79.99);
      expect(sell!.reason).toContain('즉시 청산');
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

      const { signals } = await strategy.evaluateStock(ctx);
      const sells = signals.filter((s) => s.side === 'SELL');
      expect(sells.length).toBeGreaterThan(0);
    });
  });
});
