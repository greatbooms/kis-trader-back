/** KIS API 공통 응답 */
export interface KisApiResponse<T = any> {
  rt_cd: string; // '0' = 성공
  msg_cd: string;
  msg1: string;
  output?: T;
  output1?: T;
  output2?: any;
  output3?: any;
}

/** 국내 현재가 응답 */
export interface DomesticPriceOutput {
  stck_prpr: string; // 현재가
  stck_oprc: string; // 시가
  stck_hgpr: string; // 고가
  stck_lwpr: string; // 저가
  acml_vol: string;  // 누적거래량
  hts_kor_isnm?: string; // 종목명
}

/** 국내 주문 응답 */
export interface DomesticOrderOutput {
  KRX_FWDG_ORD_ORGNO: string; // 원주문번호
  ODNO: string;                // 주문번호
  ORD_TMD: string;             // 주문시각
}

/** 국내 잔고 항목 */
export interface DomesticBalanceItem {
  pdno: string;           // 종목코드
  prdt_name: string;      // 종목명
  hldg_qty: string;       // 보유수량
  pchs_avg_pric: string;  // 매입평균가
  prpr: string;           // 현재가
  evlu_pfls_amt: string;  // 평가손익금액
  evlu_pfls_rt: string;   // 평가손익률
}

/** 해외 현재가 응답 */
export interface OverseasPriceOutput {
  last: string;   // 현재가
  open: string;   // 시가
  high: string;   // 고가
  low: string;    // 저가
  tvol: string;   // 거래량
  name?: string;  // 종목명
}

/** 해외 주문 응답 */
export interface OverseasOrderOutput {
  KRX_FWDG_ORD_ORGNO: string;
  ODNO: string;
  ORD_TMD: string;
}

/** 해외 잔고 항목 */
export interface OverseasBalanceItem {
  ovrs_pdno: string;           // 종목코드
  ovrs_item_name: string;      // 종목명
  ovrs_cblc_qty: string;       // 보유수량
  pchs_avg_pric: string;       // 매입평균가
  now_pric2: string;           // 현재가
  ovrs_stck_evlu_pfls_amt: string; // 평가손익
  evlu_pfls_rt: string;        // 수익률
  frcr_evlu_pfls_amt: string;  // 외화 평가손익
  ovrs_excg_cd: string;        // 거래소코드
}

/** 통합 시세 결과 */
export interface StockPriceResult {
  stockCode: string;
  stockName: string;
  currentPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
}

/** 주문 결과 */
export interface OrderResult {
  success: boolean;
  orderNo?: string;
  message: string;
}

/** 잔고 항목 (통합) */
export interface BalanceItem {
  stockCode: string;
  stockName: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  profitLoss: number;
  profitRate: number;
  exchangeCode?: string;
}

/** 일별 시세 */
export interface DailyPrice {
  date: string; // YYYYMMDD
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

/** 금리 항목 */
export interface InterestRateItem {
  name: string;
  rate: number;
  change: number;
}

/** 휴장일 항목 */
export interface HolidayItem {
  date: string;
  name: string;
  isOpen: boolean;
}

/** 미체결 주문 */
export interface UnfilledOrder {
  orderNo: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  exchangeCode?: string;
}

/** 해외 주문 구분 (00=지정가, 32=장전시간외, 33=장후시간외, 34=LOC) */
export type OverseasOrderDivision = '00' | '32' | '33' | '34';
