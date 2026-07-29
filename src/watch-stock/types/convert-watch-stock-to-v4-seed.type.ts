import { InfiniteBuyV4Mode } from '../../trading/types';

/** `WatchStockService.convertToInfiniteBuyV4` 시딩 계산 결과 (dryRun 미리보기와 실제 적용 응답 공용). */
export interface ConvertWatchStockToV4Seed {
  watchStockId: string;
  dryRun: boolean;
  /** 실제로 strategyName/strategyParams가 갱신되었는지 (dryRun=true면 항상 false) */
  applied: boolean;
  isActive: boolean;
  starBasePct: number;
  turn: number;
  cashRemaining: number;
  lastKnownHoldQty: number;
  mode: InfiniteBuyV4Mode;
  cycleSeq: number;
  warnings: string[];
}
