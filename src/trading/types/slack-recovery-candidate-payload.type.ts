import { SlackRecoveryTradePayload } from './slack-recovery-trade-payload.type';

export interface SlackRecoveryCandidatePayload extends SlackRecoveryTradePayload {
  brokerOrderDate: string;
  exchangeCode: string;
  orderNo: string;
}
