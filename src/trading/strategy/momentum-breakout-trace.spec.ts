import { MomentumBreakoutStrategy } from './momentum-breakout.strategy';
import { StockStrategyContext, WatchStockConfig, MarketCondition, StockIndicators } from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

/**
 * 변동성 돌파 (당일청산) — 하루 사이클 트레이싱 테스트
 *
 * 시나리오: 삼성전자 (005930), 2026-06-10
 * - 전일 고가 71000 / 저가 69000 → 변동폭 2000
 * - 당일 시가 70000 → 돌파가 = 70000 + 2000×0.5 = 71000
 * - 장중 매 분 평가를 시점별로 재현: 돌파 대기 → 진입 → 보유 → 청산
 */
describe('MomentumBreakoutStrategy — 당일 사이클 트레이스', () => {
  const strategy = new MomentumBreakoutStrategy();

  const TODAY = '2026-06-10';
  const YESTERDAY = '2026-06-09';

  /** 2026-06-10(수) KST hh:mm */
  function kst(hour: number, minute: number, day = 10): Date {
    return new Date(Date.UTC(2026, 5, day, hour - 9, minute));
  }

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
      stopLossRate: 0.3,
      maxPortfolioRate: 0.15,
    };

    const defaultPrice: StockPriceResult = {
      stockCode: '005930',
      stockName: '삼성전자',
      currentPrice: 70800,
      openPrice: 70000,
      highPrice: 70900,
      lowPrice: 69800,
      volume: 800000,
      tradingValue: 56400000000, // VWAP = 70500
    } as StockPriceResult;

    const defaultMarketCondition: MarketCondition = {
      referenceIndexAboveMA200: true,
      referenceIndexName: 'KOSPI',
      interestRateRising: false,
    };

    const defaultStockIndicators: StockIndicators = {
      currentAboveMA200: true,
      ma200: 65000,
      ma20: 69500,
      ma60: 67000,
      rsi14: 58,
      avgVolume20: 1500000,
      prevHigh: 71000,
      prevLow: 69000,
      todayOpen: 70000,
      foreignNetBuy: true,
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
      now: kst(10, 15),
      ...overrides,
    };
  }

  function holdingContext(
    overrides: Partial<StockStrategyContext>,
    currentPrice: number,
    quantity = 28,
  ): StockStrategyContext {
    const ctx = createContext(overrides);
    ctx.price.currentPrice = currentPrice;
    ctx.position = {
      stockCode: '005930',
      quantity,
      avgPrice: 71200,
      currentPrice,
      totalInvested: 71200 * quantity,
    };
    ctx.watchStock.strategyParams = {
      ...(ctx.watchStock.strategyParams ?? {}),
      entryDate: TODAY,
    };
    return ctx;
  }

  // ============================================================
  // 1. 장 초반: 돌파 전 관망
  // ============================================================

  it('09:30 — 돌파가 미달 → 관망', async () => {
    const ctx = createContext({ now: kst(9, 30) });
    ctx.price.currentPrice = 70800; // < 돌파가 71000

    const { signals, skipReasons } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
    expect(skipReasons.some((r) => r.includes('돌파 대기'))).toBe(true);
  });

  // ============================================================
  // 2. 돌파 → 진입
  // ============================================================

  it('10:15 — 돌파 직후 (+0.3%) → 시장가 매수', async () => {
    const ctx = createContext({ now: kst(10, 15) });
    ctx.price.currentPrice = 71200; // 돌파가 71000 돌파, 추격 한도(71710) 이내
    // 시간보정 거래량: 경과 75분 → 1.5M × (75/390) ≈ 288,461 ≤ 800,000 ✓
    // VWAP 70500 ≤ 71200 ✓ / MA20 69500 < 71200 ✓ / 외인 순매수 ✓

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('BUY');
    expect(signals[0].price).toBeUndefined(); // 시장가
    expect(signals[0].quantity).toBe(Math.floor(2000000 / 71200)); // 28
    expect(signals[0].metadata?.phase).toBe('vb-entry');
    expect(signals[0].metadata?.breakoutPrice).toBe(71000);
  });

  it('10:15 — 이미 급등해버린 경우 (+1.5%) → 추격 금지', async () => {
    const ctx = createContext({ now: kst(10, 15) });
    ctx.price.currentPrice = 72100; // > 71000 × 1.01 = 71710

    const { signals, skipReasons } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
    expect(skipReasons.some((r) => r.includes('추격 금지'))).toBe(true);
  });

  it('14:35 — 늦은 돌파 → 진입 윈도우 종료로 관망', async () => {
    const ctx = createContext({ now: kst(14, 35) });
    ctx.price.currentPrice = 71200;

    const { signals, skipReasons } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
    expect(skipReasons.some((r) => r.includes('시간 윈도우'))).toBe(true);
  });

  // ============================================================
  // 3. 보유 중: 청산 조건 미충족 → 유지
  // ============================================================

  it('11:00 — 보유 중 +0.8%, 고가 인접 → 보유 유지', async () => {
    const ctx = holdingContext({ now: kst(11, 0) }, 71800);
    ctx.price.highPrice = 71900; // 71900×0.98 = 70462 < 71800 → 트레일링 미발동

    const { signals, skipReasons } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
    expect(skipReasons.some((r) => r.includes('보유 유지'))).toBe(true);
  });

  // ============================================================
  // 4. 청산 시나리오 A — 트레일링 (고점 후 -2%)
  // ============================================================

  it('13:00 — 고가 73500 대비 -2% 하회 → 트레일링 전량 청산', async () => {
    const ctx = holdingContext({ now: kst(13, 0) }, 72000);
    ctx.price.highPrice = 73500; // 73500×0.98 = 72030 > 72000 → 발동

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(28);
    expect(signals[0].price).toBeUndefined(); // 시장가
    expect(signals[0].metadata?.phase).toBe('trailing-stop');
    expect(signals[0].reason.toLowerCase()).not.toContain('stop loss');
  });

  // ============================================================
  // 5. 청산 시나리오 B — 손절 (-2%)
  // ============================================================

  it('11:30 — -2.1% → 손절 전량 청산', async () => {
    const ctx = holdingContext({ now: kst(11, 30) }, 69700);
    ctx.price.highPrice = 71300;
    // profitRate = (69700-71200)/71200 = -2.1%

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].metadata?.phase).toBe('intraday-stop');
    expect(signals[0].reason).toContain('손절');
    expect(signals[0].reason.toLowerCase()).not.toContain('stop loss');
  });

  it('11:30 — -1.5%는 손절 기준 미달 → 보유 유지', async () => {
    const ctx = holdingContext({ now: kst(11, 30) }, 70150);
    ctx.price.highPrice = 71300; // 71300×0.98 = 69874 < 70150 → 트레일링 미발동
    // profitRate = (70150-71200)/71200 = -1.47%

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 6. 청산 시나리오 C — 당일청산 (15:10)
  // ============================================================

  it('15:09 — 마감 직전이지만 아직 당일청산 시각 아님 → 보유', async () => {
    const ctx = holdingContext({ now: kst(15, 9) }, 71400);
    ctx.price.highPrice = 71500;

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('15:10 — 당일청산 시각 도달 → 전량 시장가 청산', async () => {
    const ctx = holdingContext({ now: kst(15, 10) }, 71400);
    ctx.price.highPrice = 71500;

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(28);
    expect(signals[0].metadata?.phase).toBe('eod-exit');
    expect(signals[0].reason).toContain('당일청산');
  });

  it('15:10 — 당일청산 후 같은 날 재진입 금지', async () => {
    // 청산 체결 후 다음 루프: 포지션 없음 + 오늘 체결 이력 존재
    const ctx = createContext({ now: kst(15, 12), alreadyExecutedToday: true });
    ctx.price.currentPrice = 71500;

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 7. 청산 시나리오 D — 이월 포지션 정리 (다음날)
  // ============================================================

  it('다음날 09:10 — 전일 진입분 잔존 → 즉시 이월청산 (진입 윈도우 무관)', async () => {
    const ctx = createContext({ now: kst(9, 10, 11) }); // 2026-06-11 09:10
    ctx.price.currentPrice = 70500;
    ctx.position = {
      stockCode: '005930',
      quantity: 28,
      avgPrice: 71200,
      currentPrice: 70500,
      totalInvested: 71200 * 28,
    };
    ctx.watchStock.strategyParams = { entryDate: TODAY }; // 어제(06-10) 진입

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].metadata?.phase).toBe('carryover-exit');
    expect(signals[0].reason).toContain('이월청산');
    expect(signals[0].reason).toContain(TODAY);
  });

  it('이월청산이 손절보다 우선 (전일분은 조건 없이 정리)', async () => {
    const ctx = createContext({ now: kst(10, 0) });
    ctx.price.currentPrice = 69000; // -3.1% (손절 조건도 충족)
    ctx.position = {
      stockCode: '005930',
      quantity: 28,
      avgPrice: 71200,
      currentPrice: 69000,
      totalInvested: 71200 * 28,
    };
    ctx.watchStock.strategyParams = { entryDate: YESTERDAY };

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].metadata?.phase).toBe('carryover-exit');
  });

  // ============================================================
  // 8. 미체결 주문 가드
  // ============================================================

  it('진입 직후 미체결 매수 주문 존재 → 다음 분 중복 진입 금지', async () => {
    const ctx = createContext({ now: kst(10, 16), hasOpenBuyOrder: true });
    ctx.price.currentPrice = 71200;

    const { signals, skipReasons } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
    expect(skipReasons.some((r) => r.includes('미체결'))).toBe(true);
  });

  it('일반 청산(손절)은 미체결 매도 주문 처리 대기 중 중복 발행 금지', async () => {
    const ctx = holdingContext({ now: kst(11, 30), hasOpenSellOrder: true }, 69700);
    ctx.price.highPrice = 71300;
    // -2.1% 손절 조건이지만 직전 매도 주문이 처리 중 → 다음 분 재평가

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('당일청산은 미체결 매도 주문이 있어도 발행 (오버나잇 방지 우선, 중복은 브로커가 거부)', async () => {
    const ctx = holdingContext({ now: kst(15, 11), hasOpenSellOrder: true }, 71400);
    ctx.price.highPrice = 71500;

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].metadata?.phase).toBe('eod-exit');
  });

  // ============================================================
  // 9. 수량/한도
  // ============================================================

  it('buyableAmount < quota → 주문가능금액 기준 수량', async () => {
    const ctx = createContext({ now: kst(10, 15), buyableAmount: 500000 });
    ctx.price.currentPrice = 71200;

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].quantity).toBe(Math.floor(500000 / 71200)); // 7
  });

  it('quota 0 → 진입 불가', async () => {
    const ctx = createContext({ now: kst(10, 15) });
    ctx.price.currentPrice = 71200;
    ctx.watchStock.quota = 0;

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  // ============================================================
  // 10. 리스크 상태
  // ============================================================

  it('riskState.buyBlocked → 돌파해도 진입 차단', async () => {
    const ctx = createContext({
      now: kst(10, 15),
      riskState: {
        liquidateAll: false,
        buyBlocked: true,
        positionCount: 3,
        investedRate: 0.5,
        dailyPnlRate: -0.02,
        drawdown: -0.09,
        reasons: ['MDD -9%'],
      },
    });
    ctx.price.currentPrice = 71200;

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(0);
  });

  it('riskState.liquidateAll + 보유 → 리스크 전량청산 최우선', async () => {
    const ctx = holdingContext(
      {
        now: kst(11, 0),
        riskState: {
          liquidateAll: true,
          buyBlocked: true,
          positionCount: 1,
          investedRate: 0.5,
          dailyPnlRate: -0.1,
          drawdown: -0.13,
          reasons: ['MDD -13% 초과'],
        },
      },
      71400,
    );

    const { signals } = await strategy.evaluateStock(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0].side).toBe('SELL');
    expect(signals[0].quantity).toBe(28);
    expect(signals[0].reason).toContain('리스크 전량청산');
  });
});
