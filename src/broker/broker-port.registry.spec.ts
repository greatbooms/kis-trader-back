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

  it('distinguishes a registered but disabled broker from an active broker', () => {
    const tossPort = { broker: Broker.TOSS };
    const registry = new BrokerPortRegistry(kisPort as never, tossPort as never);

    expect(registry.isActive(Broker.KIS)).toBe(true);
    expect(registry.isActive(Broker.TOSS)).toBe(false);
    expect(registry.get(Broker.TOSS)).toBe(tossPort);
    expect(() => registry.requireActive(Broker.TOSS)).toThrow('Broker is not active: TOSS');
    expect(registry.requireActive(Broker.KIS)).toBe(kisPort);
  });

  it('fails closed when KIS is registered but disabled', () => {
    const registry = new BrokerPortRegistry(kisPort as never, undefined, {
      [Broker.KIS]: false,
      [Broker.TOSS]: false,
    });

    expect(registry.isActive(Broker.KIS)).toBe(false);
    expect(() => registry.requireActive(Broker.KIS)).toThrow('Broker is not active: KIS');
  });

  it.each([
    ['only KIS', true, false, [kisPort]],
    ['only Toss', false, true, [{ broker: Broker.TOSS }]],
    ['both brokers', true, true, [kisPort, { broker: Broker.TOSS }]],
    ['neither broker', false, false, []],
  ])('returns %s when enabled', (_name, kisEnabled, tossEnabled, expected) => {
    const tossPort = { broker: Broker.TOSS };
    const registry = new BrokerPortRegistry(kisPort as never, tossPort as never, {
      [Broker.KIS]: kisEnabled,
      [Broker.TOSS]: tossEnabled,
    });

    expect(registry.getActive()).toEqual(expected);
  });
});
