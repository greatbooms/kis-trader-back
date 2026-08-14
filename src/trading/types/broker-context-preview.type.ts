import { Broker, BrokerEnvironment } from '@prisma/client';

export interface BrokerContextPreview {
  broker: Broker;
  environment: BrokerEnvironment;
  maskedAccount: string;
  contextToken: string;
}
