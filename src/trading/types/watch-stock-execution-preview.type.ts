import { TradingSignal } from './trading-signal.type';

/**
 * `TradingOrchestrator.previewWatchStockExecution`의 반환 타입.
 * 미리보기 전용 계산식이 아니라 실제 `strategy.evaluateStock()` 호출 결과를 그대로 옮겨 담는다 —
 * 미리보기와 실제 실행이 갈라질 수 없게 하기 위함. v4 전용 필드(turn/cashRemaining/mode 등)는
 * infinite-buy-v4 외 전략에서는 evaluateStock이 채우지 않으므로 모두 undefined로 남는다.
 */
export interface WatchStockExecutionPreviewContext {
  currentPrice: number;
  avgPrice?: number;
  holdQty: number;
  buyableAmount: number;
  // --- infinite-buy-v4 전용 (다른 전략이면 모두 undefined) ---
  turn?: number;
  maxCycles?: number;
  cashRemaining?: number;
  mode?: string;
  dailyBuyBudget?: number;
  dailyBuyBudgetCapped?: number;
  starPct?: number;
  starPrice?: number;
  buyLimitPrice?: number;
  sellLimitPrice?: number;
  reverseStarPrice?: number;
}

export interface WatchStockExecutionPreviewSignal {
  side: TradingSignal['side'];
  phase?: string;
  quantity: number;
  price?: number;
  orderDivision?: string;
  fillModel?: string;
  reason: string;
}

export interface WatchStockExecutionPreviewResult {
  context: WatchStockExecutionPreviewContext;
  signals: WatchStockExecutionPreviewSignal[];
  skipReasons: string[];
  /** 가정 원금(quotaOverride)으로 계산했으면 그 값. 실제 저장된 quota 기준이면 undefined. */
  appliedQuotaOverride?: number;
}
