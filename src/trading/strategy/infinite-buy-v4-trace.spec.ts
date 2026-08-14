/**
 * 무한매수 V4 — 전체 사이클 트레이스 (사이클 시작 → 전반전 → 후반전 → 소진 →
 * 리버스 진입 → 리버스 진행 → 리버스 복귀 → 사이클 종료).
 *
 * 각 국면의 개별 신호 형태는 infinite-buy-v4.strategy.spec.ts가 이미 정확한 수치로
 * 검증한다. 이 트레이스는 대신 "국면 사이의 배선"을 검증한다 — 즉 어느 날의 체결이
 * TradingService.handleInfiniteBuyV4SignalFill과 동일한 규칙(§3 T 회계, 매도 먼저
 * 반영)으로 T/잔금/보유수량/평단을 갱신하면, 다음 날 전략이 그 상태를 올바르게 읽어
 * 다음 국면의 신호를 만들어내는지를 여러 날에 걸쳐 재현한다.
 *
 * 체결 적용 로직(applyFills)은 trading.service.ts의 handleInfiniteBuyV4SignalFill과
 * 같은 math util 함수(applyBuyFillToT/applySellFillToT/roundToCent)를 그대로 사용한다.
 * 40분할 실전 스케일은 하루 1턴 안팎으로 증가해 소진까지 수십 일이 걸리므로,
 * 이 트레이스는 N=4로 축소해 같은 공식으로 몇 거래일 안에 전체 국면을 통과시킨다.
 * 후반전 구간(Day2→Day3)은 여러 날의 반복적인 별지점 매수/쿼터매도 누적을 하나의
 * T 점프로 압축했다 — 그 구간의 정확한 수치는 대상이 아니고, "T가 N-1을 넘는 순간
 * REVERSE로 전환되는지"가 검증 대상이다.
 */
import { InfiniteBuyV4Strategy } from './infinite-buy-v4.strategy';
import { Broker } from '@prisma/client';
import {
  applyBuyFillToT,
  applySellFillToT,
  roundToCent,
} from './infinite-buy-v4-math.util';
import {
  StockStrategyContext,
  WatchStockConfig,
  MarketCondition,
  StockIndicators,
  TradingSignal,
  InfiniteBuyV4RecentClose,
} from '../types';
import { StockPriceResult } from '../../kis/types/kis-api.types';

