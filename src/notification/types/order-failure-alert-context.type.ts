import { Broker } from '@prisma/client';

export interface OrderFailureAlertContext {
  broker: Broker;
  market: 'DOMESTIC' | 'OVERSEAS';
  exchangeCode: string;
  stockCode: string;
  stockName: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'MARKET' | 'LIMIT' | 'LOC';
  price: number;
  strategyName: string;
  reason?: string;
  stage: 'SUBMISSION' | 'RECONCILIATION';
  brokerMessage?: string;
  orderNo?: string;
  occurredAt: Date;
}
