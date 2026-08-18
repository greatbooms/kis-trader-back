import { ApprovalStatus, OrderStatus } from '@prisma/client';

export type SellApprovalWorkflowReason =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'DELIVERY_NOT_READY'
  | 'TRADING_DISABLED'
  | 'EXPIRED'
  | 'ALREADY_HANDLED'
  | 'REFRESH_FAILED'
  | 'NO_HOLDING'
  | 'SUBMISSION_CLAIM_LOST'
  | 'BROKER_CONTEXT_MISMATCH'
  | 'BROKER_DISABLED'
  | 'BROKER_REJECTED'
  | 'BROKER_UNKNOWN'
  | 'STATE_CHANGED'
  | 'ACCEPTED_PERSISTENCE_PENDING';

export interface SellApprovalWorkflowResult {
  approvalId: string;
  approvalStatus?: ApprovalStatus;
  tradeRecordId?: string;
  tradeStatus?: OrderStatus;
  claimed: boolean;
  submitted: boolean;
  reason?: SellApprovalWorkflowReason;
}
