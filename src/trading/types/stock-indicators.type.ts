export interface StockIndicators {
  ma200?: number;
  rsi14?: number;
  currentAboveMA200: boolean;
  volatility30d?: number;
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
  atrPercent?: number;
  avgVolume20?: number;
  volumeRatio?: number;
  prevHigh?: number;
  prevLow?: number;
  prevClose?: number;
  todayOpen?: number;
  // 현재가 API에서 직접 제공되는 추가 지표
  foreignHoldRate?: number; // 외국인 소진율 (%)
  foreignNetBuyQty?: number; // 외국인 순매수 수량
  foreignNetBuy?: boolean; // 외국인 순매수 여부
  institutionNetBuy?: boolean; // 기관 순매수 여부
  fundNetBuy?: boolean; // 연기금/펀드 순매수 여부
  trustNetBuy?: boolean; // 투자신탁 순매수 여부
  foreignNetBuyAmount?: number; // 외국인 순매수 거래대금
  foreignNetBuyStreak?: number; // 외국인 연속 순매수 일수
  programTradeDirection?: 'BUY' | 'SELL'; // 프로그램 매매 방향
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
  dividendYield?: number; // 배당수익률 (%)
  payoutRatio?: number; // 배당성향 (%)
  consecutiveDividendYears?: number; // 연속 배당 연수
  dividendGrowthRate?: number; // 5년 배당 성장률 (%)
  targetPrice?: number; // 컨센서스 목표가
  targetPriceUpside?: number; // 현재가 대비 목표가 괴리 (%)
  consensusRating?: string; // 컨센서스 의견
  earningsSurprise?: number; // 최근 실적 서프라이즈 (%)
  estimatedEps?: number; // 추정 EPS
  estimatedPer?: number; // 추정 PER
  analystCount?: number; // 애널리스트 수
  recentDisclosureCount30d?: number; // 최근 30일 공시 건수 (OpenDART)
  recentPeriodicDisclosureCount30d?: number; // 최근 30일 정기공시 건수 (OpenDART)
  recentMaterialDisclosureCount30d?: number; // 최근 30일 주요사항 공시 건수 (OpenDART)
  lastDisclosureDate?: string; // 최근 공시일 (OpenDART)
  lastDisclosureTitle?: string; // 최근 공시 제목 (OpenDART)
  insiderOwnershipRate?: number; // 주요주주 지분율 (%)
  insiderOwnershipChangeRate?: number; // 주요주주 지분 증감 (%p)
  latestOwnershipReportDate?: string; // 최근 지분공시일
  latestSecFilingDate?: string; // 최근 SEC filing 일자
  latestSecFilingForm?: string; // 최근 SEC filing 양식
  latestSecPeriodicFilingDate?: string; // 최근 SEC 정기보고서 일자
  latestSecPeriodicFilingForm?: string; // 최근 SEC 정기보고서 양식
  recentSecForm8KCount30d?: number; // 최근 30일 8-K 건수
  secPeriodicReportAgeDays?: number; // 최근 정기보고서 경과일
}
