import { TradingOrderCancellationService } from './trading-order-cancellation.service';

describe('TradingOrderCancellationService', () => {
  const currentBrokerContext = () => ({
    getCurrentContext: jest.fn().mockReturnValue({
      environment: 'PROD',
      accountHash: 'current-account-hash',
      maskedAccount: '****1234-01',
    }),
    matchesCurrentContext: jest.fn().mockReturnValue(true),
  });

  const tradeRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'trade-1',
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
      domestic as never,
      overseas as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder(
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
      {} as never,
      overseas as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder('OVERSEAS', {
      orderNo: ' broker-order ',
      stockCode: ' aapl ',
      exchangeCode: ' nasd ',
      quantity: 2,
      price: 70,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(prisma.tradeRecord.findFirst).toHaveBeenCalledWith({
      where: {
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
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder('DOMESTIC', {
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
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder('DOMESTIC', {
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
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder('DOMESTIC', {
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      }),
    ).resolves.toBe(false);

    expect(recovery.claimCancellation).toHaveBeenCalledWith('trade-1');
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['claim status', { cancellationStatus: 'REJECTED' }],
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
      markCancellationAccepted: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder('DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(prisma.tradeRecord.findUnique).toHaveBeenCalledWith({
      where: { id: 'trade-race' },
    });
    expect(recovery.releaseCancellationClaim).toHaveBeenCalledWith(
      'trade-race',
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
    };
    const liveSwitch = {
      isEnabled: jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
    };
    const service = new TradingOrderCancellationService(
      prisma as never,
      domestic as never,
      {} as never,
      liveSwitch as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder('DOMESTIC', {
        orderNo: 'broker-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      }),
    ).resolves.toBe(false);

    expect(recovery.releaseCancellationClaim).toHaveBeenCalledWith(
      'trade-switch-off',
      '실거래 비활성화로 자동 주문 취소 중단',
    );
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
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
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      brokerContext as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder('DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(brokerContext.matchesCurrentContext).toHaveBeenCalledWith(
      claimedRecord.brokerEnvironment,
      claimedRecord.brokerAccountHash,
    );
    expect(recovery.releaseCancellationClaim).toHaveBeenCalledWith(
      'trade-context-drift',
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
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      brokerContext as never,
      recovery as never,
    );

    await expect(service.cancelUnfilledOrder('DOMESTIC', {
      orderNo: 'broker-order',
      stockCode: '005930',
      quantity: 2,
      price: 70_000,
      side: 'BUY',
    })).resolves.toBe(false);

    expect(recovery.releaseCancellationClaim).toHaveBeenCalledWith(
      'trade-context-error',
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
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder('DOMESTIC', {
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
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder('DOMESTIC', {
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
      {} as never,
      overseas as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder('OVERSEAS', {
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
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      currentBrokerContext() as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder('DOMESTIC', {
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
      domestic as never,
      {} as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      brokerContext as never,
      recovery as never,
    );

    await expect(
      service.cancelUnfilledOrder('DOMESTIC', {
        orderNo: 'shared-order',
        stockCode: '005930',
        quantity: 2,
        price: 70_000,
        side: 'BUY',
      }),
    ).resolves.toBe(false);

    expect(prisma.tradeRecord.findFirst).toHaveBeenCalledWith({
      where: {
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
