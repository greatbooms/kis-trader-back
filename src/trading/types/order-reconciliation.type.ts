export interface PositionQuantitySnapshot {
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode: string;
  stockCode: string;
  quantity: number;
}
