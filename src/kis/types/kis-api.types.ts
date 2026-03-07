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
  prdy_vrss_vol_rate?: string; // 전일 대비 거래량 비율
  hts_kor_isnm?: string; // 종목명
  per?: string; // PER
  pbr?: string; // PBR
  hts_frgn_ehrt?: string; // 외국인 소진율
  frgn_ntby_qty?: string; // 외국인 순매수 수량
  pgtr_ntby_qty?: string; // 프로그램매매 순매수 수량
  acml_tr_pbmn?: string; // 누적 거래대금
  w52_hgpr?: string; // 52주 최고가
  w52_lwpr?: string; // 52주 최저가
  invt_caful_yn?: string; // 투자유의여부
  mrkt_warn_cls_code?: string; // 시장경고코드 (00:없음, 01:투자주의, 02:투자경고, 03:투자위험)
  short_over_yn?: string; // 단기과열여부
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

/** 해외 현재가상세 응답 (HHDFS76200200) */
export interface OverseasPriceOutput {
  last: string;   // 현재가
  open: string;   // 시가
  high: string;   // 고가
  low: string;    // 저가
  tvol: string;   // 거래량
  name?: string;  // 종목명 (현재체결가 API용)
  rsym?: string;  // 실시간조회종목코드 (현재가상세 API용)
  perx?: string;  // PER
  pbrx?: string;  // PBR
  epsx?: string;  // EPS
  bpsx?: string;  // BPS
  h52p?: string;  // 52주 최고가
  l52p?: string;  // 52주 최저가
  pvol?: string;  // 전일거래량
  tomv?: string;  // 시가총액
  e_icod?: string; // 업종(섹터)
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
  prevDayVolumeRate?: number; // 전일 대비 거래량 비율 (%)
  per?: number; // PER
  pbr?: number; // PBR
  eps?: number; // EPS — 해외 현재가상세 API에서만 제공 (국내는 재무비율 API 사용)
  foreignHoldRate?: number; // 외국인 소진율 (%) — 국내만
  foreignNetBuyQty?: number; // 외국인 순매수 수량 — 국내만
  programNetBuyQty?: number; // 프로그램매매 순매수 수량 — 국내만
  tradingValue?: number; // 누적 거래대금 — 국내만
  w52High?: number; // 52주 최고가
  w52Low?: number; // 52주 최저가
  investCautionYn?: boolean; // 투자유의여부 — 국내만
  marketWarnCode?: string; // 시장경고코드 — 국내만
  shortOverheatYn?: boolean; // 단기과열여부 — 국내만
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
