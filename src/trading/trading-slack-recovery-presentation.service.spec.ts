import {
  BrokerOrderActionChannel,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  OrderType,
  Side,
} from '@prisma/client';
import { TradingSlackRecoveryPresentationService } from './trading-slack-recovery-presentation.service';
import { BrokerOrderRecoveryItem } from './types/broker-order-recovery-item.type';

describe('TradingSlackRecoveryPresentationService', () => {
  const postMessage = jest.fn();
  const postEphemeral = jest.fn();
  const update = jest.fn();
  const open = jest.fn();
  const app = {
    client: {
      chat: { postMessage, postEphemeral, update },
      views: { open },
    },
  };
  const slackService = {
    isEnabled: jest.fn().mockReturnValue(true),
    isConfigured: jest.fn().mockReturnValue(true),
    getApp: jest.fn().mockReturnValue(app),
    getConfiguredApp: jest.fn().mockReturnValue(app),
  };
  const configService = {
    get: jest.fn((key: string) => key === 'slack.channel' ? '#recovery' : undefined),
  };
  let service: TradingSlackRecoveryPresentationService;

const recoveryItem = (
  overrides: Partial<BrokerOrderRecoveryItem> = {},
): BrokerOrderRecoveryItem => ({
    tradeRecordId: 'trade-1',
    lifecycle: 'SUBMISSION',
    market: Market.OVERSEAS,
    exchangeCode: 'NASD',
    stockCode: 'TQQQ',
    stockName: 'TQQQ',
    side: Side.SELL,
    orderType: OrderType.LIMIT,
    quantity: 3,
    price: 75.25,
    orderNo: null,
    status: OrderStatus.SUBMISSION_UNKNOWN,
    submissionStartedAt: new Date('2026-07-13T15:00:00.000Z'),
    brokerOrderDate: null,
    brokerOrderTime: null,
    submissionResolvedAt: null,
    submissionResolvedBy: null,
    submissionResolution: null,
    cancellationStatus: null,
    cancellationStartedAt: null,
    cancellationResolvedAt: null,
    cancellationResolvedBy: null,
    cancellationMessage: null,
    brokerContextAssigned: true,
    currentBrokerEnvironment: null,
    maskedCurrentAccount: null,
    brokerContextMatchesCurrent: null,
    createdAt: new Date('2026-07-13T14:59:00.000Z'),
    updatedAt: new Date('2026-07-13T15:00:01.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    slackService.isEnabled.mockReturnValue(true);
    slackService.isConfigured.mockReturnValue(true);
    slackService.getApp.mockReturnValue(app);
    slackService.getConfiguredApp.mockReturnValue(app);
    postMessage.mockResolvedValue({ ts: '123.456', channel: 'C-RECOVERY' });
    postEphemeral.mockResolvedValue({ ok: true });
    update.mockResolvedValue({ ok: true });
    open.mockResolvedValue({ ok: true });
    service = new TradingSlackRecoveryPresentationService(
      slackService as never,
      configService as never,
    );
  });

  it.each([
    ['SUBMISSION', true, 'broker_recovery_inspect_submission'],
    ['SUBMISSION', false, 'broker_recovery_assign_context'],
    ['CANCELLATION', true, 'broker_recovery_inspect_cancellation'],
  ] as const)(
    'sends a safe %s unknown alert with the reachable %s action',
    async (lifecycle, brokerContextAssigned, actionId) => {
      const origin = await service.sendUnknownAlert({
        tradeRecordId: 'trade-safe',
        lifecycle,
        market: Market.OVERSEAS,
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        side: Side.SELL,
        quantity: 3,
        price: 75.25,
        startedAt: new Date('2026-07-13T15:00:00.000Z'),
        brokerContextAssigned,
      });

      expect(origin).toEqual({ channel: 'C-RECOVERY', messageTs: '123.456' });
      expect(postMessage).toHaveBeenCalledTimes(1);
      const payload = postMessage.mock.calls[0][0];
      const serialized = JSON.stringify(payload);
      expect(payload.channel).toBe('#recovery');
      expect(serialized).toContain('trade-safe');
      expect(serialized).toContain('TQQQ');
      expect(serialized).toContain('3');
      expect(serialized).toContain('75.25');
      expect(serialized).toContain('다시 제출하지 마세요');
      expect(serialized).toContain(actionId);
      expect(serialized).not.toContain('accountHash');
      expect(serialized).not.toContain('brokerAccount');
      expect(serialized).not.toContain('rawAccount');
    },
  );

  it('posts one aggregate startup warning with the unresolved work-queue count', async () => {
    await expect(service.sendStartupSummary(7)).resolves.toBeUndefined();

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = postMessage.mock.calls[0][0];
    const serialized = JSON.stringify(payload);
    expect(payload.channel).toBe('#recovery');
    expect(serialized).toContain('7');
    expect(serialized).toContain('확인 필요 주문');
    expect(serialized).toContain('/확인필요주문');
  });

  it('posts the startup warning before Socket Mode reports connected', async () => {
    slackService.isEnabled.mockReturnValue(false);

    await expect(service.sendStartupSummary(3)).resolves.toBeUndefined();

    expect(slackService.getConfiguredApp).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].channel).toBe('#recovery');
  });

  it('returns null without calling Slack when delivery is unavailable or lacks identity', async () => {
    slackService.isEnabled.mockReturnValue(false);
    slackService.isConfigured.mockReturnValue(false);
    slackService.getConfiguredApp.mockReturnValue(null);
    await expect(service.sendUnknownAlert({
      tradeRecordId: 'trade-1',
      lifecycle: 'SUBMISSION',
      market: Market.DOMESTIC,
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      side: Side.BUY,
      quantity: 1,
      price: 70_000,
      startedAt: new Date(),
      brokerContextAssigned: true,
    })).resolves.toBeNull();
    expect(postMessage).not.toHaveBeenCalled();

    slackService.isEnabled.mockReturnValue(true);
    postMessage.mockResolvedValue({ ok: true });
    await expect(service.sendUnknownAlert({
      tradeRecordId: 'trade-2',
      lifecycle: 'SUBMISSION',
      market: Market.DOMESTIC,
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: '삼성전자',
      side: Side.BUY,
      quantity: 1,
      price: 70_000,
      startedAt: new Date(),
      brokerContextAssigned: true,
    })).resolves.toBeNull();
  });

  it('presents zero candidates with only the explicit not-submitted confirmation action', async () => {
    const respond = jest.fn().mockResolvedValue(undefined);
    const origin = { channel: 'C1', messageTs: '100.1' };

    await service.presentCandidates(respond, {
      recoveryItem: recoveryItem(),
      candidates: [],
      inspectedAt: new Date('2026-07-13T15:01:00.000Z'),
    }, origin);

    const response = respond.mock.calls[0][0];
    const serialized = JSON.stringify(response);
    expect(response.response_type).toBe('ephemeral');
    expect(serialized).toContain('broker_recovery_not_submitted');
    expect(serialized).not.toContain('broker_recovery_link_candidate');
    const actionValue = response.blocks[2].elements[0].value;
    expect(JSON.parse(actionValue)).toMatchObject({
      origin: { channel: 'C1', messageTs: '100.1' },
    });
  });

  it('presents link and collision candidates with distinct validated payloads', async () => {
    const respond = jest.fn().mockResolvedValue(undefined);
    const candidate = {
      orderNo: 'ORDER-1',
      stockCode: 'TQQQ',
      side: Side.SELL,
      orderQuantity: 3,
      filledQuantity: 0,
      remainingQuantity: 3,
      orderPrice: 75.25,
      exchangeCode: 'NASD',
      orderDate: '20260714',
      orderTime: '000100',
      rejectionState: 'NOT_REJECTED' as const,
      rejected: false,
    };

    await service.presentCandidates(respond, {
      recoveryItem: recoveryItem(),
      candidates: [
        candidate,
        {
          ...candidate,
          orderNo: 'ORDER-2',
          existingTradeRecordId: 'trade-existing',
          collisionType: 'EXACT',
        },
      ],
      inspectedAt: new Date(),
    }, { channel: 'C1', messageTs: '100.1' });

    const serialized = JSON.stringify(respond.mock.calls[0][0]);
    expect(serialized).toContain('broker_recovery_link_candidate');
    expect(serialized).toContain('broker_recovery_match_existing');
    expect(serialized).toContain('trade-existing');
    expect(serialized).toContain('20260714');
    expect(serialized).not.toContain('broker_recovery_not_submitted');
  });

  it('fails closed without actionable Slack candidates when the complete result exceeds the presentation limit', async () => {
    const respond = jest.fn().mockResolvedValue(undefined);
    const candidates = Array.from({ length: 11 }, (_, index) => ({
      orderNo: `ORDER-${index + 1}`,
      stockCode: 'TQQQ',
      side: Side.SELL,
      orderQuantity: 3,
      filledQuantity: 0,
      remainingQuantity: 3,
      orderPrice: 75.25,
      exchangeCode: 'NASD',
      orderDate: '20260714',
      orderTime: `0001${String(index).padStart(2, '0')}`,
      rejectionState: 'NOT_REJECTED' as const,
      rejected: false,
      ...(index === 5
        ? { existingTradeRecordId: 'trade-existing', collisionType: 'EXACT' as const }
        : {}),
    }));

    await service.presentCandidates(respond, {
      recoveryItem: recoveryItem(),
      candidates,
      inspectedAt: new Date(),
    }, { channel: 'C1', messageTs: '100.1' });

    const response = respond.mock.calls[0][0];
    const serialized = JSON.stringify(response);
    expect(response.text).toContain('11');
    expect(serialized).toContain('웹 포트폴리오');
    expect(serialized).not.toContain('broker_recovery_link_candidate');
    expect(serialized).not.toContain('broker_recovery_match_existing');
    expect(serialized).not.toContain('broker_recovery_not_submitted');
  });

  it.each([
    ['openContextAssignmentModal', 'broker_recovery_assign_context_confirm'],
    ['openLinkCandidateModal', 'broker_recovery_link_candidate_confirm'],
    ['openNotSubmittedModal', 'broker_recovery_not_submitted_confirm'],
    ['openMatchExistingModal', 'broker_recovery_match_existing_confirm'],
    ['openCancellationInspectionModal', 'broker_recovery_inspect_cancellation_confirm'],
    ['openCancellationNotAcceptedModal', 'broker_recovery_cancellation_not_accepted_confirm'],
  ] as const)(
    '%s opens the stable confirmation modal with a required acknowledgement',
    async (method, callbackId) => {
      const tradePayload = {
        v: 1 as const,
        tradeRecordId: 'trade-1',
        origin: { channel: 'C1', messageTs: '100.1' },
      };
      const candidatePayload = {
        ...tradePayload,
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'ORDER-1',
      };
      const args: Record<string, unknown[]> = {
        openContextAssignmentModal: [
          'trigger-1',
          tradePayload,
          {
            environment: 'PROD',
            maskedAccount: '****1234-01',
            contextToken: 'opaque-context-token',
          },
        ],
        openLinkCandidateModal: ['trigger-1', candidatePayload],
        openNotSubmittedModal: ['trigger-1', tradePayload],
        openMatchExistingModal: [
          'trigger-1',
          { ...candidatePayload, existingTradeRecordId: 'trade-existing' },
        ],
        openCancellationInspectionModal: ['trigger-1', tradePayload],
        openCancellationNotAcceptedModal: ['trigger-1', tradePayload],
      };

      await (service[method] as (...values: unknown[]) => Promise<void>)(...args[method]);

      const view = open.mock.calls[0][0].view;
      expect(open.mock.calls[0][0].trigger_id).toBe('trigger-1');
      expect(view.callback_id).toBe(callbackId);
      expect(view.private_metadata).toContain('trade-1');
      expect(view.blocks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'input',
          block_id: 'confirmation',
          element: expect.objectContaining({
            type: 'checkboxes',
            action_id: 'acknowledged',
          }),
        }),
      ]));
    },
  );

  it('offers cancellation-not-accepted only while cancellation remains UNKNOWN', async () => {
    const origin = { channel: 'C1', messageTs: '100.1' };
    await service.presentCancellationInspection(
      origin,
      'U123',
      recoveryItem({
        lifecycle: 'CANCELLATION',
        status: OrderStatus.PARTIAL,
        orderNo: 'ORDER-1',
        cancellationStatus: CancellationAttemptStatus.UNKNOWN,
      }),
    );

    expect(JSON.stringify(postEphemeral.mock.calls[0][0]))
      .toContain('broker_recovery_cancellation_not_accepted');

    jest.clearAllMocks();
    slackService.isEnabled.mockReturnValue(true);
    slackService.getApp.mockReturnValue(app);
    await service.presentCancellationInspection(
      origin,
      'U123',
      recoveryItem({
        lifecycle: 'CANCELLATION',
        status: OrderStatus.CANCELLED,
        orderNo: 'ORDER-1',
        cancellationStatus: CancellationAttemptStatus.RESOLVED,
      }),
    );
    expect(JSON.stringify(update.mock.calls[0][0])).not
      .toContain('broker_recovery_cancellation_not_accepted');
  });

  it.each([
    [
      'SUBMISSION',
      recoveryItem({ brokerContextAssigned: true }),
      'broker_recovery_inspect_submission',
    ],
    [
      'CANCELLATION',
      recoveryItem({
        lifecycle: 'CANCELLATION',
        brokerContextAssigned: true,
        orderNo: 'ORDER-1',
        status: OrderStatus.PARTIAL,
        cancellationStatus: CancellationAttemptStatus.UNKNOWN,
        cancellationStartedAt: new Date('2026-07-13T16:00:00.000Z'),
      }),
      'broker_recovery_inspect_cancellation',
    ],
  ] as const)(
    're-renders an unresolved %s alert with its explicit inspect action after context assignment',
    async (_lifecycle, item, expectedActionId) => {
      expect(service).toEqual(expect.objectContaining({
        presentContextAssignment: expect.any(Function),
      }));

      await (service as any).presentContextAssignment(
        { channel: 'C1', messageTs: '100.1' },
        'U123',
        item,
      );

      expect(postEphemeral).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'C1',
        user: 'U123',
      }));
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'C1',
        ts: '100.1',
      }));
      const serialized = JSON.stringify(update.mock.calls[0][0]);
      expect(serialized).toContain(expectedActionId);
      expect(serialized).not.toContain('broker_recovery_assign_context');
      expect(serialized).toContain('결과 불명');
    },
  );

  it('treats original-message update as best effort after an authoritative resolution', async () => {
    update.mockRejectedValue(new Error('message deleted'));

    await expect(service.presentResolution(
      { channel: 'C1', messageTs: '100.1' },
      'U123',
      recoveryItem({ status: OrderStatus.FAILED }),
      '복구 처리 완료',
    )).resolves.toBeUndefined();

    expect(postEphemeral).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['LIST', '확인 필요 주문 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'],
    ['INSPECTION', 'KIS 조회 결과를 확인하지 못했습니다. 웹 포트폴리오에서 현재 상태를 확인하세요.'],
    ['MODAL', 'Slack 확인 창을 열지 못했습니다. 다시 시도하거나 웹 포트폴리오를 사용하세요.'],
    ['MUTATION', '복구 작업을 확정하지 못했습니다. 웹 포트폴리오에서 현재 상태를 확인하세요.'],
  ] as const)(
    'renders the bounded allowlisted %s failure text',
    async (kind, expectedText) => {
      const respond = jest.fn().mockResolvedValue(undefined);

      await service.respondFailure(respond, kind);

      const responseText = respond.mock.calls[0][0].text;
      expect(responseText).toContain(expectedText);
      expect(responseText.length).toBeLessThanOrEqual(160);
    },
  );

  it('renders modal-submit failures from an allowlisted category only', async () => {
    await service.presentFailure(
      { channel: 'C1', messageTs: '100.1' },
      'U123',
      'MUTATION',
    );

    expect(postEphemeral).toHaveBeenCalledWith({
      channel: 'C1',
      user: 'U123',
      text: ':x: 복구 작업 실패: 복구 작업을 확정하지 못했습니다. 웹 포트폴리오에서 현재 상태를 확인하세요.',
    });
  });

  it('exposes the existing Bolt app without owning its lifecycle', () => {
    expect(service.getApp()).toBe(app);
    expect(slackService.getApp).toHaveBeenCalledTimes(1);
  });
});
