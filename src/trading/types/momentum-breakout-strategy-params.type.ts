/**
 * 변동성 돌파(momentum-breakout) 전략 파라미터.
 * 상태 필드(entryDate/entryDayHigh)는 체결 후처리(TradingService/SimulationTickEngine)가 기록하고,
 * 나머지는 WatchStock.strategyParams로 override 가능한 튜닝 값.
 */
export interface MomentumBreakoutStrategyParams {
  /** 진입 체결일 (KST YYYY-MM-DD). 당일청산 판정과 이월 포지션 정리에 사용 */
  entryDate?: string;
  /**
   * 진입 시점의 당일 고가 (BUY 신호 metadata에서 체결 후처리가 기록).
   * 현재 당일 고가가 이 값을 넘어선 경우에만 "진입 후 고가"로 인정해 트레일링 기준으로 쓴다
   * — 진입 전 스파이크가 섞인 세션 고가로 인한 진입 직후 트레일링 오발동 방지
   */
  entryDayHigh?: number;

  /** 변동성 돌파 계수 K — 돌파가 = 당일 시가 + 전일변동폭 × K (기본 0.5) */
  kValue?: number;
  /** 평균단가 대비 손절률 (기본 0.02 = -2%) */
  stopLossRate?: number;
  /** 당일 고가 대비 트레일링 스탑 사용 여부 (기본 true) */
  trailingStopEnabled?: boolean;
  /** 트레일링 스탑 폭 (기본 0.02) */
  trailingStopRate?: number;
  /** 익절 사용 여부 (기본 false — 당일청산이 기본 출구) */
  takeProfitEnabled?: boolean;
  /** 익절률 (takeProfitEnabled=true일 때, 기본 0.05) */
  takeProfitRate?: number;
  /**
   * MA20 추세 필터 (hard, 기본 true).
   * 레짐 분석(2023-06~2026-05): K돌파 gross 엣지가 MA20 위에서만 유의
   * (005930 +0.176% vs +0.007%, 122630 +0.110% vs -0.032%)
   */
  useMa20Filter?: boolean;
  /** 시간보정 거래량 soft 조건 배수 (기본 1.0) */
  volumeMultiplier?: number;
  /** soft 조건 최소 충족 개수 (기본 2, 평가 가능한 항목 수가 더 적으면 그 수로 제한) */
  minSoftConditions?: number;
  /** 돌파가 대비 최대 추격 허용률 — 초과 시 추격 매수 금지 (기본 0.01) */
  maxChaseRate?: number;
  /** 진입 허용 시작 시각, KST HH:mm (기본 '09:05') */
  entryStartTime?: string;
  /** 진입 허용 종료 시각, KST HH:mm (기본 '14:30') */
  entryEndTime?: string;
  /** 당일청산 시각, KST HH:mm (기본 '15:10' — 15:20 동시호가 전 완료) */
  exitTime?: string;
}
