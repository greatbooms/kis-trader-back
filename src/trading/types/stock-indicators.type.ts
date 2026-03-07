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
}
