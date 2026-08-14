import {
  ApprovalStatus,
  Broker,
  Market,
  OrderStatus,
  WatchStockExecutionEventType,
} from '@prisma/client';
import { Logger } from '@nestjs/common';
import { TradingSellApprovalNotificationService } from './trading-sell-approval-notification.service';
import { TradingSellApprovalWorkflowService } from './trading-sell-approval-workflow.service';

describe('TradingSellApprovalWorkflowService', () => {
  const now = new Date('2026-07-13T01:00:00.000Z');
  let warnSpy: jest.SpyInstance;
  const matchingBrokerContext = () => ({
    matchesCurrentContext: jest.fn().mockReturnValue(true),
  });
  const submissionGateway = (domestic: any = {}, overseas: any = {}) => ({
    submit: jest.fn((signal) => signal.market === Market.DOMESTIC
      ? domestic.orderSell(signal.stockCode, signal.quantity, signal.price, signal.orderDivision)
      : overseas.orderSell(
        signal.exchangeCode,
        signal.stockCode,
        signal.quantity,
        signal.price || 0,
        signal.orderDivision,
      )),
  });
  const approvalNotification = (prisma: unknown, slack?: unknown) => (
    new TradingSellApprovalNotificationService(prisma as never, slack as never)
  );

  const createPostClaimHarness = (options: any = {}) => {
    jest.useFakeTimers().setSystemTime(now);
    const market = options.market || Market.OVERSEAS;
    const exchangeCode = options.exchangeCode || (market === Market.DOMESTIC ? 'KRX' : 'NASD');
    const stockCode = options.stockCode || (market === Market.DOMESTIC ? '005930' : 'TQQQ');
    const approval = {
      id: 'approval-post-claim',
      tradeRecordId: 'trade-post-claim',
      market,
      exchangeCode,
      stockCode,
      stockName: stockCode,
      signal: {
        market,
        exchangeCode,
        stockCode,
        side: 'SELL',
        quantity: 4,
        price: 220,
        orderDivision: '00',
        reason: 'stop loss',
      },
      quantity: 4,
      status: ApprovalStatus.PENDING,
      notifiedAt: new Date('2026-07-13T00:59:00.000Z'),
      slackMessageTs: '1783904340.000000',
      slackChannel: 'C123',
      expiresAt: new Date('2026-07-13T01:09:00.000Z'),
      tradeRecord: {
        id: 'trade-post-claim',
        broker: Broker.KIS,
        market,
        exchangeCode,
        stockCode,
        stockName: stockCode,
        side: 'SELL',
        orderType: 'LIMIT',
        quantity: 4,
        price: 220,
        status: OrderStatus.AWAITING_APPROVAL,
        strategyName: 'infinite-buy',
        reason: 'stop loss',
        submissionStartedAt: null,
        brokerEnvironment: 'PROD',
        brokerAccountHash: 'account-a-hash',
      },
      ...options.approval,
    };
    approval.tradeRecord = { ...approval.tradeRecord, ...options.tradeRecord };
    approval.signal = { ...approval.signal, ...options.signal };
    const tx = {
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue(approval),
        updateMany: jest.fn().mockResolvedValue({ count: options.approvalClaimCount ?? 1 }),
      },
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: options.tradeClaimCount ?? 1 }),
      },
    };
    const tradeRecordUpdateMany = options.tradeRecordUpdateMany
      || jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue({
          ...approval,
          status: ApprovalStatus.APPROVED,
          tradeRecord: { ...approval.tradeRecord, status: OrderStatus.SUBMITTING },
        }),
        updateMany: options.signalPersistenceError
          ? jest.fn().mockRejectedValue(options.signalPersistenceError)
          : jest.fn().mockResolvedValue({ count: options.signalPersistenceCount ?? 1 }),
      },
      tradeRecord: { updateMany: tradeRecordUpdateMany },
      watchStock: { findUnique: jest.fn().mockResolvedValue(null) },
      watchStockExecutionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const liveSwitch = { isEnabled: jest.fn() };
    const liveResults = options.liveSwitchResults || [true, true];
    for (const enabled of liveResults) liveSwitch.isEnabled.mockReturnValueOnce(enabled);
    liveSwitch.isEnabled.mockReturnValue(liveResults[liveResults.length - 1]);
    const defaultHolding = {
      stockCode,
      stockName: stockCode,
      quantity: 4,
      avgPrice: 200,
      currentPrice: 220,
      profitLoss: 80,
      profitRate: 10,
      ...(market === Market.OVERSEAS ? { exchangeCode } : {}),
    };
    const positionRefresh = {
      refresh: options.refreshError
        ? jest.fn().mockRejectedValue(options.refreshError)
        : jest.fn().mockResolvedValue(options.holdings ?? [defaultHolding]),
    };
    const accepted = {
      outcome: 'ACCEPTED',
      success: true,
      orderNo: 'O-100',
      brokerOrderDate: '20260713',
      orderTime: '100001',
      message: 'accepted',
    };
    const kisDomestic = {
      orderSell: jest.fn().mockResolvedValue(options.orderResult || accepted),
    };
    const kisOverseas = {
      orderSell: jest.fn().mockResolvedValue(options.orderResult || accepted),
    };
    if (options.orderError) {
      kisDomestic.orderSell.mockRejectedValue(options.orderError);
      kisOverseas.orderSell.mockRejectedValue(options.orderError);
    }
    const recovery = {
      markSubmissionUnknown: jest.fn().mockResolvedValue(true),
      warnAcceptedOrderPersistenceFailure: jest.fn().mockResolvedValue(undefined),
    };
    const slack = {
      updateStopLossApprovalMessage: options.slackError
        ? jest.fn().mockRejectedValue(options.slackError)
        : jest.fn().mockResolvedValue(undefined),
    };
    const brokerContext = {
      matchesCurrentContext: jest.fn(),
    };
    const brokerContextResults = options.brokerContextResults || [true, true, true];
    for (const matches of brokerContextResults) {
      brokerContext.matchesCurrentContext.mockReturnValueOnce(matches);
    }
    brokerContext.matchesCurrentContext.mockReturnValue(
      brokerContextResults[brokerContextResults.length - 1],
    );
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway(kisDomestic, kisOverseas) as any,
      liveSwitch as any,
      positionRefresh as any,
      recovery as any,
      brokerContext as any,
      { get: jest.fn().mockReturnValue(['U123']) } as any,
      approvalNotification(prisma, slack) as any,
    );
    return {
      service,
      approval,
      tx,
      prisma,
      liveSwitch,
      positionRefresh,
      kisDomestic,
      kisOverseas,
      recovery,
      slack,
      brokerContext,
      tradeRecordUpdateMany,
    };
  };

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('atomically claims a delivered pending approval and its awaiting trade', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const approval = {
      id: 'approval-1',
      tradeRecordId: 'trade-1',
      market: Market.DOMESTIC,
      exchangeCode: 'KRX',
      stockCode: '005930',
      status: ApprovalStatus.PENDING,
      notifiedAt: new Date('2026-07-13T00:59:00.000Z'),
      slackMessageTs: '1783904340.000000',
      slackChannel: 'C123',
      expiresAt: new Date('2026-07-13T01:09:00.000Z'),
      quantity: 3,
      signal: {
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 3,
        price: 70000,
        orderDivision: '00',
      },
      tradeRecord: {
        id: 'trade-1',
        broker: Broker.KIS,
        market: Market.DOMESTIC,
        exchangeCode: 'KRX',
        stockCode: '005930',
        quantity: 3,
        price: 70000,
        status: OrderStatus.AWAITING_APPROVAL,
      },
    };
    const tx = {
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue(approval),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue({
          ...approval,
          status: ApprovalStatus.APPROVED,
          tradeRecord: { ...approval.tradeRecord, status: OrderStatus.SUBMITTING },
        }),
      },
      tradeRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const liveSwitch = { isEnabled: jest.fn().mockReturnValue(true) };
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway({
        orderSell: jest.fn().mockResolvedValue({
          outcome: 'ACCEPTED',
          success: true,
          orderNo: 'D-1',
          brokerOrderDate: '20260713',
          orderTime: '100000',
          message: 'accepted',
        }),
      }) as any,
      liveSwitch as any,
      {
        refresh: jest.fn().mockResolvedValue([{
          stockCode: '005930',
          stockName: 'Samsung',
          quantity: 3,
          avgPrice: 71000,
          currentPrice: 70000,
          profitLoss: -3000,
          profitRate: -1.4,
        }]),
      } as any,
      { warnAcceptedOrderPersistenceFailure: jest.fn() } as any,
      matchingBrokerContext() as any,
      { get: jest.fn().mockReturnValue(['U123']) } as any,
      approvalNotification(prisma) as any,
    );

    const result = await service.approve('approval-1', 'U123');

    expect(tx.stopLossApproval.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-1',
        status: ApprovalStatus.PENDING,
        expiresAt: { gt: now },
      },
      data: {
        status: ApprovalStatus.APPROVED,
        respondedAt: now,
        respondedBy: 'U123',
      },
    });
    expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'trade-1', status: OrderStatus.AWAITING_APPROVAL },
      data: { status: OrderStatus.SUBMITTING },
    });
    expect(result.claimed).toBe(true);
  });

  it('atomically expires a due pending approval and cancels its awaiting trade', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const approval = {
      id: 'approval-expired',
      tradeRecordId: 'trade-expired',
      market: Market.DOMESTIC,
      exchangeCode: 'KRX',
      stockCode: '005930',
      status: ApprovalStatus.PENDING,
      notifiedAt: new Date('2026-07-13T00:49:00.000Z'),
      slackMessageTs: '1783903740.000000',
      slackChannel: 'C123',
      expiresAt: new Date('2026-07-13T00:59:00.000Z'),
      tradeRecord: {
        id: 'trade-expired',
        status: OrderStatus.AWAITING_APPROVAL,
      },
    };
    const tx = {
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue(approval),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const kisDomestic = { orderSell: jest.fn() };
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway(kisDomestic) as any,
      { isEnabled: jest.fn().mockReturnValue(true) } as any,
      {} as any,
      {} as any,
      matchingBrokerContext() as any,
      { get: jest.fn().mockReturnValue(['U123']) } as any,
      approvalNotification(prisma) as any,
    );

    const result = await service.approve('approval-expired', 'U123');

    expect(tx.stopLossApproval.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-expired',
        status: ApprovalStatus.PENDING,
        expiresAt: { lte: now },
      },
      data: { status: ApprovalStatus.EXPIRED },
    });
    expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'trade-expired', status: OrderStatus.AWAITING_APPROVAL },
      data: { status: OrderStatus.CANCELLED },
    });
    expect(result).toEqual(expect.objectContaining({
      approvalStatus: ApprovalStatus.EXPIRED,
      tradeStatus: OrderStatus.CANCELLED,
      reason: 'EXPIRED',
      claimed: false,
    }));
    expect(kisDomestic.orderSell).not.toHaveBeenCalled();
  });

  it('rolls back a partial pair claim and returns the persisted concurrent outcome', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const approval = {
      id: 'approval-race',
      tradeRecordId: 'trade-race',
      market: Market.DOMESTIC,
      exchangeCode: 'KRX',
      stockCode: '005930',
      status: ApprovalStatus.PENDING,
      notifiedAt: new Date('2026-07-13T00:59:00.000Z'),
      slackMessageTs: '1783904340.000000',
      slackChannel: 'C123',
      expiresAt: new Date('2026-07-13T01:09:00.000Z'),
      tradeRecord: {
        id: 'trade-race',
        status: OrderStatus.AWAITING_APPROVAL,
      },
    };
    const persisted = {
      ...approval,
      status: ApprovalStatus.REJECTED,
      respondedBy: 'U456',
      tradeRecord: { ...approval.tradeRecord, status: OrderStatus.CANCELLED },
    };
    const tx = {
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue(approval),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      stopLossApproval: { findUnique: jest.fn().mockResolvedValue(persisted) },
    };
    const kisDomestic = { orderSell: jest.fn() };
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway(kisDomestic) as any,
      { isEnabled: jest.fn().mockReturnValue(true) } as any,
      {} as any,
      {} as any,
      matchingBrokerContext() as any,
      { get: jest.fn().mockReturnValue(['U123']) } as any,
      approvalNotification(prisma) as any,
    );

    await expect(service.approve('approval-race', 'U123')).resolves.toEqual(
      expect.objectContaining({
        approvalStatus: ApprovalStatus.REJECTED,
        tradeStatus: OrderStatus.CANCELLED,
        claimed: false,
        reason: 'ALREADY_HANDLED',
      }),
    );
    expect(kisDomestic.orderSell).not.toHaveBeenCalled();
  });

  it('atomically rejects an authorized request even while live trading is disabled', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const approval = {
      id: 'approval-reject',
      tradeRecordId: 'trade-reject',
      market: Market.OVERSEAS,
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      status: ApprovalStatus.PENDING,
      notifiedAt: new Date('2026-07-13T00:59:00.000Z'),
      slackMessageTs: '1783904340.000000',
      slackChannel: 'C123',
      expiresAt: new Date('2026-07-13T01:09:00.000Z'),
      tradeRecord: {
        id: 'trade-reject',
        status: OrderStatus.AWAITING_APPROVAL,
      },
    };
    const tx = {
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue(approval),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue({
          ...approval,
          status: ApprovalStatus.REJECTED,
          tradeRecord: { ...approval.tradeRecord, status: OrderStatus.CANCELLED },
        }),
      },
    };
    const liveSwitch = { isEnabled: jest.fn().mockReturnValue(false) };
    const slack = {
      updateStopLossApprovalMessage: jest.fn().mockRejectedValue(new Error('Slack unavailable')),
    };
    const brokerContext = {
      matchesCurrentContext: jest.fn().mockReturnValue(false),
    };
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway() as any,
      liveSwitch as any,
      {} as any,
      {} as any,
      brokerContext as any,
      { get: jest.fn().mockReturnValue(['U123']) } as any,
      approvalNotification(prisma, slack) as any,
    );

    const result = await service.reject('approval-reject', 'U123');

    expect(liveSwitch.isEnabled).not.toHaveBeenCalled();
    expect(brokerContext.matchesCurrentContext).not.toHaveBeenCalled();
    expect(tx.stopLossApproval.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-reject',
        status: ApprovalStatus.PENDING,
        expiresAt: { gt: now },
      },
      data: {
        status: ApprovalStatus.REJECTED,
        respondedAt: now,
        respondedBy: 'U123',
      },
    });
    expect(tx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'trade-reject', status: OrderStatus.AWAITING_APPROVAL },
      data: { status: OrderStatus.CANCELLED },
    });
    expect(result).toEqual(expect.objectContaining({
      approvalStatus: ApprovalStatus.REJECTED,
      tradeStatus: OrderStatus.CANCELLED,
      claimed: true,
      submitted: false,
    }));
    expect(slack.updateStopLossApprovalMessage).toHaveBeenCalledWith(
      'C123',
      '1783904340.000000',
      'TQQQ',
      'REJECTED',
    );
  });

  it('expires a due pair before applying the pre-claim live-switch gate', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const approval = {
      id: 'approval-due-disabled',
      tradeRecordId: 'trade-due-disabled',
      market: Market.DOMESTIC,
      exchangeCode: 'KRX',
      stockCode: '005930',
      status: ApprovalStatus.PENDING,
      notifiedAt: new Date('2026-07-13T00:49:00.000Z'),
      slackMessageTs: '1783903740.000000',
      slackChannel: 'C123',
      expiresAt: new Date('2026-07-13T00:59:00.000Z'),
      tradeRecord: { id: 'trade-due-disabled', status: OrderStatus.AWAITING_APPROVAL },
    };
    const tx = {
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue(approval),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tradeRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway() as any,
      { isEnabled: jest.fn().mockReturnValue(false) } as any,
      {} as any,
      {} as any,
      matchingBrokerContext() as any,
      { get: jest.fn().mockReturnValue(['U123']) } as any,
      approvalNotification(prisma) as any,
    );

    const result = await service.approve('approval-due-disabled', 'U123');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      approvalStatus: ApprovalStatus.EXPIRED,
      tradeStatus: OrderStatus.CANCELLED,
      reason: 'EXPIRED',
    }));
  });

  it('fails closed on a malformed allowlist before any DB, refresh, or KIS read', async () => {
    const prisma = { $transaction: jest.fn() };
    const kisDomestic = { orderSell: jest.fn() };
    const kisOverseas = { orderSell: jest.fn() };
    const liveSwitch = { isEnabled: jest.fn() };
    const positionRefresh = { refresh: jest.fn() };
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway(kisDomestic, kisOverseas) as any,
      liveSwitch as any,
      positionRefresh as any,
      {} as any,
      matchingBrokerContext() as any,
      { get: jest.fn().mockReturnValue('U123,U456') } as any,
      approvalNotification(prisma) as any,
    );

    const result = await service.approve('approval-1', 'U12');

    expect(result).toEqual({
      approvalId: 'approval-1',
      claimed: false,
      submitted: false,
      reason: 'UNAUTHORIZED',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(liveSwitch.isEnabled).not.toHaveBeenCalled();
    expect(positionRefresh.refresh).not.toHaveBeenCalled();
    expect(kisDomestic.orderSell).not.toHaveBeenCalled();
    expect(kisOverseas.orderSell).not.toHaveBeenCalled();
  });

  it.each([
    ['notifiedAt', { notifiedAt: null }],
    ['Slack message timestamp', { slackMessageTs: '   ' }],
    ['Slack channel', { slackChannel: '' }],
  ])('does not mutate a pending pair missing its persisted %s anchor', async (_label, missing) => {
    jest.useFakeTimers().setSystemTime(now);
    const approval = {
      id: 'approval-undelivered',
      tradeRecordId: 'trade-undelivered',
      market: Market.DOMESTIC,
      exchangeCode: 'KRX',
      stockCode: '005930',
      status: ApprovalStatus.PENDING,
      notifiedAt: new Date('2026-07-13T00:59:00.000Z'),
      slackMessageTs: '1783904340.000000',
      slackChannel: 'C123',
      expiresAt: new Date('2026-07-13T01:09:00.000Z'),
      tradeRecord: { id: 'trade-undelivered', status: OrderStatus.AWAITING_APPROVAL },
      ...missing,
    };
    const tx = {
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue(approval),
        updateMany: jest.fn(),
      },
      tradeRecord: { updateMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const liveSwitch = { isEnabled: jest.fn() };
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway({ orderSell: jest.fn() }, { orderSell: jest.fn() }) as any,
      liveSwitch as any,
      { refresh: jest.fn() } as any,
      {} as any,
      matchingBrokerContext() as any,
      { get: jest.fn().mockReturnValue(['U123']) } as any,
      approvalNotification(prisma) as any,
    );

    const result = await service.approve('approval-undelivered', 'U123');

    expect(result).toEqual(expect.objectContaining({
      approvalStatus: ApprovalStatus.PENDING,
      tradeStatus: OrderStatus.AWAITING_APPROVAL,
      reason: 'DELIVERY_NOT_READY',
    }));
    expect(tx.stopLossApproval.updateMany).not.toHaveBeenCalled();
    expect(tx.tradeRecord.updateMany).not.toHaveBeenCalled();
    expect(liveSwitch.isEnabled).not.toHaveBeenCalled();
  });

  it('lets only one concurrent approval winner invoke one KIS sell POST', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const state = {
      approvalStatus: ApprovalStatus.PENDING as ApprovalStatus,
      tradeStatus: OrderStatus.AWAITING_APPROVAL as OrderStatus,
      submissionStartedAt: null as Date | null,
      quantity: 5,
    };
    const readApproval = () => ({
      id: 'approval-concurrent',
      tradeRecordId: 'trade-concurrent',
      market: Market.DOMESTIC,
      exchangeCode: 'KRX',
      stockCode: '005930',
      stockName: 'Samsung',
      signal: {
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
        quantity: 5,
        price: 70000,
        orderDivision: '00',
        reason: 'stop loss',
      },
      quantity: 5,
      status: state.approvalStatus,
      notifiedAt: new Date('2026-07-13T00:59:00.000Z'),
      slackMessageTs: '1783904340.000000',
      slackChannel: 'C123',
      expiresAt: new Date('2026-07-13T01:09:00.000Z'),
      tradeRecord: {
        id: 'trade-concurrent',
        market: Market.DOMESTIC,
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        side: 'SELL',
        orderType: 'LIMIT',
        quantity: state.quantity,
        price: 70000,
        status: state.tradeStatus,
        strategyName: 'momentum-breakout',
        reason: 'stop loss',
        submissionStartedAt: state.submissionStartedAt,
      },
    });
    const tx = {
      stopLossApproval: {
        findUnique: jest.fn(async () => readApproval()),
        updateMany: jest.fn(async ({ data }: any) => {
          if (state.approvalStatus !== ApprovalStatus.PENDING) return { count: 0 };
          state.approvalStatus = data.status;
          return { count: 1 };
        }),
      },
      tradeRecord: {
        updateMany: jest.fn(async ({ data }: any) => {
          if (state.tradeStatus !== OrderStatus.AWAITING_APPROVAL) return { count: 0 };
          state.tradeStatus = data.status;
          return { count: 1 };
        }),
      },
    };
    const tradeRecordUpdateMany = jest.fn(async ({ data }: any) => {
      if (
        data.submissionStartedAt
        && state.tradeStatus === OrderStatus.SUBMITTING
        && state.submissionStartedAt === null
      ) {
        state.submissionStartedAt = data.submissionStartedAt;
        state.quantity = data.quantity;
        return { count: 1 };
      }
      if (data.status === OrderStatus.PENDING && state.tradeStatus === OrderStatus.SUBMITTING) {
        state.tradeStatus = OrderStatus.PENDING;
        return { count: 1 };
      }
      return { count: 0 };
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      stopLossApproval: {
        findUnique: jest.fn(async () => readApproval()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tradeRecord: { updateMany: tradeRecordUpdateMany },
      watchStock: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const kisDomestic = {
      orderSell: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'D-100',
        brokerOrderDate: '20260713',
        orderTime: '100001',
        message: 'accepted',
      }),
    };
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway(kisDomestic, { orderSell: jest.fn() }) as any,
      { isEnabled: jest.fn().mockReturnValue(true) } as any,
      {
        refresh: jest.fn().mockResolvedValue([{
          stockCode: '005930',
          stockName: 'Samsung',
          quantity: 5,
          avgPrice: 71000,
          currentPrice: 70000,
          profitLoss: -5000,
          profitRate: -1.4,
        }]),
      } as any,
      {
        markSubmissionUnknown: jest.fn(),
        warnAcceptedOrderPersistenceFailure: jest.fn(),
      } as any,
      matchingBrokerContext() as any,
      { get: jest.fn().mockReturnValue(['U123']) } as any,
      approvalNotification(prisma, { updateStopLossApprovalMessage: jest.fn() }) as any,
    );

    const results = await Promise.all([
      service.approve('approval-concurrent', 'U123'),
      service.approve('approval-concurrent', 'U123'),
    ]);

    expect(kisDomestic.orderSell).toHaveBeenCalledTimes(1);
    expect(kisDomestic.orderSell).toHaveBeenCalledWith('005930', 5, 70000, '00');
    expect(results.filter((result) => result.submitted)).toHaveLength(1);
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
  });

  it('cancels the pre-submit trade when the broker position refresh fails', async () => {
    const harness = createPostClaimHarness({ refreshError: new Error('balance unavailable') });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.tradeRecordUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-post-claim',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: {
        status: OrderStatus.CANCELLED,
        brokerMessage: 'Position refresh failed: balance unavailable',
      },
    });
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.CANCELLED,
      reason: 'REFRESH_FAILED',
    }));
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
  });

  it('cancels when no venue-matching broker holding exists', async () => {
    const harness = createPostClaimHarness({
      holdings: [{
        stockCode: ' tqqq ',
        stockName: 'TQQQ',
        exchangeCode: 'NYSE',
        quantity: 10,
        avgPrice: 200,
        currentPrice: 220,
        profitLoss: 200,
        profitRate: 10,
      }],
    });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.CANCELLED,
      reason: 'NO_HOLDING',
    }));
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
  });

  it('normalizes the overseas venue and stock, clamps quantity, and persists it in the POST CAS', async () => {
    const harness = createPostClaimHarness({
      exchangeCode: 'nasd',
      stockCode: 'tqqq',
      holdings: [{
        stockCode: ' TQQQ ',
        stockName: 'TQQQ',
        exchangeCode: ' NASD ',
        quantity: 2,
        avgPrice: 200,
        currentPrice: 220,
        profitLoss: 40,
        profitRate: 10,
      }],
    });

    await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.prisma.stopLossApproval.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-post-claim',
        tradeRecordId: 'trade-post-claim',
        status: ApprovalStatus.APPROVED,
      },
      data: {
        signal: expect.objectContaining({ quantity: 2 }),
      },
    });
    expect(harness.tradeRecordUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'trade-post-claim',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: { quantity: 2, submissionStartedAt: expect.any(Date) },
    });
    expect(harness.kisOverseas.orderSell).toHaveBeenCalledWith(
      'nasd',
      'tqqq',
      2,
      220,
      '00',
    );
  });

  it('mirrors one approved submission with the clamped broker quantity', async () => {
    const harness = createPostClaimHarness({
      holdings: [{
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        exchangeCode: 'NASD',
        quantity: 2,
        avgPrice: 200,
        currentPrice: 220,
        profitLoss: 40,
        profitRate: 10,
      }],
    });
    harness.prisma.watchStock.findUnique.mockResolvedValue({ id: 'watch-approved' });

    await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.prisma.watchStockExecutionLog.create).toHaveBeenCalledTimes(1);
    expect(harness.prisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        watchStockId: 'watch-approved',
        tradeRecordId: 'trade-post-claim',
        eventType: WatchStockExecutionEventType.ORDER_SUBMITTED,
        message: '주문 제출: SELL 2주',
        details: expect.objectContaining({
          side: 'SELL',
          quantity: 2,
          approvedSell: true,
        }),
      }),
    });
    expect(harness.kisOverseas.orderSell).toHaveBeenCalledTimes(1);
  });

  it('cancels before KIS when clamped approval-signal persistence throws', async () => {
    const harness = createPostClaimHarness({
      signalPersistenceError: new Error('approval signal unavailable'),
    });

    await expect(
      harness.service.approve('approval-post-claim', 'U123'),
    ).resolves.toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.CANCELLED,
      submitted: false,
      reason: 'STATE_CHANGED',
    }));

    expect(harness.tradeRecordUpdateMany).toHaveBeenCalledTimes(1);
    expect(harness.tradeRecordUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-post-claim',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: {
        status: OrderStatus.CANCELLED,
        brokerMessage: '승인 주문 수량 저장 실패로 주문 취소',
      },
    });
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
  });

  it('cancels before KIS when clamped approval-signal persistence loses its CAS', async () => {
    const harness = createPostClaimHarness({ signalPersistenceCount: 0 });

    await expect(
      harness.service.approve('approval-post-claim', 'U123'),
    ).resolves.toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.CANCELLED,
      submitted: false,
      reason: 'STATE_CHANGED',
    }));

    expect(harness.tradeRecordUpdateMany).toHaveBeenCalledTimes(1);
    expect(harness.tradeRecordUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-post-claim',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: {
        status: OrderStatus.CANCELLED,
        brokerMessage: '승인 주문 수량 저장 실패로 주문 취소',
      },
    });
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
  });

  it('continues an approved submission when its execution-log mirror fails', async () => {
    const harness = createPostClaimHarness();
    harness.prisma.watchStock.findUnique.mockResolvedValue({ id: 'watch-mirror-failure' });
    harness.prisma.watchStockExecutionLog.create.mockRejectedValue(
      new Error('approved mirror unavailable'),
    );

    await expect(
      harness.service.approve('approval-post-claim', 'U123'),
    ).resolves.toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.PENDING,
      submitted: true,
    }));

    expect(harness.kisOverseas.orderSell).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[TQQQ] Approved submission mirror failed: approved mirror unavailable',
    );
  });

  it('cancels after claim when the live switch turns off before the POST', async () => {
    const harness = createPostClaimHarness({ liveSwitchResults: [true, false] });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.CANCELLED,
      reason: 'TRADING_DISABLED',
    }));
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
  });

  it('leaves a pending approval untouched when its stored broker context does not match', async () => {
    const harness = createPostClaimHarness({ brokerContextResults: [false] });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.brokerContext.matchesCurrentContext).toHaveBeenCalledWith(
      'PROD',
      'account-a-hash',
    );
    expect(harness.tx.stopLossApproval.updateMany).not.toHaveBeenCalled();
    expect(harness.tx.tradeRecord.updateMany).not.toHaveBeenCalled();
    expect(harness.positionRefresh.refresh).not.toHaveBeenCalled();
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
    expect(harness.slack.updateStopLossApprovalMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      approvalId: 'approval-post-claim',
      approvalStatus: ApprovalStatus.PENDING,
      tradeRecordId: 'trade-post-claim',
      tradeStatus: OrderStatus.AWAITING_APPROVAL,
      claimed: false,
      submitted: false,
      reason: 'BROKER_CONTEXT_MISMATCH',
    });
  });

  it('treats a missing stored broker context as a pre-claim mismatch', async () => {
    const harness = createPostClaimHarness({
      brokerContextResults: [false],
      tradeRecord: {
        brokerEnvironment: null,
        brokerAccountHash: null,
      },
    });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.brokerContext.matchesCurrentContext).toHaveBeenCalledWith(null, null);
    expect(harness.tx.stopLossApproval.updateMany).not.toHaveBeenCalled();
    expect(harness.tx.tradeRecord.updateMany).not.toHaveBeenCalled();
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      claimed: false,
      submitted: false,
      reason: 'BROKER_CONTEXT_MISMATCH',
    }));
  });

  it.each([
    ['before broker refresh', [true, false], 2, 0],
    ['before submission claim', [true, true, false], 3, 1],
  ] as const)(
    'cancels its unstarted claimed pair when the broker context changes %s',
    async (_label, brokerContextResults, expectedContextChecks, expectedRefreshCalls) => {
      const harness = createPostClaimHarness({
        brokerContextResults,
      });

      const result = await harness.service.approve('approval-post-claim', 'U123');

      expect(harness.brokerContext.matchesCurrentContext).toHaveBeenCalledTimes(
        expectedContextChecks,
      );
      expect(harness.positionRefresh.refresh).toHaveBeenCalledTimes(expectedRefreshCalls);
      expect(harness.tradeRecordUpdateMany).toHaveBeenCalledTimes(1);
      expect(harness.tradeRecordUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-post-claim',
          status: OrderStatus.SUBMITTING,
          submissionStartedAt: null,
        },
        data: {
          status: OrderStatus.CANCELLED,
          brokerMessage: 'Broker context changed before submission',
        },
      });
      expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        claimed: true,
        submitted: false,
        tradeStatus: OrderStatus.CANCELLED,
        reason: 'BROKER_CONTEXT_MISMATCH',
      }));
    },
  );

  it.each([
    ['refresh failure', { refreshError: new Error('balance unavailable') }],
    ['no matching holding', { holdings: [] }],
    ['post-claim live switch disable', { liveSwitchResults: [true, false] }],
  ])('returns persisted state when pre-submit cancellation loses for %s', async (_label, options) => {
    const harness = createPostClaimHarness({
      ...options,
      tradeRecordUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    (harness.prisma.tradeRecord as any).findUnique = jest.fn().mockResolvedValue({
      status: OrderStatus.FAILED,
    });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.FAILED,
      submitted: false,
      reason: 'STATE_CHANGED',
    }));
    expect(warnSpy).toHaveBeenCalledWith(
      '[TQQQ] Trade state changed before workflow persistence: FAILED',
    );
  });

  it('does not call KIS when the submissionStartedAt CAS loses', async () => {
    const harness = createPostClaimHarness({
      tradeRecordUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    harness.prisma.watchStock.findUnique.mockResolvedValue({ id: 'watch-cas-loser' });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(result).toEqual(expect.objectContaining({
      claimed: false,
      submitted: false,
      reason: 'SUBMISSION_CLAIM_LOST',
    }));
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
    expect(harness.prisma.watchStockExecutionLog.create).not.toHaveBeenCalled();
  });

  it('cancels the exact submission claim when the broker context changes during its CAS', async () => {
    let contextMatches = true;
    let submissionStartedAt: Date | undefined;
    const updateMany = jest.fn().mockImplementation(async ({ data }: any) => {
      if (data.submissionStartedAt) {
        submissionStartedAt = data.submissionStartedAt;
        contextMatches = false;
      }
      return { count: 1 };
    });
    const harness = createPostClaimHarness({ tradeRecordUpdateMany: updateMany });
    harness.brokerContext.matchesCurrentContext.mockImplementation(() => contextMatches);
    harness.prisma.watchStock.findUnique.mockResolvedValue({ id: 'watch-context-cas' });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(submissionStartedAt).toEqual(expect.any(Date));
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'trade-post-claim',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt,
      },
      data: {
        status: OrderStatus.CANCELLED,
        submissionStartedAt: null,
        brokerMessage: 'Broker context changed after submission claim',
      },
    });
    expect(harness.prisma.watchStockExecutionLog.create).not.toHaveBeenCalled();
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.CANCELLED,
      submitted: false,
      reason: 'BROKER_CONTEXT_MISMATCH',
    }));
  });

  it('rechecks broker context after the winning submission audit and cancels by timestamp', async () => {
    let contextMatches = true;
    const harness = createPostClaimHarness();
    harness.brokerContext.matchesCurrentContext.mockImplementation(() => contextMatches);
    harness.prisma.watchStock.findUnique.mockResolvedValue({ id: 'watch-context-audit' });
    harness.prisma.watchStockExecutionLog.create.mockImplementation(async () => {
      contextMatches = false;
      return {};
    });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    const submissionStartedAt = harness.tradeRecordUpdateMany.mock.calls[0][0]
      .data.submissionStartedAt;
    expect(harness.tradeRecordUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'trade-post-claim',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt,
      },
      data: {
        status: OrderStatus.CANCELLED,
        submissionStartedAt: null,
        brokerMessage: 'Broker context changed after submission claim',
      },
    });
    expect(harness.prisma.watchStockExecutionLog.create).toHaveBeenCalledTimes(1);
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.CANCELLED,
      reason: 'BROKER_CONTEXT_MISMATCH',
    }));
  });

  it('rechecks the live switch after the winning submission audit and cancels by timestamp', async () => {
    const harness = createPostClaimHarness({
      liveSwitchResults: [true, true, true, false],
    });
    harness.prisma.watchStock.findUnique.mockResolvedValue({ id: 'watch-live-audit' });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    const submissionStartedAt = harness.tradeRecordUpdateMany.mock.calls[0][0]
      .data.submissionStartedAt;
    expect(harness.tradeRecordUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'trade-post-claim',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt,
      },
      data: {
        status: OrderStatus.CANCELLED,
        submissionStartedAt: null,
        brokerMessage: 'Live trading disabled after submission claim',
      },
    });
    expect(harness.prisma.watchStockExecutionLog.create).toHaveBeenCalledTimes(1);
    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.CANCELLED,
      reason: 'TRADING_DISABLED',
    }));
  });

  it('renders a lost submission claim as unknown instead of confirmed not-submitted', async () => {
    const harness = createPostClaimHarness({
      tradeRecordUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });

    await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
    expect(harness.slack.updateStopLossApprovalMessage).toHaveBeenCalledWith(
      'C123',
      '1783904340.000000',
      'TQQQ',
      'APPROVED_UNKNOWN',
    );
  });

  it('renders a failed pre-submit cancellation CAS as unknown', async () => {
    const harness = createPostClaimHarness({
      holdings: [],
      tradeRecordUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    (harness.prisma.tradeRecord as any).findUnique = jest.fn().mockResolvedValue({
      status: OrderStatus.FAILED,
    });

    await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.kisOverseas.orderSell).not.toHaveBeenCalled();
    expect(harness.slack.updateStopLossApprovalMessage).toHaveBeenCalledWith(
      'C123',
      '1783904340.000000',
      'TQQQ',
      'APPROVED_UNKNOWN',
    );
  });

  it('retries only accepted-result persistence three total times and warns when every CAS returns zero', async () => {
    const persistence = jest.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });
    const harness = createPostClaimHarness({ tradeRecordUpdateMany: persistence });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.kisOverseas.orderSell).toHaveBeenCalledTimes(1);
    expect(persistence).toHaveBeenCalledTimes(4);
    expect(harness.recovery.warnAcceptedOrderPersistenceFailure).toHaveBeenCalledWith({
      market: Market.OVERSEAS,
      stockCode: 'TQQQ',
      tradeRecordId: 'trade-post-claim',
      orderNo: 'O-100',
    });
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.SUBMITTING,
      submitted: true,
      reason: 'ACCEPTED_PERSISTENCE_PENDING',
    }));
  });

  it('maps a complete ACCEPTED identity to PENDING with broker identity fields', async () => {
    const harness = createPostClaimHarness();

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.tradeRecordUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'trade-post-claim',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: { not: null },
      },
      data: {
        status: OrderStatus.PENDING,
        orderNo: 'O-100',
        brokerOrderDate: '20260713',
        brokerOrderTime: '100001',
        brokerMessage: 'accepted',
      },
    });
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.PENDING,
      submitted: true,
    }));
  });

  it('maps a typed REJECTED outcome to FAILED without unknown recovery', async () => {
    const harness = createPostClaimHarness({
      orderResult: {
        outcome: 'REJECTED',
        success: false,
        message: 'insufficient holding',
      },
    });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.tradeRecordUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'trade-post-claim',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: { not: null },
      },
      data: {
        status: OrderStatus.FAILED,
        brokerMessage: 'insufficient holding',
      },
    });
    expect(harness.recovery.markSubmissionUnknown).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.FAILED,
      reason: 'BROKER_REJECTED',
    }));
  });

  it('returns the persisted trade status when the broker REJECTED CAS loses', async () => {
    const updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const harness = createPostClaimHarness({
      tradeRecordUpdateMany: updateMany,
      orderResult: {
        outcome: 'REJECTED',
        success: false,
        message: 'insufficient holding',
      },
    });
    (harness.prisma.tradeRecord as any).findUnique = jest.fn().mockResolvedValue({
      status: OrderStatus.CANCELLED,
    });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.kisOverseas.orderSell).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.CANCELLED,
      submitted: true,
      reason: 'STATE_CHANGED',
    }));
    expect(warnSpy).toHaveBeenCalledWith(
      '[TQQQ] Trade state changed before workflow persistence: CANCELLED',
    );
  });

  it('maps a typed UNKNOWN outcome through durable unknown recovery', async () => {
    const harness = createPostClaimHarness({
      orderResult: {
        outcome: 'UNKNOWN',
        success: false,
        message: 'transport outcome unknown',
      },
    });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.recovery.markSubmissionUnknown).toHaveBeenCalledWith(
      'trade-post-claim',
      'transport outcome unknown',
    );
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.SUBMISSION_UNKNOWN,
      reason: 'BROKER_UNKNOWN',
    }));
  });

  it('maps a thrown KIS mutation through durable unknown recovery without retrying KIS', async () => {
    const harness = createPostClaimHarness({ orderError: new Error('socket timeout') });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.kisOverseas.orderSell).toHaveBeenCalledTimes(1);
    expect(harness.recovery.markSubmissionUnknown).toHaveBeenCalledWith(
      'trade-post-claim',
      'socket timeout',
    );
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.SUBMISSION_UNKNOWN,
      reason: 'BROKER_UNKNOWN',
    }));
  });

  it('treats nominal ACCEPTED with incomplete identity as durable unknown', async () => {
    const harness = createPostClaimHarness({
      orderResult: {
        outcome: 'ACCEPTED',
        success: true,
        orderNo: '   ',
        brokerOrderDate: '20260713',
        orderTime: '100001',
        message: 'nominal success',
      },
    });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.recovery.markSubmissionUnknown).toHaveBeenCalledWith(
      'trade-post-claim',
      'Accepted broker response missing required order identity',
    );
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.SUBMISSION_UNKNOWN,
      reason: 'BROKER_UNKNOWN',
    }));
  });

  it.each([
    [
      'thrown KIS mutation',
      { orderError: new Error('socket timeout') },
    ],
    [
      'typed UNKNOWN',
      {
        orderResult: {
          outcome: 'UNKNOWN',
          success: false,
          message: 'transport outcome unknown',
        },
      },
    ],
    [
      'incomplete nominal ACCEPTED',
      {
        orderResult: {
          outcome: 'ACCEPTED',
          success: true,
          orderNo: '   ',
          brokerOrderDate: '20260713',
          orderTime: '100001',
          message: 'nominal success',
        },
      },
    ],
  ])('returns persisted state when UNKNOWN recovery loses for %s', async (_label, options) => {
    const harness = createPostClaimHarness(options);
    harness.recovery.markSubmissionUnknown.mockResolvedValue(false);
    (harness.prisma.tradeRecord as any).findUnique = jest.fn().mockResolvedValue({
      status: OrderStatus.FAILED,
    });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.kisOverseas.orderSell).toHaveBeenCalledTimes(1);
    expect(harness.recovery.markSubmissionUnknown).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.FAILED,
      submitted: true,
      reason: 'STATE_CHANGED',
    }));
    expect(warnSpy).toHaveBeenCalledWith(
      '[TQQQ] Trade state changed before workflow persistence: FAILED',
    );
  });

  it('removes expired Slack actions best-effort after the atomic expiry decision', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const approval = {
      id: 'approval-expired-slack',
      tradeRecordId: 'trade-expired-slack',
      market: Market.DOMESTIC,
      exchangeCode: 'KRX',
      stockCode: '005930',
      status: ApprovalStatus.PENDING,
      notifiedAt: new Date('2026-07-13T00:49:00.000Z'),
      slackMessageTs: '1783903740.000000',
      slackChannel: 'C123',
      expiresAt: new Date('2026-07-13T00:59:00.000Z'),
      tradeRecord: { id: 'trade-expired-slack', status: OrderStatus.AWAITING_APPROVAL },
    };
    const tx = {
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue(approval),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tradeRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      stopLossApproval: {
        findUnique: jest.fn().mockResolvedValue({
          ...approval,
          status: ApprovalStatus.EXPIRED,
          tradeRecord: { ...approval.tradeRecord, status: OrderStatus.CANCELLED },
        }),
      },
    };
    const slack = { updateStopLossApprovalMessage: jest.fn().mockResolvedValue(undefined) };
    const service = new TradingSellApprovalWorkflowService(
      prisma as any,
      submissionGateway() as any,
      { isEnabled: jest.fn().mockReturnValue(false) } as any,
      {} as any,
      {} as any,
      matchingBrokerContext() as any,
      { get: jest.fn().mockReturnValue(['U123']) } as any,
      approvalNotification(prisma, slack) as any,
    );

    await service.approve('approval-expired-slack', 'U123');

    expect(slack.updateStopLossApprovalMessage).toHaveBeenCalledWith(
      'C123',
      '1783903740.000000',
      '005930',
      'EXPIRED',
    );
  });

  it('retries accepted-result DB errors without retrying KIS and stops after persistence succeeds', async () => {
    const persistence = jest.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('db unavailable 1'))
      .mockRejectedValueOnce(new Error('db unavailable 2'))
      .mockResolvedValueOnce({ count: 1 });
    const harness = createPostClaimHarness({ tradeRecordUpdateMany: persistence });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.kisOverseas.orderSell).toHaveBeenCalledTimes(1);
    expect(persistence).toHaveBeenCalledTimes(4);
    expect(harness.recovery.warnAcceptedOrderPersistenceFailure).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.PENDING,
      submitted: true,
    }));
  });

  it('updates the original Slack message only after refresh, KIS, and accepted persistence', async () => {
    const events: string[] = [];
    const harness = createPostClaimHarness();
    const holding = {
      stockCode: 'TQQQ',
      stockName: 'TQQQ',
      exchangeCode: 'NASD',
      quantity: 4,
      avgPrice: 200,
      currentPrice: 220,
      profitLoss: 80,
      profitRate: 10,
    };
    harness.positionRefresh.refresh.mockImplementation(async () => {
      events.push('refresh');
      return [holding];
    });
    harness.kisOverseas.orderSell.mockImplementation(async () => {
      events.push('kis');
      return {
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'O-100',
        brokerOrderDate: '20260713',
        orderTime: '100001',
        message: 'accepted',
      };
    });
    harness.tradeRecordUpdateMany.mockImplementation(async ({ data }: any) => {
      if (data.status === OrderStatus.PENDING) events.push('persisted');
      return { count: 1 };
    });
    harness.slack.updateStopLossApprovalMessage.mockImplementation(async () => {
      events.push('slack');
    });

    await harness.service.approve('approval-post-claim', 'U123');

    expect(events).toEqual(['refresh', 'kis', 'persisted', 'slack']);
    expect(harness.slack.updateStopLossApprovalMessage).toHaveBeenCalledTimes(1);
    expect(harness.slack.updateStopLossApprovalMessage).toHaveBeenCalledWith(
      'C123',
      '1783904340.000000',
      'TQQQ',
      'APPROVED_ACCEPTED',
    );
  });

  it.each([
    ['accepted order', {}, 'APPROVED_ACCEPTED', 1],
    ['pre-submit cancellation', { holdings: [] }, 'APPROVED_NOT_SUBMITTED', 0],
    [
      'KIS rejection',
      { orderResult: { outcome: 'REJECTED', success: false, message: 'rejected' } },
      'APPROVED_REJECTED',
      1,
    ],
    [
      'unknown KIS result',
      { orderResult: { outcome: 'UNKNOWN', success: false, message: 'timeout' } },
      'APPROVED_UNKNOWN',
      1,
    ],
  ] as const)(
    'maps %s to one authoritative Slack result',
    async (_label, options, expectedStatus, expectedKisCalls) => {
      const harness = createPostClaimHarness(options);

      await harness.service.approve('approval-post-claim', 'U123');

      expect(harness.slack.updateStopLossApprovalMessage).toHaveBeenCalledTimes(1);
      expect(harness.slack.updateStopLossApprovalMessage).toHaveBeenCalledWith(
        'C123',
        '1783904340.000000',
        'TQQQ',
        expectedStatus,
      );
      expect(harness.kisOverseas.orderSell).toHaveBeenCalledTimes(expectedKisCalls);
    },
  );

  it('continues refresh and KIS submission when the best-effort Slack update fails', async () => {
    const harness = createPostClaimHarness({ slackError: new Error('Slack unavailable') });

    const result = await harness.service.approve('approval-post-claim', 'U123');

    expect(harness.slack.updateStopLossApprovalMessage).toHaveBeenCalledTimes(1);
    expect(harness.positionRefresh.refresh).toHaveBeenCalledTimes(1);
    expect(harness.kisOverseas.orderSell).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      tradeStatus: OrderStatus.PENDING,
      submitted: true,
    }));
  });
});
