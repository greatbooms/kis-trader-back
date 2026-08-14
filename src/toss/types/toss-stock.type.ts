export type TossStockMarket =
  | 'KOSPI'
  | 'KOSDAQ'
  | 'NYSE'
  | 'NASDAQ'
  | 'AMEX'
  | 'KR_ETC'
  | 'US_ETC'
  | (string & {});

export type TossCanonicalVenue = 'NASD' | 'NYSE' | 'AMEX';

export interface TossStockInfo {
  symbol: string;
  name: string;
  englishName: string;
  isinCode: string;
  market: TossStockMarket;
  securityType: string;
  isCommonShare: boolean;
  status: string;
  currency: string;
  sharesOutstanding: string;
  listDate?: string | null;
  delistDate?: string | null;
  leverageFactor?: string | null;
  koreanMarketDetail?: unknown | null;
}
