import { BrokerOrderActionChannel } from '@prisma/client';

export interface BrokerActionContext {
  channel: BrokerOrderActionChannel;
  actor: string;
}
