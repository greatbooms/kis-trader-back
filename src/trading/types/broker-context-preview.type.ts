import { BrokerEnvironment } from '@prisma/client';

export interface BrokerContextPreview {
  environment: BrokerEnvironment;
  maskedAccount: string;
  contextToken: string;
}
