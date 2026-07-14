import {
  CancellationAttemptStatus,
  OrderStatus,
} from '@prisma/client';
import { TradingBrokerRecoverySlackAlertService } from './trading-broker-recovery-slack-alert.service';

describe('TradingBrokerRecoverySlackAlertService', () => {
  const submissionRecord = {
    id: 'trade-submission-unknown',
    market: 'OVERSEAS',
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    stockName: 'TQQQ',
    side: 'SELL',
    quantity: 3,
    price: 75.25,
    status: OrderStatus.SUBMISSION_UNKNOWN,
    submissionStartedAt: new Date('2026-07-13T15:00:00.000Z'),
    cancellationStatus: null,
    cancellationStartedAt: null,
    brokerEnvironment: 'PROD',
    brokerAccountHash: 'must-never-leave-service',
  };

  const build = (record: Record<string, unknown> | null = submissionRecord) => {
    const prisma = {
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(record),
      },
    };
    const presentation = {
      sendUnknownAlert: jest.fn().mockResolvedValue({
        channel: 'C123',
        messageTs: '123.456',
      }),
      sendStartupSummary: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TradingBrokerRecoverySlackAlertService(
      prisma as never,
      presentation as never,
    );
    return { service, prisma, presentation };
  };

  it('loads only an unresolved row and emits a safe submission alert', async () => {
    const { service, prisma, presentation } = build();

    await expect(service.notifyUnknown('trade-submission-unknown'))
      .resolves.toBeUndefined();

    expect(prisma.tradeRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'trade-submission-unknown',
        OR: [
          { status: OrderStatus.SUBMISSION_UNKNOWN },
          { cancellationStatus: CancellationAttemptStatus.UNKNOWN },
        ],
      },
      select: expect.objectContaining({
        id: true,
        brokerEnvironment: true,
        brokerAccountHash: true,
      }),
    });
    expect(presentation.sendUnknownAlert).toHaveBeenCalledWith({
      tradeRecordId: 'trade-submission-unknown',
      lifecycle: 'SUBMISSION',
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      side: 'SELL',
      quantity: 3,
      price: 75.25,
      startedAt: new Date('2026-07-13T15:00:00.000Z'),
      brokerContextAssigned: true,
    });
    expect(JSON.stringify(presentation.sendUnknownAlert.mock.calls))
      .not.toContain('must-never-leave-service');
  });

  it('maps an unknown cancellation without exposing partial broker context', async () => {
    const cancellationRecord = {
      ...submissionRecord,
      id: 'trade-cancellation-unknown',
      status: OrderStatus.PARTIAL,
      submissionStartedAt: new Date('2026-07-13T14:00:00.000Z'),
      cancellationStatus: CancellationAttemptStatus.UNKNOWN,
      cancellationStartedAt: new Date('2026-07-13T16:00:00.000Z'),
      brokerAccountHash: null,
    };
    const { service, presentation } = build(cancellationRecord);

    await service.notifyUnknown('trade-cancellation-unknown');

    expect(presentation.sendUnknownAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeRecordId: 'trade-cancellation-unknown',
        lifecycle: 'CANCELLATION',
        startedAt: cancellationRecord.cancellationStartedAt,
        brokerContextAssigned: false,
      }),
    );
  });

  it('does nothing when the row is no longer unresolved', async () => {
    const { service, presentation } = build(null);

    await service.notifyUnknown('resolved-trade');

    expect(presentation.sendUnknownAlert).not.toHaveBeenCalled();
  });

  it('contains DB and Slack presentation failures after durable UNKNOWN', async () => {
    const first = build();
    first.prisma.tradeRecord.findFirst.mockRejectedValue(new Error('db read unavailable'));
    const firstWarn = jest.spyOn((first.service as any).logger, 'warn').mockImplementation();

    await expect(first.service.notifyUnknown('trade-db-fail')).resolves.toBeUndefined();
    expect(firstWarn).toHaveBeenCalledWith(expect.stringContaining('trade-db-fail'));

    const second = build();
    second.presentation.sendUnknownAlert.mockRejectedValue(new Error('Slack unavailable'));
    const secondWarn = jest.spyOn((second.service as any).logger, 'warn').mockImplementation();

    await expect(second.service.notifyUnknown('trade-slack-fail')).resolves.toBeUndefined();
    expect(secondWarn).toHaveBeenCalledWith(expect.stringContaining('trade-slack-fail'));
  });

  it('sends one best-effort startup summary with the unresolved count', async () => {
    const { service, presentation } = build();

    await expect(service.notifyStartupSummary(7)).resolves.toBeUndefined();

    expect(presentation.sendStartupSummary).toHaveBeenCalledTimes(1);
    expect(presentation.sendStartupSummary).toHaveBeenCalledWith(7);
  });
});
