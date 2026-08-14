import { Logger } from '@nestjs/common';
import { Broker, Market, OrderStatus, OrderType, Side } from '@prisma/client';
import { TradingOrderExecutionService } from './trading-order-execution.service';

describe('TradingOrderExecutionService', () => {
  const submissionGateway = (domestic: any = {}, overseas: any = {}) => ({
    submit: jest.fn((signal) => {
      if (signal.market === Market.DOMESTIC) {
        return signal.side === Side.BUY
          ? domestic.orderBuy(signal.stockCode, signal.quantity, signal.price, signal.orderDivision)
          : domestic.orderSell(signal.stockCode, signal.quantity, signal.price, signal.orderDivision);
      }
      return signal.side === Side.BUY
        ? overseas.orderBuy(
          signal.exchangeCode,
          signal.stockCode,
          signal.quantity,
          signal.price || 0,
          signal.orderDivision,
        )
        : overseas.orderSell(
          signal.exchangeCode,
          signal.stockCode,
          signal.quantity,
          signal.price || 0,
          signal.orderDivision,
        );
    }),
  });
  const noopFailureNotifier = () => ({ notify: jest.fn().mockResolvedValue(undefined) });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists and submits the canonical instrument returned by the admission guard', async () => {
    const tx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-canonical' }),
      },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
    };
    const overseas = {
      orderBuy: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'broker-canonical',
        brokerOrderDate: '20260714',
        orderTime: '101112',
        message: 'accepted',
      }),
      orderSell: jest.fn(),
    };
    const guard = {
      admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx, {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'AAPL',
        side: 'BUY',
      })),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway({ orderBuy: jest.fn(), orderSell: jest.fn() }, overseas) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      guard as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      { markSubmissionUnknown: jest.fn() } as never,
      noopFailureNotifier() as never,
    );

    await expect(service.execute({
      market: 'OVERSEAS',
      exchangeCode: ' nasd ',
      stockCode: ' aapl ',
      side: 'BUY',
      quantity: 1,
      price: 250,
      reason: 'canonical admission',
    })).resolves.toBe(true);

    expect(tx.tradeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        market: Market.OVERSEAS,
        exchangeCode: 'NASD',
        stockCode: 'AAPL',
      }),
    });
    expect(overseas.orderBuy).toHaveBeenCalledWith('NASD', 'AAPL', 1, 250, undefined);
  });

  it('cancels the claimed intent when the broker account changes immediately before POST', async () => {
    const tx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-context-switch' }),
      },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
    };
    const domestic = { orderBuy: jest.fn(), orderSell: jest.fn() };
    const brokerContext = {
      getCurrentContext: jest
        .fn()
        .mockReturnValueOnce({ environment: 'PROD', accountHash: 'account-a' })
        .mockReturnValueOnce({ environment: 'PROD', accountHash: 'account-a' })
        .mockReturnValueOnce({ environment: 'PROD', accountHash: 'account-b' }),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      brokerContext as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      { markSubmissionUnknown: jest.fn() } as never,
      noopFailureNotifier() as never,
    );

    await expect(service.execute({
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      side: 'BUY',
      quantity: 1,
      price: 70_000,
      reason: 'context switch safety',
    })).resolves.toBe(false);

    const submissionStartedAt = prisma.tradeRecord.updateMany.mock.calls[0][0].data
      .submissionStartedAt;
    expect(submissionStartedAt).toEqual(expect.any(Date));
    expect(prisma.tradeRecord.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'trade-context-switch',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt,
      },
      data: {
        status: OrderStatus.CANCELLED,
        submissionStartedAt: null,
        brokerMessage: 'KIS 계좌 변경으로 주문 취소',
      },
    });
    expect(domestic.orderBuy).not.toHaveBeenCalled();
  });

  it('cancels the claimed intent when live trading is disabled immediately before POST', async () => {
    const tx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-live-switch' }),
      },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
    };
    const domestic = { orderBuy: jest.fn(), orderSell: jest.fn() };
    const liveSwitch = {
      isEnabled: jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic) as never,
      liveSwitch as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PROD',
          accountHash: 'account-a',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      { markSubmissionUnknown: jest.fn() } as never,
      noopFailureNotifier() as never,
    );

    await expect(service.execute({
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      side: 'BUY',
      quantity: 1,
      price: 70_000,
      reason: 'live switch safety',
    })).resolves.toBe(false);

    const submissionStartedAt = prisma.tradeRecord.updateMany.mock.calls[0][0].data
      .submissionStartedAt;
    expect(prisma.tradeRecord.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'trade-live-switch',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt,
      },
      data: {
        status: OrderStatus.CANCELLED,
        submissionStartedAt: null,
        brokerMessage: '실거래 비활성화로 주문 취소',
      },
    });
    expect(domestic.orderBuy).not.toHaveBeenCalled();
  });

  it('creates an automatic intent as SUBMITTING with broker context before submission claim', async () => {
    const tx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-1' }),
      },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const guard = {
      admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(
        { orderBuy: jest.fn(), orderSell: jest.fn() },
        { orderBuy: jest.fn(), orderSell: jest.fn() },
      ) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      guard as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      { markSubmissionUnknown: jest.fn() } as never,
      noopFailureNotifier() as never,
    );

    await expect(
      service.execute(
        {
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'BUY',
          quantity: 1,
          price: 70_000,
          reason: 'ordinary buy',
        },
        'daily-dca',
        undefined,
        undefined,
      ),
    ).resolves.toBe(false);

    expect(guard.admit).toHaveBeenCalledWith(
      {
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'BUY',
      },
      expect.any(Function),
    );
    expect(tx.tradeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        market: Market.DOMESTIC,
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: Side.BUY,
        orderType: OrderType.LIMIT,
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
        brokerEnvironment: 'PAPER',
        brokerAccountHash: 'account-hash',
      }),
    });
    expect(prisma.tradeRecord.updateMany).toHaveBeenCalledTimes(1);
  });

  it('lets the submission CAS winner call KIS once and persists an accepted broker identity', async () => {
    const tx = {
      tradeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'trade-accepted' }),
      },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
      watchStockExecutionLog: {
        create: jest.fn().mockResolvedValue({ id: 'accepted-audit' }),
      },
    };
    const domestic = {
      orderBuy: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'broker-1',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      }),
      orderSell: jest.fn(),
    };
    const guard = {
      admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic, { orderBuy: jest.fn(), orderSell: jest.fn() }) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      guard as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      { markSubmissionUnknown: jest.fn() } as never,
      noopFailureNotifier() as never,
    );

    await expect(
      service.execute(
        {
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'BUY',
          quantity: 1,
          price: 70_000,
          reason: 'ordinary buy',
        },
        'daily-dca',
        {
          watchStock: {
            id: 'ws-accepted',
            broker: Broker.KIS,
            market: 'DOMESTIC',
            exchangeCode: 'KRX',
            stockCode: '005930',
            stockName: 'Samsung',
            strategyName: 'daily-dca',
          },
        } as never,
        undefined,
      ),
    ).resolves.toBe(true);

    expect(domestic.orderBuy).toHaveBeenCalledTimes(1);
    expect(domestic.orderBuy).toHaveBeenCalledWith('005930', 1, 70_000, undefined);
    expect(prisma.tradeRecord.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'trade-accepted',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: { not: null },
      },
      data: {
        status: OrderStatus.PENDING,
        orderNo: 'broker-1',
        brokerOrderDate: '20260713',
        brokerOrderTime: '101112',
        brokerMessage: '접수',
      },
    });
    expect(prisma.watchStockExecutionLog.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        watchStockId: 'ws-accepted',
        tradeRecordId: 'trade-accepted',
        eventType: 'ORDER_SUBMITTED',
        message: '주문 접수: BUY 1주',
        details: expect.objectContaining({
          outcome: 'ACCEPTED',
          brokerMessage: '접수',
          orderNo: 'broker-1',
          brokerOrderDate: '20260713',
          orderTime: '101112',
        }),
      }),
    });
  });

  it('persists an explicit broker rejection as FAILED without retrying KIS', async () => {
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-rejected' }) },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
      watchStockExecutionLog: {
        create: jest.fn().mockResolvedValue({ id: 'rejected-audit' }),
      },
    };
    const domestic = {
      orderBuy: jest.fn().mockResolvedValue({
        outcome: 'REJECTED',
        success: false,
        message: '주문 거부',
      }),
      orderSell: jest.fn(),
    };
    const failureNotifier = { notify: jest.fn().mockResolvedValue(undefined) };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      { markSubmissionUnknown: jest.fn() } as never,
      failureNotifier as never,
    );

    await expect(
      service.execute(
        {
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'BUY',
          quantity: 1,
          reason: 'ordinary buy',
        },
        'daily-dca',
        {
          watchStock: {
            id: 'ws-rejected',
            broker: Broker.KIS,
            market: 'DOMESTIC',
            exchangeCode: 'KRX',
            stockCode: '005930',
            stockName: 'Samsung',
            strategyName: 'daily-dca',
          },
        } as never,
        undefined,
      ),
    ).resolves.toBe(false);

    expect(domestic.orderBuy).toHaveBeenCalledTimes(1);
    expect(prisma.tradeRecord.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'trade-rejected',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: { not: null },
      },
      data: {
        status: OrderStatus.FAILED,
        brokerMessage: '주문 거부',
      },
    });
    expect(prisma.watchStockExecutionLog.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        watchStockId: 'ws-rejected',
        tradeRecordId: 'trade-rejected',
        eventType: 'ORDER_FAILED',
        message: '주문 실패: BUY 1주',
        details: expect.objectContaining({
          outcome: 'REJECTED',
          brokerMessage: '주문 거부',
        }),
      }),
    });
    expect(failureNotifier.notify).toHaveBeenCalledTimes(1);
    expect(failureNotifier.notify).toHaveBeenCalledWith('trade-rejected', 'SUBMISSION');
  });

  it('does not request a rejection alert when the FAILED transition loses its CAS', async () => {
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-rejected' }) },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
      watchStockExecutionLog: {
        create: jest.fn().mockResolvedValue({ id: 'rejected-audit' }),
      },
    };
    const domestic = {
      orderBuy: jest.fn().mockResolvedValue({
        outcome: 'REJECTED',
        success: false,
        message: '주문 거부',
      }),
      orderSell: jest.fn(),
    };
    const failureNotifier = { notify: jest.fn().mockResolvedValue(undefined) };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      { markSubmissionUnknown: jest.fn() } as never,
      failureNotifier as never,
    );
    const rejectedSignal = {
      market: 'DOMESTIC' as const,
      exchangeCode: 'KRX',
      stockCode: '005930',
      side: 'BUY' as const,
      quantity: 1,
      reason: 'ordinary buy',
    };
    const rejectedContext = {
      watchStock: {
        id: 'ws-rejected',
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        strategyName: 'daily-dca',
      },
    } as never;

    await expect(service.execute(rejectedSignal, 'daily-dca', rejectedContext)).resolves.toBe(false);

    expect(domestic.orderBuy).toHaveBeenCalledTimes(1);
    expect(failureNotifier.notify).not.toHaveBeenCalled();
  });

  it('keeps an accepted state authoritative when the outcome audit write fails', async () => {
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-audit-failure' }) },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
      watchStockExecutionLog: {
        create: jest.fn()
          .mockResolvedValueOnce({ id: 'admission-audit' })
          .mockRejectedValueOnce(new Error('audit unavailable')),
      },
    };
    const domestic = {
      orderBuy: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'audit-safe-order',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      }),
    };
    const recovery = {
      markSubmissionUnknown: jest.fn(),
      warnAcceptedOrderPersistenceFailure: jest.fn(),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      recovery as never,
      noopFailureNotifier() as never,
    );

    await expect(service.execute({
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      side: 'BUY',
      quantity: 1,
      reason: 'ordinary buy',
    }, 'daily-dca', {
      watchStock: {
        id: 'ws-audit-failure',
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        strategyName: 'daily-dca',
      },
    } as never)).resolves.toBe(true);

    expect(domestic.orderBuy).toHaveBeenCalledTimes(1);
    expect(prisma.tradeRecord.updateMany).toHaveBeenCalledTimes(2);
    expect(recovery.markSubmissionUnknown).not.toHaveBeenCalled();
  });

  it('continues an automatic order when the admitted-order mirror log fails', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-admission-log-failure' }) },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
      watchStockExecutionLog: {
        create: jest.fn()
          .mockRejectedValueOnce(new Error('admission audit unavailable'))
          .mockResolvedValueOnce({ id: 'outcome-audit' }),
      },
    };
    const domestic = {
      orderBuy: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'admission-log-safe-order',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      }),
    };
    const recovery = {
      markSubmissionUnknown: jest.fn(),
      warnAcceptedOrderPersistenceFailure: jest.fn(),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      recovery as never,
      noopFailureNotifier() as never,
    );

    await expect(service.execute({
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      side: 'BUY',
      quantity: 1,
      reason: 'ordinary buy',
    }, 'daily-dca', {
      watchStock: {
        id: 'ws-admission-log-failure',
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        strategyName: 'daily-dca',
      },
    } as never)).resolves.toBe(true);

    expect(domestic.orderBuy).toHaveBeenCalledTimes(1);
    expect(prisma.tradeRecord.updateMany).toHaveBeenCalledTimes(2);
    expect(recovery.markSubmissionUnknown).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[005930] Failed to write admitted-order mirror: admission audit unavailable',
    );
    warnSpy.mockRestore();
  });

  it('delegates an UNKNOWN result to durable recovery and never retries the order', async () => {
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-unknown' }) },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      watchStockExecutionLog: {
        create: jest.fn().mockResolvedValue({ id: 'unknown-audit' }),
      },
    };
    const domestic = {
      orderBuy: jest.fn().mockResolvedValue({
        outcome: 'UNKNOWN',
        success: false,
        message: 'transport timeout',
      }),
      orderSell: jest.fn(),
    };
    const recovery = {
      markSubmissionUnknown: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      recovery as never,
      noopFailureNotifier() as never,
    );

    await expect(
      service.execute(
        {
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'BUY',
          quantity: 1,
          reason: 'ordinary buy',
        },
        'daily-dca',
        {
          watchStock: {
            id: 'ws-unknown',
            broker: Broker.KIS,
            market: 'DOMESTIC',
            exchangeCode: 'KRX',
            stockCode: '005930',
            stockName: 'Samsung',
            strategyName: 'daily-dca',
          },
        } as never,
        undefined,
      ),
    ).resolves.toBe(false);

    expect(domestic.orderBuy).toHaveBeenCalledTimes(1);
    expect(recovery.markSubmissionUnknown).toHaveBeenCalledWith(
      'trade-unknown',
      'transport timeout',
    );
    expect(prisma.watchStockExecutionLog.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        watchStockId: 'ws-unknown',
        tradeRecordId: 'trade-unknown',
        eventType: 'ORDER_SUBMISSION_UNKNOWN',
        message: '주문 제출 결과 불명: BUY 1주',
        details: expect.objectContaining({
          outcome: 'UNKNOWN',
          brokerMessage: 'transport timeout',
        }),
      }),
    });
  });

  it.each([
    ['blank orderNo', { orderNo: '   ', brokerOrderDate: '20260713', orderTime: '101112' }],
    ['blank brokerOrderDate', { orderNo: 'broker-identity', brokerOrderDate: '', orderTime: '101112' }],
    ['missing orderTime', { orderNo: 'broker-identity', brokerOrderDate: '20260713', orderTime: undefined }],
  ])('maps nominal ACCEPTED with %s to UNKNOWN instead of PENDING', async (_label, identity) => {
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-invalid-accepted' }) },
    };
    const prisma = {
      tradeRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const domestic = {
      orderBuy: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        ...identity,
        message: 'nominal success',
      }),
    };
    const recovery = {
      markSubmissionUnknown: jest.fn().mockResolvedValue(true),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      recovery as never,
      noopFailureNotifier() as never,
    );

    await expect(service.execute({
      market: 'DOMESTIC',
      exchangeCode: 'KRX',
      stockCode: '005930',
      side: 'BUY',
      quantity: 1,
      reason: 'ordinary buy',
    }, 'daily-dca')).resolves.toBe(false);

    expect(domestic.orderBuy).toHaveBeenCalledTimes(1);
    expect(prisma.tradeRecord.updateMany).toHaveBeenCalledTimes(1);
    expect(recovery.markSubmissionUnknown).toHaveBeenCalledWith(
      'trade-invalid-accepted',
      'Accepted broker response missing required order identity',
    );
  });

  it('warns after accepted-result persistence exhaustion and still reports broker acceptance', async () => {
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-db-failure' }) },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockRejectedValueOnce(new Error('db unavailable 1'))
          .mockRejectedValueOnce(new Error('db unavailable 2'))
          .mockRejectedValueOnce(new Error('db unavailable 3')),
      },
    };
    const domestic = {
      orderBuy: jest.fn().mockResolvedValue({
        outcome: 'ACCEPTED',
        success: true,
        orderNo: 'broker-known',
        brokerOrderDate: '20260713',
        orderTime: '101112',
        message: '접수',
      }),
      orderSell: jest.fn(),
    };
    const recovery = {
      markSubmissionUnknown: jest.fn(),
      warnAcceptedOrderPersistenceFailure: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway(domestic) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      recovery as never,
      noopFailureNotifier() as never,
    );

    await expect(
      service.execute(
        {
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'BUY',
          quantity: 1,
          reason: 'ordinary buy',
        },
        'daily-dca',
        undefined,
        undefined,
      ),
    ).resolves.toBe(true);

    expect(domestic.orderBuy).toHaveBeenCalledTimes(1);
    expect(prisma.tradeRecord.updateMany).toHaveBeenCalledTimes(4);
    expect(recovery.warnAcceptedOrderPersistenceFailure).toHaveBeenCalledWith({
      market: 'DOMESTIC',
      stockCode: '005930',
      tradeRecordId: 'trade-db-failure',
      orderNo: 'broker-known',
    });
  });

  it('writes the admitted automatic-order audit with context diagnostics and trade identity', async () => {
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-audit' }) },
    };
    const prisma = {
      tradeRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      watchStockExecutionLog: {
        create: jest.fn().mockResolvedValue({ id: 'execution-log' }),
      },
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway() as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      { markSubmissionUnknown: jest.fn() } as never,
      noopFailureNotifier() as never,
    );
    const ctx = {
      watchStock: {
        id: 'ws-1',
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        strategyName: 'infinite-buy',
      },
      buyableAmount: 109.2,
      buyableMeta: {
        source: 'KIS_OVERSEAS_INQUIRE_PSAMOUNT',
        maxQuantity: 1,
        priceUsed: 54.6,
      },
    };

    await service.execute(
      {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'BUY',
        quantity: 1,
        price: 54.6,
        reason: 'Buy1',
        orderDivision: '00',
      },
      'infinite-buy',
      ctx as never,
      { preCashCappedQuota: 212.5, adjustedQuota: 109.2 },
    );

    expect(prisma.watchStockExecutionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        watchStockId: 'ws-1',
        tradeRecordId: 'trade-audit',
        eventType: 'ORDER_SUBMITTED',
        message: '주문 제출: BUY 1주',
        details: expect.objectContaining({
          side: 'BUY',
          quantity: 1,
          buyableAmount: 109.2,
          buyableAmountSource: 'KIS_OVERSEAS_INQUIRE_PSAMOUNT',
          preCashCappedQuota: 212.5,
          adjustedQuota: 109.2,
          cashCapApplied: true,
        }),
      }),
    });
  });

  it('marks an admitted infinite-buy second-target order attempted before KIS claim', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T03:00:00.000Z'));
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-second-target' }) },
    };
    const prisma = {
      tradeRecord: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      watchStockExecutionLog: { create: jest.fn().mockResolvedValue({}) },
      watchStock: {
        findUnique: jest.fn().mockResolvedValue({
          strategyParams: {
            accumulatedQuota: 100,
            secondaryExitPlan: {
              firstTargetDate: '2026-07-13',
              secondTargetPrice: 70,
              secondTargetRate: 0.2,
              secondTargetQuantity: 2,
            },
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway() as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      { refresh: jest.fn().mockResolvedValue([]) } as never,
      { markSubmissionUnknown: jest.fn() } as never,
      noopFailureNotifier() as never,
    );

    await service.execute(
      {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 2,
        price: 70,
        reason: 'Take profit 2',
        metadata: { phase: 'take-profit-2' },
      },
      'infinite-buy',
      {
        watchStock: {
          id: 'ws-second-target',
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          strategyName: 'infinite-buy',
        },
      } as never,
      undefined,
    );

    expect(prisma.watchStock.update).toHaveBeenCalledWith({
      where: { id: 'ws-second-target' },
      data: {
        strategyParams: {
          accumulatedQuota: 100,
          secondaryExitPlan: expect.objectContaining({
            secondTargetAttemptedDate: '2026-07-13',
          }),
        },
      },
    });
  });

  it('cancels a pre-submit second-target order when attempted-state persistence fails', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const tx = {
      tradeRecord: { create: jest.fn().mockResolvedValue({ id: 'trade-second-target-failure' }) },
    };
    const prisma = {
      tradeRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      watchStockExecutionLog: { create: jest.fn().mockResolvedValue({}) },
      watchStock: {
        findUnique: jest.fn().mockResolvedValue({
          strategyParams: {
            secondaryExitPlan: {
              firstTargetDate: '2026-07-13',
              secondTargetPrice: 70,
              secondTargetRate: 0.2,
              secondTargetQuantity: 2,
            },
          },
        }),
        update: jest.fn().mockRejectedValue(new Error('strategy state unavailable')),
      },
    };
    const overseas = { orderSell: jest.fn() };
    const positionRefresh = { refresh: jest.fn() };
    const service = new TradingOrderExecutionService(
      prisma as never,
      submissionGateway({}, overseas) as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never,
      {
        getCurrentContext: jest.fn().mockReturnValue({
          environment: 'PAPER',
          accountHash: 'account-hash',
          maskedAccount: '****1234-01',
        }),
      } as never,
      {
        admit: jest.fn().mockImplementation(async (_key, createWithTx) => createWithTx(tx)),
      } as never,
      positionRefresh as never,
      { markSubmissionUnknown: jest.fn() } as never,
      noopFailureNotifier() as never,
    );

    await expect(service.execute(
      {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 2,
        price: 70,
        reason: 'Take profit 2',
        metadata: { phase: 'take-profit-2' },
      },
      'infinite-buy',
      {
        watchStock: {
          id: 'ws-second-target-failure',
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          strategyName: 'infinite-buy',
        },
      } as never,
    )).resolves.toBe(false);

    expect(prisma.tradeRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'trade-second-target-failure',
        status: OrderStatus.SUBMITTING,
        submissionStartedAt: null,
      },
      data: {
        status: OrderStatus.CANCELLED,
        brokerMessage: '2차 익절 시도 상태 저장 실패로 주문 취소',
      },
    });
    expect(positionRefresh.refresh).not.toHaveBeenCalled();
    expect(overseas.orderSell).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[TQQQ] Failed to persist second-target attempted state: strategy state unavailable',
    );
    warnSpy.mockRestore();
  });
});
