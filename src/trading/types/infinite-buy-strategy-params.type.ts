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
  [key: string]: any;
}
