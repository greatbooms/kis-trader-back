export interface StockFundamentals {
  /** PER (Price to Earnings Ratio) — 국내: 현재가 API, 해외: 현재가상세 API */
  per?: number;
  /** PBR (Price to Book Ratio) — 국내: 현재가 API, 해외: 현재가상세 API */
  pbr?: number;
  /** ROE (Return on Equity, %) — 국내: 재무비율 API */
  roe?: number;
  /** 부채비율 (%) — 국내: 재무비율 API */
  debtRatio?: number;
  /** EPS (원) — 국내: 재무비율 API, 해외: 현재가상세 API. 양수 = 흑자기업 */
  eps?: number;
  /** 매출액 증가율 (%) — 국내: 재무비율 API. 양수 = 성장기업 */
  salesGrowthRate?: number;
  /** 영업이익 증가율 (%) — 국내: 재무비율 API */
  operatingProfitGrowthRate?: number;
  /** EV/EBITDA (배) — 국내: 기타주요비율 API. 낮을수록 저평가 */
  evEbitda?: number;
  /** 배당성향 (%) — 국내: 기타주요비율 API */
  dividendPayoutRate?: number;
}
