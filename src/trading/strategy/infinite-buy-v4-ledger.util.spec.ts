/**
 * infinite-buy-v4-ledger.util 단위 테스트 — trading.service.spec.ts의
 * handleInfiniteBuyV4SignalFill 기존 기대값과 동일한 수치로 순수 함수 자체를 검증한다.
 * (trading.service.spec.ts는 이 함수를 거쳐 같은 결과가 나오는지를 Prisma mock으로 감싸 확인하고,
 * 이 spec은 그 계산 자체를 의존성 없이 직접 검증한다 — 두 spec이 같은 안전망의 다른 층위다.)
 */
import { applyV4Fill, V4LedgerState } from './infinite-buy-v4-ledger.util';

describe('applyV4Fill', () => {
  it('NORMAL BUY 체결: cashRemaining 차감 + T 증가, lastKnownHoldQty는 prevHolding+quantity', () => {
    const before: V4LedgerState = { turn: 10, cashRemaining: 15000, cycleSeq: 0, lastKnownHoldQty: 100 };
    const fillAmount = 49.8 * 10;

    const result = applyV4Fill(before, {
      side: 'BUY',
      phase: 'v4-avg-buy',
      quantity: 10,
      fillAmount,
      previousHoldingQty: 100,
      attemptAmount: 250,
      N: 40,
      quota: 20000,
      compoundMode: true,
    });

    expect(result.state.cashRemaining).toBeCloseTo(15000 - fillAmount, 2);
    expect(result.state.turn).toBeCloseTo(10 + fillAmount / 250, 6);
    expect(result.state.lastKnownHoldQty).toBe(110);
    expect(result.state.cycleSeq).toBe(0);
    expect(result.cycleCompleted).toBe(false);
  });

  it('전반전 두 leg 전량 체결 시 합계 ΔT=+1 (분모는 당일 총액 — leg별 분모면 +2가 되는 회귀 고정)', () => {
    const dayTotal = 500;
    const first = applyV4Fill(
      { turn: 10, cashRemaining: 15000, cycleSeq: 0, lastKnownHoldQty: 100 },
      {
        side: 'BUY',
        phase: 'v4-avg-buy',
        quantity: 5,
        fillAmount: 250,
        previousHoldingQty: 100,
        attemptAmount: dayTotal,
        N: 40,
        quota: 20000,
        compoundMode: true,
      },
    );
    expect(first.state.turn).toBeCloseTo(10.5, 6); // 250/500 = +0.5

    const second = applyV4Fill(first.state, {
      side: 'BUY',
      phase: 'v4-star-buy',
      quantity: 5,
      fillAmount: 250,
      previousHoldingQty: first.state.lastKnownHoldQty,
      attemptAmount: dayTotal,
      N: 40,
      quota: 20000,
      compoundMode: true,
    });
    expect(second.state.turn).toBeCloseTo(11, 6); // 합계 정확히 +1
    expect(second.state.cashRemaining).toBeCloseTo(15000 - dayTotal, 2);
  });

  it('attemptAmount 미지정 시 fillAmount로 대체(전량 체결 가정) — ΔT=+1', () => {
    const result = applyV4Fill(
      { turn: 0, cashRemaining: 20000, cycleSeq: 0, lastKnownHoldQty: 0 },
      {
        side: 'BUY',
        phase: 'v4-first-buy',
        quantity: 8,
        fillAmount: 56 * 8,
        previousHoldingQty: 0,
        N: 40,
        quota: 20000,
        compoundMode: true,
      },
    );
    expect(result.state.cashRemaining).toBeCloseTo(20000 - 56 * 8, 2);
    expect(result.state.turn).toBeCloseTo(1, 6);
  });

  it('REVERSE BUY 체결: reverse 식(N 포함)을 사용한다', () => {
    const fillAmount = 45.99 * 2;
    const result = applyV4Fill(
      { turn: 37.525, cashRemaining: 400, cycleSeq: 0, lastKnownHoldQty: 190 },
      {
        side: 'BUY',
        phase: 'v4-reverse-buy',
        quantity: 2,
        fillAmount,
        previousHoldingQty: 190,
        attemptAmount: 100,
        N: 40,
        quota: 20000,
        compoundMode: true,
      },
    );

    const expectedT = 37.525 + (40 - 37.525) * 0.25 * (fillAmount / 100);
    expect(result.state.turn).toBeCloseTo(expectedT, 6);
    expect(result.state.cashRemaining).toBeCloseTo(400 - fillAmount, 2);
    expect(result.state.lastKnownHoldQty).toBe(192);
  });

  it('SELL 부분 체결(쿼터매도): sellRatioPrevHolding 기준으로 T를 축소하고 cashRemaining을 늘린다', () => {
    const result = applyV4Fill(
      { turn: 10, cashRemaining: 15000, cycleSeq: 0, lastKnownHoldQty: 100 },
      {
        side: 'SELL',
        phase: 'v4-quarter-sell',
        quantity: 25,
        fillAmount: 53.75 * 25,
        previousHoldingQty: 100,
        sellRatioPrevHolding: 100,
        N: 40,
        quota: 20000,
        compoundMode: true,
      },
    );

    expect(result.state.turn).toBeCloseTo(10 * (1 - 25 / 100), 6); // 7.5
    expect(result.state.cashRemaining).toBeCloseTo(15000 + 53.75 * 25, 2);
    expect(result.state.lastKnownHoldQty).toBe(75);
    expect(result.state.cycleSeq).toBe(0);
    expect(result.cycleCompleted).toBe(false);
  });

  it('SELL 체결 후 보유수량 0: 사이클 종료 — T=0, cycleSeq+=1, compoundMode=true면 수익 재투입', () => {
    const result = applyV4Fill(
      { turn: 2.5, cashRemaining: 16343.75, cycleSeq: 0, lastKnownHoldQty: 75 },
      {
        side: 'SELL',
        phase: 'v4-final-sell',
        quantity: 75,
        fillAmount: 57.5 * 75,
        previousHoldingQty: 75,
        sellRatioPrevHolding: 75,
        N: 40,
        quota: 20000,
        compoundMode: true,
      },
    );

    expect(result.state.turn).toBe(0);
    expect(result.state.cycleSeq).toBe(1);
    expect(result.state.cashRemaining).toBeCloseTo(16343.75 + 57.5 * 75, 2); // 복리 — 수익 그대로 재투입
    expect(result.state.lastKnownHoldQty).toBe(0);
    expect(result.cycleCompleted).toBe(true);
    expect(result.discardedExcess).toBe(0);
  });

  it('SELL 체결 후 보유수량 0 + compoundMode=false: 원금 초과분은 제외하고 quota로 클램프', () => {
    const result = applyV4Fill(
      { turn: 2.5, cashRemaining: 16343.75, cycleSeq: 0, lastKnownHoldQty: 75 },
      {
        side: 'SELL',
        phase: 'v4-final-sell',
        quantity: 75,
        fillAmount: 57.5 * 75,
        previousHoldingQty: 75,
        sellRatioPrevHolding: 75,
        N: 40,
        quota: 20000,
        compoundMode: false,
      },
    );

    expect(result.state.turn).toBe(0);
    expect(result.state.cycleSeq).toBe(1);
    expect(result.state.cashRemaining).toBe(20000); // quota(원금) 상한으로 클램프 — 단리
    expect(result.discardedExcess).toBeCloseTo(16343.75 + 57.5 * 75 - 20000, 2);
  });

  it('sellRatioPrevHolding 미지정 시 previousHoldingQty를 그대로 사용한다', () => {
    const withOverride = applyV4Fill(
      { turn: 10, cashRemaining: 15000, cycleSeq: 0, lastKnownHoldQty: 100 },
      {
        side: 'SELL', phase: 'v4-quarter-sell', quantity: 25, fillAmount: 1000,
        previousHoldingQty: 100, sellRatioPrevHolding: 100, N: 40, quota: 20000, compoundMode: true,
      },
    );
    const withoutOverride = applyV4Fill(
      { turn: 10, cashRemaining: 15000, cycleSeq: 0, lastKnownHoldQty: 100 },
      {
        side: 'SELL', phase: 'v4-quarter-sell', quantity: 25, fillAmount: 1000,
        previousHoldingQty: 100, N: 40, quota: 20000, compoundMode: true,
      },
    );
    expect(withoutOverride.state.turn).toBeCloseTo(withOverride.state.turn, 6);
  });
});
