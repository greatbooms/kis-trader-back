import {
  Broker,
  BrokerOrderAction,
  BrokerOrderActionChannel,
  CancellationAttemptStatus,
  OrderStatus,
} from '@prisma/client';
import { TradingBrokerCancellationRecoveryService } from './trading-broker-cancellation-recovery.service';

describe('TradingBrokerCancellationRecoveryService', () => {
  const record = (overrides: Record<string, unknown> = {}) => ({
    id: 'trade-cancel-unknown',
    broker: Broker.KIS,
    market: 'DOMESTIC',
    exchangeCode: 'KRX',
    stockCode: '005930',
    stockName: '삼성전자',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 4,
    price: 70_000,
    executedPrice: null,
    executedQty: 0,
    orderNo: 'ORDER-1',
    status: OrderStatus.PENDING,
    strategyName: 'daily-dca',
    reason: 'strategy reason must survive',
    submissionStartedAt: new Date('2026-07-13T00:00:00.000Z'),
    brokerOrderDate: '20260713',
    brokerOrderTime: '090000',
    brokerEnvironment: 'PROD',
    brokerAccountHash: 'current-account-hash',
    brokerMessage: 'accepted',
    submissionResolvedAt: null,
    submissionResolvedBy: null,
    submissionResolution: null,
    cancellationStatus: CancellationAttemptStatus.UNKNOWN,
    cancellationStartedAt: new Date('2026-07-13T00:01:00.000Z'),
    cancellationResolvedAt: null,
    cancellationResolvedBy: null,
    cancellationMessage: 'transport timeout',
    createdAt: new Date('2026-07-13T00:00:00.000Z'),
    updatedAt: new Date('2026-07-13T00:01:00.000Z'),
    ...overrides,
  });

  const execution = (overrides: Record<string, unknown> = {}) => ({
    orderNo: 'ORDER-1',
    stockCode: '005930',
    side: 'BUY',
    orderQuantity: 4,
    filledQuantity: 0,
    remainingQuantity: 4,
    orderPrice: 70_000,
    filledPrice: undefined,
    exchangeCode: 'KRX',
    orderDate: '20260713',
    orderTime: '090000',
    rejectionState: 'NOT_REJECTED',
    rejected: false,
    ...overrides,
  });

  const unfilled = (overrides: Record<string, unknown> = {}) => ({
    orderNo: 'ORDER-1',
    stockCode: '005930',
    side: 'BUY',
    quantity: 4,
    price: 70_000,
    exchangeCode: 'KRX',
    ...overrides,
  });

  const context = {
    channel: BrokerOrderActionChannel.WEB,
    actor: 'web:operator',
  };

  function setup(options: {
    storedRecord?: ReturnType<typeof record> | null;
    executions?: ReturnType<typeof execution>[];
    unfilledOrders?: ReturnType<typeof unfilled>[];
    claimedCount?: number;
    contextSequence?: Array<{
      broker: Broker;
      environment: 'PAPER' | 'PROD';
      accountHash: string;
      maskedAccount: string;
    }>;
  } = {}) {
    const storedRecord = options.storedRecord === undefined ? record() : options.storedRecord;
    const updatedRecord = storedRecord
      ? {
          ...storedRecord,
          cancellationStatus: CancellationAttemptStatus.RESOLVED,
        }
      : null;
    const tx = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: options.claimedCount ?? 1 }),
        findUnique: jest.fn().mockResolvedValue(updatedRecord),
      },
      brokerOrderActionAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(storedRecord),
      },
      $transaction: jest.fn().mockImplementation((work) => work(tx)),
    };
    const domestic = {
      getOrderExecutions: jest.fn().mockResolvedValue(
        options.executions ?? [execution()],
      ),
      getUnfilledOrders: jest.fn().mockResolvedValue(options.unfilledOrders ?? []),
      cancelOrder: jest.fn(),
    };
    const overseas = {
      getOrderExecutions: jest.fn().mockResolvedValue(
        options.executions ?? [execution()],
      ),
      getUnfilledOrders: jest.fn().mockResolvedValue(options.unfilledOrders ?? []),
      cancelOrder: jest.fn(),
    };
    const contexts = options.contextSequence ?? [{
      broker: Broker.KIS,
      environment: 'PROD' as const,
      accountHash: 'current-account-hash',
      maskedAccount: '****1234-01',
    }];
    const brokerContext = {
      getCurrentContext: jest.fn()
        .mockImplementation((broker: Broker) => contexts.shift() ?? contexts[contexts.length - 1] ?? {
          broker,
          environment: 'PROD',
          accountHash: 'current-account-hash',
          maskedAccount: '****1234-01',
        }),
    };
    const registry = {
      get: jest.fn().mockReturnValue({
        getOrderExecutions: jest.fn((market, startDate, endDate) => market === 'DOMESTIC'
          ? domestic.getOrderExecutions(startDate, endDate)
          : overseas.getOrderExecutions(startDate, endDate)),
        getUnfilledOrders: jest.fn((market) => market === 'DOMESTIC'
          ? domestic.getUnfilledOrders()
          : overseas.getUnfilledOrders()),
      }),
    };
    const service = new TradingBrokerCancellationRecoveryService(
      prisma as never,
      brokerContext as never,
      registry as never,
    );
    return { service, prisma, tx, domestic, overseas, brokerContext, registry, storedRecord };
  }

  it('reconciles a completely unfilled closed order to CANCELLED and RESOLVED atomically', async () => {
    const { service, prisma, tx, domestic } = setup();

    await expect(
      service.inspectCancellation('trade-cancel-unknown', context),
    ).resolves.toEqual(expect.objectContaining({ id: 'trade-cancel-unknown' }));

    expect(domestic.getOrderExecutions).toHaveBeenCalledWith('20260713', '20260713');
    expect(domestic.getUnfilledOrders).toHaveBeenCalledTimes(1);
    expect(domestic.getOrderExecutions.mock.invocationCallOrder[0]).toBeLessThan(
      domestic.getUnfilledOrders.mock.invocationCallOrder[0],
    );
    expect(domestic.cancelOrder).not.toHaveBeenCalled();
    expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-cancel-unknown',
        broker: Broker.KIS,
        status: OrderStatus.PENDING,
        orderNo: 'ORDER-1',
        cancellationStatus: CancellationAttemptStatus.UNKNOWN,
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'current-account-hash',
        brokerOrderDate: '20260713',
      },
      data: {
        status: OrderStatus.CANCELLED,
        executedQty: 0,
        executedPrice: 70_000,
        cancellationStatus: CancellationAttemptStatus.RESOLVED,
        cancellationResolvedAt: expect.any(Date),
        cancellationResolvedBy: 'web:operator',
        cancellationMessage: 'Cancellation closure confirmed from complete KIS reads',
      },
    });
    expect(tx.tradeRecord.updateMany.mock.calls[0][0].data).not.toHaveProperty('reason');
    expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
      data: {
        tradeRecordId: 'trade-cancel-unknown',
        channel: BrokerOrderActionChannel.WEB,
        action: BrokerOrderAction.CANCELLATION_RECONCILED,
        actor: 'web:operator',
        brokerOrderDate: '20260713',
        exchangeCode: 'KRX',
        orderNo: 'ORDER-1',
        beforeStatus: OrderStatus.PENDING,
        afterStatus: OrderStatus.CANCELLED,
        details: {
          orderQuantity: 4,
          filledQuantity: 0,
          remainingQuantity: 4,
          cancellationMessage: 'Cancellation closure confirmed from complete KIS reads',
        },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('reconciles a closed partially-filled order while clearing only the closed order number', async () => {
    const storedRecord = record({ status: OrderStatus.PARTIAL, executedQty: 1 });
    const { service, tx } = setup({
      storedRecord,
      executions: [execution({
        filledQuantity: 2,
        remainingQuantity: 2,
        filledPrice: 70_100,
      })],
    });

    await service.inspectCancellation(storedRecord.id, context);

    expect(tx.tradeRecord.updateMany.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        status: OrderStatus.PARTIAL,
        orderNo: null,
        executedQty: 2,
        executedPrice: 70_100,
        cancellationStatus: CancellationAttemptStatus.RESOLVED,
      }),
    );
    expect(tx.tradeRecord.updateMany.mock.calls[0][0].data).not.toHaveProperty('reason');
  });

  it('reconciles a fully-filled closed order to FILLED', async () => {
    const { service, tx } = setup({
      executions: [execution({
        filledQuantity: 4,
        remainingQuantity: 0,
        filledPrice: 70_050,
      })],
    });

    await service.inspectCancellation('trade-cancel-unknown', context);

    expect(tx.tradeRecord.updateMany.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        status: OrderStatus.FILLED,
        executedQty: 4,
        executedPrice: 70_050,
        cancellationStatus: CancellationAttemptStatus.RESOLVED,
      }),
    );
  });

  it('leaves cancellation UNKNOWN without writes when the exact order remains open', async () => {
    const storedRecord = record();
    const { service, prisma } = setup({
      storedRecord,
      executions: [execution({ remainingQuantity: 0 })],
      unfilledOrders: [unfilled()],
    });

    await expect(
      service.inspectCancellation(storedRecord.id, context),
    ).resolves.toBe(storedRecord);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not infer closure when both complete reads omit the exact order', async () => {
    const { service, prisma } = setup({ executions: [], unfilledOrders: [] });

    await expect(
      service.inspectCancellation('trade-cancel-unknown', context),
    ).rejects.toThrow('cannot prove whether the broker order is open or closed');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['REJECTED', 'UNKNOWN'] as const)(
    'refuses a closed execution with %s rejection state',
    async (rejectionState) => {
      const { service, prisma } = setup({
        executions: [execution({
          rejectionState,
          rejected: rejectionState === 'REJECTED' ? true : undefined,
        })],
      });

      await expect(
        service.inspectCancellation('trade-cancel-unknown', context),
      ).rejects.toThrow('ambiguous or rejected');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('changes no state when either complete KIS read fails', async () => {
    const first = setup();
    first.domestic.getOrderExecutions.mockRejectedValue(new Error('execution page failed'));

    await expect(
      first.service.inspectCancellation('trade-cancel-unknown', context),
    ).rejects.toThrow('execution page failed');
    expect(first.domestic.getUnfilledOrders).not.toHaveBeenCalled();
    expect(first.prisma.$transaction).not.toHaveBeenCalled();

    const second = setup();
    second.domestic.getUnfilledOrders.mockRejectedValue(new Error('unfilled page failed'));

    await expect(
      second.service.inspectCancellation('trade-cancel-unknown', context),
    ).rejects.toThrow('unfilled page failed');
    expect(second.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails before KIS on a stored context mismatch and before mutation if context changes after reads', async () => {
    const mismatched = setup({
      contextSequence: [{
        broker: Broker.KIS,
        environment: 'PAPER',
        accountHash: 'other-hash',
        maskedAccount: '****9999-01',
      }],
    });

    await expect(
      mismatched.service.inspectCancellation('trade-cancel-unknown', context),
    ).rejects.toThrow('does not match current KIS context');
    expect(mismatched.domestic.getOrderExecutions).not.toHaveBeenCalled();

    const changed = setup({
      contextSequence: [
        {
          broker: Broker.KIS,
          environment: 'PROD',
          accountHash: 'current-account-hash',
          maskedAccount: '****1234-01',
        },
        {
          broker: Broker.KIS,
          environment: 'PROD',
          accountHash: 'changed-account-hash',
          maskedAccount: '****5678-01',
        },
      ],
    });

    await expect(
      changed.service.inspectCancellation('trade-cancel-unknown', context),
    ).rejects.toThrow('changed during cancellation inspection');
    expect(changed.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [Broker.KIS, Broker.TOSS],
    [Broker.TOSS, Broker.KIS],
  ])(
    'fails closed before broker reads when a %s record resolves a %s context',
    async (recordBroker, currentBroker) => {
      const mismatched = setup({
        storedRecord: record({ broker: recordBroker }),
        contextSequence: [{
          broker: currentBroker,
          environment: 'PROD',
          accountHash: 'current-account-hash',
          maskedAccount: '****1234-01',
        }],
      });

      await expect(
        mismatched.service.inspectCancellation('trade-cancel-unknown', context),
      ).rejects.toThrow(`does not match current ${recordBroker} context`);
      expect(mismatched.registry.get).not.toHaveBeenCalled();
      expect(mismatched.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('ignores same-number execution rows from a wrong tuple or date', async () => {
    const { service, prisma } = setup({
      executions: [
        execution({ stockCode: '000660' }),
        execution({ orderDate: '20260712' }),
      ],
      unfilledOrders: [],
    });

    await expect(
      service.inspectCancellation('trade-cancel-unknown', context),
    ).rejects.toThrow('cannot prove whether the broker order is open or closed');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('confirms a positively open cancellation as REJECTED without changing the original order', async () => {
    const storedRecord = record({ status: OrderStatus.PARTIAL, executedQty: 1 });
    const { service, tx, domestic } = setup({
      storedRecord,
      executions: [execution({ filledQuantity: 1, remainingQuantity: 0 })],
      unfilledOrders: [unfilled({ quantity: 3 })],
    });

    await service.confirmCancellationNotAccepted(storedRecord.id, context);

    expect(domestic.getOrderExecutions).toHaveBeenCalledWith('20260713', '20260713');
    expect(domestic.getUnfilledOrders).toHaveBeenCalledTimes(1);
    expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: storedRecord.id,
        broker: Broker.KIS,
        status: OrderStatus.PARTIAL,
        orderNo: 'ORDER-1',
        cancellationStatus: CancellationAttemptStatus.UNKNOWN,
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'current-account-hash',
        brokerOrderDate: '20260713',
      },
      data: {
        cancellationStatus: CancellationAttemptStatus.REJECTED,
        cancellationResolvedAt: expect.any(Date),
        cancellationResolvedBy: 'web:operator',
        cancellationMessage: 'Operator confirmed cancellation was not accepted after complete KIS reads',
      },
    });
    expect(tx.tradeRecord.updateMany.mock.calls[0][0].data).not.toHaveProperty('status');
    expect(tx.tradeRecord.updateMany.mock.calls[0][0].data).not.toHaveProperty('orderNo');
    expect(tx.tradeRecord.updateMany.mock.calls[0][0].data).not.toHaveProperty('reason');
    expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tradeRecordId: storedRecord.id,
        channel: BrokerOrderActionChannel.WEB,
        action: BrokerOrderAction.CANCELLATION_NOT_ACCEPTED,
        actor: 'web:operator',
        beforeStatus: OrderStatus.PARTIAL,
        afterStatus: OrderStatus.PARTIAL,
      }),
    });
  });

  it('refuses not-accepted confirmation unless the final complete read positively shows the exact order open', async () => {
    const { service, prisma } = setup({
      executions: [execution()],
      unfilledOrders: [],
    });

    await expect(
      service.confirmCancellationNotAccepted('trade-cancel-unknown', context),
    ).rejects.toThrow('is not currently open');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows only the first Slack/web CAS winner and writes no losing audit', async () => {
    const { service, tx } = setup({
      executions: [execution({ remainingQuantity: 0 })],
      unfilledOrders: [unfilled()],
      claimedCount: 0,
    });

    await expect(
      service.confirmCancellationNotAccepted('trade-cancel-unknown', {
        channel: BrokerOrderActionChannel.SLACK,
        actor: 'slack:U123',
      }),
    ).rejects.toThrow('state changed before confirmation');
    expect(tx.brokerOrderActionAuditLog.create).not.toHaveBeenCalled();
  });

  it('requires an actor and a valid stored broker date before any KIS read', async () => {
    const missingActor = setup();
    await expect(
      missingActor.service.inspectCancellation('trade-cancel-unknown', {
        channel: BrokerOrderActionChannel.WEB,
        actor: '   ',
      }),
    ).rejects.toThrow('Recovery actor is required');
    expect(missingActor.prisma.tradeRecord.findFirst).not.toHaveBeenCalled();

    const missingDate = setup({ storedRecord: record({ brokerOrderDate: null }) });
    await expect(
      missingDate.service.inspectCancellation('trade-cancel-unknown', context),
    ).rejects.toThrow('valid broker order date is required');
    expect(missingDate.domestic.getOrderExecutions).not.toHaveBeenCalled();
  });

  it('uses overseas complete GETs and canonical tuple matching without a POST', async () => {
    const storedRecord = record({
      market: 'OVERSEAS',
      exchangeCode: 'nasd',
      stockCode: 'tqqq',
      side: 'SELL',
      orderNo: 'OVERSEAS-1',
    });
    const { service, overseas, tx } = setup({
      storedRecord,
      executions: [execution({
        orderNo: ' OVERSEAS-1 ',
        stockCode: 'TQQQ',
        side: 'SELL',
        exchangeCode: 'NASD',
      })],
      unfilledOrders: [],
    });

    await service.inspectCancellation(storedRecord.id, context);

    expect(overseas.getOrderExecutions).toHaveBeenCalledWith('20260713', '20260713');
    expect(overseas.getUnfilledOrders).toHaveBeenCalledTimes(1);
    expect(overseas.cancelOrder).not.toHaveBeenCalled();
    expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ exchangeCode: 'NASD', orderNo: 'OVERSEAS-1' }),
    });
  });
});
