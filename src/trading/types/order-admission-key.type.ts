import { Broker } from '@prisma/client';

export interface OrderAdmissionKey {
  broker: Broker;
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
}
