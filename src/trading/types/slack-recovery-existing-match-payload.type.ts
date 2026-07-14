import { SlackRecoveryCandidatePayload } from './slack-recovery-candidate-payload.type';

export interface SlackRecoveryExistingMatchPayload
  extends SlackRecoveryCandidatePayload {
  existingTradeRecordId: string;
}
