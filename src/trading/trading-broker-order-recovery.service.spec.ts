import {
  BrokerOrderAction,
  BrokerOrderActionChannel,
  CancellationAttemptStatus,
  OrderStatus,
} from '@prisma/client';
import { TradingBrokerOrderRecoveryService } from './trading-broker-order-recovery.service';

describe('TradingBrokerOrderRecoveryService', () => {
  describe('listRecoveryItems', () => {
    it('returns a DB-only deterministic queue for unknown submissions and cancellations', async () => {
      const submissionStartedAt = new Date('2026-07-13T00:00:00.000Z');
      const cancellationStartedAt = new Date('2026-07-13T01:00:00.000Z');
      const prisma = {
        tradeRecord: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'trade-submission-unknown',
              market: 'OVERSEAS',
              exchangeCode: 'NASD',
              stockCode: 'TQQQ',
              stockName: 'TQQQ',
              side: 'SELL',
              orderType: 'LIMIT',
              quantity: 4,
              price: { toString: () => '75.25' },
              orderNo: null,
              status: OrderStatus.SUBMISSION_UNKNOWN,
              submissionStartedAt,
              brokerOrderDate: null,
              brokerOrderTime: null,
              brokerEnvironment: 'PROD',
              brokerAccountHash: 'hash-only-never-returned',
              submissionResolvedAt: null,
              submissionResolvedBy: null,
              submissionResolution: null,
              cancellationStatus: null,
              cancellationStartedAt: null,
              cancellationResolvedAt: null,
              cancellationResolvedBy: null,
              cancellationMessage: null,
              createdAt: new Date('2026-07-13T00:00:00.000Z'),
              updatedAt: new Date('2026-07-13T00:01:00.000Z'),
            },
            {
              id: 'trade-cancellation-unknown',
              market: 'DOMESTIC',
              exchangeCode: 'KRX',
              stockCode: '005930',
              stockName: '삼성전자',
              side: 'BUY',
              orderType: 'LIMIT',
              quantity: 2,
              price: 70000,
              orderNo: '12345',
              status: OrderStatus.PARTIAL,
              submissionStartedAt: new Date('2026-07-13T00:30:00.000Z'),
              brokerOrderDate: '20260713',
              brokerOrderTime: '093000',
              brokerEnvironment: null,
              brokerAccountHash: null,
              submissionResolvedAt: null,
              submissionResolvedBy: null,
              submissionResolution: null,
              cancellationStatus: CancellationAttemptStatus.UNKNOWN,
              cancellationStartedAt,
              cancellationResolvedAt: null,
              cancellationResolvedBy: null,
              cancellationMessage: 'cancel transport timeout',
              createdAt: new Date('2026-07-13T00:30:00.000Z'),
              updatedAt: new Date('2026-07-13T01:01:00.000Z'),
            },
          ]),
        },
        $transaction: jest.fn(),
      };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PROD',
          accountHash: 'hash-only-never-returned',
          maskedAccount: '****5678-01',
        }),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        brokerContext as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const result = await service.listRecoveryItems();

      expect(prisma.tradeRecord.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { status: OrderStatus.SUBMISSION_UNKNOWN },
            { cancellationStatus: CancellationAttemptStatus.UNKNOWN },
          ],
        },
        orderBy: [
          { updatedAt: 'desc' },
          { id: 'desc' },
        ],
        select: expect.objectContaining({
          id: true,
          brokerEnvironment: true,
          brokerAccountHash: true,
        }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result).toEqual([
        expect.objectContaining({
          tradeRecordId: 'trade-submission-unknown',
          lifecycle: 'SUBMISSION',
          price: 75.25,
          status: OrderStatus.SUBMISSION_UNKNOWN,
          submissionStartedAt,
          brokerContextAssigned: true,
          currentBrokerEnvironment: null,
          maskedCurrentAccount: null,
          brokerContextMatchesCurrent: null,
        }),
        expect.objectContaining({
          tradeRecordId: 'trade-cancellation-unknown',
          lifecycle: 'CANCELLATION',
          price: 70000,
          status: OrderStatus.PARTIAL,
          cancellationStatus: CancellationAttemptStatus.UNKNOWN,
          cancellationStartedAt,
          brokerContextAssigned: false,
          currentBrokerEnvironment: null,
          maskedCurrentAccount: null,
          brokerContextMatchesCurrent: null,
        }),
      ]);
      expect(brokerContext.getCurrentContext).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('hash-only-never-returned');
    });

    it('treats a partially populated broker context as unassigned without reading KIS', async () => {
      const prisma = {
        tradeRecord: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'legacy-malformed-context',
              market: 'OVERSEAS',
              exchangeCode: 'NASD',
              stockCode: 'SOXL',
              stockName: 'SOXL',
              side: 'BUY',
              orderType: 'MARKET',
              quantity: 1,
              price: 0,
              orderNo: null,
              status: OrderStatus.SUBMISSION_UNKNOWN,
              submissionStartedAt: new Date('2026-07-13T02:00:00.000Z'),
              brokerOrderDate: null,
              brokerOrderTime: null,
              brokerEnvironment: 'PAPER',
              brokerAccountHash: null,
              submissionResolvedAt: null,
              submissionResolvedBy: null,
              submissionResolution: null,
              cancellationStatus: null,
              cancellationStartedAt: null,
              cancellationResolvedAt: null,
              cancellationResolvedBy: null,
              cancellationMessage: null,
              createdAt: new Date('2026-07-13T02:00:00.000Z'),
              updatedAt: new Date('2026-07-13T02:00:00.000Z'),
            },
          ]),
        },
      };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'paper-hash',
          maskedAccount: '****1111-01',
        }),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        brokerContext as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.listRecoveryItems()).resolves.toEqual([
        expect.objectContaining({
          tradeRecordId: 'legacy-malformed-context',
          brokerContextAssigned: false,
          currentBrokerEnvironment: null,
          maskedCurrentAccount: null,
          brokerContextMatchesCurrent: null,
        }),
      ]);
      expect(brokerContext.getCurrentContext).not.toHaveBeenCalled();
    });
  });

  describe('assignCurrentContext', () => {
    it('rejects a context token from a different preview before starting a transaction', async () => {
      const prisma = { $transaction: jest.fn() };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PROD',
          accountHash: 'current-account-hash',
          maskedAccount: '****5678-01',
        }),
        matchesContextBindingToken: jest.fn().mockReturnValue(false),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        brokerContext as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.assignCurrentContext(
        'legacy-stale-preview',
        'stale-context-token',
        { channel: 'WEB', actor: 'web:eric' },
      )).rejects.toThrow(/preview.*context changed/i);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('atomically assigns the current legacy context and writes a safe audit row', async () => {
      const unresolvedRecord = {
        id: 'legacy-unknown',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        side: 'SELL',
        orderType: 'LIMIT',
        quantity: 2,
        price: 75,
        orderNo: null,
        status: OrderStatus.SUBMISSION_UNKNOWN,
        submissionStartedAt: new Date('2026-07-13T02:00:00.000Z'),
        brokerOrderDate: null,
        brokerOrderTime: null,
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'current-account-hash',
        submissionResolvedAt: null,
        submissionResolvedBy: null,
        submissionResolution: null,
        cancellationStatus: null,
        cancellationStartedAt: null,
        cancellationResolvedAt: null,
        cancellationResolvedBy: null,
        cancellationMessage: null,
        createdAt: new Date('2026-07-13T01:59:00.000Z'),
        updatedAt: new Date('2026-07-13T02:01:00.000Z'),
      };
      const tx = {
        tradeRecord: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue(unresolvedRecord),
        },
        brokerOrderActionAuditLog: {
          create: jest.fn().mockResolvedValue({ id: 'audit-context' }),
        },
      };
      const prisma = {
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
      };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PROD',
          accountHash: 'current-account-hash',
          maskedAccount: '****5678-01',
        }),
        matchesContextBindingToken: jest.fn().mockReturnValue(true),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        brokerContext as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.assignCurrentContext(
        'legacy-unknown',
        'preview-context-token',
        { channel: 'WEB', actor: 'web:eric' },
      )).resolves.toEqual(expect.objectContaining({
        tradeRecordId: 'legacy-unknown',
        brokerContextAssigned: true,
      }));

      expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'legacy-unknown',
          brokerEnvironment: null,
          brokerAccountHash: null,
          OR: [
            { status: OrderStatus.SUBMISSION_UNKNOWN },
            { cancellationStatus: CancellationAttemptStatus.UNKNOWN },
          ],
        },
        data: {
          brokerEnvironment: 'PROD',
          brokerAccountHash: 'current-account-hash',
        },
      });
      expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
        data: {
          tradeRecordId: 'legacy-unknown',
          channel: BrokerOrderActionChannel.WEB,
          action: BrokerOrderAction.LEGACY_CONTEXT_ASSIGNED,
          actor: 'web:eric',
          beforeStatus: OrderStatus.SUBMISSION_UNKNOWN,
          afterStatus: OrderStatus.SUBMISSION_UNKNOWN,
          details: {
            environment: 'PROD',
            maskedAccount: '****5678-01',
          },
        },
      });
      expect(JSON.stringify(tx.brokerOrderActionAuditLog.create.mock.calls))
        .not.toContain('current-account-hash');
    });

    it('fails closed without an audit when legacy context assignment loses its CAS', async () => {
      const tx = {
        tradeRecord: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUnique: jest.fn(),
        },
        brokerOrderActionAuditLog: {
          create: jest.fn(),
        },
      };
      const prisma = {
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
      };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'paper-account-hash',
          maskedAccount: '****1111-01',
        }),
        matchesContextBindingToken: jest.fn().mockReturnValue(true),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        brokerContext as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.assignCurrentContext(
        'already-assigned-or-resolved',
        'preview-context-token',
        { channel: 'SLACK', actor: 'slack:U123' },
      )).rejects.toThrow(/context assignment.*state changed/i);

      expect(tx.brokerOrderActionAuditLog.create).not.toHaveBeenCalled();
      expect(tx.tradeRecord.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('inspectCandidates', () => {
    const unknownRecord = {
      id: 'trade-inspect',
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
      submissionStartedAt: new Date('2026-07-13T15:00:00.000Z'),
      brokerOrderDate: null,
      brokerOrderTime: null,
      brokerEnvironment: 'PROD',
      brokerAccountHash: 'current-hash',
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

    it('audits a complete read and returns candidates without linking one', async () => {
      const candidates = [{
        orderNo: 'O-123',
        stockCode: 'TQQQ',
        side: 'SELL',
        orderQuantity: 3,
        filledQuantity: 0,
        remainingQuantity: 3,
        exchangeCode: 'NASD',
        orderDate: '20260714',
        orderTime: '000100',
        rejectionState: 'UNKNOWN',
      }];
      const tx = {
        tradeRecord: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'trade-inspect',
            status: OrderStatus.SUBMISSION_UNKNOWN,
          }),
        },
        brokerOrderActionAuditLog: {
          create: jest.fn().mockResolvedValue({ id: 'audit-inspection' }),
        },
      };
      const prisma = {
        tradeRecord: {
          findFirst: jest.fn().mockResolvedValue(unknownRecord),
        },
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
      };
      const matcher = {
        findSubmissionCandidates: jest.fn().mockResolvedValue(candidates),
      };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PROD',
          accountHash: 'current-hash',
          maskedAccount: '****5678-01',
        }),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        brokerContext as never,
        matcher as never,
        {
          annotateCandidateCollisions: jest.fn(
            (_request: unknown, values: unknown) => Promise.resolve(values),
          ),
        } as never,
        {} as never,
        {} as never,
      );

      const result = await service.inspectCandidates(
        'trade-inspect',
        { channel: 'WEB', actor: 'web:eric' },
      );

      expect(matcher.findSubmissionCandidates).toHaveBeenCalledWith({
        tradeRecordId: 'trade-inspect',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 3,
        submissionStartedAt: unknownRecord.submissionStartedAt,
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'current-hash',
      });
      expect(tx.tradeRecord.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'trade-inspect',
          status: OrderStatus.SUBMISSION_UNKNOWN,
          brokerEnvironment: 'PROD',
          brokerAccountHash: 'current-hash',
        },
        select: { id: true, status: true },
      });
      expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
        data: {
          tradeRecordId: 'trade-inspect',
          channel: BrokerOrderActionChannel.WEB,
          action: BrokerOrderAction.CANDIDATES_INSPECTED,
          actor: 'web:eric',
          beforeStatus: OrderStatus.SUBMISSION_UNKNOWN,
          afterStatus: OrderStatus.SUBMISSION_UNKNOWN,
          details: {
            candidateCount: 1,
            candidates: [{
              brokerOrderDate: '20260714',
              exchangeCode: 'NASD',
              orderNo: 'O-123',
              rejectionState: 'UNKNOWN',
            }],
          },
        },
      });
      expect(result).toEqual({
        recoveryItem: expect.objectContaining({
          tradeRecordId: 'trade-inspect',
          status: OrderStatus.SUBMISSION_UNKNOWN,
        }),
        candidates,
        inspectedAt: expect.any(Date),
      });
    });

    it('rechecks the live broker context after the GET and before writing the audit', async () => {
      const prisma = {
        tradeRecord: {
          findFirst: jest.fn().mockResolvedValue(unknownRecord),
        },
        $transaction: jest.fn(),
      };
      const matcher = {
        findSubmissionCandidates: jest.fn().mockResolvedValue([]),
      };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PROD',
          accountHash: 'changed-account-hash',
          maskedAccount: '****9999-01',
        }),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        brokerContext as never,
        matcher as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.inspectCandidates(
        'trade-inspect',
        { channel: 'WEB', actor: 'web:eric' },
      )).rejects.toThrow(/context changed during candidate inspection/i);

      expect(matcher.findSubmissionCandidates).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('writes no audit when the submission state changes after the GET', async () => {
      const tx = {
        tradeRecord: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        brokerOrderActionAuditLog: {
          create: jest.fn(),
        },
      };
      const prisma = {
        tradeRecord: {
          findFirst: jest.fn().mockResolvedValue(unknownRecord),
        },
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
      };
      const matcher = {
        findSubmissionCandidates: jest.fn().mockResolvedValue([]),
      };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PROD',
          accountHash: 'current-hash',
          maskedAccount: '****5678-01',
        }),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        brokerContext as never,
        matcher as never,
        {
          annotateCandidateCollisions: jest.fn(
            (_request: unknown, values: unknown) => Promise.resolve(values),
          ),
        } as never,
        {} as never,
        {} as never,
      );

      await expect(service.inspectCandidates(
        'trade-inspect',
        { channel: 'WEB', actor: 'web:eric' },
      )).rejects.toThrow(/state changed before audit/i);

      expect(tx.brokerOrderActionAuditLog.create).not.toHaveBeenCalled();
    });

    it('writes no audit or state change when the complete broker read fails', async () => {
      const prisma = {
        tradeRecord: {
          findFirst: jest.fn().mockResolvedValue(unknownRecord),
        },
        $transaction: jest.fn(),
      };
      const matcher = {
        findSubmissionCandidates: jest.fn().mockRejectedValue(
          new Error('incomplete page 2'),
        ),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        {} as never,
        matcher as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.inspectCandidates(
        'trade-inspect',
        { channel: 'SLACK', actor: 'slack:U123' },
      )).rejects.toThrow('incomplete page 2');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses non-unknown records before reading broker history', async () => {
      const prisma = {
        tradeRecord: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      const matcher = {
        findSubmissionCandidates: jest.fn(),
      };
      const service = new TradingBrokerOrderRecoveryService(
        prisma as never,
        {} as never,
        matcher as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(service.inspectCandidates(
        'resolved-trade',
        { channel: 'WEB', actor: 'web:eric' },
      )).rejects.toThrow(/not an unresolved submission/i);

      expect(matcher.findSubmissionCandidates).not.toHaveBeenCalled();
    });
  });

  it('delegates candidate linking once and maps the durable record without another mutation', async () => {
    const resolvedRecord = {
      id: 'trade-linked',
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      side: 'SELL',
      orderType: 'LIMIT',
      quantity: 3,
      price: 75,
      orderNo: 'O-123',
      status: OrderStatus.PENDING,
      submissionStartedAt: new Date('2026-07-13T15:00:00.000Z'),
      brokerOrderDate: '20260714',
      brokerOrderTime: '000100',
      brokerEnvironment: 'PROD',
      brokerAccountHash: 'current-hash',
      submissionResolvedAt: new Date('2026-07-13T15:05:00.000Z'),
      submissionResolvedBy: 'web:eric',
      submissionResolution: 'LINKED_BROKER_ORDER',
      cancellationStatus: null,
      cancellationStartedAt: null,
      cancellationResolvedAt: null,
      cancellationResolvedBy: null,
      cancellationMessage: null,
      createdAt: new Date('2026-07-13T14:59:00.000Z'),
      updatedAt: new Date('2026-07-13T15:05:00.000Z'),
    };
    const resolution = {
      linkCandidate: jest.fn().mockResolvedValue(resolvedRecord),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'current-hash',
        maskedAccount: '****5678-01',
      }),
    };
    const service = new TradingBrokerOrderRecoveryService(
      {} as never,
      brokerContext as never,
      {} as never,
      resolution as never,
      {} as never,
      {} as never,
    );
    const input = {
      tradeRecordId: 'trade-linked',
      brokerOrderDate: '20260714',
      exchangeCode: 'NASD',
      orderNo: 'O-123',
    };
    const context = { channel: 'WEB', actor: 'web:eric' } as const;

    await expect(service.linkCandidate(input, context)).resolves.toEqual(
      expect.objectContaining({
        tradeRecordId: 'trade-linked',
        status: OrderStatus.PENDING,
        orderNo: 'O-123',
        brokerContextMatchesCurrent: true,
      }),
    );
    expect(resolution.linkCandidate).toHaveBeenCalledTimes(1);
    expect(resolution.linkCandidate).toHaveBeenCalledWith(input, context);
  });

  it('delegates not-submitted confirmation once and maps the durable record', async () => {
    const resolvedRecord = {
      id: 'trade-not-submitted',
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      side: 'SELL',
      orderType: 'LIMIT',
      quantity: 3,
      price: 75,
      orderNo: null,
      status: OrderStatus.FAILED,
      submissionStartedAt: new Date('2026-07-13T15:00:00.000Z'),
      brokerOrderDate: null,
      brokerOrderTime: null,
      brokerEnvironment: 'PROD',
      brokerAccountHash: 'current-hash',
      submissionResolvedAt: new Date('2026-07-13T15:05:00.000Z'),
      submissionResolvedBy: 'web:eric',
      submissionResolution: 'CONFIRMED_NOT_SUBMITTED',
      cancellationStatus: null,
      cancellationStartedAt: null,
      cancellationResolvedAt: null,
      cancellationResolvedBy: null,
      cancellationMessage: null,
      createdAt: new Date('2026-07-13T14:59:00.000Z'),
      updatedAt: new Date('2026-07-13T15:05:00.000Z'),
    };
    const resolution = {
      confirmNotSubmitted: jest.fn().mockResolvedValue(resolvedRecord),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'current-hash',
        maskedAccount: '****5678-01',
      }),
    };
    const service = new TradingBrokerOrderRecoveryService(
      {} as never,
      brokerContext as never,
      {} as never,
      resolution as never,
      {} as never,
      {} as never,
    );
    const context = { channel: 'WEB', actor: 'web:eric' } as const;

    await expect(service.confirmNotSubmitted(
      'trade-not-submitted',
      context,
    )).resolves.toEqual(expect.objectContaining({
      tradeRecordId: 'trade-not-submitted',
      status: OrderStatus.FAILED,
      submissionResolution: 'CONFIRMED_NOT_SUBMITTED',
      brokerContextMatchesCurrent: true,
    }));
    expect(resolution.confirmNotSubmitted).toHaveBeenCalledTimes(1);
    expect(resolution.confirmNotSubmitted).toHaveBeenCalledWith(
      'trade-not-submitted',
      context,
    );
  });

  it('delegates existing-record confirmation once and maps the durable record', async () => {
    const resolvedRecord = {
      id: 'trade-matched-existing',
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      side: 'SELL',
      orderType: 'LIMIT',
      quantity: 3,
      price: 75,
      orderNo: null,
      status: OrderStatus.FAILED,
      submissionStartedAt: new Date('2026-07-13T15:00:00.000Z'),
      brokerOrderDate: null,
      brokerOrderTime: null,
      brokerEnvironment: 'PROD',
      brokerAccountHash: 'current-hash',
      submissionResolvedAt: new Date('2026-07-13T15:05:00.000Z'),
      submissionResolvedBy: 'slack:U123',
      submissionResolution: 'MATCHED_EXISTING_TRADE_RECORD',
      cancellationStatus: null,
      cancellationStartedAt: null,
      cancellationResolvedAt: null,
      cancellationResolvedBy: null,
      cancellationMessage: null,
      createdAt: new Date('2026-07-13T14:59:00.000Z'),
      updatedAt: new Date('2026-07-13T15:05:00.000Z'),
    };
    const resolution = {
      confirmMatchesExisting: jest.fn().mockResolvedValue(resolvedRecord),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'current-hash',
        maskedAccount: '****5678-01',
      }),
    };
    const service = new TradingBrokerOrderRecoveryService(
      {} as never,
      brokerContext as never,
      {} as never,
      resolution as never,
      {} as never,
      {} as never,
    );
    const input = {
      tradeRecordId: 'trade-matched-existing',
      brokerOrderDate: '20260714',
      exchangeCode: 'NASD',
      orderNo: 'O-123',
      existingTradeRecordId: 'existing-trade',
    };
    const context = { channel: 'SLACK', actor: 'slack:U123' } as const;

    await expect(service.confirmMatchesExisting(input, context)).resolves.toEqual(
      expect.objectContaining({
        tradeRecordId: 'trade-matched-existing',
        status: OrderStatus.FAILED,
        submissionResolution: 'MATCHED_EXISTING_TRADE_RECORD',
        brokerContextMatchesCurrent: true,
      }),
    );
    expect(resolution.confirmMatchesExisting).toHaveBeenCalledTimes(1);
    expect(resolution.confirmMatchesExisting).toHaveBeenCalledWith(input, context);
  });

  it('delegates cancellation inspection once and maps only safe current context metadata', async () => {
    const cancellationRecord = {
      id: 'trade-cancellation-unknown',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 2,
      price: 70000,
      orderNo: 'K-123',
      status: OrderStatus.PENDING,
      submissionStartedAt: new Date('2026-07-13T00:30:00.000Z'),
      brokerOrderDate: '20260713',
      brokerOrderTime: '093000',
      brokerEnvironment: 'PROD',
      brokerAccountHash: 'current-secret-hash',
      submissionResolvedAt: null,
      submissionResolvedBy: null,
      submissionResolution: null,
      cancellationStatus: CancellationAttemptStatus.UNKNOWN,
      cancellationStartedAt: new Date('2026-07-13T01:00:00.000Z'),
      cancellationResolvedAt: null,
      cancellationResolvedBy: null,
      cancellationMessage: 'cancel outcome unknown',
      createdAt: new Date('2026-07-13T00:30:00.000Z'),
      updatedAt: new Date('2026-07-13T01:01:00.000Z'),
    };
    const cancellationRecovery = {
      inspectCancellation: jest.fn().mockResolvedValue(cancellationRecord),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'current-secret-hash',
        maskedAccount: '****5678-01',
      }),
    };
    const service = new TradingBrokerOrderRecoveryService(
      {} as never,
      brokerContext as never,
      {} as never,
      {} as never,
      cancellationRecovery as never,
      {} as never,
    );
    const context = { channel: 'WEB', actor: 'web:eric' } as const;

    const result = await service.inspectCancellation(
      'trade-cancellation-unknown',
      context,
    );

    expect(cancellationRecovery.inspectCancellation).toHaveBeenCalledTimes(1);
    expect(cancellationRecovery.inspectCancellation).toHaveBeenCalledWith(
      'trade-cancellation-unknown',
      context,
    );
    expect(result).toEqual(expect.objectContaining({
      tradeRecordId: 'trade-cancellation-unknown',
      lifecycle: 'CANCELLATION',
      cancellationStatus: CancellationAttemptStatus.UNKNOWN,
      currentBrokerEnvironment: 'PROD',
      maskedCurrentAccount: '****5678-01',
      brokerContextMatchesCurrent: true,
    }));
    expect(JSON.stringify(result)).not.toContain('current-secret-hash');
  });

  it('delegates cancellation-not-accepted confirmation once and keeps cancellation lifecycle metadata', async () => {
    const resolvedRecord = {
      id: 'trade-cancellation-rejected',
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 2,
      price: 70000,
      orderNo: 'K-123',
      status: OrderStatus.PENDING,
      submissionStartedAt: new Date('2026-07-13T00:30:00.000Z'),
      brokerOrderDate: '20260713',
      brokerOrderTime: '093000',
      brokerEnvironment: 'PROD',
      brokerAccountHash: 'current-secret-hash',
      submissionResolvedAt: null,
      submissionResolvedBy: null,
      submissionResolution: null,
      cancellationStatus: CancellationAttemptStatus.REJECTED,
      cancellationStartedAt: new Date('2026-07-13T01:00:00.000Z'),
      cancellationResolvedAt: new Date('2026-07-13T01:05:00.000Z'),
      cancellationResolvedBy: 'slack:U123',
      cancellationMessage: 'Operator confirmed cancellation was not accepted',
      createdAt: new Date('2026-07-13T00:30:00.000Z'),
      updatedAt: new Date('2026-07-13T01:05:00.000Z'),
    };
    const cancellationRecovery = {
      confirmCancellationNotAccepted: jest.fn().mockResolvedValue(resolvedRecord),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'current-secret-hash',
        maskedAccount: '****5678-01',
      }),
    };
    const service = new TradingBrokerOrderRecoveryService(
      {} as never,
      brokerContext as never,
      {} as never,
      {} as never,
      cancellationRecovery as never,
      {} as never,
    );
    const context = { channel: 'SLACK', actor: 'slack:U123' } as const;

    const result = await service.confirmCancellationNotAccepted(
      'trade-cancellation-rejected',
      context,
    );

    expect(cancellationRecovery.confirmCancellationNotAccepted).toHaveBeenCalledTimes(1);
    expect(cancellationRecovery.confirmCancellationNotAccepted).toHaveBeenCalledWith(
      'trade-cancellation-rejected',
      context,
    );
    expect(result).toEqual(expect.objectContaining({
      tradeRecordId: 'trade-cancellation-rejected',
      lifecycle: 'CANCELLATION',
      status: OrderStatus.PENDING,
      cancellationStatus: CancellationAttemptStatus.REJECTED,
      currentBrokerEnvironment: 'PROD',
      maskedCurrentAccount: '****5678-01',
      brokerContextMatchesCurrent: true,
    }));
    expect(JSON.stringify(result)).not.toContain('current-secret-hash');
  });

  it('atomically marks an attempted submission unknown and writes its audit row', async () => {
    const tx = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      brokerOrderActionAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((work) => work(tx)),
    };
    const recoverySlackAlert = {
      notifyUnknown: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TradingBrokerOrderRecoveryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      recoverySlackAlert as never,
    );

    await expect(
      service.markSubmissionUnknown('trade-1', 'transport timeout'),
    ).resolves.toBe(true);

    expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-1',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: { not: null },
      },
      data: {
        status: OrderStatus.SUBMISSION_UNKNOWN,
        brokerMessage: 'transport timeout',
      },
    });
    expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
      data: {
        tradeRecordId: 'trade-1',
        channel: BrokerOrderActionChannel.SYSTEM,
        action: BrokerOrderAction.UNKNOWN_DETECTED,
        actor: 'system',
        beforeStatus: OrderStatus.SUBMITTING,
        afterStatus: OrderStatus.SUBMISSION_UNKNOWN,
        details: { message: 'transport timeout' },
      },
    });
    expect(recoverySlackAlert.notifyUnknown).toHaveBeenCalledTimes(1);
    expect(recoverySlackAlert.notifyUnknown).toHaveBeenCalledWith('trade-1');
  });

  it('does not alert when submission UNKNOWN loses its CAS', async () => {
    const tx = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      brokerOrderActionAuditLog: {
        create: jest.fn(),
      },
    };
    const recoverySlackAlert = { notifyUnknown: jest.fn() };
    const service = new TradingBrokerOrderRecoveryService(
      {
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      recoverySlackAlert as never,
    );

    await expect(
      service.markSubmissionUnknown('trade-loser', 'transport timeout'),
    ).resolves.toBe(false);

    expect(tx.brokerOrderActionAuditLog.create).not.toHaveBeenCalled();
    expect(recoverySlackAlert.notifyUnknown).not.toHaveBeenCalled();
  });

  it('claims one cancellation attempt only from an open non-blocking lifecycle', async () => {
    const prisma = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new TradingBrokerOrderRecoveryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.claimCancellation('trade-1')).resolves.toBe(true);

    expect(prisma.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-1',
        status: { in: [OrderStatus.PENDING, OrderStatus.PARTIAL] },
        orderNo: { not: null },
        OR: [
          { cancellationStatus: null },
          {
            cancellationStatus: {
              in: [
                CancellationAttemptStatus.REJECTED,
                CancellationAttemptStatus.RESOLVED,
              ],
            },
          },
        ],
      },
      data: {
        cancellationStatus: CancellationAttemptStatus.SUBMITTING,
        cancellationStartedAt: expect.any(Date),
        cancellationResolvedAt: null,
        cancellationResolvedBy: null,
        cancellationMessage: null,
      },
    });
  });

  it('atomically marks cancellation UNKNOWN with audit while preserving the original order status', async () => {
    const tx = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      brokerOrderActionAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'cancel-audit' }),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((work) => work(tx)),
    };
    const recoverySlackAlert = {
      notifyUnknown: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TradingBrokerOrderRecoveryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      recoverySlackAlert as never,
    );

    await expect(
      service.markCancellationUnknown('trade-cancel', 'network timeout'),
    ).resolves.toBe(true);

    expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-cancel',
        cancellationStatus: CancellationAttemptStatus.SUBMITTING,
      },
      data: {
        cancellationStatus: CancellationAttemptStatus.UNKNOWN,
        cancellationMessage: 'network timeout',
      },
    });
    expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
      data: {
        tradeRecordId: 'trade-cancel',
        channel: BrokerOrderActionChannel.SYSTEM,
        action: BrokerOrderAction.CANCELLATION_UNKNOWN,
        actor: 'system',
        details: { message: 'network timeout' },
      },
    });
    expect(recoverySlackAlert.notifyUnknown).toHaveBeenCalledTimes(1);
    expect(recoverySlackAlert.notifyUnknown).toHaveBeenCalledWith('trade-cancel');
  });

  it('does not alert when cancellation UNKNOWN loses its CAS', async () => {
    const tx = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      brokerOrderActionAuditLog: {
        create: jest.fn(),
      },
    };
    const recoverySlackAlert = { notifyUnknown: jest.fn() };
    const service = new TradingBrokerOrderRecoveryService(
      {
        $transaction: jest.fn().mockImplementation((work) => work(tx)),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      recoverySlackAlert as never,
    );

    await expect(
      service.markCancellationUnknown('cancel-loser', 'network timeout'),
    ).resolves.toBe(false);

    expect(tx.brokerOrderActionAuditLog.create).not.toHaveBeenCalled();
    expect(recoverySlackAlert.notifyUnknown).not.toHaveBeenCalled();
  });

  it('takes over cold-start cancellation SUBMITTING rows as UNKNOWN without a broker POST', async () => {
    const prisma = {
      tradeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'cancel-stale-1' },
          { id: 'cancel-stale-2' },
        ]),
      },
    };
    const recoverySlackAlert = { notifyUnknown: jest.fn() };
    const service = new TradingBrokerOrderRecoveryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      recoverySlackAlert as never,
    );
    const markUnknown = jest
      .spyOn(service, 'markCancellationUnknown')
      .mockResolvedValue(true);

    await expect(service.takeOverCancellationAttempts()).resolves.toBe(2);

    expect(prisma.tradeRecord.findMany).toHaveBeenCalledWith({
      where: { cancellationStatus: CancellationAttemptStatus.SUBMITTING },
      select: { id: true },
    });
    expect(markUnknown).toHaveBeenCalledTimes(2);
    expect(markUnknown).toHaveBeenNthCalledWith(
      1,
      'cancel-stale-1',
      'Cold-start takeover of unfinished cancellation',
      false,
    );
    expect(markUnknown).toHaveBeenNthCalledWith(
      2,
      'cancel-stale-2',
      'Cold-start takeover of unfinished cancellation',
      false,
    );
    expect(recoverySlackAlert.notifyUnknown).not.toHaveBeenCalled();
  });

  it('takes over cold-start submissions based on whether the KIS claim timestamp exists', async () => {
    const tx = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      brokerOrderActionAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-pre-submit-cancelled' }),
      },
    };
    const prisma = {
      tradeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'submission-attempted', submissionStartedAt: new Date('2026-07-13T01:00:00Z') },
          { id: 'submission-not-started', submissionStartedAt: null },
        ]),
      },
      $transaction: jest.fn().mockImplementation((work) => work(tx)),
    };
    const recoverySlackAlert = { notifyUnknown: jest.fn() };
    const service = new TradingBrokerOrderRecoveryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      recoverySlackAlert as never,
    );
    const markUnknown = jest
      .spyOn(service, 'markSubmissionUnknown')
      .mockResolvedValue(true);

    await expect(service.takeOverSubmissionAttempts()).resolves.toEqual({
      unknown: 1,
      cancelled: 1,
    });

    expect(prisma.tradeRecord.findMany).toHaveBeenCalledWith({
      where: { status: OrderStatus.SUBMITTING },
      select: { id: true, submissionStartedAt: true },
    });
    expect(markUnknown).toHaveBeenCalledWith(
      'submission-attempted',
      'Cold-start takeover of attempted order submission',
      false,
    );
    expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'submission-not-started',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: {
        status: OrderStatus.CANCELLED,
        brokerMessage: 'Cold-start cancelled before broker submission',
      },
    });
    expect(tx.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
      data: {
        tradeRecordId: 'submission-not-started',
        channel: BrokerOrderActionChannel.SYSTEM,
        action: BrokerOrderAction.CONFIRMED_NOT_SUBMITTED,
        actor: 'system',
        beforeStatus: OrderStatus.SUBMITTING,
        afterStatus: OrderStatus.CANCELLED,
        details: {
          message: 'Cold-start cancelled before broker submission',
        },
      },
    });
    expect(recoverySlackAlert.notifyUnknown).not.toHaveBeenCalled();
  });

  it('runs one cold-start takeover and sends one aggregate unresolved warning', async () => {
    const prisma = {
      tradeRecord: {
        count: jest.fn().mockResolvedValue(7),
      },
    };
    const recoverySlackAlert = {
      notifyStartupSummary: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TradingBrokerOrderRecoveryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      recoverySlackAlert as never,
    );
    jest.spyOn(service, 'takeOverSubmissionAttempts').mockResolvedValue({
      unknown: 2,
      cancelled: 1,
    });
    jest.spyOn(service, 'takeOverCancellationAttempts').mockResolvedValue(3);

    await expect(service.takeOverStartupState()).resolves.toEqual({
      submissionUnknown: 2,
      submissionCancelled: 1,
      cancellationUnknown: 3,
      unresolvedCount: 7,
    });

    expect(prisma.tradeRecord.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { status: OrderStatus.SUBMISSION_UNKNOWN },
          { cancellationStatus: CancellationAttemptStatus.UNKNOWN },
        ],
      },
    });
    expect(recoverySlackAlert.notifyStartupSummary).toHaveBeenCalledTimes(1);
    expect(recoverySlackAlert.notifyStartupSummary).toHaveBeenCalledWith(7);
  });

  it('sends accepted-order persistence exhaustion warnings best effort with safe identifiers', async () => {
    const slack = {
      sendBrokerOrderPersistenceWarning: jest.fn().mockRejectedValue(new Error('slack down')),
    };
    const service = new TradingBrokerOrderRecoveryService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      slack as never,
    );

    await expect(service.warnAcceptedOrderPersistenceFailure({
      market: 'DOMESTIC',
      stockCode: '005930',
      tradeRecordId: 'trade-db-failure',
      orderNo: 'broker-known-order',
    })).resolves.toBeUndefined();

    expect(slack.sendBrokerOrderPersistenceWarning).toHaveBeenCalledWith({
      market: 'DOMESTIC',
      stockCode: '005930',
      tradeRecordId: 'trade-db-failure',
      orderNo: 'broker-known-order',
    });
  });
});
