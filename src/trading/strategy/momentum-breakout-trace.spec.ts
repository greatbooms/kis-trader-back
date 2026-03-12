import { MomentumBreakoutStrategy } from './momentum-breakout.strategy';
import { StockStrategyContext, WatchStockConfig, MarketCondition, StockIndicators } from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

/**
 * 모멘텀 돌파 전략 — 실제 시나리오 기반 트레이싱 테스트
 *
 * 시나리오: 삼성전자 (005930) 단기 급등 + 트레일링 스탑
 * - 변동성 돌파 진입 → 1차 익절 → 트레일링 스탑
 */
describe('MomentumBreakoutStrategy — Realistic Trace', () => {
  const strategy = new MomentumBreakoutStrategy();

  function createContext(overrides: Partial<StockStrategyContext> = {}): StockStrategyContext {
    const defaultWatchStock: WatchStockConfig = {
      id: 'ws-mom-1',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      strategyName: 'momentum-breakout',
      quota: 2000000,
      cycle: 1,
      maxCycles: 40,
      stopLossRate: 0.03,
      maxPortfolioRate: 0.15,
    };

    const defaultPrice: StockPriceResult = {
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 72000,
      openPrice: 70000,
      highPrice: 72500,
      lowPrice: 69500,
      volume: 2000000,
    };

    const defaultMarketCondition: MarketCondition = {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'KOSPI',
      interestRateRising: false,
    };

    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
      ma200: 65000,
      ma20: 69000,
      ma60: 67000,
      rsi14: 60,
      bollingerUpper: 75000,
      bollingerMiddle: 70000,
      bollingerLower: 65000,
      volumeRatio: 2.0,
      prevHigh: 71000,
      prevLow: 69000,
      todayOpen: 70000,
    };

    return {
      watchStock: defaultWatchStock,
      price: defaultPrice,
      position: undefined,
      alreadyExecutedToday: false,
      marketCondition: defaultMarketCondition,
      stockIndicators: defaultStockIndicators,
      buyableAmount: 2000000,
      totalPortfolioValue: 50000000,
      ...overrides,
    };
  }

  // ============================================================
  // 1. 진입 조건 점검 — 모든 조건 충족 시에만 매수
  // ============================================================

  it('모든 조건 충족 → 매수', async () => {
    // curPrice=72000 > ma20=69000 ✓
    // rsi14=60 (50~70) ✓
    // volumeRatio=2.0 >= 1.5 ✓
    // breakout = 70000 + (71000-69000)*0.5 = 71000, curPrice(72000) >= 71000 ✓
    const ctx = createContext();
    const signals = await strategy.evaluateStock(ctx);

    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
    // quota=2000000, buyQty = floor(2000000/72000) = 27
    expect(signals[0].quantity).toBe(Math.floor(2000000 / 72000));
    expect(signals[0].price).toBe(72000);
    expect(signals[0].reason).toContain('모멘텀돌파');
  });

  it('가격 <= MA20 → 매수 안함', async () => {
    const ctx = createContext();
    ctx.price.currentPrice = 68000; // <= ma20(69000)
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('RSI < 50 → 매수 안함', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 69000,
        rsi14: 45, // < 50
        volumeRatio: 2.0,
        prevHigh: 71000,
        prevLow: 69000,
        todayOpen: 70000,
      },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('RSI > 70 → 매수 안함 (과열)', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 69000,
        rsi14: 75, // > 70
        volumeRatio: 2.0,
        prevHigh: 71000,
        prevLow: 69000,
        todayOpen: 70000,
      },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('거래량 부족 (volumeRatio < 1.5) → 매수 안함', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 69000,
        rsi14: 60,
        volumeRatio: 1.2, // < 1.5
        prevHigh: 71000,
        prevLow: 69000,
        todayOpen: 70000,
      },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('변동성 돌파 미달 → 매수 안함', async () => {
    // breakout = 70000 + (71000-69000)*0.5 = 71000
    // curPrice = 70500 < 71000 → 돌파 안됨
    const ctx = createContext();
    ctx.price.currentPrice = 70500;
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('breakoutPrice 경계값: curPrice == breakoutPrice → 매수 안함 (< 아닌 >= 아님)', async () => {
    // breakout = 70000 + (71000-69000)*0.5 = 71000
    // curPrice = 71000 → curPrice < breakoutPrice? NO → 돌파 인정? 코드에서는 curPrice < breakoutPrice return → 71000 < 71000 = false → 통과
    const ctx = createContext();
    ctx.price.currentPrice = 71000;
    // 하지만 curPrice(71000) <= ma20(69000)? NO → ma20 통과
    // 조건: 진입됨! curPrice >= breakoutPrice → curPrice NOT < breakoutPrice
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  // ============================================================
  // 2. 포지션 보유 — 손절
  // ============================================================

  it('손절: -3% 이하 → 전량 매도', async () => {
    // avgPrice=72000, -3% = 69840
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 69000,
        totalInvested: 1944000,
      },
    });
    ctx.price.currentPrice = 69000;
    // profitRate = (69000-72000)/72000 = -4.2%

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(27);
    expect(signals[0].reason).toContain('손절');
  });

  it('손실 -2.5%: 아직 손절 아님', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 70200, // -2.5%
        totalInvested: 1944000,
      },
    });
    ctx.price.currentPrice = 70200;
    ctx.price.highPrice = 72000; // 고점과 같으니 트레일링 안걸림

    const signals = await strategy.evaluateStock(ctx);
    const stopLoss = signals.find(s => s.reason?.includes('손절'));
    expect(stopLoss).toBeUndefined();
  });

  // ============================================================
  // 3. 트레일링 스탑 — 당일 고가 대비 -2%
  // ============================================================

  it('트레일링 스탑: 고가 78000 대비 -2% (76440) → curPrice 74500 → 발동', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 74500,
        totalInvested: 1944000,
      },
    });
    ctx.price.currentPrice = 74500;
    ctx.price.highPrice = 78000;
    // 78000 * 0.98 = 76440, 74500 < 76440 → 트레일링 발동

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(27);
    expect(signals[0].reason).toContain('트레일링스탑');
  });

  it('고가 대비 -1.5%: 트레일링 미발동', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 76500,
        totalInvested: 1944000,
      },
    });
    ctx.price.currentPrice = 76500;
    ctx.price.highPrice = 78000;
    // 78000 * 0.98 = 76440, 76500 >= 76440 → 트레일링 미발동

    const signals = await strategy.evaluateStock(ctx);
    const trailing = signals.find(s => s.reason?.includes('트레일링스탑'));
    expect(trailing).toBeUndefined();
  });

  it('highPrice=0 → 트레일링 스탑 비활성', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 73000,
        totalInvested: 1944000,
      },
    });
    ctx.price.currentPrice = 73000;
    ctx.price.highPrice = 0;

    const signals = await strategy.evaluateStock(ctx);
    const trailing = signals.find(s => s.reason?.includes('트레일링스탑'));
    expect(trailing).toBeUndefined();
  });

  // ============================================================
  // 4. 손절 vs 트레일링 우선순위 — 손절이 먼저
  // ============================================================

  it('손절과 트레일링 동시 충족 → 손절이 먼저 (return)', async () => {
    // avgPrice=72000, -3%=69840 → curPrice=69000 (손절 충족)
    // highPrice=78000, -2%=76440 → 69000 < 76440 (트레일링도 충족)
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 69000,
        totalInvested: 1944000,
      },
    });
    ctx.price.currentPrice = 69000;
    ctx.price.highPrice = 78000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].reason).toContain('손절'); // 트레일링이 아닌 손절
  });

  // ============================================================
  // 5. 익절 — 1차(+5%) 50%, 2차(+8%) 전량
  // ============================================================

  it('1차 익절: +5% → 50% 매도', async () => {
    // avgPrice=72000, +5%=75600
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 75600,
        totalInvested: 1944000,
      },
    });
    ctx.price.currentPrice = 75600;
    ctx.price.highPrice = 75600; // 고점과 같으므로 트레일링 안걸림

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(Math.floor(27 / 2)); // 13
    expect(signals[0].reason).toContain('익절(반)');
  });

  it('2차 익절: +8% → 전량 매도', async () => {
    // avgPrice=72000, +8%=77760
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 14, // 1차 익절 후 남은 수량
        avgPrice: 72000,
        currentPrice: 77760,
        totalInvested: 1008000,
      },
    });
    ctx.price.currentPrice = 77760;
    ctx.price.highPrice = 77760;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(14); // 전량
    expect(signals[0].reason).toContain('익절(전량)');
  });

  // ============================================================
  // 6. 익절 우선순위 — +8% > +5% > 트레일링
  // ============================================================

  it('+8%와 +5% 동시 충족 → +8% 우선 (전량 매도)', async () => {
    // avgPrice=72000, +8%=77760, +5%=75600
    // curPrice=80000 → 둘 다 충족, +8%가 먼저 체크됨
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 80000,
        totalInvested: 1944000,
      },
    });
    ctx.price.currentPrice = 80000;
    ctx.price.highPrice = 80000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].quantity).toBe(27); // 전량 (8% 익절)
    expect(signals[0].reason).toContain('익절(전량)');
  });

  // ============================================================
  // 7. 해외 종목 테스트
  // ============================================================

  it('해외 종목: 가격 소수점 2자리 + exchangeCode 포함', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 150,
        rsi14: 60,
        volumeRatio: 2.0,
        prevHigh: 155,
        prevLow: 150,
        todayOpen: 152,
      },
    });
    ctx.watchStock.market = 'OVERSEAS';
    ctx.watchStock.exchangeCode = 'NASD';
    ctx.watchStock.stockCode = 'AAPL';
    // breakout = 152 + (155-150)*0.5 = 154.5
    ctx.price.currentPrice = 155.678; // > breakout(154.5)

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].price).toBe(155.68); // 반올림
    expect(signals[0].exchangeCode).toBe('NASD');
  });

  // ============================================================
  // 8. buyableAmount 제한
  // ============================================================

  it('buyableAmount < quota → buyableAmount 기준 매수', async () => {
    const ctx = createContext({ buyableAmount: 500000 });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    // buyAmount = min(2000000, 500000) = 500000, qty = floor(500000/72000) = 6
    expect(signals[0].quantity).toBe(Math.floor(500000 / 72000));
  });

  // ============================================================
  // 9. quota=0 → 매수 불가
  // ============================================================

  it('quota=0 → 매수 0주', async () => {
    const ctx = createContext();
    ctx.watchStock.quota = 0;
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 10. 커스텀 파라미터
  // ============================================================

  it('커스텀 kValue=0.7: 더 높은 돌파 기준', async () => {
    const ctx = createContext();
    ctx.watchStock.strategyParams = { kValue: 0.7 };
    // breakout = 70000 + (71000-69000)*0.7 = 71400
    // curPrice=72000 >= 71400 → 돌파
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  it('커스텀 kValue=0.7 + 미세 돌파 미달', async () => {
    const ctx = createContext();
    ctx.watchStock.strategyParams = { kValue: 0.7 };
    ctx.price.currentPrice = 71300; // < breakout(71400)
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('커스텀 stopLossRate=0.05: 더 넓은 손절', async () => {
    // avgPrice=72000, -5%=68400
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 69000, // -4.2%
        totalInvested: 1944000,
      },
    });
    ctx.watchStock.strategyParams = { stopLossRate: 0.05 };
    ctx.price.currentPrice = 69000;
    ctx.price.highPrice = 72000; // 트레일링 안걸리게

    const signals = await strategy.evaluateStock(ctx);
    // -4.2% > -5% → 손절 안됨
    const stopLoss = signals.find(s => s.reason?.includes('손절'));
    expect(stopLoss).toBeUndefined();
  });

  // ============================================================
  // 11. prevHigh = prevLow (변동폭 0) → breakout = todayOpen
  // ============================================================

  it('전일 변동폭 0 → breakout = todayOpen, curPrice >= todayOpen 이면 매수', async () => {
    const ctx = createContext({
      stockIndicators: {
        currentAboveMA200: true,
        ma20: 69000,
        rsi14: 60,
        volumeRatio: 2.0,
        prevHigh: 70000,
        prevLow: 70000, // range = 0
        todayOpen: 70000,
      },
    });
    // breakout = 70000 + 0*0.5 = 70000
    // curPrice(72000) >= 70000 → 돌파
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
  });

  // ============================================================
  // 12. riskState 관련
  // ============================================================

  it('riskState.buyBlocked → 매수 차단', async () => {
    const ctx = createContext({
      riskState: {
        liquidateAll: false,
        buyBlocked: true,
        positionCount: 3,
        investedRate: 0.5,
        dailyPnlRate: -0.02,
        drawdown: 0.05,
        reasons: ['MDD 5%'],
      },
    });
    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('riskState.liquidateAll + 포지션 → 전량 청산', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 71000,
        totalInvested: 1944000,
      },
      riskState: {
        liquidateAll: true,
        buyBlocked: true,
        positionCount: 1,
        investedRate: 0.5,
        dailyPnlRate: -0.1,
        drawdown: -0.13,
        reasons: ['MDD -13% 초과'],
      },
    });
    ctx.price.currentPrice = 71000;

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(27);
    expect(signals[0].reason).toContain('리스크 전량청산');
  });

  // ============================================================
  // 13. 포지션 보유 중 이익도 손실도 아닌 상태 → 시그널 없음
  // ============================================================

  it('보유 중 변화 없음 (profitRate ≈ 0) → 시그널 없음', async () => {
    const ctx = createContext({
      position: {
        stockCode: '005930',
        quantity: 27,
        avgPrice: 72000,
        currentPrice: 72000,
        totalInvested: 1944000,
      },
    });
    ctx.price.currentPrice = 72000;
    ctx.price.highPrice = 72500; // 72500*0.98=71050, 72000 > 71050 → 트레일링 안걸림

    const signals = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });
});
