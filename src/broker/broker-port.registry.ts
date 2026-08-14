import { Injectable } from '@nestjs/common';
import { Broker } from '@prisma/client';
import type { BrokerPort } from '../common/types';
import { KisBrokerAdapter } from '../kis/kis-broker.adapter';

@Injectable()
export class BrokerPortRegistry {
  private readonly ports: Map<Broker, BrokerPort>;

  constructor(kis: KisBrokerAdapter) {
    this.ports = new Map([[kis.broker, kis]]);
  }

  get(broker: Broker): BrokerPort {
    const port = this.ports.get(broker);
    if (!port) throw new Error(`Broker port is not registered: ${broker}`);
    return port;
  }
}
