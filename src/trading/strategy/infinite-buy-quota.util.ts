import type { InfiniteBuyStrategyParams } from '../types';

export interface AccumulatedQuotaInput {
  baseQuota: number;           // 이번 회차 기본 할당 (perCycleQuota)
  params?: InfiniteBuyStrategyParams;
  remainingQuota: number;      // quota - totalInvested (상한)
}

export interface AccumulatedQuotaResult {
  carriedIn: number;           // 이번 실행 시작 시 이월 금액
  combinedQuota: number;       // baseQuota + carriedIn (remainingQuota 상한 전)
  cappedQuota: number;         // min(combinedQuota, remainingQuota)
}

/**
 * accumulatedQuota 이월 금액을 현재 회차 예산에 합산한다.
 * 시뮬레이션과 실전이 동일 계산을 공유하기 위해 유틸로 분리.
 */
export function applyAccumulatedQuota(input: AccumulatedQuotaInput): AccumulatedQuotaResult {
  const { baseQuota, params, remainingQuota } = input;
  const carriedIn = Math.max(0, Number(params?.accumulatedQuota) || 0);
  const combinedQuota = baseQuota + carriedIn;
  const cappedQuota = Math.max(0, Math.min(combinedQuota, remainingQuota));
  return { carriedIn, combinedQuota, cappedQuota };
}
