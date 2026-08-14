import { Broker } from '@prisma/client';
import { createBrokerPortRegistry } from './broker.module';

describe('BrokerModule Toss registration gate', () => {
  const kis = { broker: Broker.KIS };
  const toss = { broker: Broker.TOSS };

  it('registers Toss only when toss.clientId is configured', () => {
    const config = { get: jest.fn().mockReturnValue('client-id') };
    const registry = createBrokerPortRegistry(kis as never, toss as never, config as never);

    expect(registry.get(Broker.TOSS)).toBe(toss);
  });

  it.each([undefined, '', '   '])('leaves Toss fail-closed for clientId %p', (clientId) => {
    const config = { get: jest.fn().mockReturnValue(clientId) };
    const registry = createBrokerPortRegistry(kis as never, toss as never, config as never);

    expect(() => registry.get(Broker.TOSS)).toThrow('Broker port is not registered: TOSS');
  });
});
