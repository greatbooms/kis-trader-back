import { SlackMessageOrigin } from './slack-message-origin.type';

export interface SlackRecoveryTradePayload {
  v: 1;
  tradeRecordId: string;
  contextToken?: string;
  origin?: SlackMessageOrigin;
}
