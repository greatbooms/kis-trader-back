import { ApprovalStatus, Market, OrderStatus, Side } from '@prisma/client';
import { TradingSlackCommandsService } from './trading-slack-commands.service';

describe('TradingSlackCommandsService', () => {
  const mockPrisma = {
    position: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    tradeRecord: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    stopLossApproval: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    watchStock: {
      findFirst: jest.fn(),
    },
  };

  const mockMarketAnalysisService = {
    getMarketCondition: jest.fn(),
  };

  const mockSlackService = {
    getApp: jest.fn(),
    formatPositionList: jest.fn(),
    formatDailySummary: jest.fn(),
    formatStockDetail: jest.fn(),
    updateStopLossApprovalMessage: jest.fn(),
  };

  const mockApprovalWorkflow = {
    approve: jest.fn(),
    reject: jest.fn(),
  };

  let service: TradingSlackCommandsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMarketAnalysisService.getMarketCondition.mockResolvedValue({
      referenceIndexName: 'S&P500',
      referenceIndexAboveMA200: true,
    });
    service = new TradingSlackCommandsService(
      mockPrisma as any,
      mockApprovalWorkflow as any,
      mockMarketAnalysisService as any,
      mockSlackService as any,
    );
  });

  function registerApprovalAction(
    actionName: 'stop_loss_approve' | 'stop_loss_reject',
  ): (args: any) => Promise<void> {
    const actionHandlers = new Map<string, (args: any) => Promise<void>>();
    const app = {
      command: jest.fn(),
      action: jest.fn((name, handler) => actionHandlers.set(name, handler)),
      event: jest.fn(),
    };
    mockSlackService.getApp.mockReturnValue(app);
    service.onModuleInit();
    return actionHandlers.get(actionName)!;
  }

  it('delegates the exact approval ID and Slack actor to the approval workflow once', async () => {
    mockApprovalWorkflow.approve.mockResolvedValue({
      approvalId: 'approval-exact',
      approvalStatus: ApprovalStatus.APPROVED,
      tradeStatus: OrderStatus.PENDING,
      claimed: true,
      submitted: true,
    });
    const handler = registerApprovalAction('stop_loss_approve');
    const ack = jest.fn().mockResolvedValue(undefined);

    await handler({
      ack,
      body: {
        actions: [{ value: 'approval-exact' }],
        user: { id: 'U-APPROVER' },
      },
      respond: jest.fn().mockResolvedValue(undefined),
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(mockApprovalWorkflow.approve).toHaveBeenCalledTimes(1);
    expect(mockApprovalWorkflow.approve).toHaveBeenCalledWith(
      'approval-exact',
      'U-APPROVER',
    );
    expect(mockApprovalWorkflow.reject).not.toHaveBeenCalled();
    expect(mockPrisma.stopLossApproval.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.stopLossApproval.update).not.toHaveBeenCalled();
    expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
    expect(mockSlackService.updateStopLossApprovalMessage).not.toHaveBeenCalled();
  });

  it('delegates the exact rejection ID and Slack actor to the approval workflow once', async () => {
    mockApprovalWorkflow.reject.mockResolvedValue({
      approvalId: 'rejection-exact',
      approvalStatus: ApprovalStatus.REJECTED,
      tradeStatus: OrderStatus.CANCELLED,
      claimed: true,
      submitted: false,
    });
    const handler = registerApprovalAction('stop_loss_reject');
    const ack = jest.fn().mockResolvedValue(undefined);

    await handler({
      ack,
      body: {
        actions: [{ value: 'rejection-exact' }],
        user: { id: 'U-REJECTOR' },
      },
      respond: jest.fn().mockResolvedValue(undefined),
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(mockApprovalWorkflow.reject).toHaveBeenCalledTimes(1);
    expect(mockApprovalWorkflow.reject).toHaveBeenCalledWith(
      'rejection-exact',
      'U-REJECTOR',
    );
    expect(mockApprovalWorkflow.approve).not.toHaveBeenCalled();
    expect(mockPrisma.stopLossApproval.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.stopLossApproval.update).not.toHaveBeenCalled();
    expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
    expect(mockSlackService.updateStopLossApprovalMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['stop_loss_approve', 'approve'],
    ['stop_loss_reject', 'reject'],
  ] as const)(
    'delegates a missing Slack actor to the fail-closed workflow for %s',
    async (actionName, workflowMethod) => {
      mockApprovalWorkflow[workflowMethod].mockResolvedValue({
        approvalId: 'approval-no-actor',
        claimed: false,
        submitted: false,
        reason: 'UNAUTHORIZED',
      });
      const handler = registerApprovalAction(actionName);
      const respond = jest.fn().mockResolvedValue(undefined);

      await handler({
        ack: jest.fn().mockResolvedValue(undefined),
        body: { actions: [{ value: 'approval-no-actor' }] },
        respond,
      });

      expect(mockApprovalWorkflow[workflowMethod]).toHaveBeenCalledTimes(1);
      expect(mockApprovalWorkflow[workflowMethod]).toHaveBeenCalledWith(
        'approval-no-actor',
        undefined,
      );
      expect(respond).toHaveBeenCalledWith({
        text: expect.stringMatching(/권한/),
        replace_original: false,
      });
      expect(mockPrisma.stopLossApproval.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.stopLossApproval.update).not.toHaveBeenCalled();
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
      expect(mockSlackService.updateStopLossApprovalMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['NOT_FOUND', /존재하지/],
    ['DELIVERY_NOT_READY', /전달/],
    ['TRADING_DISABLED', /비활성/],
    ['BROKER_CONTEXT_MISMATCH', /계좌.*일치하지/],
    ['REFRESH_FAILED', /포지션/],
    ['NO_HOLDING', /보유/],
    ['SUBMISSION_CLAIM_LOST', /상태/],
    ['BROKER_REJECTED', /거절/],
    ['BROKER_UNKNOWN', /결과.*확인/],
    ['STATE_CHANGED', /상태/],
    ['ACCEPTED_PERSISTENCE_PENDING', /접수.*저장/],
  ] as const)(
    'presents workflow result %s without performing another action',
    async (reason, expectedText) => {
      mockApprovalWorkflow.approve.mockResolvedValue({
        approvalId: 'approval-result',
        claimed: reason !== 'NOT_FOUND' && reason !== 'DELIVERY_NOT_READY'
          && reason !== 'TRADING_DISABLED',
        submitted: ['BROKER_REJECTED', 'BROKER_UNKNOWN', 'STATE_CHANGED', 'ACCEPTED_PERSISTENCE_PENDING'].includes(reason),
        reason,
      });
      const handler = registerApprovalAction('stop_loss_approve');
      const respond = jest.fn().mockResolvedValue(undefined);

      await handler({
        ack: jest.fn().mockResolvedValue(undefined),
        body: {
          actions: [{ value: 'approval-result' }],
          user: { id: 'U-APPROVER' },
        },
        respond,
      });

      expect(mockApprovalWorkflow.approve).toHaveBeenCalledTimes(1);
      expect(respond).toHaveBeenCalledTimes(1);
      expect(respond).toHaveBeenCalledWith({
        text: expect.stringMatching(expectedText),
        replace_original: false,
      });
      expect(mockPrisma.stopLossApproval.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.stopLossApproval.update).not.toHaveBeenCalled();
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
      expect(mockSlackService.updateStopLossApprovalMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['stop_loss_approve', 'approve'],
    ['stop_loss_reject', 'reject'],
  ] as const)(
    'contains %s presentation failure after a successful workflow result',
    async (actionName, workflowMethod) => {
      mockApprovalWorkflow[workflowMethod].mockResolvedValue({
        approvalId: 'approval-present',
        approvalStatus: ApprovalStatus.APPROVED,
        claimed: false,
        submitted: false,
        reason: 'ALREADY_HANDLED',
      });
      const handler = registerApprovalAction(actionName);
      const respond = jest.fn().mockRejectedValue(new Error('presentation unavailable'));
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();
      let thrown: unknown;

      try {
        await handler({
          ack: jest.fn().mockResolvedValue(undefined),
          body: {
            actions: [{ value: 'approval-present' }],
            user: { id: 'U-APPROVER' },
          },
          respond,
        });
      } catch (error) {
        thrown = error;
      }

      expect({
        workflowCalls: mockApprovalWorkflow[workflowMethod].mock.calls.length,
        respondCalls: respond.mock.calls.length,
        thrown,
        warning: warnSpy.mock.calls[0]?.[0],
      }).toEqual({
        workflowCalls: 1,
        respondCalls: 1,
        thrown: undefined,
        warning: expect.stringContaining(
          '[APPROVAL approval-present] Slack presentation failed',
        ),
      });
    },
  );

  it.each([
    ['stop_loss_approve', 'approve', '승인'],
    ['stop_loss_reject', 'reject', '거절'],
  ] as const)(
    'presents a %s workflow error without invoking a second action',
    async (actionName, workflowMethod, actionLabel) => {
      mockApprovalWorkflow[workflowMethod].mockRejectedValue(
        new Error('workflow failed safely'),
      );
      const handler = registerApprovalAction(actionName);
      const respond = jest.fn().mockResolvedValue(undefined);

      await handler({
        ack: jest.fn().mockResolvedValue(undefined),
        body: {
          actions: [{ value: 'approval-error' }],
          user: { id: 'U-APPROVER' },
        },
        respond,
      });

      expect(mockApprovalWorkflow[workflowMethod]).toHaveBeenCalledTimes(1);
      expect(respond).toHaveBeenCalledTimes(1);
      expect(respond).toHaveBeenCalledWith({
        text: expect.stringMatching(new RegExp(`${actionLabel} 처리 실패.*workflow failed safely`)),
        replace_original: false,
      });
      expect(mockPrisma.stopLossApproval.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.stopLossApproval.update).not.toHaveBeenCalled();
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
      expect(mockSlackService.updateStopLossApprovalMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['stop_loss_approve', 'approve'],
    ['stop_loss_reject', 'reject'],
  ] as const)(
    'contains %s failure-response rejection after the workflow throws',
    async (actionName, workflowMethod) => {
      mockApprovalWorkflow[workflowMethod].mockRejectedValue(
        new Error('workflow failed safely'),
      );
      const handler = registerApprovalAction(actionName);
      const respond = jest.fn().mockRejectedValue(new Error('failure response unavailable'));
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();
      let thrown: unknown;

      try {
        await handler({
          ack: jest.fn().mockResolvedValue(undefined),
          body: {
            actions: [{ value: 'approval-workflow-error' }],
            user: { id: 'U-APPROVER' },
          },
          respond,
        });
      } catch (error) {
        thrown = error;
      }

      expect({
        workflowCalls: mockApprovalWorkflow[workflowMethod].mock.calls.length,
        respondCalls: respond.mock.calls.length,
        thrown,
        warning: warnSpy.mock.calls[0]?.[0],
      }).toEqual({
        workflowCalls: 1,
        respondCalls: 1,
        thrown: undefined,
        warning: expect.stringContaining(
          '[APPROVAL approval-workflow-error] Slack failure response failed',
        ),
      });
    },
  );

  it.each([
    ['stop_loss_approve', 'approve', ApprovalStatus.APPROVED],
    ['stop_loss_reject', 'reject', ApprovalStatus.REJECTED],
  ] as const)(
    'presents an already-handled %s result without invoking a second action',
    async (actionName, workflowMethod, approvalStatus) => {
      mockApprovalWorkflow[workflowMethod].mockResolvedValue({
        approvalId: 'approval-handled',
        approvalStatus,
        claimed: false,
        submitted: false,
        reason: 'ALREADY_HANDLED',
      });
      const handler = registerApprovalAction(actionName);
      const respond = jest.fn().mockResolvedValue(undefined);

      await handler({
        ack: jest.fn().mockResolvedValue(undefined),
        body: {
          actions: [{ value: 'approval-handled' }],
          user: { id: 'U-APPROVER' },
        },
        respond,
      });

      expect(mockApprovalWorkflow[workflowMethod]).toHaveBeenCalledTimes(1);
      expect(respond).toHaveBeenCalledTimes(1);
      expect(respond).toHaveBeenCalledWith({
        text: expect.stringMatching(/이미 처리/),
        replace_original: false,
      });
      expect(mockPrisma.stopLossApproval.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.stopLossApproval.update).not.toHaveBeenCalled();
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
      expect(mockSlackService.updateStopLossApprovalMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['stop_loss_approve', 'approve'],
    ['stop_loss_reject', 'reject'],
  ] as const)(
    'presents an expired %s result without invoking a second action',
    async (actionName, workflowMethod) => {
      mockApprovalWorkflow[workflowMethod].mockResolvedValue({
        approvalId: 'approval-expired',
        approvalStatus: ApprovalStatus.EXPIRED,
        tradeStatus: OrderStatus.CANCELLED,
        claimed: false,
        submitted: false,
        reason: 'EXPIRED',
      });
      const handler = registerApprovalAction(actionName);
      const respond = jest.fn().mockResolvedValue(undefined);

      await handler({
        ack: jest.fn().mockResolvedValue(undefined),
        body: {
          actions: [{ value: 'approval-expired' }],
          user: { id: 'U-APPROVER' },
        },
        respond,
      });

      expect(mockApprovalWorkflow[workflowMethod]).toHaveBeenCalledTimes(1);
      expect(respond).toHaveBeenCalledTimes(1);
      expect(respond).toHaveBeenCalledWith({
        text: expect.stringMatching(/만료/),
        replace_original: false,
      });
      expect(mockPrisma.stopLossApproval.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.stopLossApproval.update).not.toHaveBeenCalled();
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
      expect(mockSlackService.updateStopLossApprovalMessage).not.toHaveBeenCalled();
    },
  );

  it('builds a US session summary using only US positions and session trades', async () => {
    const tradeStart = new Date('2026-06-24T22:30:00+09:00');
    const tradeEnd = new Date('2026-06-25T05:00:00+09:00');

    mockPrisma.position.findMany.mockResolvedValue([
      {
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        exchangeCode: 'NASD',
        market: Market.OVERSEAS,
        quantity: 37,
        avgPrice: 78.79,
        currentPrice: 75.11,
        profitLoss: -136.01,
        profitRate: -4.66,
        totalInvested: 2915.08,
      },
    ]);
    mockPrisma.tradeRecord.findMany.mockResolvedValue([
      { side: Side.BUY, market: Market.OVERSEAS, exchangeCode: 'NASD' },
      { side: Side.SELL, market: Market.OVERSEAS, exchangeCode: 'AMEX' },
    ]);

    const summary = await service.buildDailySummary({
      summaryTitle: '미국장 매매 요약 | 2026-06-24 거래일',
      market: 'OVERSEAS',
      exchangeCodes: ['NASD', 'NYSE', 'AMEX'],
      tradeStart,
      tradeEnd,
    });

    expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
      where: {
        market: Market.OVERSEAS,
        exchangeCode: { in: ['NASD', 'NYSE', 'AMEX'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
    expect(mockPrisma.tradeRecord.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: tradeStart, lte: tradeEnd },
        status: 'FILLED',
        market: Market.OVERSEAS,
        exchangeCode: { in: ['NASD', 'NYSE', 'AMEX'] },
      },
      select: {
        side: true,
        market: true,
        exchangeCode: true,
      },
    });
    expect(summary.summaryTitle).toBe('미국장 매매 요약 | 2026-06-24 거래일');
    expect(summary.todayBuyCount).toBe(1);
    expect(summary.todaySellCount).toBe(1);
    expect(summary.marketSummaries).toHaveLength(1);
    expect(summary.marketSummaries?.[0].label).toBe('미국');
    expect(mockMarketAnalysisService.getMarketCondition).toHaveBeenCalledWith('NASD');
  });
});
