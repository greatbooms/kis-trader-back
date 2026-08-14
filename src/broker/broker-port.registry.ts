import { Injectable } from '@nestjs/common';
import { Broker } from '@prisma/client';
import type { BrokerPort } from '../common/types';
import { KisBrokerAdapter } from '../kis/kis-broker.adapter';

@Injectable()
export class BrokerPortRegistry {
  private readonly ports: Map<Broker, BrokerPort>;

  constructor(kis: KisBrokerAdapter, toss?: BrokerPort) {
    this.ports = new Map([
      [kis.broker, kis],
      ...(toss ? [[toss.broker, toss] as [Broker, BrokerPort]] : []),
    ]);
  }

  get(broker: Broker): BrokerPort {
    const port = this.ports.get(broker);
    if (!port) throw new Error(`Broker port is not registered: ${broker}`);
    return port;
  }
}
