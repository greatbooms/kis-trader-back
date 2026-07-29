import {
  allocateLadderOrders,
  applyBuyFillToT,
  applyDailyFillsToT,
  applySellFillToT,
  calculateDailyBuyBudget,
  calculateStarPoint,
  shouldEnterReverseMode,
  shouldExitReverseMode,
} from './infinite-buy-v4-math.util';

describe('calculateStarPoint', () => {
  it('N=20 starBase=20 (SOXL 20분할)', () => {
    const result = calculateStarPoint({ avgPrice: 38.3, T: 8.6, N: 20, starBasePct: 20 });
    expect(result.starPct).toBeCloseTo(2.8, 9);
    expect(result.starPrice).toBe(39.37);
    expect(result.buyLimitPrice).toBe(39.36);
    expect(result.sellLimitPrice).toBe(39.37);
  });

  it('N=20 starBase=15 (TQQQ 20분할)', () => {
    const result = calculateStarPoint({ avgPrice: 50, T: 5, N: 20, starBasePct: 15 });
    expect(result.starPct).toBeCloseTo(7.5, 9);
    expect(result.starPrice).toBe(53.75);
  });

  it('N=40 starBase=15 (TQQQ 40분할)', () => {
    const result = calculateStarPoint({ avgPrice: 50, T: 10, N: 40, starBasePct: 15 });
    expect(result.starPct).toBeCloseTo(7.5, 9);
    expect(result.starPrice).toBe(53.75);
  });

  it('N=40 starBase=20 (SOXL 40분할)', () => {
    const result = calculateStarPoint({ avgPrice: 38.3, T: 17.2, N: 40, starBasePct: 20 });
    expect(result.starPct).toBeCloseTo(2.8, 9);
    expect(result.starPrice).toBe(39.37);
  });

  it('T=N/2 경계에서 별%가 정확히 0 (전반전→후반전 전환점)', () => {
    const result = calculateStarPoint({ avgPrice: 100, T: 20, N: 40, starBasePct: 15 });
    expect(result.starPct).toBe(0);
    expect(result.starPrice).toBe(100);
  });

  it('T > N/2 이면 별%가 음수 (별지점이 평단 아래)', () => {
    const result = calculateStarPoint({ avgPrice: 100, T: 30, N: 40, starBasePct: 15 });
    expect(result.starPct).toBeLessThan(0);
    expect(result.starPrice).toBeLessThan(100);
  });

  it('평단이 0 이하면 throw', () => {
    expect(() => calculateStarPoint({ avgPrice: 0, T: 0, N: 40, starBasePct: 15 })).toThrow(RangeError);
  });
});

describe('calculateDailyBuyBudget', () => {
  it('T=0, 잔금 20000, N=40 → D=500', () => {
    expect(calculateDailyBuyBudget({ cashRemaining: 20000, N: 40, T: 0 })).toBe(500);
  });

  it('첫 매수 전량 체결(478/478) 후 T=1, 잔금 19522 → D=500.5641...', () => {
    const T = applyBuyFillToT(0, { kind: 'normal', fillAmount: 478, attemptAmount: 478 });
    expect(T).toBe(1);
    const D = calculateDailyBuyBudget({ cashRemaining: 19522, N: 40, T });
    expect(D).toBeCloseTo(500.564102564, 9);
  });

  it('T > N - 1 이면 throw (REVERSE 전환 대상 — D 계산 대상 아님)', () => {
    expect(() => calculateDailyBuyBudget({ cashRemaining: 1000, N: 40, T: 40 })).toThrow(RangeError);
    expect(() => calculateDailyBuyBudget({ cashRemaining: 1000, N: 40, T: 39.5 })).not.toThrow();
  });
});

describe('allocateLadderOrders', () => {
  const steps = [0.05, 0.1, 0.15];

  it('예산이 충분하면 3단계 모두 배정 (기준가 100 → 95/90/85)', () => {
    const orders = allocateLadderOrders({ remainingBudget: 300, basePrice: 100, steps });
    expect(orders).toEqual([
      { price: 95, quantity: 1 },
      { price: 90, quantity: 1 },
      { price: 85, quantity: 1 },
    ]);
  });

  it('예산이 2단계까지만 되면 앞 2개만 배정', () => {
    const orders = allocateLadderOrders({ remainingBudget: 200, basePrice: 100, steps });
    expect(orders).toEqual([
      { price: 95, quantity: 1 },
      { price: 90, quantity: 1 },
    ]);
  });

  it('예산이 전혀 없으면 빈 배열', () => {
    const orders = allocateLadderOrders({ remainingBudget: 50, basePrice: 100, steps });
    expect(orders).toEqual([]);
  });

  it('예산이 정확히 한 단계 가격과 같으면 그 단계는 배정', () => {
    const orders = allocateLadderOrders({ remainingBudget: 95, basePrice: 100, steps });
    expect(orders).toEqual([{ price: 95, quantity: 1 }]);
  });
});

