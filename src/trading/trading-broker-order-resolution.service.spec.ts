import {
  BrokerOrderAction,
  BrokerOrderActionChannel,
  OrderStatus,
  SubmissionResolution,
  WatchStockExecutionEventType,
} from '@prisma/client';
import { TradingBrokerOrderResolutionService } from './trading-broker-order-resolution.service';

describe('TradingBrokerOrderResolutionService', () => {
  const unknownRecord = {
    id: 'trade-unknown',
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    stockName: 'TQQQ',
    side: 'SELL',
    orderType: 'LIMIT',
    quantity: 3,
    price: 75,
    orderNo: null,
    status: OrderStatus.SUBMISSION_UNKNOWN,
    strategyName: 'infinite-buy',
    reason: 'approved take profit',
    submissionStartedAt: new Date('2026-07-13T15:00:00.000Z'),
    brokerOrderDate: null,
    brokerOrderTime: null,
    brokerEnvironment: 'PROD',
    brokerAccountHash: 'current-hash',
    brokerMessage: 'transport timeout',
    submissionResolvedAt: null,
    submissionResolvedBy: null,
    submissionResolution: null,
    cancellationStatus: null,
    cancellationStartedAt: null,
    cancellationResolvedAt: null,
    cancellationResolvedBy: null,
    cancellationMessage: null,
    createdAt: new Date('2026-07-13T14:59:00.000Z'),
    updatedAt: new Date('2026-07-13T15:01:00.000Z'),
  };
  const candidate = {
    orderNo: ' O-123 ',
    stockCode: 'TQQQ',
    side: 'SELL',
    orderQuantity: 3,
    filledQuantity: 0,
    remainingQuantity: 3,
    orderPrice: 75,
    exchangeCode: 'NASD',
    orderDate: '20260714',
    orderTime: '000100',
    rejectionState: 'UNKNOWN',
  };

  const build = (overrides: Record<string, any> = {}) => {
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(unknownRecord),
        findMany: jest.fn().mockResolvedValue([]),
      },
      watchStock: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      watchStockExecutionLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
      ...overrides,
    };
    const matcher = {
      findSubmissionCandidates: jest.fn().mockResolvedValue([candidate]),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'current-hash',
        maskedAccount: '****5678-01',
      }),
    };
    const service = new TradingBrokerOrderResolutionService(
      prisma as never,
      matcher as never,
      brokerContext as never,
    );
    return { service, prisma, matcher, brokerContext };
  };

  it('annotates exact and conservative legacy collisions without exposing account hashes', async () => {
    const { service, prisma } = build();
    prisma.tradeRecord.findMany
      .mockResolvedValueOnce([{
        id: 'existing-exact',
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'O-123',
        createdAt: new Date('2026-07-13T15:10:00.000Z'),
      }])
      .mockResolvedValueOnce([{
        id: 'existing-legacy',
        brokerOrderDate: null,
        exchangeCode: 'NYSE',
        orderNo: 'L-456',
        createdAt: new Date('2026-07-14T01:00:00.000Z'),
      }]);
    const legacyCandidate = {
      ...candidate,
      orderNo: 'L-456',
      exchangeCode: 'NYSE',
      orderDate: '20260714',
    };

    const result = await service.annotateCandidateCollisions(
      {
        tradeRecordId: 'trade-unknown',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 3,
        submissionStartedAt: unknownRecord.submissionStartedAt,
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'current-hash',
      } as never,
      [candidate, legacyCandidate] as never,
    );

    expect(result).toEqual([
      expect.objectContaining({
        existingTradeRecordId: 'existing-exact',
        collisionType: 'EXACT',
      }),
      expect.objectContaining({
        existingTradeRecordId: 'existing-legacy',
        collisionType: 'LEGACY',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('current-hash');
  });

  it('re-queries KIS and atomically links the selected broker identity exactly once', async () => {
    const resolvedRecord = {
      ...unknownRecord,
      status: OrderStatus.PENDING,
      orderNo: 'O-123',
      brokerOrderDate: '20260714',
      brokerOrderTime: '000100',
      submissionResolution: SubmissionResolution.LINKED_BROKER_ORDER,
      submissionResolvedAt: new Date(),
      submissionResolvedBy: 'web:eric',
    };
    const tx = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(resolvedRecord),
      },
      brokerOrderActionAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-link' }),
      },
    };
    const { service, prisma, matcher } = build({
      $transaction: jest.fn().mockImplementation((work) => work(tx)),
    });
    jest.spyOn(service, 'annotateCandidateCollisions')
      .mockResolvedValue([{ ...candidate, orderNo: 'O-123' }] as never);

    const result = await service.linkCandidate(
      {
        tradeRecordId: 'trade-unknown',
        brokerOrderDate: '20260714',
        exchangeCode: 'nasd',
        orderNo: 'O-123',
      },
      { channel: 'WEB', actor: 'web:eric' },
    );

    expect(matcher.findSubmissionCandidates).toHaveBeenCalledTimes(1);
    expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-unknown',
        status: OrderStatus.SUBMISSION_UNKNOWN,
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'current-hash',
      },
      data: {
        status: OrderStatus.PENDING,
        orderNo: 'O-123',
        brokerOrderDate: '20260714',
        brokerOrderTime: '000100',
        submissionResolvedAt: expect.any(Date),
        submissionResolvedBy: 'web:eric',
        submissionResolution: SubmissionResolution.LINKED_BROKER_ORDER,
        brokerMessage: 'Broker order linked by operator recovery',
      },
    });
    expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tradeRecordId: 'trade-unknown',
        channel: BrokerOrderActionChannel.WEB,
        action: BrokerOrderAction.BROKER_ORDER_LINKED,
        actor: 'web:eric',
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'O-123',
        beforeStatus: OrderStatus.SUBMISSION_UNKNOWN,
        afterStatus: OrderStatus.PENDING,
      }),
    });
    expect(result).toEqual(resolvedRecord);
    expect(prisma.watchStock.findFirst).toHaveBeenCalled();
  });

  it('refuses a selected identity that is absent from the mutation-time KIS read', async () => {
    const { service, prisma, matcher } = build();
    matcher.findSubmissionCandidates.mockResolvedValue([]);

    await expect(service.linkCandidate(
      {
        tradeRecordId: 'trade-unknown',
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'missing',
      },
      { channel: 'SLACK', actor: 'slack:U123' },
    )).rejects.toThrow(/no longer present/i);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an exact or legacy collision before changing the unknown record', async () => {
    const { service, prisma } = build();
    jest.spyOn(service, 'annotateCandidateCollisions').mockResolvedValue([{
      ...candidate,
      orderNo: 'O-123',
      existingTradeRecordId: 'existing-trade',
      collisionType: 'LEGACY',
    }] as never);

    await expect(service.linkCandidate(
      {
        tradeRecordId: 'trade-unknown',
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'O-123',
      },
      { channel: 'WEB', actor: 'web:eric' },
    )).rejects.toThrow(/existing-trade/);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates no audit when the SUBMISSION_UNKNOWN CAS loses', async () => {
    const tx = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
      brokerOrderActionAuditLog: { create: jest.fn() },
    };
    const { service } = build({
      $transaction: jest.fn().mockImplementation((work) => work(tx)),
    });
    jest.spyOn(service, 'annotateCandidateCollisions')
      .mockResolvedValue([{ ...candidate, orderNo: 'O-123' }] as never);

    await expect(service.linkCandidate(
      {
        tradeRecordId: 'trade-unknown',
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'O-123',
      },
      { channel: 'WEB', actor: 'web:eric' },
    )).rejects.toThrow(/state changed/i);

    expect(tx.brokerOrderActionAuditLog.create).not.toHaveBeenCalled();
  });

  it('translates a broker identity unique race without a second mutation', async () => {
    const uniqueError = Object.assign(new Error('unique'), { code: 'P2002' });
    const { service } = build({
      $transaction: jest.fn().mockRejectedValue(uniqueError),
    });
    jest.spyOn(service, 'annotateCandidateCollisions')
      .mockResolvedValue([{ ...candidate, orderNo: 'O-123' }] as never);

    await expect(service.linkCandidate(
      {
        tradeRecordId: 'trade-unknown',
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'O-123',
      },
      { channel: 'WEB', actor: 'web:eric' },
    )).rejects.toThrow(/already linked/i);
  });

  it('keeps the authoritative link when the best-effort WatchStock mirror fails', async () => {
    const resolvedRecord = {
      ...unknownRecord,
      status: OrderStatus.PENDING,
      orderNo: 'O-123',
      brokerOrderDate: '20260714',
      brokerOrderTime: '000100',
      submissionResolution: SubmissionResolution.LINKED_BROKER_ORDER,
    };
    const tx = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(resolvedRecord),
      },
      brokerOrderActionAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-link' }),
      },
    };
    const watchStock = { id: 'watch-1', strategyName: 'infinite-buy' };
    const { service, prisma } = build({
      $transaction: jest.fn().mockImplementation((work) => work(tx)),
      watchStock: { findFirst: jest.fn().mockResolvedValue(watchStock) },
      watchStockExecutionLog: {
        create: jest.fn().mockRejectedValue(new Error('mirror unavailable')),
      },
    });
    jest.spyOn(service, 'annotateCandidateCollisions')
      .mockResolvedValue([{ ...candidate, orderNo: 'O-123' }] as never);

    await expect(service.linkCandidate(
      {
        tradeRecordId: 'trade-unknown',
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'O-123',
      },
      { channel: 'WEB', actor: 'web:eric' },
    )).resolves.toEqual(resolvedRecord);

    expect(prisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        watchStockId: 'watch-1',
        tradeRecordId: 'trade-unknown',
        eventType: WatchStockExecutionEventType.ORDER_RECONCILIATION,
      }),
    });
  });

  describe('submission confirmation resolution', () => {
    it('confirms not submitted only after a complete zero-candidate KIS read', async () => {
      const resolvedRecord = {
        ...unknownRecord,
        status: OrderStatus.FAILED,
        brokerMessage: 'Operator confirmed no matching broker order',
        submissionResolution: SubmissionResolution.CONFIRMED_NOT_SUBMITTED,
        submissionResolvedAt: new Date('2026-07-13T15:05:00.000Z'),
        submissionResolvedBy: 'web:eric',
      };
      const tx = {
        tradeRecord: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue(resolvedRecord),
        },
        brokerOrderActionAuditLog: {
          create: jest.fn().mockResolvedValue({ id: 'audit-not-submitted' }),
        },
      };
      const { service, prisma, matcher } = build({
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
        watchStock: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'watch-1',
            strategyName: 'infinite-buy',
          }),
        },
      });
      matcher.findSubmissionCandidates.mockResolvedValue([]);

      const result = await service.confirmNotSubmitted(
        ' trade-unknown ',
        { channel: 'WEB', actor: ' web:eric ' },
      );

      expect(matcher.findSubmissionCandidates).toHaveBeenCalledTimes(1);
      expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-unknown',
          status: OrderStatus.SUBMISSION_UNKNOWN,
          brokerEnvironment: 'PROD',
          brokerAccountHash: 'current-hash',
        },
        data: {
          status: OrderStatus.FAILED,
          submissionResolvedAt: expect.any(Date),
          submissionResolvedBy: 'web:eric',
          submissionResolution: SubmissionResolution.CONFIRMED_NOT_SUBMITTED,
          brokerMessage: 'Operator confirmed no matching broker order',
        },
      });
      const updateData = tx.tradeRecord.updateMany.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('reason');
      expect(updateData).not.toHaveProperty('orderNo');
      expect(updateData).not.toHaveProperty('brokerOrderDate');
      expect(updateData).not.toHaveProperty('brokerOrderTime');
      expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
        data: {
          tradeRecordId: 'trade-unknown',
          channel: BrokerOrderActionChannel.WEB,
          action: BrokerOrderAction.CONFIRMED_NOT_SUBMITTED,
          actor: 'web:eric',
          beforeStatus: OrderStatus.SUBMISSION_UNKNOWN,
          afterStatus: OrderStatus.FAILED,
          details: {
            candidateCount: 0,
          },
        },
      });
      expect(result).toEqual(resolvedRecord);
      expect(prisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          watchStockId: 'watch-1',
          tradeRecordId: 'trade-unknown',
          eventType: WatchStockExecutionEventType.ORDER_RECONCILIATION,
          details: {
            action: BrokerOrderAction.CONFIRMED_NOT_SUBMITTED,
          },
        }),
      });
    });

    it('refuses not-submitted confirmation when any mutation-time candidate exists', async () => {
      const { service, prisma, matcher } = build();

      await expect(service.confirmNotSubmitted(
        'trade-unknown',
        { channel: 'SLACK', actor: 'slack:U123' },
      )).rejects.toThrow(/matching broker order.*candidate review/i);

      expect(matcher.findSubmissionCandidates).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('preserves unknown state when the complete KIS read for not-submitted fails', async () => {
      const { service, prisma, matcher } = build();
      matcher.findSubmissionCandidates.mockRejectedValue(
        new Error('incomplete KIS history page'),
      );

      await expect(service.confirmNotSubmitted(
        'trade-unknown',
        { channel: 'WEB', actor: 'web:eric' },
      )).rejects.toThrow('incomplete KIS history page');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechecks current broker context after the not-submitted KIS read', async () => {
      const { service, prisma, matcher, brokerContext } = build();
      matcher.findSubmissionCandidates.mockResolvedValue([]);
      brokerContext.getCurrentContext.mockReturnValue({
        environment: 'PAPER',
        accountHash: 'other-hash',
        maskedAccount: '****9999-01',
      });

      await expect(service.confirmNotSubmitted(
        'trade-unknown',
        { channel: 'WEB', actor: 'web:eric' },
      )).rejects.toThrow(/context changed/i);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('writes no audit or mirror when not-submitted loses the CAS race', async () => {
      const tx = {
        tradeRecord: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUnique: jest.fn(),
        },
        brokerOrderActionAuditLog: { create: jest.fn() },
      };
      const { service, prisma, matcher } = build({
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
      });
      matcher.findSubmissionCandidates.mockResolvedValue([]);

      await expect(service.confirmNotSubmitted(
        'trade-unknown',
        { channel: 'SLACK', actor: 'slack:U123' },
      )).rejects.toThrow(/state changed/i);

      expect(tx.brokerOrderActionAuditLog.create).not.toHaveBeenCalled();
      expect(tx.tradeRecord.findUnique).not.toHaveBeenCalled();
      expect(prisma.watchStock.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      {
        collisionType: 'EXACT',
        exactRows: [{
          id: 'existing-trade',
          brokerOrderDate: '20260714',
          exchangeCode: 'NASD',
          orderNo: 'O-123',
          createdAt: new Date('2026-07-13T15:10:00.000Z'),
        }],
        legacyRows: [],
      },
      {
        collisionType: 'LEGACY',
        exactRows: [],
        legacyRows: [{
          id: 'existing-trade',
          brokerOrderDate: null,
          exchangeCode: 'NASD',
          orderNo: 'O-123',
          createdAt: new Date('2026-07-14T01:00:00.000Z'),
        }],
      },
    ])('confirms a named $collisionType existing-record collision without attaching identity', async ({
      collisionType,
      exactRows,
      legacyRows,
    }) => {
      const resolvedRecord = {
        ...unknownRecord,
        status: OrderStatus.FAILED,
        brokerMessage: 'Operator confirmed broker order belongs to an existing TradeRecord',
        submissionResolution: SubmissionResolution.MATCHED_EXISTING_TRADE_RECORD,
        submissionResolvedAt: new Date('2026-07-13T15:05:00.000Z'),
        submissionResolvedBy: 'slack:U123',
      };
      const tx = {
        tradeRecord: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue(resolvedRecord),
        },
        brokerOrderActionAuditLog: {
          create: jest.fn().mockResolvedValue({ id: 'audit-existing' }),
        },
      };
      const { service, prisma, matcher } = build({
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
      });
      prisma.tradeRecord.findMany
        .mockResolvedValueOnce(exactRows)
        .mockResolvedValueOnce(legacyRows);

      const result = await service.confirmMatchesExisting(
        {
          tradeRecordId: ' trade-unknown ',
          brokerOrderDate: '20260714',
          exchangeCode: 'nasd',
          orderNo: ' O-123 ',
          existingTradeRecordId: ' existing-trade ',
        },
        { channel: 'SLACK', actor: ' slack:U123 ' },
      );

      expect(matcher.findSubmissionCandidates).toHaveBeenCalledTimes(1);
      expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-unknown',
          status: OrderStatus.SUBMISSION_UNKNOWN,
          brokerEnvironment: 'PROD',
          brokerAccountHash: 'current-hash',
        },
        data: {
          status: OrderStatus.FAILED,
          submissionResolvedAt: expect.any(Date),
          submissionResolvedBy: 'slack:U123',
          submissionResolution: SubmissionResolution.MATCHED_EXISTING_TRADE_RECORD,
          brokerMessage: 'Operator confirmed broker order belongs to an existing TradeRecord',
        },
      });
      const updateData = tx.tradeRecord.updateMany.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('reason');
      expect(updateData).not.toHaveProperty('orderNo');
      expect(updateData).not.toHaveProperty('brokerOrderDate');
      expect(updateData).not.toHaveProperty('brokerOrderTime');
      expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
        data: {
          tradeRecordId: 'trade-unknown',
          channel: BrokerOrderActionChannel.SLACK,
          action: BrokerOrderAction.MATCHED_EXISTING_TRADE_RECORD,
          actor: 'slack:U123',
          brokerOrderDate: '20260714',
          exchangeCode: 'NASD',
          orderNo: 'O-123',
          beforeStatus: OrderStatus.SUBMISSION_UNKNOWN,
          afterStatus: OrderStatus.FAILED,
          details: {
            existingTradeRecordId: 'existing-trade',
            collisionType,
          },
        },
      });
      expect(result).toEqual(resolvedRecord);
    });

    it('refuses existing-match when the named record is not the proven collision', async () => {
      const { service, prisma } = build();
      prisma.tradeRecord.findMany
        .mockResolvedValueOnce([{
          id: 'different-existing-trade',
          brokerOrderDate: '20260714',
          exchangeCode: 'NASD',
          orderNo: 'O-123',
          createdAt: new Date('2026-07-13T15:10:00.000Z'),
        }])
        .mockResolvedValueOnce([]);

      await expect(service.confirmMatchesExisting(
        {
          tradeRecordId: 'trade-unknown',
          brokerOrderDate: '20260714',
          exchangeCode: 'NASD',
          orderNo: 'O-123',
          existingTradeRecordId: 'existing-trade',
        },
        { channel: 'WEB', actor: 'web:eric' },
      )).rejects.toThrow(/does not match existing TradeRecord existing-trade/i);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses existing-match when the selected identity is absent at mutation time', async () => {
      const { service, prisma, matcher } = build();
      matcher.findSubmissionCandidates.mockResolvedValue([]);

      await expect(service.confirmMatchesExisting(
        {
          tradeRecordId: 'trade-unknown',
          brokerOrderDate: '20260714',
          exchangeCode: 'NASD',
          orderNo: 'O-123',
          existingTradeRecordId: 'existing-trade',
        },
        { channel: 'WEB', actor: 'web:eric' },
      )).rejects.toThrow(/no longer present/i);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('writes no second audit when existing-match loses the Slack/web CAS race', async () => {
      const tx = {
        tradeRecord: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUnique: jest.fn(),
        },
        brokerOrderActionAuditLog: { create: jest.fn() },
      };
      const { service, prisma } = build({
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
      });
      prisma.tradeRecord.findMany
        .mockResolvedValueOnce([{
          id: 'existing-trade',
          brokerOrderDate: '20260714',
          exchangeCode: 'NASD',
          orderNo: 'O-123',
          createdAt: new Date('2026-07-13T15:10:00.000Z'),
        }])
        .mockResolvedValueOnce([]);

      await expect(service.confirmMatchesExisting(
        {
          tradeRecordId: 'trade-unknown',
          brokerOrderDate: '20260714',
          exchangeCode: 'NASD',
          orderNo: 'O-123',
          existingTradeRecordId: 'existing-trade',
        },
        { channel: 'SLACK', actor: 'slack:U123' },
      )).rejects.toThrow(/state changed/i);

      expect(tx.brokerOrderActionAuditLog.create).not.toHaveBeenCalled();
      expect(prisma.watchStock.findFirst).not.toHaveBeenCalled();
    });
  });
});