describe('InfiniteBuyV4 — 전체 사이클 트레이스', () => {
  const strategy = new InfiniteBuyV4Strategy();
  const N = 4;
  const PRINCIPAL = 1120;

  const watchStockBase: Omit<WatchStockConfig, 'strategyParams'> = {
    id: 'ws-v4-trace',
    broker: Broker.KIS,
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    stockName: 'ProShares UltraPro QQQ',
    strategyName: 'infinite-buy-v4',
    quota: PRINCIPAL,
    cycle: 1,
    maxCycles: N,
    stopLossRate: 0.5,
    maxPortfolioRate: 1,
  };

  const marketOk: MarketCondition = {
    referenceIndexAboveMA200: true,
    referenceIndexName: 'NASDAQ',
    interestRateRising: false,
  };

  interface SimState {
    T: number;
    cashRemaining: number;
    mode: 'NORMAL' | 'REVERSE';
    cycleSeq: number;
    holdQty: number;
    avgPrice: number;
    recentCloses: InfiniteBuyV4RecentClose[];
  }

  function buildCtx(state: SimState, curPrice: number, prevClose: number, dateStr: string): StockStrategyContext {
    const price: StockPriceResult = {
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      currentPrice: curPrice,
      openPrice: curPrice,
      highPrice: curPrice,
      lowPrice: curPrice,
      volume: 1_000_000,
    };
    const stockIndicators: StockIndicators = { currentAboveMA200: true, prevClose };

    return {
      watchStock: {
        ...watchStockBase,
        strategyParams: {
          v4: {
            turn: state.T,
            cashRemaining: state.cashRemaining,
            mode: state.mode,
            cycleSeq: state.cycleSeq,
            recentCloses: state.recentCloses,
          },
        },
      },
      price,
      position: state.holdQty > 0
        ? {
            stockCode: 'TQQQ',
            quantity: state.holdQty,
            avgPrice: state.avgPrice,
            currentPrice: curPrice,
            totalInvested: roundToCent(state.holdQty * state.avgPrice),
          }
        : undefined,
      alreadyExecutedToday: false,
      marketCondition: marketOk,
      stockIndicators,
      buyableAmount: 1_000_000,
      totalPortfolioValue: 1_000_000,
      now: new Date(`${dateStr}T00:00:00Z`),
    };
  }

  /** LOC/MOC/limit-touch 체결 판정 — backtest 엔진의 fillModel 계약과 동일 (§7). */
  function fillsToday(
    signals: TradingSignal[],
    closePrice: number,
    dayHigh: number,
  ): (TradingSignal & { executedPrice: number })[] {
    return signals
      .filter((s) => {
        const model = s.metadata?.fillModel;
        if (model === 'moc') return true;
        if (model === 'loc') {
          return s.side === 'BUY' ? closePrice <= s.price! : closePrice >= s.price!;
        }
        if (model === 'limit-touch') return dayHigh >= s.price!;
        return false;
      })
      .map((s) => ({
        ...s,
        executedPrice: s.metadata?.fillModel === 'limit-touch' ? s.price! : closePrice,
      }));
  }

  /**
   * TradingService.handleInfiniteBuyV4SignalFill과 동일한 순서/공식으로 체결을 반영한다:
   * 같은 날 매도·매수가 함께 오면 매도 먼저(§3), 보유 0 도달 시 사이클 종료(§4.5).
   */
  function applyFills(
    state: SimState,
    filled: (TradingSignal & { executedPrice: number })[],
  ): SimState {
    let { T, cashRemaining, cycleSeq, holdQty, avgPrice } = state;

    for (const sell of filled.filter((f) => f.side === 'SELL')) {
      const fillAmount = roundToCent(sell.executedPrice * sell.quantity);
      const prevHolding = Number(sell.metadata?.v4PrevHolding ?? holdQty);
      T = applySellFillToT(T, { filledQuantity: sell.quantity, previousHoldingQuantity: prevHolding });
      cashRemaining = roundToCent(cashRemaining + fillAmount);
      holdQty = Math.max(0, holdQty - sell.quantity);
      if (holdQty === 0) {
        T = 0;
        cycleSeq += 1;
        avgPrice = 0; // compoundMode=true 기본 — cashRemaining은 그대로 재투입
      }
    }

    for (const buy of filled.filter((f) => f.side === 'BUY')) {
      const fillAmount = roundToCent(buy.executedPrice * buy.quantity);
      const attemptAmount = Number(buy.metadata?.v4AttemptAmount ?? fillAmount);
      T = buy.metadata?.phase === 'v4-reverse-buy'
        ? applyBuyFillToT(T, { kind: 'reverse', fillAmount, attemptAmount, N })
        : applyBuyFillToT(T, { kind: 'normal', fillAmount, attemptAmount });
      const newHold = holdQty + buy.quantity;
      avgPrice = newHold > 0 ? roundToCent((avgPrice * holdQty + fillAmount) / newHold) : avgPrice;
      holdQty = newHold;
      cashRemaining = roundToCent(cashRemaining - fillAmount);
    }

    return { ...state, T, cashRemaining, cycleSeq, holdQty, avgPrice };
  }

  it('sell-먼저 반영이 buy-먼저 반영과 다른 결과를 낸다 (§3 순서 규칙 회귀 고정)', () => {
    // T=10, 같은 날 쿼터매도(25/100) + 매수(체결액=시도액, ΔT=+1)가 함께 체결되는 경우.
    const sellFirst = applyBuyFillToT(
      applySellFillToT(10, { filledQuantity: 25, previousHoldingQuantity: 100 }),
      { kind: 'normal', fillAmount: 500, attemptAmount: 500 },
    );
    const buyFirst = applySellFillToT(
      applyBuyFillToT(10, { kind: 'normal', fillAmount: 500, attemptAmount: 500 }),
      { filledQuantity: 25, previousHoldingQuantity: 100 },
    );
    expect(sellFirst).toBeCloseTo(8.5, 6);
    expect(buyFirst).toBeCloseTo(8.25, 6);
    expect(sellFirst).not.toBeCloseTo(buyFirst, 6);
  });

  it('사이클 시작 → 전반전 → 후반전 → 소진 → 리버스 진입 → 리버스 진행 → 복귀 → 종료', async () => {
    let state: SimState = {
      T: 0,
      cashRemaining: PRINCIPAL,
      mode: 'NORMAL',
      cycleSeq: 0,
      holdQty: 0,
      avgPrice: 0,
      recentCloses: [],
    };

    // ── Day0: 사이클 시작 (첫 매수, T=0) ──
    let ctx = buildCtx(state, 100, 99, '2026-01-05');
    let result = await strategy.evaluateStock(ctx);
    expect(result.details?.mode).toBe('NORMAL');
    const firstBuy = result.signals.find((s) => s.metadata?.phase === 'v4-first-buy');
    expect(firstBuy).toBeDefined();
    expect(firstBuy!.price).toBeCloseTo(112, 2); // 100 × 1.12
    expect(result.signals.some((s) => s.side === 'SELL')).toBe(false); // 보유 없음 → 매도 없음

    let filled = fillsToday(result.signals, 100, 100); // 종가 100 — firstBuy(112) 조건 충족
    expect(filled).toHaveLength(1);
    state = applyFills(state, filled);
    state.mode = result.details!.v4StateUpdate.mode;
    state.recentCloses = result.details!.v4StateUpdate.recentCloses;
    expect(state.holdQty).toBe(firstBuy!.quantity);
    expect(state.T).toBeGreaterThan(0);
    expect(state.mode).toBe('NORMAL');

    // ── Day1: 전반전 — 평단/별지점 매수 + (인트라데이 고가 터치) 최종매도가 같은 날 체결 ──
    ctx = buildCtx(state, state.avgPrice, 100, '2026-01-06');
    result = await strategy.evaluateStock(ctx);
    expect(result.details?.T).toBeLessThan(N / 2); // 아직 전반전
    const avgBuy = result.signals.find((s) => s.metadata?.phase === 'v4-avg-buy');
    const starBuy = result.signals.find((s) => s.metadata?.phase === 'v4-star-buy');
    const finalSell = result.signals.find((s) => s.metadata?.phase === 'v4-final-sell');
    expect(avgBuy).toBeDefined();
    expect(starBuy).toBeDefined();
    expect(finalSell).toBeDefined();
    expect(avgBuy!.price).toBeCloseTo(state.avgPrice, 2); // 평단 그대로

    // 종가는 평단(avgBuy 기준가)에 딱 맞춰 두 매수 다리를 모두 체결시키고,
    // 장중 고가만 최종매도 목표가를 터치시켜 매도·매수가 같은 날 함께 체결되게 한다.
    const closeDay1 = avgBuy!.price!;
    const highDay1 = finalSell!.price! + 1;
    filled = fillsToday(result.signals, closeDay1, highDay1);
    const filledSides = filled.map((f) => f.side).sort().join(',');
    expect(filledSides).toBe('BUY,BUY,SELL'); // avgBuy + starBuy + finalSell만 체결 (quarterSell는 미체결)
    const holdBeforeDay1 = state.holdQty;
    state = applyFills(state, filled);
    state.mode = result.details!.v4StateUpdate.mode;
    state.recentCloses = result.details!.v4StateUpdate.recentCloses;
    // 매도(1주) 먼저 반영 후 매수(2주) 반영 — 순매수 +1
    expect(state.holdQty).toBe(holdBeforeDay1 - finalSell!.quantity + 2);
    expect(state.T).toBeGreaterThan(0);

    // ── Day2: 후반전(T ≥ N/2) — 평단 매수 다리가 사라지고 별지점 매수만 남는다 ──
    ctx = buildCtx(state, state.avgPrice, closeDay1, '2026-01-07');
    result = await strategy.evaluateStock(ctx);
    if ((result.details?.T ?? 0) >= N / 2) {
      expect(result.signals.some((s) => s.metadata?.phase === 'v4-avg-buy')).toBe(false);
      expect(result.signals.some((s) => s.metadata?.phase === 'v4-star-buy')).toBe(true);
    }
    const holdAfterDay1 = state.holdQty;
    const avgPriceAfterDay1 = state.avgPrice;
    const cashAfterDay1 = state.cashRemaining;

    // ── "소진" 압축: 여러 후반전 일자의 반복적인 별지점 매수/쿼터매도 누적을
    // T가 N-1을 넘는 지점까지 한 번에 점프시킨다 (해당 구간 수치 자체는 검증 대상이 아님).
    state = {
      ...state,
      T: N - 1 + 0.2,
      holdQty: 4,
      avgPrice: avgPriceAfterDay1 || 90,
      cashRemaining: cashAfterDay1,
    };
    expect(holdAfterDay1).toBeGreaterThan(0); // 압축 전 상태가 유효했는지 sanity check

    // ── Day3: REVERSE 진입 첫날 — 보유의 1/(N/2)를 MOC로 무조건 매도 ──
    ctx = buildCtx(state, state.avgPrice, 90, '2026-01-10');
    result = await strategy.evaluateStock(ctx);
    expect(result.details?.v4StateUpdate?.mode).toBe('REVERSE');
    expect(result.signals).toHaveLength(1);
    const reverseFirstSell = result.signals[0];
    expect(reverseFirstSell.side).toBe('SELL');
    expect(reverseFirstSell.metadata?.phase).toBe('v4-reverse-sell');
    expect(reverseFirstSell.orderDivision).toBe('33'); // MOC
    expect(reverseFirstSell.metadata?.fillModel).toBe('moc');
    const M = N / 2;
    expect(reverseFirstSell.quantity).toBe(Math.floor(state.holdQty / M));

    filled = fillsToday(result.signals, 85, 85); // MOC는 조건 없이 무조건 체결
    expect(filled).toHaveLength(1);
    const holdBeforeDay3 = state.holdQty;
    state = applyFills(state, filled);
    state.mode = result.details!.v4StateUpdate.mode;
    state.recentCloses = result.details!.v4StateUpdate.recentCloses;
    expect(state.holdQty).toBe(holdBeforeDay3 - reverseFirstSell.quantity);
    expect(state.mode).toBe('REVERSE');

    // ── Day4: REVERSE 진행 — 리버스 별지점(최근 종가 평균) 기준 매도 체결 ──
    ctx = buildCtx(state, state.avgPrice, 85, '2026-01-11');
    result = await strategy.evaluateStock(ctx);
    expect(result.details?.reverseStarPrice).toBeGreaterThan(0);
    const reverseSell = result.signals.find((s) => s.metadata?.phase === 'v4-reverse-sell');
    expect(reverseSell).toBeDefined();
    expect(reverseSell!.orderDivision).toBe('34'); // LOC (첫날 이후는 MOC 아님)
    const reverseStarPrice = result.details!.reverseStarPrice as number;
    filled = fillsToday(result.signals, reverseStarPrice + 1, reverseStarPrice + 1); // 종가가 리버스 별지점 이상 → 매도 체결, 매수는 미체결
    expect(filled.some((f) => f.side === 'SELL')).toBe(true);
    expect(filled.some((f) => f.side === 'BUY')).toBe(false);
    const holdBeforeDay4 = state.holdQty;
    state = applyFills(state, filled);
    state.mode = result.details!.v4StateUpdate.mode;
    state.recentCloses = result.details!.v4StateUpdate.recentCloses;
    expect(state.holdQty).toBe(holdBeforeDay4 - reverseSell!.quantity);

    // ── Day5: 종가가 회복 임계값(평단 × (1 − finalTargetPct%))을 넘으면 즉시 NORMAL 복귀 ──
    const recoveryClose = roundToCent(state.avgPrice * 0.95); // finalTargetPct=15% 이내로 확실히 회복
    ctx = buildCtx(state, state.avgPrice, recoveryClose, '2026-01-12');
    result = await strategy.evaluateStock(ctx);
    expect(result.details?.v4StateUpdate?.mode).toBe('NORMAL');
    state.mode = 'NORMAL';

    // ── Day6: 사이클 종료 직전 — 남은 보유 전량이 쿼터매도+최종매도로 청산되면 T=0/cycleSeq+=1 ──
    state = { ...state, holdQty: 2 }; // 압축된 리버스 구간 이후 소규모 잔여 보유로 정리 (사이클 종료 조건 재현용)
    const cashBeforeCycleEnd = state.cashRemaining;
    ctx = buildCtx(state, state.avgPrice, state.avgPrice, '2026-01-13');
    result = await strategy.evaluateStock(ctx);
    const quarterSell = result.signals.find((s) => s.metadata?.phase === 'v4-quarter-sell');
    const finalSellEnd = result.signals.find((s) => s.metadata?.phase === 'v4-final-sell');
    expect(quarterSell).toBeDefined();
    expect(finalSellEnd).toBeDefined();
    expect(quarterSell!.quantity + finalSellEnd!.quantity).toBe(2); // 전량 청산 구성

    const highDay6 = Math.max(quarterSell!.price!, finalSellEnd!.price!) + 1;
    filled = fillsToday(result.signals, highDay6, highDay6); // 둘 다 체결되도록 종가/고가를 충분히 높임
    expect(filled).toHaveLength(2);
    const cycleSeqBefore = state.cycleSeq;
    state = applyFills(state, filled);

    expect(state.holdQty).toBe(0);
    expect(state.T).toBe(0); // §4.5 사이클 종료
    expect(state.cycleSeq).toBe(cycleSeqBefore + 1);
    expect(state.cashRemaining).toBeGreaterThan(cashBeforeCycleEnd); // compoundMode=true 기본 — 수익 재투입, 리셋 없음
  });
});
