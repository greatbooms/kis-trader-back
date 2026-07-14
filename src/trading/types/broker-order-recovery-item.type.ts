import {
  BrokerEnvironment,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  OrderType,
  Side,
  SubmissionResolution,
} from '@prisma/client';
import { BrokerOrderRecoveryLifecycle } from './broker-order-recovery-lifecycle.type';

export interface BrokerOrderRecoveryItem {
  tradeRecordId: string;
  lifecycle: BrokerOrderRecoveryLifecycle;
  market: Market;
  exchangeCode: string;
  stockCode: string;
  stockName: string;
  side: Side;
  orderType: OrderType;
  quantity: number;
  price: number;
  orderNo: string | null;
  status: OrderStatus;
  submissionStartedAt: Date | null;
  brokerOrderDate: string | null;
  brokerOrderTime: string | null;
  submissionResolvedAt: Date | null;
  submissionResolvedBy: string | null;
  submissionResolution: SubmissionResolution | null;
  cancellationStatus: CancellationAttemptStatus | null;
  cancellationStartedAt: Date | null;
  cancellationResolvedAt: Date | null;
  cancellationResolvedBy: string | null;
  cancellationMessage: string | null;
  brokerContextAssigned: boolean;
  currentBrokerEnvironment: BrokerEnvironment | null;
  maskedCurrentAccount: string | null;
  brokerContextMatchesCurrent: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}
