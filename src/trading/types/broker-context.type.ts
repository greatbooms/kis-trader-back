import { Broker } from '@prisma/client';

export interface BrokerContext {
  broker: Broker;
  environment: 'PAPER' | 'PROD';
  accountHash: string;
  maskedAccount: string;
}
