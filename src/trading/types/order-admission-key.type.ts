export interface OrderAdmissionKey {
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
}
