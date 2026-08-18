import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Broker, BrokerOrderActionChannel } from '@prisma/client';
import { GqlAuthGuard } from '../auth/auth.guard';
import { TradingBrokerOrderRecoveryResolver } from './trading-broker-order-recovery.resolver';

describe('TradingBrokerOrderRecoveryResolver', () => {
  const webContext = {
    req: {
      user: { username: 'eric' },
    },
  } as never;
  const actionContext = {
    channel: BrokerOrderActionChannel.WEB,
    actor: 'web:eric',
  };

  const build = () => {
    const recovery = {
      listRecoveryItems: jest.fn().mockResolvedValue([]),
      getCurrentContextPreview: jest.fn().mockReturnValue({
        broker: Broker.KIS,
        environment: 'PROD',
        maskedAccount: '****5678-01',
        contextToken: 'opaque-context-token',
      }),
      inspectCandidates: jest.fn().mockResolvedValue({}),
      assignCurrentContext: jest.fn().mockResolvedValue({}),
      linkCandidate: jest.fn().mockResolvedValue({}),
      confirmNotSubmitted: jest.fn().mockResolvedValue({}),
      confirmMatchesExisting: jest.fn().mockResolvedValue({}),
      inspectCancellation: jest.fn().mockResolvedValue({}),
      confirmCancellationNotAccepted: jest.fn().mockResolvedValue({}),
    };
    return {
      recovery,
      resolver: new TradingBrokerOrderRecoveryResolver(recovery as never),
    };
  };

  it('is protected by the GraphQL auth guard at class level', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TradingBrokerOrderRecoveryResolver,
    );

    expect(guards).toContain(GqlAuthGuard);
  });

  it('returns the DB-only recovery queue without adding broker lookups', async () => {
    const { resolver, recovery } = build();

    await expect(resolver.getRecoveryItems()).resolves.toEqual([]);

    expect(recovery.listRecoveryItems).toHaveBeenCalledTimes(1);
  });

  it('exposes current masked context only through the explicit preview query', () => {
    const { resolver, recovery } = build();

    expect(resolver.getCurrentContextPreview(Broker.KIS)).toEqual({
      broker: Broker.KIS,
      environment: 'PROD',
      maskedAccount: '****5678-01',
      contextToken: 'opaque-context-token',
    });
    expect(recovery.getCurrentContextPreview).toHaveBeenCalledWith(Broker.KIS);
    expect(recovery.listRecoveryItems).not.toHaveBeenCalled();
  });

  it('fails closed when the authenticated request has no usable username', async () => {
    const { resolver, recovery } = build();

    expect(() => resolver.inspectBrokerOrderCandidates(
      { tradeRecordId: 'trade-1' },
      { req: { user: { username: '   ' } } } as never,
    )).toThrow('Authenticated username is required');

    expect(recovery.inspectCandidates).not.toHaveBeenCalled();
  });

  it.each([
    [
      'inspectCandidates',
      'inspectBrokerOrderCandidates',
      { tradeRecordId: 'trade-1' },
      ['trade-1', actionContext],
    ],
    [
      'assignCurrentContext',
      'assignCurrentBrokerContext',
      { tradeRecordId: 'trade-1', contextToken: 'opaque-context-token' },
      ['trade-1', 'opaque-context-token', actionContext],
    ],
    [
      'linkCandidate',
      'linkBrokerOrderCandidate',
      {
        tradeRecordId: 'trade-1',
        brokerOrderDate: '20260713',
        exchangeCode: 'NASD',
        orderNo: 'O-1',
      },
      [{
        tradeRecordId: 'trade-1',
        brokerOrderDate: '20260713',
        exchangeCode: 'NASD',
        orderNo: 'O-1',
      }, actionContext],
    ],
    [
      'confirmNotSubmitted',
      'confirmBrokerOrderNotSubmitted',
      { tradeRecordId: 'trade-1' },
      ['trade-1', actionContext],
    ],
    [
      'confirmMatchesExisting',
      'confirmBrokerOrderMatchesExisting',
      {
        tradeRecordId: 'trade-1',
        brokerOrderDate: '20260713',
        exchangeCode: 'NASD',
        orderNo: 'O-1',
        existingTradeRecordId: 'trade-existing',
      },
      [{
        tradeRecordId: 'trade-1',
        brokerOrderDate: '20260713',
        exchangeCode: 'NASD',
        orderNo: 'O-1',
        existingTradeRecordId: 'trade-existing',
      }, actionContext],
    ],
    [
      'inspectCancellation',
      'inspectUnknownCancellation',
      { tradeRecordId: 'trade-1' },
      ['trade-1', actionContext],
    ],
    [
      'confirmCancellationNotAccepted',
      'confirmCancellationNotAccepted',
      { tradeRecordId: 'trade-1' },
      ['trade-1', actionContext],
    ],
  ] as const)(
    'delegates %s with the authenticated web actor',
    async (serviceMethod, resolverMethod, input, expectedArgs) => {
      const { resolver, recovery } = build();

      await (resolver[resolverMethod] as any)(input, webContext);

      expect(recovery[serviceMethod]).toHaveBeenCalledWith(...expectedArgs);
    },
  );
});
