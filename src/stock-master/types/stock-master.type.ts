export interface StockInfo {
  stockCode: string;
  stockName: string;
  englishName?: string;
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode: string;
}
