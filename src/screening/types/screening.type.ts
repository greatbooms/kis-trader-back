export interface ScreeningCandidate {
  stockCode: string;
  stockName: string;
  exchangeCode: string;
  market: 'DOMESTIC' | 'OVERSEAS';
  currentPrice: number;
  changeRate: number;
  volume: number;
  marketCap: number;
  per?: number; // 해외 조건검색 API에서 제공
  eps?: number; // 해외 조건검색 API에서 제공
}

export interface StockScore {
  stockCode: string;
  stockName: string;
  exchangeCode: string;
  market: 'DOMESTIC' | 'OVERSEAS';
  totalScore: number;
  technicalScore: number;
  fundamentalScore: number;
  momentumScore: number;
  reasons: string[];
  indicators: StockIndicatorDetail;
  currentPrice: number;
  changeRate: number;
  volume: number;
  marketCap: number;
}

export interface StockIndicatorDetail {
  rsi14?: number;
  ma20?: number;
  ma60?: number;
  ma200?: number;
  priceAboveMa200?: boolean;
  goldenCrossNear?: boolean;
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
  foreignNetBuy?: boolean;
  institutionNetBuy?: boolean;
  volumeSurgeRate?: number;
}
