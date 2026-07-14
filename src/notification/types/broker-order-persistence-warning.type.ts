export interface BrokerOrderPersistenceWarning {
  market: 'DOMESTIC' | 'OVERSEAS';
  stockCode: string;
  tradeRecordId: string;
  orderNo: string;
}
