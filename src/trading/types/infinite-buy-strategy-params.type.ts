import type { TargetTableRow } from '../strategy/infinite-buy-target-table';

export type Buy2DipMode = 'atr-light' | 'atr-strong' | 'fixed-3pct' | 'fixed-5pct';

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
  [key: string]: any;
}
