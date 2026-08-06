export type InfiniteBuyV4Mode = 'NORMAL' | 'REVERSE';

export interface InfiniteBuyV4RecentClose {
  date: string;
  close: number;
}

/**
 * `WatchStock.strategyParams.v4` 저장 형태 (스키마 마이그레이션 없음, JSON 하위 키).
 * 설정값과 상태값이 섞여 있다 — 설정은 사용자가 지정, 상태는 fill 확정 시점에
 * `TradingService.handleStrategySignalFill`이 갱신하고 전략은 평가 시 읽기 전용으로 참조한다.
 * (recentCloses/mode 만 예외 — 전략이 평가 시점에 직접 계산해 details.v4StateUpdate로 반환한다.)
 */
export interface InfiniteBuyV4Params {
  // --- 설정 (종목별) ---
  /** 별% 스케일이자 최종 목표 수익률 기준. TQQQ/SOXL 외 종목은 필수 명시 (기본값 없음) */
  starBasePct?: number;
  /** 최종 지정가 매도 목표 (%). 기본값 = starBasePct */
  finalTargetPct?: number;
  /** 첫 매수 LOC 마크업 비율. 기본 0.12 */
  firstBuyMarkupPct?: number;
  /** 첫 매수를 제외한 BUY 지정가의 현재가 대비 최대 프리미엄. 기본 0.10 */
  maxBuyPremiumPct?: number;
  /** 사다리 할인율 단계 (기준가 대비 비율). 기본 [0.05, 0.10, 0.15] */
  ladderStepsPct?: number[];
  /** 사이클 종료 시 잔금 전체를 새 원금으로 사용(복리, true 기본) / 원금 초과분 제외(단리, false) */
  compoundMode?: boolean;

  // --- 상태 ---
  mode?: InfiniteBuyV4Mode;
  /** 회차 (T). 체결 비율 기반 연속값 — fill 확정 시점에만 갱신 */
  turn?: number;
  /** 잔금 = principal − 현재 사이클 순투입액(매수 체결액 − 매도 회수액) */
  cashRemaining?: number;
  /** 완료된 사이클 수 (로그/분석용) */
  cycleSeq?: number;
  /** 리버스 별지점(직전 거래일 종가 평균) 계산용 롤링 윈도우. 최대 5개, 날짜 중복 없이 유지 */
  recentCloses?: InfiniteBuyV4RecentClose[];
  /**
   * 마지막 체결 확정 시점의 보유수량 (handleStrategySignalFill이 매 체결마다 갱신).
   * 다음 평가에서 broker 실제 보유수량과 비교해 수동매매 혼입을 감지하는 데 사용 (F2).
   */
  lastKnownHoldQty?: number;
}
