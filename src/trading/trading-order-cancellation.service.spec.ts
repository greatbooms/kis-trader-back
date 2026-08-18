import { TradingOrderCancellationService } from './trading-order-cancellation.service';
import { Broker } from '@prisma/client';

describe('TradingOrderCancellationService', () => {
  const registry = (domestic: any, overseas: any) => {
    const port = {
      cancelOrder: jest.fn((request) => request.market === 'DOMESTIC'
        ? domestic.cancelOrder(request.orderNo, request.stockCode, request.qty)
        : overseas.cancelOrder(
          request.exchangeCode,
          request.orderNo,
          request.stockCode,
          request.qty,
          request.price,
        )),
    };
    return {
      get: jest.fn().mockReturnValue(port),
      isActive: jest.fn().mockReturnValue(true),
      requireActive: jest.fn().mockReturnValue(port),
    };
  };

  const currentBrokerContext = () => ({
    getCurrentContext: jest.fn((broker) => ({
      broker,
      environment: 'PROD',
      accountHash: 'current-account-hash',
      maskedAccount: '****1234-01',
    })),
    matchesCurrentContext: jest.fn().mockReturnValue(true),
  });

  const tradeRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'trade-1',
    broker: 'KIS',
    brokerEnvironment: 'PROD',
    brokerAccountHash: 'current-account-hash',
    market: 'DOMESTIC',
    exchangeCode: 'KRX',
    stockCode: '005930',
    side: 'BUY',
    orderNo: 'broker-order',
    brokerOrderDate: '20260714',
    quantity: 2,
    executedQty: 0,
    price: '70000',
    status: 'PENDING',
    cancellationStatus: null,
    ...overrides,
  });

  it.each([
    ['blank order number', 'DOMESTIC', { orderNo: '   ' }],
    ['blank stock code', 'DOMESTIC', { stockCode: '' }],
    ['invalid side', 'DOMESTIC', { side: 'HOLD' }],
    ['zero quantity', 'DOMESTIC', { quantity: 0 }],
    ['fractional quantity', 'DOMESTIC', { quantity: 1.5 }],
    ['blank overseas exchange', 'OVERSEAS', { exchangeCode: ' ' }],
    ['unsupported overseas exchange', 'OVERSEAS', { exchangeCode: 'BOGUS' }],
  ])('fails closed before DB or KIS access for %s', async (
    _label,
    market,
    invalidFields,
  ) => {
    const prisma = {
      tradeRecord: { findFirst: jest.fn() },
    };
    const domestic = { cancelOrder: jest.fn() };
    const overseas = { cancelOrder: jest.fn() };
    const recovery = { claimCancellation: jest.fn() };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, overseas) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(
      Broker.KIS,
      market as 'DOMESTIC' | 'OVERSEAS',
      {
        orderNo: 'broker-order',
        stockCode: market === 'DOMESTIC' ? '005930' : 'AAPL',
        quantity: 2,
        price: 70,
        side: 'BUY',
        ...(market === 'OVERSEAS' ? { exchangeCode: 'NASD' } : {}),
        ...invalidFields,
      } as never,
    )).resolves.toBe(false);

    expect(prisma.tradeRecord.findFirst).not.toHaveBeenCalled();
    expect(recovery.claimCancellation).not.toHaveBeenCalled();
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
    expect(overseas.cancelOrder).not.toHaveBeenCalled();
  });

  it.each([Broker.KIS, Broker.TOSS])(
    'fails closed before automatic cancellation lookup when %s is inactive',
    async (broker) => {
      const prisma = {
        tradeRecord: { findFirst: jest.fn() },
      };
      const domestic = { cancelOrder: jest.fn() };
      const overseas = { cancelOrder: jest.fn() };
      const recovery = { claimCancellation: jest.fn() };
      const brokerRegistry = registry(domestic, overseas);
      brokerRegistry.isActive.mockReturnValue(false);
      const service = new TradingOrderCancellationService(
        prisma as never,
        brokerRegistry as never,
        { isEnabled: jest.fn().mockReturnValue(true) } as never,
        currentBrokerContext() as never,
        recovery as never,
      );

      await expect(service.cancelUnfilledOrder(broker, 'DOMESTIC', {
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      })).resolves.toBe(false);

      expect(prisma.tradeRecord.findFirst).not.toHaveBeenCalled();
      expect(recovery.claimCancellation).not.toHaveBeenCalled();
      expect(brokerRegistry.requireActive).not.toHaveBeenCalled();
      expect(domestic.cancelOrder).not.toHaveBeenCalled();
    },
  );

  it('normalizes an overseas unfilled order before the exact local tuple lookup', async () => {
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue({ id: 'trade-normalized' }),
      },
    };
    const overseas = { cancelOrder: jest.fn() };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(false),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry({}, overseas) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(Broker.KIS, 'OVERSEAS', {
      orderNo: ' broker-order ',
      stockCode: ' aapl ',
      exchangeCode: ' nasd ',
      quantity: 2,
      price: 70,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(prisma.tradeRecord.findFirst).toHaveBeenCalledWith({
      where: {
        broker: Broker.KIS,
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'current-account-hash',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'AAPL',
        side: 'BUY',
        orderNo: 'broker-order',
        status: { in: ['PENDING', 'PARTIAL'] },
      },
    });
    expect(overseas.cancelOrder).not.toHaveBeenCalled();
  });

  it('never selects a same-tuple TOSS record from KIS unfilled order data', async () => {
    const tossRecord = tradeRecord({ id: 'toss-collision', broker: Broker.TOSS });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockImplementation(({ where }) => (
          where.broker === Broker.KIS ? null : tossRecord
        )),
      },
    };
    const kis = { cancelOrder: jest.fn() };
    const toss = { cancelOrder: jest.fn().mockResolvedValue({ outcome: 'ACCEPTED' }) };
    const brokerRegistry = {
      get: jest.fn((broker) => broker === Broker.KIS ? kis : toss),
      isActive: jest.fn().mockReturnValue(true),
      requireActive: jest.fn((broker) => broker === Broker.KIS ? kis : toss),
    };
    const recovery = { claimCancellation: jest.fn() };
    const service = new TradingOrderCancellationService(
      prisma as never,
      brokerRegistry as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(prisma.tradeRecord.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ broker: Broker.KIS }),
    });
    expect(recovery.claimCancellation).not.toHaveBeenCalled();
    expect(kis.cancelOrder).not.toHaveBeenCalled();
    expect(toss.cancelOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['blank order number', { orderNo: '   ' }],
    ['missing broker order date', { brokerOrderDate: null }],
    ['invalid broker order date', { brokerOrderDate: '20260230' }],
    ['missing broker environment', { brokerEnvironment: null }],
    ['blank broker account hash', { brokerAccountHash: ' ' }],
  ])('does not claim a local record with incomplete %s identity', async (
    _field,
    incompleteFields,
  ) => {
    const record = tradeRecord({
      id: 'trade-incomplete',
      ...incompleteFields,
    });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue({
          ...record,
          cancellationStatus: 'SUBMITTING',
        }),
      },
    };
    const domestic = {
      cancelOrder: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      }),
    };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      markCancellationAccepted: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(recovery.claimCancellation).not.toHaveBeenCalled();
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
  });

  it('does not claim when broker unfilled quantity differs from the local remaining quantity', async () => {
    const record = tradeRecord({
      id: 'trade-stale-quantity',
      quantity: 5,
      executedQty: 2,
    });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue({
          ...record,
          cancellationStatus: 'SUBMITTING',
        }),
      },
    };
    const domestic = {
      cancelOrder: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      }),
    };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      markCancellationAccepted: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(recovery.claimCancellation).not.toHaveBeenCalled();
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
  });

  it('uses the shared claim and performs no POST when another caller wins', async () => {
    const record = tradeRecord({ id: 'trade-1' });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
      },
    };
    const domestic = { cancelOrder: jest.fn() };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(false),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      }),
    ).resolves.toBe(false);

    expect(recovery.claimCancellation).toHaveBeenCalledWith('trade-1', Broker.KIS);
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['claim status', { cancellationStatus: 'REJECTED' }],
    ['broker', { broker: Broker.TOSS }],
    ['broker environment', { brokerEnvironment: 'PAPER' }],
    ['broker account', { brokerAccountHash: 'other-account-hash' }],
    ['market', { market: 'OVERSEAS' }],
    ['exchange', { exchangeCode: 'NYSE' }],
    ['stock', { stockCode: '000660' }],
    ['side', { side: 'SELL' }],
    ['order number', { orderNo: 'changed-order' }],
    ['broker order date', { brokerOrderDate: '20260715' }],
    ['quantity', { quantity: 3 }],
    ['executed quantity', { executedQty: 1 }],
    ['price', { price: '70001' }],
    ['open status', { status: 'PARTIAL' }],
  ])('releases the claim without POST when the reloaded %s changed', async (
    _field,
    changedFields,
  ) => {
    const initialRecord = tradeRecord({ id: 'trade-race' });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(initialRecord),
        findUnique: jest.fn().mockResolvedValue({
          ...initialRecord,
          cancellationStatus: 'SUBMITTING',
          ...changedFields,
        }),
      },
    };
    const domestic = {
      cancelOrder: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      }),
    };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      releaseCancellationClaim: jest.fn().mockResolvedValue(true),
      markCancellationUnknown: jest.fn(),
      markCancellationAccepted: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(prisma.tradeRecord.findUnique).toHaveBeenCalledWith({
      where: { id: 'trade-race', broker: Broker.KIS },
    });
    expect(recovery.releaseCancellationClaim).toHaveBeenCalledWith(
      'trade-race',
      Broker.KIS,
      '취소 대상 주문 정보 변경',
    );
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
  });

  it('releases a won claim when live trading closes before the broker POST', async () => {
    const record = tradeRecord({ id: 'trade-switch-off' });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue({
          ...record,
          cancellationStatus: 'SUBMITTING',
        }),
      },
    };
    const domestic = { cancelOrder: jest.fn() };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      releaseCancellationClaim: jest.fn().mockResolvedValue(true),
      markCancellationUnknown: jest.fn(),
    };
    const liveSwitch = {
      isEnabled: jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      liveSwitch as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      }),
    ).resolves.toBe(false);

    expect(recovery.releaseCancellationClaim).toHaveBeenCalledWith(
      'trade-switch-off',
      Broker.KIS,
      '실거래 비활성화로 자동 주문 취소 중단',
    );
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
  });

  it('releases a won automatic cancellation claim when its broker becomes inactive before POST', async () => {
    const record = tradeRecord({ id: 'trade-broker-disabled', broker: Broker.TOSS });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue({
          ...record,
          cancellationStatus: 'SUBMITTING',
        }),
      },
    };
    const domestic = { cancelOrder: jest.fn() };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      releaseCancellationClaim: jest.fn().mockResolvedValue(true),
      markCancellationUnknown: jest.fn(),
    };
    const brokerRegistry = registry(domestic, {});
    brokerRegistry.isActive
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const service = new TradingOrderCancellationService(
      prisma as never,
      brokerRegistry as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(Broker.TOSS, 'DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(recovery.releaseCancellationClaim).toHaveBeenCalledWith(
      'trade-broker-disabled',
      Broker.TOSS,
      '브로커 비활성화로 자동 주문 취소 중단',
    );
    expect(brokerRegistry.requireActive).not.toHaveBeenCalled();
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
    expect(recovery.markCancellationUnknown).not.toHaveBeenCalled();
  });

  it('releases a won claim when the broker context changes before POST', async () => {
    const record = tradeRecord({ id: 'trade-context-drift' });
    const claimedRecord = {
      ...record,
      cancellationStatus: 'SUBMITTING',
    };
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue(claimedRecord),
      },
    };
    const domestic = {
      cancelOrder: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      }),
    };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      releaseCancellationClaim: jest.fn().mockResolvedValue(true),
      markCancellationAccepted: jest.fn().mockResolvedValue(true),
    };
    const brokerContext = currentBrokerContext();
    brokerContext.matchesCurrentContext.mockReturnValue(false);
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      brokerContext as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(brokerContext.matchesCurrentContext).toHaveBeenCalledWith(
      Broker.KIS,
      claimedRecord.brokerEnvironment,
      claimedRecord.brokerAccountHash,
    );
    expect(recovery.releaseCancellationClaim).toHaveBeenCalledWith(
      'trade-context-drift',
      Broker.KIS,
      '브로커 컨텍스트 변경으로 자동 주문 취소 중단',
    );
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
  });

  it('releases a won claim when the broker context recheck throws', async () => {
    const record = tradeRecord({ id: 'trade-context-error' });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue({
          ...record,
          cancellationStatus: 'SUBMITTING',
        }),
      },
    };
    const domestic = {
      cancelOrder: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      }),
    };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      releaseCancellationClaim: jest.fn().mockResolvedValue(true),
      markCancellationAccepted: jest.fn().mockResolvedValue(true),
    };
    const brokerContext = currentBrokerContext();
    brokerContext.matchesCurrentContext.mockImplementation(() => {
      throw new Error('context unavailable');
    });
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      brokerContext as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(recovery.releaseCancellationClaim).toHaveBeenCalledWith(
      'trade-context-error',
      Broker.KIS,
      '브로커 컨텍스트 확인 실패로 자동 주문 취소 중단',
    );
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
  });

  it('posts once and persists ACCEPTED without updating the original order status', async () => {
    const record = tradeRecord({ id: 'trade-accepted' });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue({
          ...record,
          cancellationStatus: 'SUBMITTING',
        }),
      },
    };
    const domestic = {
      cancelOrder: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        message: '취소 접수',
      }),
    };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      markCancellationAccepted: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      }),
    ).resolves.toBe(true);

    expect(domestic.cancelOrder).toHaveBeenCalledTimes(1);
    expect(domestic.cancelOrder).toHaveBeenCalledWith('broker-order', '005930', 2);
    expect(recovery.markCancellationAccepted).toHaveBeenCalledWith(
      'trade-accepted',
      Broker.KIS,
      '취소 접수',
    );
  });

  it('persists an explicit broker cancellation rejection as REJECTED', async () => {
    const record = tradeRecord({ id: 'trade-rejected' });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue({
          ...record,
          cancellationStatus: 'SUBMITTING',
        }),
      },
    };
    const domestic = {
      cancelOrder: jest.fn().mockResolvedValue({
        outcome: 'REJECTED',
        success: false,
        message: '취소 거부',
      }),
    };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      markCancellationRejected: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      }),
    ).resolves.toBe(false);

    expect(domestic.cancelOrder).toHaveBeenCalledTimes(1);
    expect(recovery.markCancellationRejected).toHaveBeenCalledWith(
      'trade-rejected',
      Broker.KIS,
      '취소 거부',
    );
  });

  it('persists an ambiguous automatic cancellation as UNKNOWN with one POST', async () => {
    const record = tradeRecord({
      id: 'trade-unknown',
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      side: 'SELL',
    });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue({
          ...record,
          cancellationStatus: 'SUBMITTING',
        }),
      },
    };
    const overseas = {
      cancelOrder: jest.fn().mockResolvedValue({
        outcome: 'UNKNOWN',
        success: false,
        message: 'transport timeout',
      }),
    };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      markCancellationUnknown: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry({}, overseas) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder(Broker.KIS, 'OVERSEAS', {
        orderNo: 'broker-order',
        stockCode: 'TQQQ',
        exchangeCode: 'NASD',
        quantity: 2,
        price: 70,
        side: 'SELL',
      }),
    ).resolves.toBe(false);

    expect(overseas.cancelOrder).toHaveBeenCalledTimes(1);
    expect(recovery.markCancellationUnknown).toHaveBeenCalledWith(
      'trade-unknown',
      Broker.KIS,
      'transport timeout',
    );
  });

  it('maps a thrown broker cancellation failure to UNKNOWN without retrying', async () => {
    const record = tradeRecord({ id: 'trade-thrown' });
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
        findUnique: jest.fn().mockResolvedValue({
          ...record,
          cancellationStatus: 'SUBMITTING',
        }),
      },
    };
    const domestic = {
      cancelOrder: jest.fn().mockRejectedValue(new Error('socket closed')),
    };
    const recovery = {
      claimCancellation: jest.fn().mockResolvedValue(true),
      markCancellationUnknown: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      }),
    ).resolves.toBe(false);

    expect(domestic.cancelOrder).toHaveBeenCalledTimes(1);
    expect(recovery.markCancellationUnknown).toHaveBeenCalledWith(
      'trade-thrown',
      Broker.KIS,
      'socket closed',
    );
  });

  it('does not claim a same-number legacy or different-account broker order', async () => {
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockImplementation(({ where }) => (
          where.brokerEnvironment === 'PROD'
          && where.brokerAccountHash === 'current-account-hash'
          && where.exchangeCode === 'KRX'
          && where.stockCode === '005930'
          && where.side === 'BUY'
            ? null
            : { id: 'wrong-legacy-row' }
        )),
      },
    };
    const domestic = { cancelOrder: jest.fn() };
    const recovery = { claimCancellation: jest.fn() };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'current-account-hash',
        maskedAccount: '****1234-01',
      }),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      registry(domestic, {}) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      brokerContext as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder(Broker.KIS, 'DOMESTIC', {
        orderNo: 'shared-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      }),
    ).resolves.toBe(false);

    expect(prisma.tradeRecord.findFirst).toHaveBeenCalledWith({
      where: {
        broker: Broker.KIS,
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'current-account-hash',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'BUY',
        orderNo: 'shared-order',
        status: { in: ['PENDING', 'PARTIAL'] },
      },
    });
    expect(recovery.claimCancellation).not.toHaveBeenCalled();
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
  });
});
