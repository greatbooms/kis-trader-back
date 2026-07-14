import { Market, Side } from '@prisma/client';
import { BrokerOrderRecoveryLifecycle } from './broker-order-recovery-lifecycle.type';

export interface BrokerOrderRecoverySlackAlert {
  tradeRecordId: string;
  lifecycle: BrokerOrderRecoveryLifecycle;
  market: Market;
  exchangeCode: string;
  stockCode: string;
  stockName: string;
  side: Side;
  quantity: number;
  price: number;
  startedAt: Date | null;
  brokerContextAssigned: boolean;
}