describe('T 회계 — applySellFillToT (쿼터매도/최종매도 부분체결/리버스매도 공통식)', () => {
  it('쿼터매도 전량 체결 (1/4) → T × 0.75', () => {
    expect(applySellFillToT(10, { filledQuantity: 25, previousHoldingQuantity: 100 })).toBeCloseTo(7.5, 9);
  });

  it('쿼터매도 부분 체결 → 체결비율만큼만 반영', () => {
    expect(applySellFillToT(10, { filledQuantity: 10, previousHoldingQuantity: 100 })).toBeCloseTo(9, 9);
  });

  it('최종매도 부분 체결도 동일식 적용', () => {
    expect(applySellFillToT(10, { filledQuantity: 30, previousHoldingQuantity: 75 })).toBeCloseTo(6, 9);
  });

  it('리버스매도 전량 체결 (N=40 → M=20, 1/20) → T × 0.95', () => {
    expect(applySellFillToT(39.5, { filledQuantity: 1, previousHoldingQuantity: 20 })).toBeCloseTo(37.525, 9);
  });

  it('리버스매도 부분 체결', () => {
    expect(applySellFillToT(39.5, { filledQuantity: 5, previousHoldingQuantity: 20 })).toBeCloseTo(29.625, 9);
  });
});

describe('T 회계 — applyBuyFillToT', () => {
  it('NORMAL 매수 전량 체결 → ΔT = 1', () => {
    expect(applyBuyFillToT(3, { kind: 'normal', fillAmount: 500, attemptAmount: 500 })).toBe(4);
  });

  it('NORMAL 매수 부분 체결 → 체결비율만큼만 반영', () => {
    expect(applyBuyFillToT(3, { kind: 'normal', fillAmount: 250, attemptAmount: 500 })).toBe(3.5);
  });

  it('REVERSE 매수 전량 체결 → T + (N-T)×0.25', () => {
    expect(applyBuyFillToT(37.525, { kind: 'reverse', fillAmount: 100, attemptAmount: 100, N: 40 })).toBeCloseTo(
      38.14375,
      9,
    );
  });

  it('REVERSE 매수 부분 체결', () => {
    expect(applyBuyFillToT(37.525, { kind: 'reverse', fillAmount: 50, attemptAmount: 100, N: 40 })).toBeCloseTo(
      37.834375,
      9,
    );
  });
});

describe('applyDailyFillsToT — 같은 날 매도·매수 순서 (매도 먼저, 매수 나중)', () => {
  it('REVERSE 매도 전량 → REVERSE 매수 전량 (T=39.5 → 38.14375)', () => {
    const T = applyDailyFillsToT(39.5, {
      sellFills: [{ filledQuantity: 1, previousHoldingQuantity: 20 }],
      buyFill: { kind: 'reverse', fillAmount: 100, attemptAmount: 100, N: 40 },
    });
    expect(T).toBeCloseTo(38.14375, 9);
  });

  it('매도 없이 매수만 있으면 매수만 반영', () => {
    const T = applyDailyFillsToT(3, { buyFill: { kind: 'normal', fillAmount: 500, attemptAmount: 500 } });
    expect(T).toBe(4);
  });

  it('매수 없이 매도만 있으면 매도만 반영', () => {
    const T = applyDailyFillsToT(10, { sellFills: [{ filledQuantity: 25, previousHoldingQuantity: 100 }] });
    expect(T).toBeCloseTo(7.5, 9);
  });
});

describe('shouldEnterReverseMode — 모드 전환 경계 (T=N-1)', () => {
  it('N=40: T=39(=N-1)에서는 아직 NORMAL', () => {
    expect(shouldEnterReverseMode({ T: 39, N: 40 })).toBe(false);
  });

  it('N=40: T가 39를 초과하면 REVERSE 전환', () => {
    expect(shouldEnterReverseMode({ T: 39.0001, N: 40 })).toBe(true);
  });

  it('N=20: T=19(=N-1)에서는 아직 NORMAL, 초과하면 REVERSE', () => {
    expect(shouldEnterReverseMode({ T: 19, N: 20 })).toBe(false);
    expect(shouldEnterReverseMode({ T: 19.0001, N: 20 })).toBe(true);
  });
});

describe('shouldExitReverseMode — 리버스 종료 경계 (종가 > 평단 × (1 - finalTargetPct%))', () => {
  it('경계값과 정확히 같으면 아직 REVERSE 유지 (strictly greater 필요)', () => {
    expect(shouldExitReverseMode({ closePrice: 85, avgPrice: 100, finalTargetPct: 15 })).toBe(false);
  });

  it('경계값을 초과하면 NORMAL 복귀', () => {
    expect(shouldExitReverseMode({ closePrice: 85.01, avgPrice: 100, finalTargetPct: 15 })).toBe(true);
  });

  it('경계값 미만이면 REVERSE 유지', () => {
    expect(shouldExitReverseMode({ closePrice: 84.99, avgPrice: 100, finalTargetPct: 15 })).toBe(false);
  });
});
