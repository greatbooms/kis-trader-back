import { Broker } from '@prisma/client';

export interface BrokerOrderPersistenceWarning {
  broker: Broker;
  market: 'DOMESTIC' | 'OVERSEAS';
  stockCode: string;
  tradeRecordId: string;
  orderNo: string;
}
