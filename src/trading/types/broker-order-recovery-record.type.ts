import {
  Broker,
  BrokerEnvironment,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  OrderType,
  Side,
  SubmissionResolution,
} from '@prisma/client';

export interface BrokerOrderRecoveryRecord {
  id: string;
  broker: Broker;
  market: Market;
  exchangeCode: string;
  stockCode: string;
  stockName: string;
  side: Side;
  orderType: OrderType;
  quantity: number;
  price: unknown;
  orderNo: string | null;
  status: OrderStatus;
  strategyName?: string | null;
  reason?: string | null;
  brokerMessage?: string | null;
  submissionStartedAt: Date | null;
  brokerOrderDate: string | null;
  brokerOrderTime: string | null;
  brokerEnvironment: BrokerEnvironment | null;
  brokerAccountHash: string | null;
  submissionResolvedAt: Date | null;
  submissionResolvedBy: string | null;
  submissionResolution: SubmissionResolution | null;
  cancellationStatus: CancellationAttemptStatus | null;
  cancellationStartedAt: Date | null;
  cancellationResolvedAt: Date | null;
  cancellationResolvedBy: string | null;
  cancellationMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}
