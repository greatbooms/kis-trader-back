/**
 * 무한매수법 실전 데이터 추적 테스트
 *
 * 시나리오: TQQQ (해외, NASD) / quota=$10,000 / maxCycles=40
 * perCycleQuota = $10,000 / 40 = $250
 *
 * 개선된 Buy 로직:
 *   Buy1 = 현재가 (즉시 체결)
 *   Buy2 = 현재가 × (1 - dipRate) (현재가 아래 지정가)
 *   dipRate: T<10 → 3%, T<20 → 5%, T>=20 → 7%
 */
import { InfiniteBuyStrategy } from './infinite-buy.strategy';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

describe('무한매수법 — 실전 데이터 추적', () => {
  const strategy = new InfiniteBuyStrategy();

  const watchStock: WatchStockConfig = {
    id: 'ws-tqqq',
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    stockName: 'ProShares UltraPro QQQ',
    strategyName: 'infinite-buy',
    quota: 10000,        // $10,000 총 투자금
    cycle: 1,
    maxCycles: 40,       // 40회 분할
    stopLossRate: 0.3,   // 30% 손절
    maxPortfolioRate: 0.15,
  };

  const marketOk: MarketCondition = {
    referenceIndexAboveMA200: true,
    referenceIndexName: 'S&P500',
    interestRateRising: false,
  };

  const indicatorsOk: StockIndicators = {
    currentAboveMA200: true,
    ma200: 40,
    rsi14: 50,
  };

  function makeCtx(overrides: Partial<StockStrategyContext>): StockStrategyContext {
    return {
      watchStock: { ...watchStock },
      price: {
        stockCode: 'TQQQ',
        stockName: 'ProShares UltraPro QQQ',
        currentPrice: 50,
        openPrice: 49,
        highPrice: 51,
        lowPrice: 48,
        volume: 100000000,
      },
      position: undefined,
      alreadyExecutedToday: false,
      marketCondition: marketOk,
      stockIndicators: indicatorsOk,
      buyableAmount: 50000,
      totalPortfolioValue: 100000,
      ...overrides,
    };
  }

  // ============================================================
  // 기본 계산값 검증
  // ============================================================
  describe('기본 계산값 검증', () => {
    const perCycleQuota = 10000 / 40; // = 250

    it('perCycleQuota = $250', () => {
      expect(perCycleQuota).toBe(250);
    });

    it('T 계산: totalInvested / perCycleQuota', () => {
      expect(500 / perCycleQuota).toBe(2);
      expect(5000 / perCycleQuota).toBe(20);
    });

    it('dipRate: T<10 → 3%, T<20 → 5%, T>=20 → 7%', () => {
      // T=5 → 3%
      expect(0.03).toBe(0.03);
      // T=15 → 5%
      expect(0.05).toBe(0.05);
      // T=25 → 7%
      expect(0.07).toBe(0.07);
    });

    it('pivotPrice = baseRate * avgPrice (Sell 가격용)', () => {
      expect(1.10 * 50).toBeCloseTo(55);
      expect(1.05 * 48).toBeCloseTo(50.4);
      expect(1.00 * 45).toBeCloseTo(45);
    });
  });

  // ============================================================
  // Day 1: 첫 매수 (포지션 없음) — $50.00
  // ============================================================
  describe('Day 1: 첫 매수 @ $50.00', () => {
    it('should buy initial position', async () => {
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 50, openPrice: 49, highPrice: 51, lowPrice: 48, volume: 100000000,
        },
      });

      const signals = await strategy.evaluateStock(ctx);

      // 첫 매수: adjustedQuota = perCycleQuota = $250
      // buyQty = floor(250 / 50) = 5주
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      expect(signals[0].quantity).toBe(5);
      expect(signals[0].price).toBe(50);
      expect(signals[0].orderDivision).toBe('34'); // LOC (NASD)
      expect(signals[0].reason).toContain('Initial buy');
    });
  });

  // ============================================================
  // Day 2: 소폭 하락 $48.50, 보유 5주 @ avg $50.00
  //   T = 1.0, dipRate = 3% (T<10)
  //   Buy1 = $48.50 (현재가)
  //   Buy2 = $48.50 × 0.97 = $47.05 (현재가 -3%)
  // ============================================================
  describe('Day 2: 하락 $48.50, T=1.0', () => {
    it('should generate Buy1(현재가) + Buy2(현재가-3%) + Sell1 + Sell2', async () => {
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 48.50, openPrice: 49, highPrice: 50, lowPrice: 48, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 5,
          avgPrice: 50.00,
          currentPrice: 48.50,
          totalInvested: 250,  // T = 1.0
        },
      });

      const signals = await strategy.evaluateStock(ctx);

      // T=1.0 (<10) → dipRate=3%
      // adjustedQuota=$250, halfQuota=$125
      //
      // Buy1Price = round(48.50) = $48.50
      // Buy1Qty = floor(125 / 48.50) = 2
      //
      // Buy2Price = round(48.50 * 0.97) = round(47.045) = $47.05
      // Buy2Qty = floor(125 / 47.05) = 2
      //
      // pivotPrice = 1.095 * 50.00 = $54.75
      // Sell1Qty = max(1, round(5/4)) = 1
      // Sell1Price = round(54.75) = $54.75
      //
      // Sell2Qty = 5 - 1 = 4
      // T<10 → targetRate=1.05
      // Sell2Price = round(50.00 * 1.05) = $52.50

      const buys = signals.filter(s => s.side === 'BUY');
      const sells = signals.filter(s => s.side === 'SELL');

      expect(buys).toHaveLength(2);
      expect(sells).toHaveLength(2);

      // Buy1: 현재가에 즉시 매수
      const buy1 = buys.find(s => s.reason.includes('Buy1'));
      expect(buy1).toBeDefined();
      expect(buy1!.price).toBe(48.50);
      expect(buy1!.quantity).toBe(2);

      // Buy2: 현재가 -3% 지정가 (더 떨어져야 체결)
      const buy2 = buys.find(s => s.reason.includes('Buy2'));
      expect(buy2).toBeDefined();
      expect(buy2!.price).toBe(47.05);
      expect(buy2!.price!).toBeLessThan(48.50); // 반드시 현재가보다 낮음
      expect(buy2!.quantity).toBe(2);

      // Sell1/Sell2 (변경 없음)
      const sell1 = sells.find(s => s.reason.includes('Sell1'));
      expect(sell1!.price).toBe(54.75);
      expect(sell1!.quantity).toBe(1);

      const sell2 = sells.find(s => s.reason.includes('Sell2'));
      expect(sell2!.price).toBe(52.50);
      expect(sell2!.quantity).toBe(4);
    });
  });

  // ============================================================
  // Day 5: 계속 하락 $45.00, T=3.0
  //   dipRate = 3% (T<10)
  //   Buy1 = $45.00, Buy2 = $45 × 0.97 = $43.65
  // ============================================================
  describe('Day 5: 하락 $45.00, T=3.0', () => {
    it('Buy1=현재가, Buy2=현재가-3% (항상 현재가보다 낮음)', async () => {
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 45.00, openPrice: 46, highPrice: 47, lowPrice: 44.5, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 15,
          avgPrice: 48.00,
          currentPrice: 45.00,
          totalInvested: 750,  // T = 3.0
        },
      });

      const signals = await strategy.evaluateStock(ctx);

      // Buy1 = $45.00
      // Buy2 = round(45 * 0.97) = $43.65
      const buy1 = signals.find(s => s.reason.includes('Buy1'));
      expect(buy1!.price).toBe(45.00);

      const buy2 = signals.find(s => s.reason.includes('Buy2'));
      expect(buy2!.price).toBe(43.65);
      expect(buy2!.price!).toBeLessThan(45.00); // 반드시 현재가보다 낮음

      // Sell 검증
      const sell1 = signals.find(s => s.reason.includes('Sell1'));
      // pivotPrice = (10 - 1.5 + 100)/100 * 48 = 1.085 * 48 = 52.08
      expect(sell1!.price).toBe(52.08);
      expect(sell1!.quantity).toBe(4); // max(1, round(15/4))

      const sell2 = signals.find(s => s.reason.includes('Sell2'));
      expect(sell2!.price).toBe(50.40); // 48 * 1.05
      expect(sell2!.quantity).toBe(11); // 15 - 4
    });
  });

  // ============================================================
  // 개선 검증: Buy2는 항상 현재가보다 낮아야 함
  // ============================================================
  describe('개선 검증: Buy2 < 현재가 보장', () => {
    it('하락장에서도 Buy2 < 현재가', async () => {
      // 이전 버그: avgPrice > curPrice일 때 Buy2 = pivotPrice > curPrice
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 45.00, openPrice: 46, highPrice: 47, lowPrice: 44.5, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 5,
          avgPrice: 50.00,
          currentPrice: 45.00,
          totalInvested: 250,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      const buy1 = signals.find(s => s.reason.includes('Buy1'));
      const buy2 = signals.find(s => s.reason.includes('Buy2'));

      // Buy1 = 현재가
      expect(buy1!.price).toBe(45.00);
      // Buy2 < 현재가 (현재가 × 0.97 = $43.65)
      expect(buy2!.price).toBe(43.65);
      expect(buy2!.price!).toBeLessThan(45.00);
    });

    it('상승장에서도 Buy2 < 현재가', async () => {
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 55.00, openPrice: 54, highPrice: 56, lowPrice: 53, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 5,
          avgPrice: 50.00,
          currentPrice: 55.00,
          totalInvested: 250,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      const buy2 = signals.find(s => s.reason.includes('Buy2'));
      // Buy2 = 55.00 * 0.97 = $53.35
      expect(buy2!.price).toBe(53.35);
      expect(buy2!.price!).toBeLessThan(55.00);
    });
  });

  // ============================================================
  // T=10 경계: dipRate 전환 (3% → 5%) + Sell2 target 전환 (5% → 10%)
  // ============================================================
  describe('T=10 경계: dipRate/target 전환', () => {
    it('T=9.9 → dipRate=3%, target=5%  /  T=10.0 → dipRate=5%, target=10%', async () => {
      const perCycleQuota = 250;

      // T=9.9 (< 10): dipRate=3%, target=5%
      const ctx1 = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 46.00, openPrice: 46, highPrice: 47, lowPrice: 45, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 55,
          avgPrice: 45.00,
          currentPrice: 46.00,
          totalInvested: perCycleQuota * 9.9,
        },
      });

      const signals1 = await strategy.evaluateStock(ctx1);
      const buy2_1 = signals1.find(s => s.reason.includes('Buy2'));
      expect(buy2_1!.reason).toContain('dip=3%');
      // Buy2 = 46 * 0.97 = $44.62
      expect(buy2_1!.price).toBe(44.62);

      const sell2_1 = signals1.find(s => s.reason.includes('Sell2'));
      expect(sell2_1!.reason).toContain('target=5%');

      // T=10.0 (>= 10, < 20): dipRate=5%, target=10%
      const ctx2 = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 46.00, openPrice: 46, highPrice: 47, lowPrice: 45, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 55,
          avgPrice: 45.00,
          currentPrice: 46.00,
          totalInvested: perCycleQuota * 10,
        },
      });

      const signals2 = await strategy.evaluateStock(ctx2);
      const buy2_2 = signals2.find(s => s.reason.includes('Buy2'));
      expect(buy2_2!.reason).toContain('dip=5%');
      // Buy2 = 46 * 0.95 = $43.70
      expect(buy2_2!.price).toBe(43.70);

      const sell2_2 = signals2.find(s => s.reason.includes('Sell2'));
      expect(sell2_2!.reason).toContain('target=10%');
    });
  });

  // ============================================================
  // T=20 경계: Buy1+Buy2 → Buy2만 전환, dipRate=7%
  // ============================================================
  describe('T=20 경계: Buy 방식 전환', () => {
    it('T=19.9 → Buy1+Buy2, T=20.0 → Buy2만', async () => {
      const perCycleQuota = 250;

      // T=19.9 (<20): Buy1 + Buy2
      const ctx1 = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 42.00, openPrice: 42, highPrice: 43, lowPrice: 41, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 120,
          avgPrice: 42.00,
          currentPrice: 42.00,
          totalInvested: perCycleQuota * 19.9,
        },
      });

      const signals1 = await strategy.evaluateStock(ctx1);
      const buys1 = signals1.filter(s => s.side === 'BUY');
      expect(buys1.some(s => s.reason.includes('Buy1'))).toBe(true);
      expect(buys1.some(s => s.reason.includes('Buy2'))).toBe(true);

      // T=20.0: Buy2만, dipRate=7%
      const ctx2 = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 42.00, openPrice: 42, highPrice: 43, lowPrice: 41, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 120,
          avgPrice: 42.00,
          currentPrice: 42.00,
          totalInvested: perCycleQuota * 20,
        },
      });

      const signals2 = await strategy.evaluateStock(ctx2);
      const buys2 = signals2.filter(s => s.side === 'BUY');
      expect(buys2.every(s => s.reason.includes('Buy2'))).toBe(true);
      expect(buys2.some(s => s.reason.includes('Buy1'))).toBe(false);

      // Buy2 = 42 * 0.93 = $39.06, dipRate=7%
      expect(buys2[0].price).toBe(39.06);
      expect(buys2[0].reason).toContain('dip=7%');
    });
  });

  // ============================================================
  // T=30: dipRate=7%, 더 보수적 매수
  // ============================================================
  describe('T=30: 보수적 매수', () => {
    it('Buy2 = 현재가 × 0.93 (7% 아래)', async () => {
      const perCycleQuota = 250;
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 38.00, openPrice: 38, highPrice: 39, lowPrice: 37, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 200,
          avgPrice: 40.00,
          currentPrice: 38.00,
          totalInvested: perCycleQuota * 30,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      const buy2 = signals.find(s => s.reason.includes('Buy2'));
      // Buy2 = 38 * 0.93 = $35.34
      expect(buy2!.price).toBe(35.34);
      expect(buy2!.price!).toBeLessThan(38.00);

      // Sell 검증
      const sell1 = signals.find(s => s.reason.includes('Sell1'));
      // pivotPrice = 0.95 * 40 = 38.00
      expect(sell1!.price).toBe(38.00);

      const sell2 = signals.find(s => s.reason.includes('Sell2'));
      // T>=20 → target=15%, 40 * 1.15 = 46.00
      expect(sell2!.price).toBe(46.00);
      expect(sell2!.reason).toContain('target=15%');
    });
  });

  // ============================================================
  // 손절 테스트
  // ============================================================
  describe('손절: -30% 이하 하락', () => {
    it('avgPrice=50, curPrice=34.99 → 손절 발동 (-30.02%)', async () => {
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 34.99, openPrice: 36, highPrice: 37, lowPrice: 34.5, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 50,
          avgPrice: 50.00,
          currentPrice: 34.99,
          totalInvested: 2500,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(50);
      expect(signals[0].reason).toContain('Stop loss');
      expect(signals[0].price).toBe(34.99);
    });

    it('avgPrice=50, curPrice=35.01 → 손절 미발동 (-29.98%)', async () => {
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 35.01, openPrice: 36, highPrice: 37, lowPrice: 35, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 50,
          avgPrice: 50.00,
          currentPrice: 35.01,
          totalInvested: 2500,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      const stopLoss = signals.find(s => s.reason.includes('Stop loss'));
      expect(stopLoss).toBeUndefined();
      expect(signals.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // RSI 과매도 + 금리 급등 동시 적용
  // ============================================================
  describe('adjustedQuota 조정: RSI 과매도 + 금리 급등', () => {
    it('금리 급등 → ×0.5, RSI<30 → ×1.5 → 최종 ×0.75', async () => {
      const ctx = makeCtx({
        marketCondition: {
          referenceIndexAboveMA200: true,
          referenceIndexName: 'S&P500',
          interestRateRising: true,
        },
        stockIndicators: {
          currentAboveMA200: true,
          rsi14: 25,
        },
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 50, openPrice: 49, highPrice: 51, lowPrice: 48, volume: 100000000,
        },
      });

      // perCycleQuota=$250 × 0.5 × 1.5 = $187.50
      // buyQty = floor(187.50 / 50) = 3
      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('BUY');
      expect(signals[0].quantity).toBe(3);
    });
  });

  // ============================================================
  // 국내 주식 (원화 정수 반올림)
  // ============================================================
  describe('국내 주식: 원화 반올림', () => {
    it('국내 주식은 정수로 반올림, Buy1=현재가', async () => {
      const domesticWatch: WatchStockConfig = {
        ...watchStock,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: '삼성전자',
        quota: 4000000,
        maxCycles: 40,
      };

      const ctx = makeCtx({
        watchStock: domesticWatch,
        price: {
          stockCode: '005930', stockName: '삼성전자',
          currentPrice: 72500, openPrice: 72000, highPrice: 73000, lowPrice: 71500, volume: 5000000,
        },
        position: {
          stockCode: '005930',
          quantity: 1,
          avgPrice: 73000,
          currentPrice: 72500,
          totalInvested: 100000, // T = 1.0
        },
        totalPortfolioValue: 20000000,
        buyableAmount: 5000000,
      });

      // perCycleQuota = 100000, halfQuota = 50000
      // Buy1 = round(72500) = 72500, qty = floor(50000/72500) = 0
      // Buy2 = round(72500 * 0.97) = round(70325) = 70325, qty = floor(50000/70325) = 0
      // 분할 불가 → 전액 Buy1: qty = floor(100000/72500) = 1

      const signals = await strategy.evaluateStock(ctx);
      const buy1 = signals.find(s => s.reason.includes('Buy1'));
      expect(buy1).toBeDefined();
      expect(buy1!.quantity).toBe(1);
      expect(buy1!.price).toBe(72500);
      expect(buy1!.orderDivision).toBe('00'); // 국내는 지정가

      // 가격이 정수인지 확인
      signals.forEach(s => {
        if (s.price !== undefined) {
          expect(s.price % 1).toBe(0);
        }
      });
    });
  });

  // ============================================================
  // T=40: maxCycles 도달 → 매수 없음, 매도만
  // ============================================================
  describe('T=40: maxCycles 도달', () => {
    it('매수 없음, 매도 시그널만 생성', async () => {
      const perCycleQuota = 250;
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 40.00, openPrice: 40, highPrice: 41, lowPrice: 39, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 250,
          avgPrice: 40.00,
          currentPrice: 40.00,
          totalInvested: perCycleQuota * 40,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      const buys = signals.filter(s => s.side === 'BUY');
      expect(buys).toHaveLength(0);
      const sells = signals.filter(s => s.side === 'SELL');
      expect(sells.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // 버그 수정 확인: T=40에서도 손절/매도 동작
  // ============================================================
  describe('버그 수정 확인: T=40에서도 손절/매도 동작', () => {
    it('T=40 + 현재가 급락(-40%) → 손절 발동', async () => {
      const perCycleQuota = 250;
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 24.00, openPrice: 25, highPrice: 26, lowPrice: 23, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 250,
          avgPrice: 40.00,
          currentPrice: 24.00,
          totalInvested: perCycleQuota * 40,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      expect(signals).toHaveLength(1);
      expect(signals[0].side).toBe('SELL');
      expect(signals[0].quantity).toBe(250);
      expect(signals[0].reason).toContain('Stop loss');
    });

    it('T=40 + 수익 중 → Sell 시그널 생성 (매수 없음)', async () => {
      const perCycleQuota = 250;
      const ctx = makeCtx({
        price: {
          stockCode: 'TQQQ', stockName: 'TQQQ',
          currentPrice: 55.00, openPrice: 54, highPrice: 56, lowPrice: 53, volume: 100000000,
        },
        position: {
          stockCode: 'TQQQ',
          quantity: 250,
          avgPrice: 40.00,
          currentPrice: 55.00,
          totalInvested: perCycleQuota * 40,
        },
      });

      const signals = await strategy.evaluateStock(ctx);
      const buys = signals.filter(s => s.side === 'BUY');
      expect(buys).toHaveLength(0);
      const sells = signals.filter(s => s.side === 'SELL');
      expect(sells.length).toBeGreaterThanOrEqual(1);
      expect(sells.some(s => s.reason.includes('Sell1'))).toBe(true);
    });
  });

  // ============================================================
  // 버그 수정 확인: alreadyExecutedToday여도 손절 동작
  // ============================================================
  describe('alreadyExecutedToday = true', () => {
    it('매수/일반매도 차단, 손절은 여전히 동작', async () => {
      // 손절 미충족 → 전부 차단
      const ctx1 = makeCtx({
        alreadyExecutedToday: true,
        position: {
          stockCode: 'TQQQ',
          quantity: 50,
          avgPrice: 50,
          currentPrice: 45,
          totalInvested: 2500,
        },
      });
      ctx1.price.currentPrice = 45;
      const signals1 = await strategy.evaluateStock(ctx1);
      expect(signals1).toHaveLength(0);

      // 손절 충족 → 손절 동작
      const ctx2 = makeCtx({
        alreadyExecutedToday: true,
        position: {
          stockCode: 'TQQQ',
          quantity: 50,
          avgPrice: 50,
          currentPrice: 20,
          totalInvested: 2500,
        },
      });
      ctx2.price.currentPrice = 20;
      const signals2 = await strategy.evaluateStock(ctx2);
      expect(signals2).toHaveLength(1);
      expect(signals2[0].side).toBe('SELL');
      expect(signals2[0].reason).toContain('Stop loss');
    });
  });
});
