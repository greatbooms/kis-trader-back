export interface StockIndicators {
  ma200?: number;
  rsi14?: number;
  currentAboveMA200: boolean;
  // 하이브리드 전략용 확장 지표
  ma20?: number;
  ma60?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;
  macdPrevHistogram?: number;
  adx14?: number;
  atr14?: number;
  avgVolume20?: number;
  volumeRatio?: number;
  prevHigh?: number;
  prevLow?: number;
  prevClose?: number;
  todayOpen?: number;
  // 현재가 API에서 직접 제공되는 추가 지표
  foreignHoldRate?: number; // 외국인 소진율 (%)
  foreignNetBuyQty?: number; // 외국인 순매수 수량
  w52High?: number; // 52주 최고가
  w52Low?: number; // 52주 최저가
  investCautionYn?: boolean; // 투자유의여부
  marketWarnCode?: string; // 시장경고코드
  shortOverheatYn?: boolean; // 단기과열여부
  // 가격 위치 지표
  d250High?: number; // 250일 최고가
  d250Low?: number; // 250일 최저가
  d250HighRate?: number; // 250일 최고가 대비 현재가 비율 (%)
  d250LowRate?: number; // 250일 최저가 대비 현재가 비율 (%)
  yearHigh?: number; // 연중 최고가
  yearLow?: number; // 연중 최저가
  yearHighRate?: number; // 연중 최고가 대비 현재가 비율 (%)
  yearLowRate?: number; // 연중 최저가 대비 현재가 비율 (%)
  // 시가총액/리스크
  marketCap?: number; // 시가총액
  loanBalanceRate?: number; // 융자잔고 비율 (%)
  shortSellable?: boolean; // 공매도 가능 여부
}
