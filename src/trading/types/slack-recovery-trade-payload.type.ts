import { Broker } from '@prisma/client';
import { SlackMessageOrigin } from './slack-message-origin.type';

export interface SlackRecoveryTradePayload {
  v: 1;
  tradeRecordId: string;
  broker: Broker;
  contextToken?: string;
  origin?: SlackMessageOrigin;
}
