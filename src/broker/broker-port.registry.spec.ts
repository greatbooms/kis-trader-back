import { Broker } from '@prisma/client';
import { BrokerPortRegistry } from './broker-port.registry';

describe('BrokerPortRegistry', () => {
  const kisPort = { broker: Broker.KIS };

  it('returns the registered broker port', () => {
    const registry = new BrokerPortRegistry(kisPort as never);

    expect(registry.get(Broker.KIS)).toBe(kisPort);
  });

  it('fails closed for an unregistered broker', () => {
    const registry = new BrokerPortRegistry(kisPort as never);

    expect(() => registry.get(Broker.TOSS)).toThrow('Broker port is not registered: TOSS');
  });
});
