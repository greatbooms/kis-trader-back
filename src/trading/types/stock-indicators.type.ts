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
}
