import { Broker } from '@prisma/client';
import { createBrokerPortRegistry } from './broker.module';

describe('BrokerModule Toss registration gate', () => {
  const kis = { broker: Broker.KIS };
  const toss = { broker: Broker.TOSS };

  it('keeps Toss inactive by default even when its port is registered', () => {
    const config = {
      get: jest.fn((key) => ({
        'toss.clientId': 'client-id',
        'trading.brokers.kis.enabled': true,
        'trading.brokers.toss.enabled': false,
      })[key]),
    };
    const registry = createBrokerPortRegistry(kis as never, toss as never, config as never);

    expect(registry.get(Broker.TOSS)).toBe(toss);
    expect(registry.getActive()).toEqual([kis]);
  });

  it.each([undefined, '', '   '])('leaves Toss fail-closed for clientId %p', (clientId) => {
    const config = {
      get: jest.fn((key) => {
        if (key === 'toss.clientId') return clientId;
        if (key === 'trading.brokers.toss.enabled') return false;
        return true;
      }),
    };
    const registry = createBrokerPortRegistry(kis as never, toss as never, config as never);

    expect(() => registry.get(Broker.TOSS)).toThrow('Broker port is not registered: TOSS');
  });

  it.each(['toss.clientId', 'toss.clientSecret', 'toss.accountNo'])(
    'fails closed when Toss is enabled without %s',
    (missingKey) => {
      const config = {
        get: jest.fn((key) => {
          if (key === 'trading.brokers.kis.enabled') return true;
          if (key === 'trading.brokers.toss.enabled') return true;
          return key === missingKey ? '   ' : 'configured';
        }),
      };

      expect(() => createBrokerPortRegistry(kis as never, toss as never, config as never))
        .toThrow('Toss broker is enabled but credentials are incomplete');
    },
  );
});
