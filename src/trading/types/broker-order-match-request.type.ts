import { Broker, BrokerEnvironment, Market, Side } from '@prisma/client';

export interface BrokerOrderMatchRequest {
  tradeRecordId: string;
  broker: Broker;
  market: Market;
  exchangeCode: string;
  stockCode: string;
  side: Side;
  quantity: number;
  submissionStartedAt: Date | null;
  brokerEnvironment: BrokerEnvironment | null;
  brokerAccountHash: string | null;
}
