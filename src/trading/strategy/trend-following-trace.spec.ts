import { TrendFollowingStrategy } from './trend-following.strategy';
import { StockStrategyContext, WatchStockConfig, MarketCondition, StockIndicators } from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

/**
 * 추세 추종 전략 — 실제 시나리오 기반 트레이싱 테스트
 *
 * 시나리오: 삼성전자 (005930) 상승 추세 → 피라미딩 → 추세 소멸
 */
describe('TrendFollowingStrategy — Realistic Trace', () => {
  const strategy = new TrendFollowingStrategy();

  function createContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-tf-1',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      strategyName: 'trend-following',
      quota: 5000000,
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.07,
      maxPortfolioRate: 0.15,
    };

    const defaultPrice: StockPriceResult = {
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 72000,
      openPrice: 71000,
      highPrice: 73000,
      lowPrice: 70500,
      volume: 1500000,
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
      buyableAmount: 5000000,
      totalPortfolioValue: 50000000,
      ...overrides,
    };
  }

  // ============================================================
  // 1. 신규 진입 시나리오
  // ============================================================

  it('Day 1: 골든크로스 + ADX>25 + 가격>MA20 → 진입', async () => {
    const ctx = createContext();
    // ma20(70000) > ma60(68000) ✓, adx14(30) > 25 ✓, curPrice(72000) > ma20(70000) ✓
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
    expect(signals[0].quantity).toBe(Math.floor(5000000 / 72000)); // 69
    expect(signals[0].price).toBe(72000);
  });

  // ============================================================
  // 2. 피라미딩 시나리오
  // ============================================================

  it('Day 10: 수익 +6%, 추세 유지 → 피라미딩', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 76500, // +6.25%
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 73000,
        ma60: 70000,
        adx14: 32,
      },
    });
    ctx.price.currentPrice = 76500;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
    expect(signals[0].reason).toContain('피라미딩');
    // pyramidAmount = min(5000000*0.5, 5000000) = 2500000 / 76500 = 32
    expect(signals[0].quantity).toBe(Math.floor(2500000 / 76500));
  });

  it('Day 10: 수익 +6%이지만 ADX=23 (약한 추세) → 피라미딩 안함', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 76500,
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 73000,
        ma60: 70000,
        adx14: 23, // < 25
      },
    });
    ctx.price.currentPrice = 76500;

    const signals = await strategy.evaluateStock(ctx);
    // ADX(23) < adxThreshold(25) → 피라미딩 불가
    // ADX(23) >= adxExitThreshold(20) → 추세소멸 아님
    expect(signals).toHaveLength(0);
  });

  it('Day 10: 수익 +4.5% (< 5%) → 피라미딩 안함', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 75240, // +4.5%
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 73000,
        ma60: 70000,
        adx14: 30,
      },
    });
    ctx.price.currentPrice = 75240;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 3. 손절 시나리오
  // ============================================================

  it('Day 5: -7.5% 하락 → 손절', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 66600, // -7.5%
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 70000,
        ma60: 68000,
        adx14: 28,
      },
    });
    ctx.price.currentPrice = 66600;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(69);
    expect(signals[0].reason).toContain('손절');
  });

  it('Day 5: -6.5% 하락 (7% 미만) → 손절 아님', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 67320, // -6.5%
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 70000,
        ma60: 68000,
        adx14: 28,
      },
    });
    ctx.price.currentPrice = 67320;

    const signals = await strategy.evaluateStock(ctx);
    const stopLoss = signals.find(s => s.reason?.includes('손절'));
    expect(stopLoss).toBeUndefined();
  });

  // ============================================================
  // 4. 추세 소멸 매도 시나리오
  // ============================================================

  it('Day 30: 데드크로스 (MA20 < MA60) → 전량 매도', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 101, // 피라미딩 후 총량
        avgPrice: 73000,
        currentPrice: 74000,
        totalInvested: 7373000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 72000, // dead cross
        ma60: 73000,
        adx14: 22,
      },
    });
    ctx.price.currentPrice = 74000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(101);
    expect(signals[0].reason).toContain('데드크로스');
  });

  it('Day 30: ADX < 20 (추세 소멸) → 전량 매도', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 101,
        avgPrice: 73000,
        currentPrice: 75000,
        totalInvested: 7373000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 74000, // golden cross 유지
        ma60: 73000,
        adx14: 18, // < 20
      },
    });
    ctx.price.currentPrice = 75000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].reason).toContain('추세소멸');
  });

  // ============================================================
  // 5. 버그 수정 검증: alreadyExecutedToday와 손절/추세소멸
  // ============================================================

  it('alreadyExecutedToday=true + 손절 조건 → 손절 동작', async () => {
    const ctx = createContext({
      alreadyExecutedToday: true,
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 66000, // -8.3%
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 70000,
        ma60: 68000,
        adx14: 28,
      },
    });
    ctx.price.currentPrice = 66000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].reason).toContain('손절');
  });

  it('alreadyExecutedToday=true + 추세소멸 → 매도 동작', async () => {
    const ctx = createContext({
      alreadyExecutedToday: true,
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 74000,
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 71000, // dead cross
        ma60: 72000,
        adx14: 25,
      },
    });
    ctx.price.currentPrice = 74000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].reason).toContain('데드크로스');
  });

  it('alreadyExecutedToday=true + 피라미딩 조건 → 피라미딩 차단', async () => {
    const ctx = createContext({
      alreadyExecutedToday: true,
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 76500, // +6.25%
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 73000,
        ma60: 70000,
        adx14: 32,
      },
    });
    ctx.price.currentPrice = 76500;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0); // 피라미딩은 하루 1회 제한
  });

  it('alreadyExecutedToday=true + 신규 진입 → 진입 차단', async () => {
    const ctx = createContext({ alreadyExecutedToday: true });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('alreadyExecutedToday=true + riskState.liquidateAll → 전량 청산 동작', async () => {
    const ctx = createContext({
      alreadyExecutedToday: true,
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 65000,
        totalInvested: 4968000,
      },
      riskState: {
        liquidateAll: true,
        buyBlocked: true,
        positionCount: 1,
        investedRate: 0.5,
        dailyPnlRate: -0.1,
        drawdown: -0.21,
        reasons: ['MDD -21% 초과'],
      },
    });
    ctx.price.currentPrice = 65000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].reason).toContain('리스크 전량청산');
  });

  // ============================================================
  // 6. 해외 종목
  // ============================================================

  it('해외 종목: 소수점 2자리 반올림', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 180,
        ma60: 175,
        adx14: 30,
      },
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';
    ctx.watchStock.stockCode = 'AAPL';
    ctx.price.currentPrice = 185.567;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].price).toBe(185.57);
    expect(signals[0].exchangeCode).toBe('NASD');
  });

  // ============================================================
  // 7. 손절 vs 추세소멸 우선순위
  // ============================================================

  it('손절과 데드크로스 동시 충족 → 손절 우선', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 66000, // -8.3%
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 67000, // dead cross
        ma60: 68000,
        adx14: 15, // weak trend too
      },
    });
    ctx.price.currentPrice = 66000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].reason).toContain('손절'); // 데드크로스가 아닌 손절
  });

  // ============================================================
  // 8. 피라미딩 무한 반복 가능성 점검
  // ============================================================

  it('피라미딩: quota=0 → 추가매수 0주', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 69,
        avgPrice: 72000,
        currentPrice: 76500,
        totalInvested: 4968000,
      },
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 73000,
        ma60: 70000,
        adx14: 32,
      },
    });
    ctx.watchStock.quota = 0;
    ctx.price.currentPrice = 76500;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });
});
