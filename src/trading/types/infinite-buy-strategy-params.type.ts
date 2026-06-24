import type { TargetTableRow } from '../strategy/infinite-buy-target-table';

export type Buy2DipMode = 'atr-light' | 'atr-strong' | 'fixed-3pct' | 'fixed-5pct';

export type RsiPolicy =
  | 'none'
  | 'legacy-hard'
  | 'continuous'
  | 'hard-stop-70'
  | 'hard-stop-75'
  | 'hard-stop-80';

export interface InfiniteBuySecondaryExitPlan {
  firstTargetDate: string;
  secondTargetPrice: number;
  secondTargetRate: number;
  secondTargetQuantity: number;
  secondTargetAttemptedDate?: string;
}

export interface InfiniteBuyStrategyParams {
  accumulatedQuota?: number;
  lastAccumulatedDate?: string;
  secondaryExitPlan?: InfiniteBuySecondaryExitPlan;
  buy2DipMode?: Buy2DipMode;
  targetTableOverride?: TargetTableRow[];
  mddLiquidateStockLossThreshold?: number;
  rsiPolicy?: RsiPolicy;
  /** 일일 투입 상한 (perCycleQuota의 배수). hard-stop 정책 후 누적 quota 일괄 투입 방지. 기본 3. */
  maxDailyQuotaMultiple?: number;
  /** 같은 사이클 BUY/SELL 동시 발생 시 왕복 비용을 넘기기 위한 최소 가격 간격. 기본 0.006(0.6%). */
  sameCycleMinProfitRate?: number;
  [key: string]: any;
}
