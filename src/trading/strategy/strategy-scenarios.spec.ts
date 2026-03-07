import { InfiniteBuyStrategy } from './infinite-buy.strategy';
import { GridMeanReversionStrategy } from './grid-mean-reversion.strategy';
import { MomentumBreakoutStrategy } from './momentum-breakout.strategy';
import { ConservativeStrategy } from './conservative.strategy';
import { TrendFollowingStrategy } from './trend-following.strategy';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
  TradingSignal,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

/**
 * 멀티 턴 시뮬레이션 테스트
 * 여러 날에 걸친 가격 변동 시나리오에서 전략이 올바르게 동작하는지 검증
 */

function createBaseContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
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
    volumeRatio: 1.0,
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
    buyableAmount: 5000000,
    totalPortfolioValue: 20000000,
    ...overrides,
  };
}

describe('Strategy Scenarios - Multi-turn Simulation', () => {
  describe('무한매수법: 3개월 하락장 시나리오', () => {
    const strategy = new InfiniteBuyStrategy();

    it('should accumulate T through declining prices and trigger stop loss', async () => {
      const perCycleQuota = 4000000 / 40; // 100,000 per cycle
      let totalInvested = 0;
      let quantity = 0;
      let allSignals: TradingSignal[] = [];

      // Day 1: 첫 매수 @ 70000
      const ctx1 = createBaseContext();
      ctx1.price.currentPrice = 70000;
      const signals1 = await strategy.evaluateStock(ctx1);
      expect(signals1.length).toBeGreaterThan(0);
      expect(signals1[0].side).toBe('BUY');

      // Simulate accumulation: 10 cycles invested
      totalInvested = perCycleQuota * 10; // T=10
      quantity = 15; // roughly 1M / 70000 avg
      const avgPrice = totalInvested / quantity;

      // Day 30: T=10, price drops to 60000 → sell targets should adjust
      const ctx2 = createBaseContext({
        position: {
          stockCode: '005930',
          quantity,
          avgPrice,
          currentPrice: 60000,
          totalInvested,
        },
      });
      ctx2.price.currentPrice = 60000;
      ctx2.stockIndicators.rsi14 = 25; // oversold → 1.5x quota
      const signals2 = await strategy.evaluateStock(ctx2);

      // Should have buy + sell signals
      const buys2 = signals2.filter((s) => s.side === 'BUY');
      const sells2 = signals2.filter((s) => s.side === 'SELL');
      expect(buys2.length).toBeGreaterThanOrEqual(1);
      expect(sells2.length).toBeGreaterThanOrEqual(1);

      // T=10이므로 target = 10%
      const sell2Target = sells2.find((s) => s.reason.includes('Sell2'));
      if (sell2Target) {
        expect(sell2Target.price).toBeGreaterThan(avgPrice);
      }

      // Day 60: 급락 → 손절 발동 (stopLossRate = 0.3 → -30%)
      totalInvested = perCycleQuota * 20; // T=20
      quantity = 35;
      const avgPrice3 = totalInvested / quantity;

      const ctx3 = createBaseContext({
        position: {
          stockCode: '005930',
          quantity,
          avgPrice: avgPrice3,
          currentPrice: avgPrice3 * 0.65, // -35%
          totalInvested,
        },
      });
      ctx3.price.currentPrice = avgPrice3 * 0.65;
      const signals3 = await strategy.evaluateStock(ctx3);

      const stopLoss = signals3.find((s) => s.reason.includes('Stop loss'));
      expect(stopLoss).toBeDefined();
      expect(stopLoss!.quantity).toBe(quantity);
      expect(stopLoss!.side).toBe('SELL');
    });

    it('should respect T boundary: T=0 first buy, T=20 switch to Buy2 only', async () => {
      // T=0: should do initial buy
      const ctx0 = createBaseContext();
      ctx0.price.currentPrice = 70000;
      const signals0 = await strategy.evaluateStock(ctx0);
      expect(signals0.some((s) => s.side === 'BUY')).toBe(true);

      const perCycleQuota = 4000000 / 40;

      // T=19 (< 20): should have Buy1 + Buy2
      const ctx19 = createBaseContext({
        position: {
          stockCode: '005930',
          quantity: 30,
          avgPrice: 68000,
          currentPrice: 68000,
          totalInvested: perCycleQuota * 19,
        },
      });
      ctx19.price.currentPrice = 68000;
      const signals19 = await strategy.evaluateStock(ctx19);
      const buys19 = signals19.filter((s) => s.side === 'BUY');
      // T < 20 → Buy1 + Buy2
      expect(buys19.some((s) => s.reason.includes('Buy1'))).toBe(true);

      // T=25 (>= 20): should have only Buy2
      const ctx25 = createBaseContext({
        position: {
          stockCode: '005930',
          quantity: 40,
          avgPrice: 66000,
          currentPrice: 66000,
          totalInvested: perCycleQuota * 25,
        },
      });
      ctx25.price.currentPrice = 66000;
      const signals25 = await strategy.evaluateStock(ctx25);
      const buys25 = signals25.filter((s) => s.side === 'BUY');
      expect(buys25.every((s) => s.reason.includes('Buy2'))).toBe(true);
    });
  });

  describe('그리드 평균회귀: V자 반등 시나리오', () => {
    const strategy = new GridMeanReversionStrategy();

    it('should enter at BB lower, add at grid levels, and exit at BB middle/upper', async () => {
      // Day 1: BB 하단 터치 + RSI < 30 + MACD 상승전환 → 진입
      const ctx1 = createBaseContext({
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
        stockIndicators: {
          currentAboveMA200: true,
          bollingerLower: 65000,
          bollingerMiddle: 70000,
          bollingerUpper: 75000,
          rsi14: 25,
          macdHistogram: 0.3,
          macdPrevHistogram: -0.2,
        },
      });
      ctx1.price.currentPrice = 64500; // below BB lower

      const signals1 = await strategy.evaluateStock(ctx1);
      expect(signals1).toHaveLength(1);
      expect(signals1[0].side).toBe('BUY');
      expect(signals1[0].reason).toContain('그리드진입');

      // Day 5: 추가 하락 → 그리드 2단계 매수 (avgPrice -4%)
      const avgPrice = 64500;
      const ctx2 = createBaseContext({
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
          avgPrice,
          currentPrice: avgPrice * 0.95, // -5% from avg → hits grid level 2 (-4%)
          totalInvested: 903000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerLower: 60000,
          bollingerMiddle: 70000,
          bollingerUpper: 75000,
          rsi14: 20,
        },
      });
      ctx2.price.currentPrice = avgPrice * 0.95;

      const signals2 = await strategy.evaluateStock(ctx2);
      const gridBuys = signals2.filter((s) => s.side === 'BUY');
      expect(gridBuys.length).toBe(1);
      expect(gridBuys[0].reason).toContain('그리드매수');

      // Day 15: 반등하여 BB 중심선 도달 → 50% 매도
      const ctx3 = createBaseContext({
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
          quantity: 28,
          avgPrice: 62000,
          currentPrice: 70000,
          totalInvested: 1736000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 70000,
          bollingerUpper: 75000,
        },
      });
      ctx3.price.currentPrice = 70000;

      const signals3 = await strategy.evaluateStock(ctx3);
      expect(signals3).toHaveLength(1);
      expect(signals3[0].side).toBe('SELL');
      expect(signals3[0].quantity).toBe(14); // floor(28/2)
      expect(signals3[0].reason).toContain('BB중심선');

      // Day 20: BB 상단 도달 → 전량 매도
      const ctx4 = createBaseContext({
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
          avgPrice: 62000,
          currentPrice: 76000,
          totalInvested: 868000,
        },
        stockIndicators: {
          currentAboveMA200: true,
          bollingerMiddle: 70000,
          bollingerUpper: 75000,
        },
      });
      ctx4.price.currentPrice = 76000;

      const signals4 = await strategy.evaluateStock(ctx4);
      expect(signals4).toHaveLength(1);
      expect(signals4[0].side).toBe('SELL');
      expect(signals4[0].quantity).toBe(14); // full exit
      expect(signals4[0].reason).toContain('BB상단');
    });
  });

  describe('모멘텀 돌파: 급등 + 트레일링 시나리오', () => {
    const strategy = new MomentumBreakoutStrategy();

    it('should enter on breakout, take partial profit, then trailing stop', async () => {
      // Day 1: 변동성 돌파 진입
      const ctx1 = createBaseContext({
        watchStock: {
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
        },
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
      ctx1.price.currentPrice = 72000; // > breakout(69000 + 4000*0.5 = 71000)

      const signals1 = await strategy.evaluateStock(ctx1);
      expect(signals1).toHaveLength(1);
      expect(signals1[0].side).toBe('BUY');
      const buyQty = signals1[0].quantity;

      // Day 2: +5.5% → 1차 익절 (50%)
      const ctx2 = createBaseContext({
        watchStock: {
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
        },
        position: {
          stockCode: '005930',
          quantity: buyQty,
          avgPrice: 72000,
          currentPrice: 76000, // +5.6%
          totalInvested: 72000 * buyQty,
        },
      });
      ctx2.price.currentPrice = 76000;
      ctx2.price.highPrice = 76000;

      const signals2 = await strategy.evaluateStock(ctx2);
      expect(signals2).toHaveLength(1);
      expect(signals2[0].side).toBe('SELL');
      expect(signals2[0].reason).toContain('익절');

      // Day 3: 고점 후 2% 하락 → 트레일링 스탑
      const remainQty = buyQty - signals2[0].quantity;
      if (remainQty > 0) {
        const ctx3 = createBaseContext({
          watchStock: {
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
          },
          position: {
            stockCode: '005930',
            quantity: remainQty,
            avgPrice: 72000,
            currentPrice: 74500,
            totalInvested: 72000 * remainQty,
          },
        });
        ctx3.price.currentPrice = 74500;
        ctx3.price.highPrice = 78000; // 74500 < 78000 * 0.98(76440) → trailing

        const signals3 = await strategy.evaluateStock(ctx3);
        expect(signals3).toHaveLength(1);
        expect(signals3[0].side).toBe('SELL');
        expect(signals3[0].reason).toContain('트레일링스탑');
      }
    });
  });

  describe('보수적 매매: 과매도 반등 시나리오', () => {
    const strategy = new ConservativeStrategy();

    it('should enter with 30% of quota and exit at +3%', async () => {
      // Day 1: RSI < 25, 거래량 2배 → 진입 (자금의 30%)
      const ctx1 = createBaseContext({
        watchStock: {
          id: 'ws-1',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          strategyName: 'conservative',
          quota: 1000000,
          cycle: 1,
          maxCycles: 40,
          stopLossRate: 0.05,
          maxPortfolioRate: 0.15,
        },
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 20,
          volumeRatio: 2.5,
        },
      });
      ctx1.price.currentPrice = 70000;

      const signals1 = await strategy.evaluateStock(ctx1);
      expect(signals1).toHaveLength(1);
      expect(signals1[0].side).toBe('BUY');
      // buyAmount = min(1000000 * 0.3, 5000000) = 300000
      // buyQty = floor(300000 / 70000) = 4
      expect(signals1[0].quantity).toBe(4);

      // Day 3: +3.5% → 익절
      const ctx2 = createBaseContext({
        watchStock: {
          id: 'ws-1',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          strategyName: 'conservative',
          quota: 1000000,
          cycle: 1,
          maxCycles: 40,
          stopLossRate: 0.05,
          maxPortfolioRate: 0.15,
        },
        position: {
          stockCode: '005930',
          quantity: 4,
          avgPrice: 70000,
          currentPrice: 72500, // +3.6%
          totalInvested: 280000,
        },
      });
      ctx2.price.currentPrice = 72500;

      const signals2 = await strategy.evaluateStock(ctx2);
      expect(signals2).toHaveLength(1);
      expect(signals2[0].side).toBe('SELL');
      expect(signals2[0].quantity).toBe(4);
      expect(signals2[0].reason).toContain('익절');
    });
  });

  describe('추세 추종: 골든크로스 진입 → 피라미딩 → 데드크로스 청산', () => {
    const strategy = new TrendFollowingStrategy();

    it('should enter on golden cross, pyramid on profit, exit on dead cross', async () => {
      // Day 1: 골든크로스 + ADX > 25 → 진입
      const ctx1 = createBaseContext({
        watchStock: {
          id: 'ws-1',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          strategyName: 'trend-following',
          quota: 2000000,
          cycle: 1,
          maxCycles: 40,
          stopLossRate: 0.07,
          maxPortfolioRate: 0.15,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 70000,
          ma60: 68000,
          adx14: 30,
        },
      });
      ctx1.price.currentPrice = 72000;

      const signals1 = await strategy.evaluateStock(ctx1);
      expect(signals1).toHaveLength(1);
      expect(signals1[0].side).toBe('BUY');
      expect(signals1[0].reason).toContain('추세진입');
      const buyQty = signals1[0].quantity; // floor(2000000/72000) = 27

      // Day 30: +8% 수익, 추세 유지 → 피라미딩
      const ctx2 = createBaseContext({
        watchStock: {
          id: 'ws-1',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          strategyName: 'trend-following',
          quota: 2000000,
          cycle: 1,
          maxCycles: 40,
          stopLossRate: 0.07,
          maxPortfolioRate: 0.15,
        },
        position: {
          stockCode: '005930',
          quantity: buyQty,
          avgPrice: 72000,
          currentPrice: 77760, // +8%
          totalInvested: 72000 * buyQty,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 75000,
          ma60: 72000,
          adx14: 35,
        },
      });
      ctx2.price.currentPrice = 77760;

      const signals2 = await strategy.evaluateStock(ctx2);
      expect(signals2).toHaveLength(1);
      expect(signals2[0].side).toBe('BUY');
      expect(signals2[0].reason).toContain('피라미딩');

      // Day 60: 데드크로스 발생 → 전량 청산
      const totalQty = buyQty + signals2[0].quantity;
      const ctx3 = createBaseContext({
        watchStock: {
          id: 'ws-1',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          strategyName: 'trend-following',
          quota: 2000000,
          cycle: 1,
          maxCycles: 40,
          stopLossRate: 0.07,
          maxPortfolioRate: 0.15,
        },
        position: {
          stockCode: '005930',
          quantity: totalQty,
          avgPrice: 74000,
          currentPrice: 73000,
          totalInvested: 74000 * totalQty,
        },
        stockIndicators: {
          currentAboveMA200: true,
          ma20: 72000, // dead cross
          ma60: 73000,
          adx14: 25,
        },
      });
      ctx3.price.currentPrice = 73000;

      const signals3 = await strategy.evaluateStock(ctx3);
      expect(signals3).toHaveLength(1);
      expect(signals3[0].side).toBe('SELL');
      expect(signals3[0].quantity).toBe(totalQty);
      expect(signals3[0].reason).toContain('데드크로스');
    });
  });
});
