export interface StockFundamentals {
  /** PER (Price to Earnings Ratio) — 국내/해외 모두 사용 가능 */
  per?: number;
  /** PBR (Price to Book Ratio) — 국내만 사용 가능 */
  pbr?: number;
  /** ROE (Return on Equity, %) — 국내만 사용 가능 */
  roe?: number;
  /** 부채비율 (%) — 국내만 사용 가능 */
  debtRatio?: number;
}
