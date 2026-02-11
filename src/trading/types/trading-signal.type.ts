export interface TradingSignal {
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode?: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  reason: string;
  orderDivision?: string; // '00'=지정가, '34'=LOC 등
}
