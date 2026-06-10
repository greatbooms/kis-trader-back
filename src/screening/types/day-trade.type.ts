/** 데이트레이드(당일청산) 후보 지표 스냅샷 — 전일 확정 일봉 기준 */
export interface DayTradeIndicatorSnapshot {
  prevDate: string; // 전일 일봉 날짜 (YYYYMMDD)
  prevClose: number;
  prevRangePct: number; // 전일 (고가-저가)/종가 × 100
  atrPct: number; // ATR14 / 전일 종가 × 100
  ma20: number;
  aboveMa20: boolean; // 전일 종가 > MA20
  avgTradeValue20d: number; // 20일 평균 거래대금(원) — 종가×거래량 근사
}

/** getPrice에서 가져오는 당일 적용 유의/경고 상태 */
export interface DayTradeCautionFlags {
  investCautionYn?: boolean;
  shortOverheatYn?: boolean;
  marketWarnCode?: string;
}

export interface DayTradeCandidateScore {
  stockCode: string;
  stockName: string;
  exchangeCode: 'KRX';
  market: 'DOMESTIC';
  score: number;
  rank: number; // 통과 후보 1부터, 탈락은 0
  excluded: boolean;
  excludeReason?: string;
  indicators: DayTradeIndicatorSnapshot;
}

export interface DayTradeRunResult {
  skipped: boolean;
  skipReason?: string;
  saved: number;
  simulated: number;
  topStockName?: string;
}

/** AppSetting 'day-trade-screening' 키 값 */
export interface DayTradeScreeningSettings {
  enabled: boolean;
  topN: number;
  simCapital: number;
}
