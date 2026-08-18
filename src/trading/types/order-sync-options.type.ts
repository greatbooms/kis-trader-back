import { Broker } from '@prisma/client';

export interface OrderSyncOptions {
  force?: boolean;
  broker?: Broker;
  failOnAnyError?: boolean;
}
