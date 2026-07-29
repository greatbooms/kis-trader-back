/**
 * 무한매수 V4 체결 장부 전이 — T(회차)/cashRemaining/cycleSeq/lastKnownHoldQty를
 * 체결 1건 단위로 갱신하는 순수 함수 (§3 T 회계 / §4.5 사이클 종료 규칙).
 * `TradingService.handleInfiniteBuyV4SignalFill`(실거래, reconciliation 시점)과
 * `BacktestEngine`(과거 데이터 재현, bar 시뮬레이션 시점)이 이 함수를 공유해
 * 두 경로의 장부 규칙이 갈라지지 않게 한다. Prisma 읽기/쓰기, 로깅 등 부수효과는
 * 호출자 책임이며 이 파일은 의존성이 없다 (infinite-buy-v4-math.util 제외).
 */
import { applyBuyFillToT, applySellFillToT, roundToCent } from './infinite-buy-v4-math.util';

export interface V4LedgerState {
  /** 회차 (T) */
  turn: number;
  /** 잔금 = principal − 현재 사이클 순투입액 */
  cashRemaining: number;
  /** 완료된 사이클 수 */
  cycleSeq: number;
  /** 마지막 체결 확정 시점의 보유수량 (수동매매 혼입 감지용) */
  lastKnownHoldQty: number;
}

export interface V4FillInput {
  side: 'BUY' | 'SELL';
  phase: string;
  /** 이번 체결 수량 */
  quantity: number;
  /** 이번 체결 금액 (체결가 × 수량) */
  fillAmount: number;
  /** 체결 직전 실제 보유수량 — 체결 후 수량(lastKnownHoldQty) 계산 기준 */
  previousHoldingQty: number;
  /**
   * SELL 전용 T 비율 분모 override — 전략이 평가 시점에 스냅샷한 보유수량
   * (signal.metadata.v4PrevHolding). 미지정 시 previousHoldingQty를 사용한다.
   */
  sellRatioPrevHolding?: number;
  /**
   * BUY 전용 T 회계 분모(당일 매수 시도 총액, signal.metadata.v4DayBuyAttemptTotal 등).
   * 미지정 시 fillAmount로 대체한다(전량 체결 가정).
   */
  attemptAmount?: number;
  /** 분할수 (WatchStock.maxCycles) */
  N: number;
  /** 원금 (WatchStock.quota) */
  quota: number;
  /** 사이클 종료 시 잔금 처리 방식 — true(복리)/false(단리) */
  compoundMode: boolean;
}

export interface V4FillResult {
  state: V4LedgerState;
  /** SELL로 보유수량이 0이 되어 사이클이 종료됐는지 (호출자가 알림/로그에 사용) */
  cycleCompleted: boolean;
  /** 단리 모드 사이클 종료 시 제외된 초과분 (로그용, 종료가 아니거나 복리면 0) */
  discardedExcess: number;
}

/** 체결 1건을 장부에 반영한다. 같은 bar/reconciliation에 SELL·BUY가 함께 있으면 SELL부터 순서대로 호출할 것 (§3). */
export function applyV4Fill(state: V4LedgerState, input: V4FillInput): V4FillResult {
  const { turn, cycleSeq, cashRemaining } = state;
  const { side, phase, quantity, fillAmount, previousHoldingQty, N, quota, compoundMode } = input;

  if (side === 'BUY') {
    const attemptAmount = input.attemptAmount ?? fillAmount;
    const nextTurn = phase === 'v4-reverse-buy'
      ? applyBuyFillToT(turn, { kind: 'reverse', fillAmount, attemptAmount, N })
      : applyBuyFillToT(turn, { kind: 'normal', fillAmount, attemptAmount });

    return {
      state: {
        turn: nextTurn,
        cashRemaining: roundToCent(cashRemaining - fillAmount),
        cycleSeq,
        lastKnownHoldQty: previousHoldingQty + quantity,
      },
      cycleCompleted: false,
      discardedExcess: 0,
    };
  }

  // SELL
  const ratioPrevHolding = input.sellRatioPrevHolding ?? previousHoldingQty;
  let nextTurn = applySellFillToT(turn, { filledQuantity: quantity, previousHoldingQuantity: ratioPrevHolding });
  let nextCash = roundToCent(cashRemaining + fillAmount);
  const holdQtyAfterFill = Math.max(0, previousHoldingQty - quantity);
  let nextCycleSeq = cycleSeq;
  let discardedExcess = 0;
  let cycleCompleted = false;

  if (holdQtyAfterFill === 0) {
    // §4.5 사이클 종료: T=0, cycleSeq+=1, compoundMode에 따라 cashRemaining 재설정
    cycleCompleted = true;
    nextTurn = 0;
    nextCycleSeq = cycleSeq + 1;
    discardedExcess = compoundMode ? 0 : Math.max(0, nextCash - quota);
    nextCash = compoundMode ? nextCash : Math.min(nextCash, quota);
  }

  return {
    state: { turn: nextTurn, cashRemaining: nextCash, cycleSeq: nextCycleSeq, lastKnownHoldQty: holdQtyAfterFill },
    cycleCompleted,
    discardedExcess,
  };
}
