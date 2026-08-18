import { TradingSellApprovalService } from './trading-sell-approval.service';
import { Broker } from '@prisma/client';
import { TradingSignal } from './types';

describe('TradingSellApprovalService', () => {
  const service = new TradingSellApprovalService({} as any, {} as any, {} as any);

  function makeSell(
    metadata: Record<string, unknown> = {},
    overrides: Partial<TradingSignal> = {},
  ): TradingSignal {
    return {
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      side: 'SELL',
      quantity: 1,
      price: 50,
      reason: 'ordinary sell',
      metadata,
      ...overrides,
    };
  }

  it.each([
    ['stop-loss', true],
    ['risk-liquidation', true],
    ['eod-exit', true],
    ['carryover-exit', true],
    ['trailing-stop', true],
    ['trend-exit', false],
    ['overheat-exit', false],
    ['take-profit', false],
  ])('classifies phase %s as approval=%s', (phase, expected) => {
    expect(service.shouldRequireApproval(makeSell({ phase }))).toBe(expected);
  });

  it.each([
    [
      'infinite-buy take-profit below T=20',
      makeSell(
        { phase: 'take-profit-1', tValue: 19.999 },
        { reason: 'Take profit 1: T=19.999' },
      ),
      'infinite-buy',
      false,
    ],
    [
      'infinite-buy take-profit at T=20',
      makeSell(
        { phase: 'take-profit-1', tValue: 20 },
        { reason: 'Take profit 1: T=20' },
      ),
      'infinite-buy',
      true,
    ],
    [
      'BUY even with high-T take-profit metadata',
      makeSell(
        { phase: 'take-profit-1', tValue: 20 },
        { side: 'BUY', reason: 'Take profit 1: T=20' },
      ),
      'infinite-buy',
      false,
    ],
    [
      'ordinary take-profit',
      makeSell({ phase: 'take-profit' }, { reason: '익절: +10%' }),
      undefined,
      false,
    ],
    [
      'Korean stop-loss',
      makeSell({}, { reason: '손절: -10%' }),
      undefined,
      true,
    ],
    [
      'English stop-loss',
      makeSell({}, { reason: 'Stop loss: -10%' }),
      undefined,
      true,
    ],
    [
      'unknown ordinary SELL',
      makeSell({}, { reason: 'rebalance exit' }),
      undefined,
      false,
    ],
    [
      'ordinary overheat SELL',
      makeSell({ phase: 'overheat-exit' }, { reason: '과열청산: RSI=75 > 70' }),
      undefined,
      false,
    ],
  ])('classifies %s', (_name, signal, strategyName, expected) => {
    expect(service.shouldRequireApproval(signal as TradingSignal, strategyName as string | undefined))
      .toBe(expected);
  });

  describe('infinite-buy-v4 승인 allowlist 예외 (D3)', () => {
    // v4-quarter-sell/v4-reverse-sell/v4-final-sell은 정례 매도라 자동 실행되어야 한다 (§6.3).
    // 1) MANUAL_SELL_APPROVAL_PHASES/보호성 reason 패턴에 걸리지 않아야 하고,
    // 2) "infinite-buy T>=20 익절 승인" 규칙이 strategyName 정확 일치(!== 'infinite-buy')라
    //    'infinite-buy-v4'를 오폭하지 않아야 한다.
    it.each(['v4-quarter-sell', 'v4-reverse-sell', 'v4-final-sell'])(
      '%s는 T가 20 이상이어도 승인 없이 자동 실행된다',
      (phase) => {
        const signal = makeSell(
          { phase, tValue: 39.5 },
          { reason: `V4 ${phase}: 25주 @ 53.75` },
        );
        expect(service.shouldRequireApproval(signal, 'infinite-buy-v4')).toBe(false);
      },
    );

    it('전략명이 정확히 infinite-buy가 아니면(-v4) 기존 고T 익절 승인 규칙이 적용되지 않는다', () => {
      const signal = makeSell(
        { phase: 'v4-quarter-sell', tValue: 39.5 },
        { reason: 'V4 v4-quarter-sell: 25주 @ 53.75' },
      );
      expect(service.shouldRequireApproval(signal, 'infinite-buy-v4', {
        watchStock: { strategyName: 'infinite-buy-v4' },
      } as any)).toBe(false);
    });
  });

  it('creates the approval pair atomically through the shared order guard', async () => {
    const tx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-atomic' }),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'approval-atomic',
          tradeRecordId: 'trade-atomic',
        }),
      },
    };
    const expiryTx = {
      stopLossApproval: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(expiryTx)),
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-direct' }),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'approval-direct',
          tradeRecordId: 'trade-direct',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const orderGuard = {
      admit: jest.fn(async (_key, createWithTx) => createWithTx(tx)),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PAPER',
        accountHash: 'account-hash',
      }),
    };
    const slack = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendStopLossApproval: jest.fn(async () => ({
        ts: String(Date.now() / 1000),
        channel: 'C123',
      })),
    };
    const atomicService = new TradingSellApprovalService(
      prisma as any,
      brokerContext as any,
      orderGuard as any,
      slack as any,
    );

    await expect(
      atomicService.requestApproval(
        makeSell({ phase: 'stop-loss' }),
        'infinite-buy',
        undefined,
        'LIMIT' as any,
      ),
    ).resolves.toBe(false);

    expect(orderGuard.admit).toHaveBeenCalledWith(
      {
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
      },
      expect.any(Function),
    );
    expect(tx.tradeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'AWAITING_APPROVAL',
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      }),
    });
    expect(tx.stopLossApproval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tradeRecordId: 'trade-atomic',
        status: 'PENDING',
      }),
    });
    expect(prisma.tradeRecord.create).not.toHaveBeenCalled();
    expect(prisma.stopLossApproval.create).not.toHaveBeenCalled();
  });

  it('uses one normalized overseas instrument for expiry, cooldown, persistence, reload identity, and Slack', async () => {
    const expiryTx = {
      stopLossApproval: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const admissionTx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-normalized' }),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'approval-normalized',
          tradeRecordId: 'trade-normalized',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(expiryTx)),
      stopLossApproval: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const orderGuard = {
      admit: jest.fn(async (_key, createWithTx) => createWithTx(admissionTx)),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PAPER',
        accountHash: 'account-hash',
      }),
    };
    const slack = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendStopLossApproval: jest.fn(async () => ({
        ts: String(Date.now() / 1000),
        channel: 'C123',
      })),
    };
    const normalizedService = new TradingSellApprovalService(
      prisma as any,
      brokerContext as any,
      orderGuard as any,
      slack as any,
    );
    const variant = makeSell(
      { phase: 'stop-loss' },
      { exchangeCode: ' nasd ', stockCode: ' tQqQ ' },
    );

    await normalizedService.requestApproval(
      variant,
      'infinite-buy',
      undefined,
      'LIMIT' as any,
    );

    expect(expiryTx.stopLossApproval.findMany).toHaveBeenCalledWith({
      where: {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        status: 'PENDING',
        expiresAt: { lte: expect.any(Date) },
        tradeRecord: { broker: Broker.KIS },
      },
      select: { id: true, tradeRecordId: true },
    });
    expect(orderGuard.admit).toHaveBeenCalledWith(
      {
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
      },
      expect.any(Function),
    );
    expect(admissionTx.stopLossApproval.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
      }),
      orderBy: { notifiedAt: 'desc' },
      select: { id: true },
    });
    expect(admissionTx.tradeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
      }),
    });
    expect(admissionTx.stopLossApproval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        signal: expect.objectContaining({
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
        }),
      }),
    });
    expect(slack.sendStopLossApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
      }),
    );
  });

  it('forces a domestic approval instrument exchange to KRX before guard and persistence', async () => {
    const expiryTx = {
      stopLossApproval: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const admissionTx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-domestic-normalized' }),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'approval-domestic-normalized',
          tradeRecordId: 'trade-domestic-normalized',
        }),
      },
    };
    const cancellationTx = {
      stopLossApproval: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      tradeRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const transactions = [expiryTx, cancellationTx];
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(transactions.shift())),
      stopLossApproval: { findFirst: jest.fn() },
    };
    const orderGuard = {
      admit: jest.fn(async (_key, createWithTx) => createWithTx(admissionTx)),
    };
    const domesticService = new TradingSellApprovalService(
      prisma as any,
      { getCurrentContext: jest.fn().mockReturnValue({ environment: 'PAPER' }) } as any,
      orderGuard as any,
      { isEnabled: jest.fn().mockReturnValue(false) } as any,
    );

    await domesticService.requestApproval(
      makeSell(
        { phase: 'stop-loss' },
        { market: 'DOMESTIC', exchangeCode: ' nasd ', stockCode: ' 005930 ' },
      ),
      undefined,
      undefined,
      'MARKET' as any,
    );

    expect(orderGuard.admit).toHaveBeenCalledWith(
      {
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
      },
      expect.any(Function),
    );
    expect(admissionTx.tradeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
      }),
    });
    expect(admissionTx.stopLossApproval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        signal: expect.objectContaining({
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
        }),
      }),
    });
  });

  it('reloads the concurrent winner without mutating or delivering it again', async () => {
    const winner = {
      id: 'approval-winner',
      tradeRecordId: 'trade-winner',
      status: 'PENDING',
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback({
        stopLossApproval: { findMany: jest.fn().mockResolvedValue([]) },
      })),
      tradeRecord: {
        update: jest.fn(),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(winner),
        update: jest.fn(),
      },
    };
    const orderGuard = {
      admit: jest.fn().mockResolvedValue(null),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'prod-account-hash',
      }),
    };
    const slack = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendStopLossApproval: jest.fn(),
    };
    const concurrentService = new TradingSellApprovalService(
      prisma as any,
      brokerContext as any,
      orderGuard as any,
      slack as any,
    );

    await expect(
      concurrentService.requestApproval(
        makeSell(
          { phase: 'stop-loss' },
          { exchangeCode: ' nasd ', stockCode: ' tQqQ ' },
        ),
        'infinite-buy',
        undefined,
        'LIMIT' as any,
      ),
    ).resolves.toBe(false);

    expect(prisma.stopLossApproval.findFirst).toHaveBeenCalledWith({
      where: {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        status: 'PENDING',
        tradeRecord: { broker: Broker.KIS },
      },
      orderBy: { requestedAt: 'desc' },
    });
    expect(prisma.tradeRecord.update).not.toHaveBeenCalled();
    expect(prisma.stopLossApproval.update).not.toHaveBeenCalled();
    expect(slack.sendStopLossApproval).not.toHaveBeenCalled();
  });

  it('reloads the partial-index winner after the losing pair transaction rolls back', async () => {
    const winner = {
      id: 'approval-unique-winner',
      tradeRecordId: 'trade-unique-winner',
      status: 'PENDING',
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback({
        stopLossApproval: { findMany: jest.fn().mockResolvedValue([]) },
      })),
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(winner),
      },
    };
    const orderGuard = {
      admit: jest.fn().mockRejectedValue({ code: 'P2002' }),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'prod-account-hash',
      }),
    };
    const slack = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendStopLossApproval: jest.fn(),
    };
    const losingService = new TradingSellApprovalService(
      prisma as any,
      brokerContext as any,
      orderGuard as any,
      slack as any,
    );

    await expect(
      losingService.requestApproval(
        makeSell(
          { phase: 'stop-loss' },
          { exchangeCode: ' nasd ', stockCode: ' tqQq ' },
        ),
        'infinite-buy',
        undefined,
        'LIMIT' as any,
      ),
    ).resolves.toBe(false);

    expect(prisma.stopLossApproval.findFirst).toHaveBeenCalledWith({
      where: {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        status: 'PENDING',
        tradeRecord: { broker: Broker.KIS },
      },
      orderBy: { requestedAt: 'desc' },
    });
    expect(slack.sendStopLossApproval).not.toHaveBeenCalled();
  });

  it('rethrows P2002 when the normalized pending winner cannot be reloaded', async () => {
    const uniqueError = { code: 'P2002', meta: { target: 'approval-id' } };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback({
        stopLossApproval: { findMany: jest.fn().mockResolvedValue([]) },
      })),
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const orderGuard = {
      admit: jest.fn().mockRejectedValue(uniqueError),
    };
    const noWinnerService = new TradingSellApprovalService(
      prisma as any,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PROD',
          accountHash: 'account-hash',
        }),
      } as any,
      orderGuard as any,
      {
        isEnabled: jest.fn().mockReturnValue(true),
        sendStopLossApproval: jest.fn(),
      } as any,
    );

    await expect(
      noWinnerService.requestApproval(
        makeSell(
          { phase: 'stop-loss' },
          { exchangeCode: ' nasd ', stockCode: ' tqQq ' },
        ),
        'infinite-buy',
        undefined,
        'LIMIT' as any,
      ),
    ).rejects.toBe(uniqueError);

    expect(prisma.stopLossApproval.findFirst).toHaveBeenCalledWith({
      where: {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        status: 'PENDING',
        tradeRecord: { broker: Broker.KIS },
      },
      orderBy: { requestedAt: 'desc' },
    });
  });

  it('rolls back the guarded pair and skips Slack when approval creation fails', async () => {
    const creationError = new Error('approval create failed');
    const admissionTx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-rolled-back' }),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(creationError),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback({
        stopLossApproval: { findMany: jest.fn().mockResolvedValue([]) },
      })),
    };
    const orderGuard = {
      admit: jest.fn(async (_key, createWithTx) => createWithTx(admissionTx)),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PAPER',
        accountHash: 'account-hash',
      }),
    };
    const slack = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendStopLossApproval: jest.fn(),
    };
    const rollbackService = new TradingSellApprovalService(
      prisma as any,
      brokerContext as any,
      orderGuard as any,
      slack as any,
    );

    await expect(
      rollbackService.requestApproval(
        makeSell({ phase: 'stop-loss' }),
        'infinite-buy',
        undefined,
        'LIMIT' as any,
      ),
    ).rejects.toBe(creationError);

    expect(admissionTx.tradeRecord.create).toHaveBeenCalledTimes(1);
    expect(admissionTx.stopLossApproval.create).toHaveBeenCalledTimes(1);
    expect(slack.sendStopLossApproval).not.toHaveBeenCalled();
  });

  it('elects one concurrent pair creator and sends exactly one Slack request', async () => {
    const admissionTx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-concurrent-winner' }),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'approval-concurrent-winner',
          tradeRecordId: 'trade-concurrent-winner',
        }),
      },
    };
    const winner = {
      id: 'approval-concurrent-winner',
      tradeRecordId: 'trade-concurrent-winner',
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback({
        stopLossApproval: { findMany: jest.fn().mockResolvedValue([]) },
      })),
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(winner),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    let creatorElected = false;
    const orderGuard = {
      admit: jest.fn(async (_key, createWithTx) => {
        if (creatorElected) return null;
        creatorElected = true;
        return createWithTx(admissionTx);
      }),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PROD',
        accountHash: 'account-hash',
      }),
    };
    const slack = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendStopLossApproval: jest.fn(async () => ({
        ts: String(Date.now() / 1000),
        channel: 'C123',
      })),
    };
    const concurrencyService = new TradingSellApprovalService(
      prisma as any,
      brokerContext as any,
      orderGuard as any,
      slack as any,
    );

    await Promise.all([
      concurrencyService.requestApproval(
        makeSell({ phase: 'stop-loss' }),
        'infinite-buy',
        undefined,
        'LIMIT' as any,
      ),
      concurrencyService.requestApproval(
        makeSell({ phase: 'stop-loss' }),
        'infinite-buy',
        undefined,
        'LIMIT' as any,
      ),
    ]);

    expect(admissionTx.tradeRecord.create).toHaveBeenCalledTimes(1);
    expect(admissionTx.stopLossApproval.create).toHaveBeenCalledTimes(1);
    expect(slack.sendStopLossApproval).toHaveBeenCalledTimes(1);
  });

  it('keeps execution logging best effort after the approval lease is persisted', async () => {
    const admissionTx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-log-best-effort' }),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'approval-log-best-effort',
          tradeRecordId: 'trade-log-best-effort',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback({
        stopLossApproval: { findMany: jest.fn().mockResolvedValue([]) },
      })),
      stopLossApproval: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      watchStockExecutionLog: {
        create: jest.fn().mockRejectedValue(new Error('execution log unavailable')),
      },
    };
    const orderGuard = {
      admit: jest.fn(async (_key, createWithTx) => createWithTx(admissionTx)),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PAPER',
        accountHash: 'account-hash',
      }),
    };
    const slack = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendStopLossApproval: jest.fn(async () => ({
        ts: String(Date.now() / 1000),
        channel: 'C123',
      })),
    };
    const loggingService = new TradingSellApprovalService(
      prisma as any,
      brokerContext as any,
      orderGuard as any,
      slack as any,
    );

    await expect(
      loggingService.requestApproval(
        makeSell({ phase: 'stop-loss' }),
        'infinite-buy',
        {
          watchStock: {
            id: 'watch-1',
            broker: Broker.KIS,
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            stockName: 'TQQQ',
            strategyName: 'infinite-buy',
          },
        } as any,
        'LIMIT' as any,
      ),
    ).resolves.toBe(false);

    expect(prisma.stopLossApproval.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.watchStockExecutionLog.create).toHaveBeenCalledTimes(1);
  });

  it('atomically expires a due pair before admitting its replacement', async () => {
    const events: string[] = [];
    const expiryTx = {
      stopLossApproval: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'approval-expired', tradeRecordId: 'trade-expired' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const admissionTx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-replacement' }),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'approval-replacement',
          tradeRecordId: 'trade-replacement',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => {
        events.push('expire');
        return callback(expiryTx);
      }),
      stopLossApproval: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const orderGuard = {
      admit: jest.fn(async (_key, createWithTx) => {
        events.push('admit');
        return createWithTx(admissionTx);
      }),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PAPER',
        accountHash: 'account-hash',
      }),
    };
    const slack = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendStopLossApproval: jest.fn(async () => ({
        ts: String(Date.now() / 1000),
        channel: 'C123',
      })),
    };
    const expiryService = new TradingSellApprovalService(
      prisma as any,
      brokerContext as any,
      orderGuard as any,
      slack as any,
    );

    await expiryService.requestApproval(
      makeSell({ phase: 'stop-loss' }),
      'infinite-buy',
      undefined,
      'LIMIT' as any,
    );

    expect(events).toEqual(['expire', 'admit']);
    expect(expiryTx.stopLossApproval.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-expired',
        status: 'PENDING',
        expiresAt: { lte: expect.any(Date) },
      },
      data: { status: 'EXPIRED' },
    });
    expect(expiryTx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-expired',
        status: 'AWAITING_APPROVAL',
      },
      data: { status: 'CANCELLED' },
    });
    expect(admissionTx.tradeRecord.create).toHaveBeenCalledTimes(1);
    expect(admissionTx.stopLossApproval.create).toHaveBeenCalledTimes(1);
  });

  it('blocks a replacement during the fixed 30-minute successful-delivery cooldown', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T09:30:00.000Z'));
    try {
      const expiryTx = {
        stopLossApproval: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      const admissionTx = {
        tradeRecord: {
          create: jest.fn(),
        },
        stopLossApproval: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'approval-notified-recently',
            notifiedAt: new Date('2026-07-13T09:01:00.000Z'),
          }),
          create: jest.fn(),
        },
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(expiryTx)),
        stopLossApproval: { findFirst: jest.fn() },
      };
      const orderGuard = {
        admit: jest.fn(async (_key, createWithTx) => createWithTx(admissionTx)),
      };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PROD',
          accountHash: 'account-hash',
        }),
      };
      const slack = {
        isEnabled: jest.fn().mockReturnValue(true),
        sendStopLossApproval: jest.fn(),
      };
      const cooldownService = new TradingSellApprovalService(
        prisma as any,
        brokerContext as any,
        orderGuard as any,
        slack as any,
      );

      await expect(
        cooldownService.requestApproval(
          makeSell({ phase: 'stop-loss' }),
          'infinite-buy',
          undefined,
          'LIMIT' as any,
        ),
      ).resolves.toBe(false);

      expect(admissionTx.stopLossApproval.findFirst).toHaveBeenCalledWith({
        where: {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          notifiedAt: { gt: new Date('2026-07-13T09:00:00.000Z') },
          tradeRecord: { broker: Broker.KIS },
        },
        orderBy: { notifiedAt: 'desc' },
        select: { id: true },
      });
      expect(admissionTx.tradeRecord.create).not.toHaveBeenCalled();
      expect(admissionTx.stopLossApproval.create).not.toHaveBeenCalled();
      expect(slack.sendStopLossApproval).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('starts a ten-minute lease from a valid Slack delivery timestamp', async () => {
    const requestTime = new Date('2026-07-13T10:00:00.000Z');
    const notifiedAt = new Date('2026-07-13T10:00:05.000Z');
    const slackTs = `${notifiedAt.getTime() / 1000}.000000`;
    jest.useFakeTimers().setSystemTime(requestTime);
    try {
      const expiryTx = {
        stopLossApproval: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      const admissionTx = {
        tradeRecord: {
          create: jest.fn().mockResolvedValue({ id: 'trade-delivered' }),
        },
        stopLossApproval: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            id: 'approval-delivered',
            tradeRecordId: 'trade-delivered',
          }),
        },
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(expiryTx)),
        stopLossApproval: {
          findFirst: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      let insideAdmission = false;
      const orderGuard = {
        admit: jest.fn(async (_key, createWithTx) => {
          insideAdmission = true;
          const result = await createWithTx(admissionTx);
          insideAdmission = false;
          return result;
        }),
      };
      const brokerContext = {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
        }),
      };
      const slack = {
        isEnabled: jest.fn().mockReturnValue(true),
        sendStopLossApproval: jest.fn(async () => {
          expect(insideAdmission).toBe(false);
          jest.setSystemTime(notifiedAt);
          return { ts: `  ${slackTs}  `, channel: '  C123  ' };
        }),
      };
      const deliveryService = new TradingSellApprovalService(
        prisma as any,
        brokerContext as any,
        orderGuard as any,
        slack as any,
      );

      await expect(
        deliveryService.requestApproval(
          makeSell({ phase: 'stop-loss' }),
          'infinite-buy',
          undefined,
          'LIMIT' as any,
        ),
      ).resolves.toBe(false);

      const approvalData = admissionTx.stopLossApproval.create.mock.calls[0][0].data;
      expect(approvalData.requestedAt).toEqual(requestTime);
      expect(approvalData.expiresAt).toEqual(new Date(requestTime.getTime() + 2 * 60 * 1000));
      expect(approvalData.timeoutMinutes).toBe(10);
      expect(slack.sendStopLossApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalId: 'approval-delivered',
          validityMinutes: 10,
          cooldownMinutes: 30,
        }),
      );
      expect(prisma.stopLossApproval.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'approval-delivered',
          tradeRecordId: 'trade-delivered',
          status: 'PENDING',
          expiresAt: { gt: notifiedAt },
        },
        data: {
          notifiedAt,
          expiresAt: new Date(notifiedAt.getTime() + 10 * 60 * 1000),
          slackMessageTs: slackTs,
          slackChannel: 'C123',
          timeoutMinutes: 10,
        },
      });
      expect(prisma.stopLossApproval.update).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['disabled Slack', false, null],
    ['missing delivery metadata', true, null],
    ['blank message timestamp', true, { ts: '   ', channel: 'C123' }],
    ['blank channel', true, { ts: '1783936805.000000', channel: '   ' }],
    ['malformed message timestamp', true, { ts: 'not-a-slack-ts', channel: 'C123' }],
    ['failed Slack call', true, new Error('slack unavailable')],
  ])('atomically cancels the pair without cooldown after %s', async (_name, enabled, outcome) => {
    const expiryTx = {
      stopLossApproval: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const cancellationTx = {
      stopLossApproval: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const transactions = [expiryTx, cancellationTx];
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(transactions.shift())),
      stopLossApproval: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      watchStockExecutionLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const admissionTx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-undelivered' }),
      },
      stopLossApproval: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'approval-undelivered',
          tradeRecordId: 'trade-undelivered',
        }),
      },
    };
    const orderGuard = {
      admit: jest.fn(async (_key, createWithTx) => createWithTx(admissionTx)),
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PAPER',
        accountHash: 'account-hash',
      }),
    };
    const sendStopLossApproval = outcome instanceof Error
      ? jest.fn().mockRejectedValue(outcome)
      : jest.fn().mockResolvedValue(outcome);
    const slack = {
      isEnabled: jest.fn().mockReturnValue(enabled),
      sendStopLossApproval,
    };
    const failureService = new TradingSellApprovalService(
      prisma as any,
      brokerContext as any,
      orderGuard as any,
      slack as any,
    );
    const loggerWarn = jest
      .spyOn((failureService as any).logger, 'warn')
      .mockImplementation(() => undefined);
    const loggerLog = jest
      .spyOn((failureService as any).logger, 'log')
      .mockImplementation(() => undefined);

    await expect(
      failureService.requestApproval(
        makeSell({ phase: 'stop-loss' }),
        'infinite-buy',
        {
          watchStock: {
            id: 'watch-undelivered',
            broker: Broker.KIS,
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
            stockName: 'TQQQ',
            strategyName: 'infinite-buy',
          },
        } as any,
        'LIMIT' as any,
      ),
    ).resolves.toBe(false);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(cancellationTx.stopLossApproval.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-undelivered',
        tradeRecordId: 'trade-undelivered',
        status: 'PENDING',
      },
      data: { status: 'EXPIRED' },
    });
    expect(cancellationTx.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-undelivered',
        status: 'AWAITING_APPROVAL',
      },
      data: { status: 'CANCELLED' },
    });
    expect(prisma.stopLossApproval.update).not.toHaveBeenCalled();
    expect(prisma.stopLossApproval.updateMany).not.toHaveBeenCalled();
    if (!enabled) {
      expect(sendStopLossApproval).not.toHaveBeenCalled();
    }
    const executionLog = prisma.watchStockExecutionLog.create.mock.calls[0][0].data;
    expect(executionLog.message).toContain('EXPIRED');
    expect(executionLog.message).toContain('CANCELLED');
    expect(executionLog.message).not.toMatch(/대기|등록/);
    expect(loggerWarn).toHaveBeenCalledWith(
      '[KIS TQQQ] Sell approval delivery failed: approval EXPIRED, trade CANCELLED',
    );
    expect(loggerLog).not.toHaveBeenCalledWith(expect.stringMatching(/registered|waiting/i));
  });

  it.each([
    [
      'before this approval request',
      new Date('2026-07-13T10:00:00.000Z'),
      new Date('2026-07-13T09:59:59.999Z'),
      new Date('2026-07-13T10:00:05.000Z'),
    ],
    [
      'after the Slack response-received time',
      new Date('2026-07-13T10:00:00.000Z'),
      new Date('2026-07-13T10:00:05.001Z'),
      new Date('2026-07-13T10:00:05.000Z'),
    ],
  ])(
    'atomically cancels without cooldown for a positive numeric Slack ts %s',
    async (_name, requestTime, slackTimestamp, responseReceivedAt) => {
      jest.useFakeTimers().setSystemTime(requestTime);
      try {
        const expiryTx = {
          stopLossApproval: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };
        const cancellationTx = {
          stopLossApproval: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          tradeRecord: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        const transactions = [expiryTx, cancellationTx];
        const prisma = {
          $transaction: jest.fn(async (callback) => callback(transactions.shift())),
          stopLossApproval: {
            findFirst: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        const admissionTx = {
          tradeRecord: {
            create: jest.fn().mockResolvedValue({ id: 'trade-out-of-window' }),
          },
          stopLossApproval: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({
              id: 'approval-out-of-window',
              tradeRecordId: 'trade-out-of-window',
            }),
          },
        };
        const orderGuard = {
          admit: jest.fn(async (_key, createWithTx) => createWithTx(admissionTx)),
        };
        const brokerContext = {
          getCurrentContext: jest.fn().mockReturnValue({
            environment: 'PAPER',
            accountHash: 'account-hash',
          }),
        };
        const slack = {
          isEnabled: jest.fn().mockReturnValue(true),
          sendStopLossApproval: jest.fn(async () => {
            jest.setSystemTime(responseReceivedAt);
            return {
              ts: String(slackTimestamp.getTime() / 1000),
              channel: 'C123',
            };
          }),
        };
        const boundedService = new TradingSellApprovalService(
          prisma as any,
          brokerContext as any,
          orderGuard as any,
          slack as any,
        );

        await expect(
          boundedService.requestApproval(
            makeSell({ phase: 'stop-loss' }),
            'infinite-buy',
            undefined,
            'LIMIT' as any,
          ),
        ).resolves.toBe(false);

        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(cancellationTx.stopLossApproval.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'approval-out-of-window',
            tradeRecordId: 'trade-out-of-window',
            status: 'PENDING',
          },
          data: { status: 'EXPIRED' },
        });
        expect(cancellationTx.tradeRecord.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'trade-out-of-window',
            status: 'AWAITING_APPROVAL',
          },
          data: { status: 'CANCELLED' },
        });
        expect(prisma.stopLossApproval.updateMany).not.toHaveBeenCalled();
        expect(cancellationTx.stopLossApproval.updateMany.mock.calls[0][0].data)
          .not.toHaveProperty('notifiedAt');
      } finally {
        jest.useRealTimers();
      }
    },
  );
});
