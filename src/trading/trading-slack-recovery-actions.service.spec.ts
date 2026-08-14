import {
  Broker,
  BrokerOrderActionChannel,
  CancellationAttemptStatus,
  Market,
  OrderStatus,
  OrderType,
  Side,
} from '@prisma/client';
import { TradingSlackRecoveryActionsService } from './trading-slack-recovery-actions.service';

describe('TradingSlackRecoveryActionsService', () => {
  const recoveryItem = (overrides: Record<string, unknown> = {}) => ({
    tradeRecordId: 'trade-1',
    broker: Broker.KIS,
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
  const inspection = {
    recoveryItem: recoveryItem(),
    candidates: [],
    inspectedAt: new Date('2026-07-13T15:01:00.000Z'),
  };
  const actionHandlers = new Map<string, (args: any) => Promise<void>>();
  const viewHandlers = new Map<string, (args: any) => Promise<void>>();
  const commandHandlers = new Map<string, (args: any) => Promise<void>>();
  const app = {
    action: jest.fn((id, handler) => actionHandlers.set(id, handler)),
    view: jest.fn((id, handler) => viewHandlers.set(id, handler)),
    command: jest.fn((id, handler) => commandHandlers.set(id, handler)),
  };
  const recovery = {
    listRecoveryItems: jest.fn(),
    getCurrentContextPreview: jest.fn(),
    inspectCandidates: jest.fn(),
    assignCurrentContext: jest.fn(),
    linkCandidate: jest.fn(),
    confirmNotSubmitted: jest.fn(),
    confirmMatchesExisting: jest.fn(),
    inspectCancellation: jest.fn(),
    confirmCancellationNotAccepted: jest.fn(),
  };
  const authorization = {
    authorize: jest.fn(),
  };
  const presentation = {
    getApp: jest.fn().mockReturnValue(app),
    presentRecoveryItems: jest.fn(),
    presentCandidates: jest.fn(),
    openContextAssignmentModal: jest.fn(),
    openLinkCandidateModal: jest.fn(),
    openNotSubmittedModal: jest.fn(),
    openMatchExistingModal: jest.fn(),
    openCancellationInspectionModal: jest.fn(),
    openCancellationNotAcceptedModal: jest.fn(),
    respondUnauthorized: jest.fn(),
    respondFailure: jest.fn(),
    presentFailure: jest.fn(),
    presentContextAssignment: jest.fn(),
    presentResolution: jest.fn(),
    presentCancellationInspection: jest.fn(),
  };
  let service: TradingSlackRecoveryActionsService;

  const tradePayload = (origin = true) => JSON.stringify({
    v: 1,
    tradeRecordId: 'trade-1',
    broker: Broker.KIS,
    ...(origin
      ? { origin: { channel: 'C-ORIGINAL', messageTs: '100.1' } }
      : {}),
  });
  const contextBoundTradePayload = () => JSON.stringify({
    ...JSON.parse(tradePayload()),
    contextToken: 'opaque-context-token',
  });
  const candidatePayload = () => JSON.stringify({
    v: 1,
    tradeRecordId: 'trade-1',
    broker: Broker.KIS,
    brokerOrderDate: '20260714',
    exchangeCode: 'nasd',
    orderNo: ' ORDER-1 ',
    origin: { channel: 'C-ORIGINAL', messageTs: '100.1' },
  });
  const existingPayload = () => JSON.stringify({
    ...JSON.parse(candidatePayload()),
    existingTradeRecordId: 'trade-existing',
  });
  const body = (value: string, userId: string | undefined = 'U123') => ({
    actions: [{ value }],
    ...(userId ? { user: { id: userId } } : {}),
    trigger_id: 'trigger-1',
    container: { channel_id: 'C-CONTAINER', message_ts: '200.2' },
  });
  const acknowledgedView = (privateMetadata: string) => ({
    private_metadata: privateMetadata,
    state: {
      values: {
        confirmation: {
          acknowledged: {
            selected_options: [{ value: 'confirmed' }],
          },
        },
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    actionHandlers.clear();
    viewHandlers.clear();
    commandHandlers.clear();
    presentation.getApp.mockReturnValue(app);
    authorization.authorize.mockReturnValue('U123');
    recovery.listRecoveryItems.mockResolvedValue([recoveryItem()]);
    recovery.getCurrentContextPreview.mockReturnValue({
      broker: Broker.KIS,
      environment: 'PROD',
      maskedAccount: '****1234-01',
      contextToken: 'opaque-context-token',
    });
    recovery.inspectCandidates.mockResolvedValue(inspection);
    recovery.assignCurrentContext.mockResolvedValue(recoveryItem());
    recovery.linkCandidate.mockResolvedValue(recoveryItem({ status: OrderStatus.PENDING }));
    recovery.confirmNotSubmitted.mockResolvedValue(recoveryItem({ status: OrderStatus.FAILED }));
    recovery.confirmMatchesExisting.mockResolvedValue(recoveryItem({ status: OrderStatus.FAILED }));
    recovery.inspectCancellation.mockResolvedValue(recoveryItem({
      lifecycle: 'CANCELLATION',
      orderNo: 'ORDER-1',
      status: OrderStatus.PARTIAL,
      cancellationStatus: CancellationAttemptStatus.UNKNOWN,
    }));
    recovery.confirmCancellationNotAccepted.mockResolvedValue(recoveryItem({
      lifecycle: 'CANCELLATION',
      orderNo: 'ORDER-1',
      status: OrderStatus.PARTIAL,
      cancellationStatus: CancellationAttemptStatus.REJECTED,
    }));
    service = new TradingSlackRecoveryActionsService(
      recovery as never,
      authorization as never,
      presentation as never,
    );
    service.onModuleInit();
  });

  it('registers the bounded command, seven stable actions, and six stable views', () => {
    expect(Array.from(commandHandlers.keys())).toEqual(['/확인필요주문']);
    expect(Array.from(actionHandlers.keys())).toEqual([
      'broker_recovery_inspect_submission',
      'broker_recovery_assign_context',
      'broker_recovery_link_candidate',
      'broker_recovery_not_submitted',
      'broker_recovery_match_existing',
      'broker_recovery_inspect_cancellation',
      'broker_recovery_cancellation_not_accepted',
    ]);
    expect(Array.from(viewHandlers.keys())).toEqual([
      'broker_recovery_assign_context_confirm',
      'broker_recovery_link_candidate_confirm',
      'broker_recovery_not_submitted_confirm',
      'broker_recovery_match_existing_confirm',
      'broker_recovery_inspect_cancellation_confirm',
      'broker_recovery_cancellation_not_accepted_confirm',
    ]);
  });

  it('authorizes the DB-only command before listing and presents the result', async () => {
    const ack = jest.fn().mockResolvedValue(undefined);
    const respond = jest.fn().mockResolvedValue(undefined);

    await commandHandlers.get('/확인필요주문')!({
      ack,
      respond,
      command: { user_id: ' U123 ' },
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(authorization.authorize).toHaveBeenCalledWith(' U123 ');
    expect(recovery.listRecoveryItems).toHaveBeenCalledTimes(1);
    expect(presentation.presentRecoveryItems).toHaveBeenCalledWith(
      respond,
      [expect.objectContaining({ tradeRecordId: 'trade-1' })],
    );
  });

  it('blocks an unauthorized submission lookup before every RecoveryService call', async () => {
    authorization.authorize.mockReturnValue(null);
    const ack = jest.fn().mockResolvedValue(undefined);
    const respond = jest.fn().mockResolvedValue(undefined);

    await actionHandlers.get('broker_recovery_inspect_submission')!({
      ack,
      respond,
      body: body(tradePayload(false), 'U-NOT-ALLOWED'),
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(authorization.authorize).toHaveBeenCalledWith('U-NOT-ALLOWED');
    expect(Object.values(recovery).every((mock) => mock.mock.calls.length === 0)).toBe(true);
    expect(presentation.respondUnauthorized).toHaveBeenCalledWith(respond);
  });

  it('passes an authorized submission lookup to recovery once with the exact Slack actor', async () => {
    const ack = jest.fn().mockResolvedValue(undefined);
    const respond = jest.fn().mockResolvedValue(undefined);

    await actionHandlers.get('broker_recovery_inspect_submission')!({
      ack,
      respond,
      body: body(tradePayload(false)),
    });

    expect(recovery.inspectCandidates).toHaveBeenCalledTimes(1);
    expect(recovery.inspectCandidates).toHaveBeenCalledWith('trade-1', {
      channel: BrokerOrderActionChannel.SLACK,
      actor: 'slack:U123',
    });
    expect(presentation.presentCandidates).toHaveBeenCalledWith(
      respond,
      inspection,
      { channel: 'C-CONTAINER', messageTs: '200.2' },
    );
  });

  it('rejects malformed or wrong-version action payloads without recovery', async () => {
    const respond = jest.fn().mockResolvedValue(undefined);
    for (const value of ['not-json', JSON.stringify({ v: 2, tradeRecordId: 'trade-1' })]) {
      await actionHandlers.get('broker_recovery_inspect_submission')!({
        ack: jest.fn().mockResolvedValue(undefined),
        respond,
        body: body(value),
      });
    }

    expect(recovery.inspectCandidates).not.toHaveBeenCalled();
    expect(presentation.respondFailure).toHaveBeenNthCalledWith(
      1,
      respond,
      'INSPECTION',
    );
    expect(presentation.respondFailure).toHaveBeenNthCalledWith(
      2,
      respond,
      'INSPECTION',
    );
  });

  it('keeps list failure detail in the server log and sends only the safe failure category', async () => {
    const secret = 'postgresql://operator:super-secret@db.internal/recovery';
    const respond = jest.fn().mockResolvedValue(undefined);
    recovery.listRecoveryItems.mockRejectedValue(new Error(secret));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation();

    await commandHandlers.get('/확인필요주문')!({
      ack: jest.fn().mockResolvedValue(undefined),
      respond,
      command: { user_id: 'U123' },
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret));
    expect(presentation.respondFailure).toHaveBeenCalledWith(respond, 'LIST');
    expect(JSON.stringify(presentation.respondFailure.mock.calls)).not.toContain(secret);
  });

  it('keeps inspection failure detail out of the Slack response', async () => {
    const secret = 'raw KIS payload with account 12345678-01';
    const respond = jest.fn().mockResolvedValue(undefined);
    recovery.inspectCandidates.mockRejectedValue(new Error(secret));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation();

    await actionHandlers.get('broker_recovery_inspect_submission')!({
      ack: jest.fn().mockResolvedValue(undefined),
      respond,
      body: body(tradePayload()),
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret));
    expect(presentation.respondFailure).toHaveBeenCalledWith(
      respond,
      'INSPECTION',
    );
    expect(JSON.stringify(presentation.respondFailure.mock.calls)).not.toContain(secret);
  });

  it('keeps modal failure detail out of the Slack response', async () => {
    const secret = 'Slack trigger failed with xoxb-private-token';
    const respond = jest.fn().mockResolvedValue(undefined);
    recovery.getCurrentContextPreview.mockImplementation(() => {
      throw new Error(secret);
    });
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation();

    await actionHandlers.get('broker_recovery_assign_context')!({
      ack: jest.fn().mockResolvedValue(undefined),
      respond,
      body: body(tradePayload()),
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret));
    expect(presentation.respondFailure).toHaveBeenCalledWith(respond, 'MODAL');
    expect(JSON.stringify(presentation.respondFailure.mock.calls)).not.toContain(secret);
  });

  it('authorizes context preview before opening assignment and performs no mutation on click', async () => {
    const ack = jest.fn().mockResolvedValue(undefined);
    await actionHandlers.get('broker_recovery_assign_context')!({
      ack,
      respond: jest.fn(),
      body: body(tradePayload(false)),
    });

    expect(authorization.authorize).toHaveBeenCalledWith('U123');
    expect(recovery.getCurrentContextPreview).toHaveBeenCalledWith(Broker.KIS);
    expect(recovery.assignCurrentContext).not.toHaveBeenCalled();
    expect(presentation.openContextAssignmentModal).toHaveBeenCalledWith(
      'trigger-1',
      {
        v: 1,
        tradeRecordId: 'trade-1',
        broker: Broker.KIS,
        contextToken: 'opaque-context-token',
        origin: { channel: 'C-CONTAINER', messageTs: '200.2' },
      },
      {
        broker: Broker.KIS,
        environment: 'PROD',
        maskedAccount: '****1234-01',
        contextToken: 'opaque-context-token',
      },
    );
  });

  it.each([
    ['broker_recovery_link_candidate', 'openLinkCandidateModal', candidatePayload],
    ['broker_recovery_not_submitted', 'openNotSubmittedModal', tradePayload],
    ['broker_recovery_match_existing', 'openMatchExistingModal', existingPayload],
    ['broker_recovery_inspect_cancellation', 'openCancellationInspectionModal', tradePayload],
    ['broker_recovery_cancellation_not_accepted', 'openCancellationNotAcceptedModal', tradePayload],
  ] as const)(
    '%s opens only its confirmation modal and performs no recovery mutation',
    async (actionId, presentationMethod, payloadFactory) => {
      await actionHandlers.get(actionId)!({
        ack: jest.fn().mockResolvedValue(undefined),
        respond: jest.fn(),
        body: body(payloadFactory()),
      });

      expect(presentation[presentationMethod]).toHaveBeenCalledTimes(1);
      expect(recovery.linkCandidate).not.toHaveBeenCalled();
      expect(recovery.confirmNotSubmitted).not.toHaveBeenCalled();
      expect(recovery.confirmMatchesExisting).not.toHaveBeenCalled();
      expect(recovery.inspectCancellation).not.toHaveBeenCalled();
      expect(recovery.confirmCancellationNotAccepted).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'broker_recovery_assign_context_confirm',
      contextBoundTradePayload,
      'assignCurrentContext',
      ['trade-1', 'opaque-context-token'],
    ],
    [
      'broker_recovery_link_candidate_confirm',
      candidatePayload,
      'linkCandidate',
      [{
        tradeRecordId: 'trade-1',
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'ORDER-1',
      }],
    ],
    [
      'broker_recovery_not_submitted_confirm',
      tradePayload,
      'confirmNotSubmitted',
      ['trade-1'],
    ],
    [
      'broker_recovery_match_existing_confirm',
      existingPayload,
      'confirmMatchesExisting',
      [{
        tradeRecordId: 'trade-1',
        brokerOrderDate: '20260714',
        exchangeCode: 'NASD',
        orderNo: 'ORDER-1',
        existingTradeRecordId: 'trade-existing',
      }],
    ],
    [
      'broker_recovery_inspect_cancellation_confirm',
      tradePayload,
      'inspectCancellation',
      ['trade-1'],
    ],
    [
      'broker_recovery_cancellation_not_accepted_confirm',
      tradePayload,
      'confirmCancellationNotAccepted',
      ['trade-1'],
    ],
  ] as const)(
    '%s reauthorizes the current user and calls exactly one locked recovery method',
    async (callbackId, payloadFactory, recoveryMethod, expectedArgs) => {
      const ack = jest.fn().mockResolvedValue(undefined);
      const metadata = payloadFactory();

      await viewHandlers.get(callbackId)!({
        ack,
        body: { user: { id: 'U123' } },
        view: acknowledgedView(metadata),
      });

      expect(authorization.authorize).toHaveBeenCalledWith('U123');
      expect(recovery[recoveryMethod]).toHaveBeenCalledTimes(1);
      expect(recovery[recoveryMethod]).toHaveBeenCalledWith(
        ...expectedArgs,
        {
          channel: BrokerOrderActionChannel.SLACK,
          actor: 'slack:U123',
        },
      );
      const calledRecoveryMethods = [
        'assignCurrentContext',
        'linkCandidate',
        'confirmNotSubmitted',
        'confirmMatchesExisting',
        'inspectCancellation',
        'confirmCancellationNotAccepted',
      ].filter((name) => recovery[name].mock.calls.length > 0);
      expect(calledRecoveryMethods).toEqual([recoveryMethod]);
    },
  );

  it('requires the acknowledgement checkbox before a modal can mutate recovery state', async () => {
    const ack = jest.fn().mockResolvedValue(undefined);
    await viewHandlers.get('broker_recovery_not_submitted_confirm')!({
      ack,
      body: { user: { id: 'U123' } },
      view: {
        private_metadata: tradePayload(),
        state: { values: {} },
      },
    });

    expect(ack).toHaveBeenCalledWith({
      response_action: 'errors',
      errors: { confirmation: expect.stringMatching(/확인/) },
    });
    expect(recovery.confirmNotSubmitted).not.toHaveBeenCalled();
  });

  it('reauthorizes modal submit instead of trusting its metadata', async () => {
    authorization.authorize.mockReturnValue(null);
    const ack = jest.fn().mockResolvedValue(undefined);

    await viewHandlers.get('broker_recovery_link_candidate_confirm')!({
      ack,
      body: { user: { id: 'U-CHANGED' } },
      view: acknowledgedView(candidatePayload()),
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(authorization.authorize).toHaveBeenCalledWith('U-CHANGED');
    expect(recovery.linkCandidate).not.toHaveBeenCalled();
    expect(presentation.presentFailure).toHaveBeenCalledWith(
      { channel: 'C-ORIGINAL', messageTs: '100.1' },
      'U-CHANGED',
      'UNAUTHORIZED',
    );
  });

  it('keeps confirmed recovery failure detail out of the Slack response', async () => {
    const secret = 'Prisma unique key contained raw broker identity';
    recovery.linkCandidate.mockRejectedValue(new Error(secret));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation();

    await viewHandlers.get('broker_recovery_link_candidate_confirm')!({
      ack: jest.fn().mockResolvedValue(undefined),
      body: { user: { id: 'U123' } },
      view: acknowledgedView(candidatePayload()),
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(secret));
    expect(presentation.presentFailure).toHaveBeenCalledWith(
      { channel: 'C-ORIGINAL', messageTs: '100.1' },
      'U123',
      'MUTATION',
    );
    expect(JSON.stringify(presentation.presentFailure.mock.calls)).not.toContain(secret);
  });

  it('routes unresolved cancellation inspection to the explicit not-accepted follow-up', async () => {
    await viewHandlers.get('broker_recovery_inspect_cancellation_confirm')!({
      ack: jest.fn().mockResolvedValue(undefined),
      body: { user: { id: 'U123' } },
      view: acknowledgedView(tradePayload()),
    });

    expect(presentation.presentCancellationInspection).toHaveBeenCalledWith(
      { channel: 'C-ORIGINAL', messageTs: '100.1' },
      'U123',
      expect.objectContaining({
        cancellationStatus: CancellationAttemptStatus.UNKNOWN,
      }),
    );
    expect(presentation.presentResolution).not.toHaveBeenCalled();
  });

  it('keeps a context-assigned record unresolved and routes it to the next-step renderer', async () => {
    const assignedItem = recoveryItem({ brokerContextAssigned: true });
    recovery.assignCurrentContext.mockResolvedValue(assignedItem);

    await viewHandlers.get('broker_recovery_assign_context_confirm')!({
      ack: jest.fn().mockResolvedValue(undefined),
      body: { user: { id: 'U123' } },
      view: acknowledgedView(contextBoundTradePayload()),
    });

    expect(presentation.presentContextAssignment).toHaveBeenCalledWith(
      { channel: 'C-ORIGINAL', messageTs: '100.1' },
      'U123',
      assignedItem,
    );
    expect(presentation.presentResolution).not.toHaveBeenCalled();
  });
});
