import { Logger } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { TradingSellApprovalNotificationService } from './trading-sell-approval-notification.service';

describe('TradingSellApprovalNotificationService', () => {
  const approval = {
    id: 'approval-1',
    stockCode: 'TQQQ',
    slackChannel: 'C123',
    slackMessageTs: '1783904340.000000',
  };

  const createHarness = () => {
    const prisma = {
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue(approval),
      },
    };
    const slack = {
      updateStopLossApprovalMessage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TradingSellApprovalNotificationService(
      prisma as never,
      slack as never,
    );
    return { service, prisma, slack };
  };

  it.each([
    [
      'confirmed cancellation',
      { approvalId: 'approval-1', claimed: true, submitted: false, tradeStatus: OrderStatus.CANCELLED },
      'APPROVED_NOT_SUBMITTED',
    ],
    [
      'lost submission claim',
      {
        approvalId: 'approval-1',
        claimed: false,
        submitted: false,
        tradeStatus: OrderStatus.SUBMITTING,
        reason: 'SUBMISSION_CLAIM_LOST' as const,
      },
      'APPROVED_UNKNOWN',
    ],
    [
      'failed cancellation CAS',
      {
        approvalId: 'approval-1',
        claimed: true,
        submitted: false,
        tradeStatus: OrderStatus.FAILED,
        reason: 'STATE_CHANGED' as const,
      },
      'APPROVED_UNKNOWN',
    ],
    [
      'accepted order',
      { approvalId: 'approval-1', claimed: true, submitted: true, tradeStatus: OrderStatus.PENDING },
      'APPROVED_ACCEPTED',
    ],
    [
      'accepted order awaiting persistence',
      {
        approvalId: 'approval-1',
        claimed: true,
        submitted: true,
        tradeStatus: OrderStatus.SUBMITTING,
        reason: 'ACCEPTED_PERSISTENCE_PENDING' as const,
      },
      'APPROVED_ACCEPTED',
    ],
    [
      'broker rejection',
      {
        approvalId: 'approval-1',
        claimed: true,
        submitted: true,
        tradeStatus: OrderStatus.FAILED,
        reason: 'BROKER_REJECTED' as const,
      },
      'APPROVED_REJECTED',
    ],
    [
      'unknown broker outcome',
      {
        approvalId: 'approval-1',
        claimed: true,
        submitted: true,
        tradeStatus: OrderStatus.SUBMISSION_UNKNOWN,
        reason: 'BROKER_UNKNOWN' as const,
      },
      'APPROVED_UNKNOWN',
    ],
  ] as const)('maps %s to an authoritative Slack status', async (
    _label,
    result,
    expectedStatus,
  ) => {
    const { service, slack } = createHarness();

    await service.updateApprovedOutcome('approval-1', result);

    expect(slack.updateStopLossApprovalMessage).toHaveBeenCalledWith(
      'C123',
      '1783904340.000000',
      'TQQQ',
      expectedStatus,
    );
  });

  it.each(['REJECTED', 'EXPIRED'] as const)(
    'updates a persisted %s decision best-effort',
    async (status) => {
      const { service, slack } = createHarness();

      await service.updateDecision('approval-1', status);

      expect(slack.updateStopLossApprovalMessage).toHaveBeenCalledWith(
        'C123',
        '1783904340.000000',
        'TQQQ',
        status,
      );
    },
  );

  it('skips Slack when persisted delivery identity is incomplete', async () => {
    const { service, prisma, slack } = createHarness();
    prisma.stopLossApproval.findUnique.mockResolvedValue({
      ...approval,
      slackMessageTs: null,
    });

    await expect(service.updateDecision('approval-1', 'EXPIRED')).resolves.toBeUndefined();

    expect(slack.updateStopLossApprovalMessage).not.toHaveBeenCalled();
  });

  it('contains lookup and Slack failures without changing the authoritative workflow result', async () => {
    const lookupHarness = createHarness();
    lookupHarness.prisma.stopLossApproval.findUnique.mockRejectedValue(new Error('db unavailable'));
    const slackHarness = createHarness();
    slackHarness.slack.updateStopLossApprovalMessage.mockRejectedValue(
      new Error('Slack unavailable'),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(
      lookupHarness.service.updateDecision('approval-1', 'EXPIRED'),
    ).resolves.toBeUndefined();
    await expect(
      slackHarness.service.updateApprovedOutcome('approval-1', {
        approvalId: 'approval-1',
        claimed: true,
        submitted: true,
        tradeStatus: OrderStatus.PENDING,
      }),
    ).resolves.toBeUndefined();

    expect(lookupHarness.slack.updateStopLossApprovalMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[APPROVAL approval-1] Slack outcome lookup failed: db unavailable',
    );
    expect(warn).toHaveBeenCalledWith('[TQQQ] Slack approval update failed: Slack unavailable');
    warn.mockRestore();
  });
});
