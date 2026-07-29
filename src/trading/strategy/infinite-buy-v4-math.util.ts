/**
 * 무한매수 V4 순수 계산 유틸 — 별지점 / 일일 매수 시도액 / 사다리 배분 / T 회계 / 모드 전환 판정.
 * 서비스·Prisma·KIS 의존 없음. 백테스트와 실거래 전략이 동일 함수를 공유한다.
 */

export function roundToCent(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface StarPointInput {
  avgPrice: number;
  T: number;
  N: number;
  starBasePct: number;
}

export interface StarPointResult {
  starPct: number;
  starPrice: number;
  buyLimitPrice: number;
  sellLimitPrice: number;
}

/**
 * 별% = starBasePct × (1 − 2T/N). T가 N/2를 넘어서면 별%가 음수로 전환되어
 * 별지점이 평단 아래로 내려간다 — 후반전 쿼터매도가 사실상 손절이 되는 규칙이다.
 */
export function calculateStarPoint(input: StarPointInput): StarPointResult {
  const { avgPrice, T, N, starBasePct } = input;
  if (avgPrice <= 0) throw new RangeError('avgPrice must be positive');
  if (N <= 0) throw new RangeError('N must be positive');

  const starPct = starBasePct * (1 - (2 * T) / N);
  const starPrice = roundToCent(avgPrice * (1 + starPct / 100));
  return {
    starPct,
    starPrice,
    buyLimitPrice: roundToCent(starPrice - 0.01),
    sellLimitPrice: starPrice,
  };
}

export interface DailyBuyBudgetInput {
  cashRemaining: number;
  N: number;
  T: number;
}

/** D = 잔금 ÷ (N − T). carry 이월 없이 매일 재계산해 잔돈·매도 회수금을 그날그날 재분배한다. */
export function calculateDailyBuyBudget(input: DailyBuyBudgetInput): number {
  const { cashRemaining, N, T } = input;
  const divisor = N - T;
  if (divisor <= 0) {
    throw new RangeError('N - T must be positive (T > N - 1 인 경우는 REVERSE 전환 대상 — D 계산 대상 아님)');
  }
  return cashRemaining / divisor;
}

export interface LadderOrder {
  price: number;
  quantity: number;
}

export interface LadderAllocationInput {
  remainingBudget: number;
  basePrice: number;
  steps: number[];
}

/**
 * 주 주문 산정 후 남은 예산으로 기준가 대비 각 step 할인가에 1주씩 배정한다.
 * 할인폭이 클수록 가격이 낮아지므로 앞 단계에서 예산이 모자라도 뒤 단계는 배정될 수 있다.
 */
export function allocateLadderOrders(input: LadderAllocationInput): LadderOrder[] {
  const { remainingBudget, basePrice, steps } = input;
  let budget = remainingBudget;
  const orders: LadderOrder[] = [];
  for (const step of steps) {
    const price = roundToCent(basePrice * (1 - step));
    if (price > 0 && price <= budget) {
      orders.push({ price, quantity: 1 });
      budget -= price;
    }
  }
  return orders;
}

export interface SellFillEvent {
  filledQuantity: number;
  previousHoldingQuantity: number;
}

/** 매도 체결 비율만큼 T를 축소한다 — 쿼터매도 / 최종매도 부분체결 / 리버스매도 공통식. */
export function applySellFillToT(T: number, event: SellFillEvent): number {
  const { filledQuantity, previousHoldingQuantity } = event;
  if (previousHoldingQuantity <= 0) return T;
  const ratio = filledQuantity / previousHoldingQuantity;
  return T * (1 - ratio);
}

export interface NormalBuyFillEvent {
  kind: 'normal';
  fillAmount: number;
  attemptAmount: number;
}

export interface ReverseBuyFillEvent {
  kind: 'reverse';
  fillAmount: number;
  attemptAmount: number;
  N: number;
}

export type BuyFillEvent = NormalBuyFillEvent | ReverseBuyFillEvent;

/**
 * 매수 체결 비율만큼 T를 늘린다.
 * NORMAL: ΔT = 체결액 ÷ 시도액 (전량 체결 = +1).
 * REVERSE: T ← T + (N−T) × 0.25 × 체결비율 — 완주까지 남은 거리의 1/4씩 회복.
 */
export function applyBuyFillToT(T: number, event: BuyFillEvent): number {
  if (event.attemptAmount <= 0) return T;
  const fillRatio = event.fillAmount / event.attemptAmount;
  if (event.kind === 'normal') {
    return T + fillRatio;
  }
  return T + (event.N - T) * 0.25 * fillRatio;
}

export interface DailyFillsInput {
  sellFills?: SellFillEvent[];
  buyFill?: BuyFillEvent;
}

/** 같은 날 매도·매수가 모두 체결되면 매도부터 반영한 뒤 매수를 반영한다. */
export function applyDailyFillsToT(T: number, input: DailyFillsInput): number {
  let next = T;
  for (const sellFill of input.sellFills ?? []) {
    next = applySellFillToT(next, sellFill);
  }
  if (input.buyFill) {
    next = applyBuyFillToT(next, input.buyFill);
  }
  return next;
}

export interface ReverseModeEntryInput {
  T: number;
  N: number;
}

/** T > N − 1 이면 그날은 매수하지 않고 REVERSE로 전환한다 (잔금 유무와 무관). */
export function shouldEnterReverseMode(input: ReverseModeEntryInput): boolean {
  return input.T > input.N - 1;
}

export interface ReverseModeExitInput {
  closePrice: number;
  avgPrice: number;
  finalTargetPct: number;
}

/** 종가가 평단 × (1 − finalTargetPct%) 를 초과하면 NORMAL로 복귀한다. */
export function shouldExitReverseMode(input: ReverseModeExitInput): boolean {
  const { closePrice, avgPrice, finalTargetPct } = input;
  const recoveryThreshold = avgPrice * (1 - finalTargetPct / 100);
  return closePrice > recoveryThreshold;
}
