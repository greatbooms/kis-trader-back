import { Test, TestingModule } from '@nestjs/testing';
import { TradingOrderReconciliationService } from './trading-order-reconciliation.service';
import { TradingService } from './trading.service';
import { PrismaService } from '../prisma.service';
import { SlackService } from '../notification/slack.service';
import { TradingBrokerContextService } from './trading-broker-context.service';

describe('TradingOrderReconciliationService', () => {
  let service: TradingOrderReconciliationService;

  const mockPrisma = {
    tradeRecord: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    position: {
      findFirst: jest.fn(),
    },
    watchStock: {
      findUnique: jest.fn(),
    },
    watchStockExecutionLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    stopLossApproval: {
      findFirst: jest.fn(),
    },
    brokerOrderActionAuditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockSlackService = {
    isEnabled: jest.fn().mockReturnValue(true),
    sendTradeAlert: jest.fn(),
  };

  const mockTradingService = {
    handleStrategySignalFill: jest.fn(),
  };

  const mockBrokerContext = {
    getCurrentContext: jest.fn().mockReturnValue({
      environment: 'PROD',
      accountHash: 'current-account-hash',
      maskedAccount: '****5678-01',
    }),
  };

  beforeEach(async () => {
    mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.$transaction.mockImplementation(async (work) => work(mockPrisma));
    mockPrisma.watchStockExecutionLog.findMany.mockImplementation(async () => {
      const log = await mockPrisma.watchStockExecutionLog.findFirst();
      return log ? [log] : [];
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingOrderReconciliationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TradingService, useValue: mockTradingService },
        { provide: SlackService, useValue: mockSlackService },
        { provide: TradingBrokerContextService, useValue: mockBrokerContext },
      ],
    }).compile();

    service = module.get<TradingOrderReconciliationService>(TradingOrderReconciliationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockSlackService.isEnabled.mockReturnValue(true);
  });

  describe('reconcileOpenOrders', () => {
    it('loads only open orders bound to the current broker context', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);

      const result = await service.reconcileOpenOrders('OVERSEAS', [], [], []);

      expect(mockPrisma.tradeRecord.findMany).toHaveBeenCalledWith({
        where: {
          market: 'OVERSEAS',
          status: { in: ['PENDING', 'PARTIAL'] },
          orderNo: { not: null },
          brokerEnvironment: 'PROD',
          brokerAccountHash: 'current-account-hash',
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual({ hasNewFill: false });
    });

    it('atomically resolves an accepted cancellation when broker closure is confirmed', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-cancel-accepted',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 2,
          price: 70_000,
          executedQty: 0,
          executedPrice: null,
          orderNo: 'cancelled-order',
          brokerOrderDate: '20260713',
          status: 'PENDING',
          cancellationStatus: 'ACCEPTED',
          strategyName: 'daily-dca',
          reason: 'DCA buy',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.brokerOrderActionAuditLog.create.mockResolvedValue({ id: 'audit-1' });
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-cancel-accepted',
        status: 'CANCELLED',
        side: 'BUY',
        quantity: 2,
        executedQty: 0,
        strategyName: 'daily-dca',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue(null);

      await service.reconcileOpenOrders('DOMESTIC', [], [], [
        {
          orderNo: 'cancelled-order',
          orderDate: '20260713',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'BUY',
          orderQuantity: 2,
          filledQuantity: 0,
          // 국내 체결내역 mapper는 전량 취소 행도 주문수량-체결수량으로 계산한다.
          remainingQuantity: 2,
        },
      ]);

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-cancel-accepted',
          status: 'PENDING',
          cancellationStatus: 'ACCEPTED',
          orderNo: 'cancelled-order',
        },
        data: {
          status: 'CANCELLED',
          executedQty: 0,
          executedPrice: 70000,
          cancellationStatus: 'RESOLVED',
          cancellationResolvedAt: expect.any(Date),
          cancellationResolvedBy: 'system:reconciliation',
          cancellationMessage: '취소 접수 후 미체결 종료 확인',
          reason: 'DCA buy | 미체결 종료',
        },
      });
      expect(mockPrisma.brokerOrderActionAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tradeRecordId: 'trade-cancel-accepted',
          channel: 'SYSTEM',
          action: 'CANCELLATION_RECONCILED',
          actor: 'system:reconciliation',
          beforeStatus: 'PENDING',
          afterStatus: 'CANCELLED',
        }),
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('keeps an accepted cancellation unresolved while the exact order remains unfilled', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-cancel-still-open',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 2,
          price: 70_000,
          executedQty: 0,
          executedPrice: null,
          orderNo: 'still-open-order',
          brokerOrderDate: '20260713',
          status: 'PENDING',
          cancellationStatus: 'ACCEPTED',
          strategyName: 'daily-dca',
          reason: 'DCA buy',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);

      await service.reconcileOpenOrders(
        'DOMESTIC',
        [],
        [{
          orderNo: 'still-open-order',
          stockCode: '005930',
          side: 'BUY',
          quantity: 2,
          price: 70_000,
        }],
        [{
          orderNo: 'still-open-order',
          orderDate: '20260713',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'BUY',
          orderQuantity: 2,
          filledQuantity: 0,
          remainingQuantity: 2,
        }],
      );

      expect(mockPrisma.tradeRecord.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('keeps an accepted cancellation unresolved when broker reads merely omit the order', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-cancel-omitted',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 2,
          price: 70_000,
          executedQty: 0,
          executedPrice: null,
          orderNo: 'omitted-order',
          brokerOrderDate: '20260713',
          status: 'PENDING',
          cancellationStatus: 'ACCEPTED',
          strategyName: 'daily-dca',
          reason: 'DCA buy',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      ]);

      await service.reconcileOpenOrders('DOMESTIC', [], [], []);

      expect(mockPrisma.tradeRecord.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.watchStockExecutionLog.create).not.toHaveBeenCalled();
      expect(mockSlackService.sendTradeAlert).not.toHaveBeenCalled();
    });

    it('does not resolve an accepted cancellation from a same-number broker order on another tuple', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-cancel-tuple',
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'SELL',
          quantity: 2,
          price: 70,
          executedQty: 0,
          executedPrice: null,
          orderNo: 'shared-order-no',
          brokerOrderDate: '20260713',
          status: 'PENDING',
          cancellationStatus: 'ACCEPTED',
          strategyName: 'manual',
          reason: 'manual sell',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      ]);

      await service.reconcileOpenOrders('OVERSEAS', [], [], [
        {
          orderNo: 'shared-order-no',
          orderDate: '20260713',
          exchangeCode: 'NYSE',
          stockCode: 'AAPL',
          side: 'BUY',
          orderQuantity: 2,
          filledQuantity: 0,
          remainingQuantity: 0,
        },
      ]);

      expect(mockPrisma.tradeRecord.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not treat a same-number unfilled order on another tuple as the current order', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-unfilled-tuple',
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'SELL',
          quantity: 2,
          price: 70,
          executedQty: 0,
          executedPrice: null,
          orderNo: 'shared-unfilled-no',
          status: 'PENDING',
          cancellationStatus: null,
          strategyName: 'manual',
          reason: 'manual sell',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);

      await service.reconcileOpenOrders('OVERSEAS', [], [
        {
          orderNo: 'shared-unfilled-no',
          exchangeCode: 'NYSE',
          stockCode: 'AAPL',
          side: 'BUY',
          quantity: 2,
          price: 190,
        },
      ], []);

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-unfilled-tuple',
          status: 'PENDING',
          orderNo: 'shared-unfilled-no',
          cancellationStatus: null,
        },
        data: {
          status: 'CANCELLED',
          reason: 'manual sell | 미체결 종료',
        },
      });
    });

    it.each(['SUBMITTING', 'UNKNOWN'])(
      'does not mutate the original order while cancellation is %s',
      async (cancellationStatus) => {
        mockPrisma.tradeRecord.findMany.mockResolvedValue([
          {
            id: `trade-cancel-${cancellationStatus.toLowerCase()}`,
            market: 'DOMESTIC',
            exchangeCode: 'KRX',
            stockCode: '005930',
            stockName: 'Samsung',
            side: 'BUY',
            quantity: 2,
            price: 70_000,
            executedQty: 0,
            executedPrice: null,
            orderNo: 'ambiguous-order',
            status: 'PENDING',
            cancellationStatus,
            strategyName: 'daily-dca',
            reason: 'DCA buy',
            createdAt: new Date(Date.now() - 10 * 60 * 1000),
          },
        ]);

        await service.reconcileOpenOrders('DOMESTIC', [], [], []);

        expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
        expect(mockPrisma.tradeRecord.updateMany).not.toHaveBeenCalled();
      },
    );

    it('does not terminalize or emit side effects when a cancellation claim wins after the stale read', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-stale-cancellation-race',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 2,
          price: 70_000,
          executedQty: 0,
          executedPrice: null,
          orderNo: 'race-order',
          status: 'PENDING',
          cancellationStatus: null,
          strategyName: 'daily-dca',
          reason: 'DCA buy',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 0 });

      await service.reconcileOpenOrders('DOMESTIC', [], [], []);

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-stale-cancellation-race',
          status: 'PENDING',
          orderNo: 'race-order',
          cancellationStatus: null,
        },
        data: {
          status: 'CANCELLED',
          reason: 'DCA buy | 미체결 종료',
        },
      });
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
      expect(mockPrisma.tradeRecord.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.watchStockExecutionLog.create).not.toHaveBeenCalled();
      expect(mockSlackService.sendTradeAlert).not.toHaveBeenCalled();
    });

    it('does not apply broker-order results or side effects after a concurrent cancellation claim', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-stale-broker-race',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 2,
          price: 70_000,
          executedQty: 0,
          executedPrice: null,
          orderNo: 'race-broker-order',
          status: 'PENDING',
          cancellationStatus: null,
          strategyName: 'daily-dca',
          reason: 'DCA buy',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 0 });

      await service.reconcileOpenOrders(
        'DOMESTIC',
        [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 2 }],
        [],
        [{
          orderNo: 'race-broker-order',
          exchangeCode: 'KRX',
          stockCode: '005930',
          side: 'BUY',
          orderQuantity: 2,
          filledQuantity: 2,
          remainingQuantity: 0,
          filledPrice: 70_000,
        }],
      );

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-stale-broker-race',
          status: 'PENDING',
          orderNo: 'race-broker-order',
          cancellationStatus: null,
        },
        data: {
          status: 'FILLED',
          executedQty: 2,
          executedPrice: 70_000,
          reason: 'DCA buy | 평균체결가 70000',
        },
      });
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
      expect(mockPrisma.tradeRecord.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.watchStockExecutionLog.create).not.toHaveBeenCalled();
      expect(mockSlackService.sendTradeAlert).not.toHaveBeenCalled();
    });

    it('should mark a pending buy order as filled when quantity increases and order is no longer unfilled', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-1',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 10,
          price: 70000,
          executedQty: null,
          executedPrice: null,
          orderNo: '1001',
          status: 'PENDING',
          strategyName: 'daily-dca',
          createdAt: new Date('2026-04-09T01:00:00Z'),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-1',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        side: 'BUY',
        quantity: 10,
        price: 70000,
        executedPrice: 70000,
        orderNo: '1001',
        strategyName: 'daily-dca',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({ id: 'ws-1' });
      mockPrisma.watchStockExecutionLog.findFirst.mockResolvedValue({
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        message: '주문 접수',
        details: {
          side: 'BUY',
          quantity: 10,
          price: 70000,
          orderDivision: '00',
          reason: 'DCA 매수',
        },
      });

      const result = await service.reconcileOpenOrders(
        'DOMESTIC',
        [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 10 }],
        [],
        [
          {
            orderNo: '1001',
            stockCode: '005930',
            side: 'BUY',
            orderQuantity: 10,
            filledQuantity: 10,
            remainingQuantity: 0,
            filledPrice: 70000,
            exchangeCode: 'KRX',
          },
        ],
      );

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-1',
          status: 'PENDING',
          orderNo: '1001',
          cancellationStatus: null,
        },
        data: {
          status: 'FILLED',
          executedQty: 10,
          executedPrice: 70000,
          reason: '평균체결가 70000',
        },
      });
      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalled();
      expect(mockSlackService.sendTradeAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: expect.objectContaining({
            stockCode: '005930',
            quantity: 10,
            price: 70000,
            orderDivision: '00',
          }),
          execution: expect.objectContaining({
            quantity: 10,
            price: 70000,
            status: 'FILLED',
          }),
        }),
      );
      expect(result).toEqual({ hasNewFill: true });
    });

    it('uses the newest valid submitted signal when the latest submission log lacks signal details', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-buy-slack-1',
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'BUY',
          quantity: 2,
          price: 72.11,
          executedQty: 0,
          executedPrice: null,
          orderNo: '0031180488',
          status: 'PENDING',
          strategyName: 'infinite-buy',
          createdAt: new Date('2026-07-16T15:30:07.670Z'),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-buy-slack-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        side: 'BUY',
        quantity: 2,
        price: 72.11,
        executedQty: 2,
        executedPrice: 72.0798,
        orderNo: '0031180488',
        strategyName: 'infinite-buy',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-tqqq',
        quota: 10_000,
        maxCycles: 40,
      });
      mockPrisma.watchStockExecutionLog.findFirst.mockResolvedValue({
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        message: '주문 접수: BUY 2주',
        details: {
          orderNo: '0031180488',
          outcome: 'ACCEPTED',
          orderTime: '003008',
        },
      });
      mockPrisma.watchStockExecutionLog.findMany.mockResolvedValue([
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          message: '주문 접수: BUY 2주',
          details: {
            orderNo: '0031180488',
            outcome: 'ACCEPTED',
            orderTime: '003008',
          },
        },
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          message: '주문 제출: BUY 2주',
          details: {
            side: 'BUY',
            quantity: 2,
            price: 72.11,
            orderDivision: '00',
            reason: 'Buy1: T=20.6, 70%, 2주 @ 72.11',
          },
        },
      ]);

      await service.reconcileOpenOrders(
        'OVERSEAS',
        [{ market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', quantity: 69 }],
        [],
        [
          {
            orderNo: '0031180488',
            stockCode: 'TQQQ',
            side: 'BUY',
            orderQuantity: 2,
            filledQuantity: 2,
            remainingQuantity: 0,
            filledPrice: 72.0798,
            exchangeCode: 'NASD',
          },
        ],
      );

      expect(mockSlackService.sendTradeAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: expect.objectContaining({
            side: 'BUY',
            quantity: 2,
            price: 72.0798,
            reason: 'Buy1: T=20.6, 70%, 2주 @ 72.11',
          }),
          execution: expect.objectContaining({
            quantity: 2,
            price: 72.0798,
            status: 'FILLED',
          }),
        }),
      );
    });

    it('includes infinite-buy order-time and post-fill T values in the trade fill alert strategy details', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-inf-1',
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'BUY',
          quantity: 2,
          price: 75.12,
          executedQty: null,
          executedPrice: null,
          orderNo: '0030768238',
          status: 'PENDING',
          strategyName: 'infinite-buy',
          createdAt: new Date('2026-06-23T15:30:00Z'),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-inf-1',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        side: 'BUY',
        quantity: 2,
        price: 75.12,
        executedQty: 2,
        executedPrice: 75.11,
        orderNo: '0030768238',
        strategyName: 'infinite-buy',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-tqqq',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        quota: 10000,
        maxCycles: 40,
      });
      mockPrisma.watchStockExecutionLog.findFirst.mockResolvedValue({
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        message: '주문 접수',
        details: {
          side: 'BUY',
          quantity: 2,
          price: 75.12,
          orderDivision: '00',
          reason: 'Buy1: T=11.7, 70%+잔여재배분, 2주 @ 75.12',
        },
      });
      mockPrisma.position.findFirst.mockResolvedValue({
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        exchangeCode: 'NASD',
        market: 'OVERSEAS',
        quantity: 37,
        avgPrice: 78.79,
        currentPrice: 75.11,
        profitLoss: -136.01,
        profitRate: -4.66,
        totalInvested: 4560.63,
      });

      await service.reconcileOpenOrders(
        'OVERSEAS',
        [{ market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', quantity: 37 }],
        [],
        [
          {
            orderNo: '0030768238',
            stockCode: 'TQQQ',
            side: 'BUY',
            orderQuantity: 2,
            filledQuantity: 2,
            remainingQuantity: 0,
            filledPrice: 75.11,
            exchangeCode: 'NASD',
          },
        ],
      );

      expect(mockSlackService.sendTradeAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          strategyDetails: expect.objectContaining({
            tValue: 11.7,
            postFillTValue: expect.closeTo(18.24252, 5),
            maxCycles: 40,
          }),
        }),
      );
    });

    it('restores an approved sell signal from the approval row when submission log is unavailable', async () => {
      const approvedSignal = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        quantity: 2,
        price: 82,
        orderDivision: '00',
        reason: 'Take profit 1: T=20',
        metadata: { phase: 'take-profit-1', tValue: 20 },
      };
      const filledRecord = {
        id: 'trade-approved-sell',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        side: 'SELL',
        quantity: 2,
        price: 82,
        executedQty: 2,
        executedPrice: 82,
        orderNo: 'approved-order',
        status: 'FILLED',
        strategyName: 'infinite-buy',
        createdAt: new Date('2026-07-13T15:00:00.000Z'),
      };
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        { ...filledRecord, status: 'PENDING', executedQty: 0 },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue(filledRecord);
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'watch-approved-sell',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        quota: 10_000,
        maxCycles: 40,
      });
      mockPrisma.watchStockExecutionLog.findFirst.mockResolvedValue(null);
      mockPrisma.stopLossApproval.findFirst.mockResolvedValue({ signal: approvedSignal });
      mockPrisma.position.findFirst.mockResolvedValue(null);

      await service.reconcileOpenOrders(
        'OVERSEAS',
        [{ market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', quantity: 8 }],
        [],
        [{
          orderNo: 'approved-order',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          orderQuantity: 2,
          filledQuantity: 2,
          remainingQuantity: 0,
          filledPrice: 82,
        }],
      );

      expect(mockTradingService.handleStrategySignalFill).toHaveBeenCalledWith(
        'infinite-buy',
        'watch-approved-sell',
        approvedSignal,
        10,
        filledRecord.createdAt,
        82,
      );
      expect(mockSlackService.sendTradeAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          signal: expect.objectContaining({
            stockCode: 'TQQQ',
            side: 'SELL',
            quantity: 2,
          }),
        }),
      );
    });

    it('should cancel a pending order when it disappears without any filled quantity', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-2',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 5,
          price: 70000,
          executedQty: null,
          executedPrice: null,
          orderNo: '1002',
          status: 'PENDING',
          strategyName: 'daily-dca',
          reason: 'DCA 매수',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-2',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        side: 'BUY',
        quantity: 5,
        price: 70000,
        executedPrice: null,
        orderNo: '1002',
        strategyName: 'daily-dca',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({ id: 'ws-1' });
      mockPrisma.watchStockExecutionLog.findFirst.mockResolvedValue({
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        message: '주문 접수',
        details: {
          side: 'BUY',
          quantity: 5,
          price: 70000,
          reason: 'DCA 매수',
        },
      });

      await service.reconcileOpenOrders(
        'DOMESTIC',
        [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 0 }],
        [],
        [],
      );

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-2',
          status: 'PENDING',
          orderNo: '1002',
          cancellationStatus: null,
        },
        data: {
          status: 'CANCELLED',
          reason: 'DCA 매수 | 미체결 종료',
        },
      });
    });

    it('should mark an order as partial when broker reports partial fill', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-3',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 10,
          price: 70000,
          executedQty: null,
          executedPrice: null,
          orderNo: '1003',
          status: 'PENDING',
          strategyName: 'daily-dca',
          createdAt: new Date('2026-04-09T01:00:00Z'),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-3',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        side: 'BUY',
        quantity: 10,
        price: 70000,
        executedPrice: 70500,
        orderNo: '1003',
        strategyName: 'daily-dca',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({ id: 'ws-1' });
      mockPrisma.watchStockExecutionLog.findFirst.mockResolvedValue({
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        message: '주문 접수',
        details: {
          side: 'BUY',
          quantity: 10,
          price: 70000,
          reason: 'DCA 매수',
        },
      });

      await service.reconcileOpenOrders(
        'DOMESTIC',
        [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 4 }],
        [],
        [
          {
            orderNo: '1003',
            stockCode: '005930',
            side: 'BUY',
            orderQuantity: 10,
            filledQuantity: 4,
            remainingQuantity: 6,
            filledPrice: 70500,
            exchangeCode: 'KRX',
          },
        ],
      );

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-3',
          status: 'PENDING',
          orderNo: '1003',
          cancellationStatus: null,
        },
        data: {
          status: 'PARTIAL',
          executedQty: 4,
          executedPrice: 70500,
          reason: '부분체결 4/10주, 잔량 6주, 평균체결가 70500',
        },
      });
    });

    it('keeps a terminal overseas partial fill as PARTIAL and does not apply full SELL fill handling', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-terminal-partial',
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'SELL',
          quantity: 5,
          price: 80,
          executedQty: 0,
          executedPrice: null,
          orderNo: 'terminal-partial-order',
          status: 'PENDING',
          cancellationStatus: null,
          strategyName: 'infinite-buy',
          reason: 'Take profit',
          createdAt: new Date('2026-07-14T01:00:00.000Z'),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-terminal-partial',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        side: 'SELL',
        quantity: 5,
        price: 80,
        executedQty: 2,
        executedPrice: 80,
        orderNo: null,
        status: 'PARTIAL',
        strategyName: 'infinite-buy',
        createdAt: new Date('2026-07-14T01:00:00.000Z'),
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'watch-terminal-partial',
      });
      mockPrisma.watchStockExecutionLog.findFirst.mockResolvedValue({
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        message: '주문 접수',
        details: {
          side: 'SELL',
          quantity: 5,
          price: 80,
          reason: 'Take profit',
        },
      });
      mockSlackService.isEnabled.mockReturnValue(false);

      await service.reconcileOpenOrders(
        'OVERSEAS',
        [{
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          quantity: 8,
        }],
        [],
        [{
          orderNo: 'terminal-partial-order',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          orderQuantity: 5,
          filledQuantity: 2,
          remainingQuantity: 0,
          filledPrice: 80,
        }],
      );

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-terminal-partial',
          status: 'PENDING',
          orderNo: 'terminal-partial-order',
          cancellationStatus: null,
        },
        data: {
          status: 'PARTIAL',
          orderNo: null,
          executedQty: 2,
          executedPrice: 80,
          reason: 'Take profit | 부분체결 2/5주, 평균체결가 80',
        },
      });
      expect(mockTradingService.handleStrategySignalFill).not.toHaveBeenCalled();
    });

    it('clears the order number when an existing PARTIAL order closes with no new fill', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-existing-terminal-partial',
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'SELL',
          quantity: 5,
          price: 80,
          executedQty: 2,
          executedPrice: 80,
          orderNo: 'existing-terminal-partial-order',
          status: 'PARTIAL',
          cancellationStatus: null,
          strategyName: 'infinite-buy',
          reason: 'Take profit',
          createdAt: new Date('2026-07-14T01:00:00.000Z'),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue(null);
      mockSlackService.isEnabled.mockReturnValue(false);

      await service.reconcileOpenOrders('OVERSEAS', [], [], [{
        orderNo: 'existing-terminal-partial-order',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        side: 'SELL',
        orderQuantity: 5,
        filledQuantity: 2,
        remainingQuantity: 0,
        filledPrice: 80,
      }]);

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-existing-terminal-partial',
          status: 'PARTIAL',
          orderNo: 'existing-terminal-partial-order',
          cancellationStatus: null,
        },
        data: {
          status: 'PARTIAL',
          orderNo: null,
          executedQty: 2,
          executedPrice: 80,
          reason: 'Take profit | 부분체결 2/5주, 평균체결가 80',
        },
      });
      expect(mockTradingService.handleStrategySignalFill).not.toHaveBeenCalled();
    });

    it('should preserve partial status and clear orderNo when remaining quantity is no longer open', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-4',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 10,
          price: 70000,
          executedQty: 4,
          executedPrice: 70500,
          orderNo: '1004',
          status: 'PARTIAL',
          strategyName: 'daily-dca',
          reason: 'DCA 매수',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-4',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
        side: 'BUY',
        quantity: 10,
        price: 70000,
        executedPrice: 70500,
        executedQty: 4,
        orderNo: null,
        strategyName: 'daily-dca',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({ id: 'ws-1' });

      await service.reconcileOpenOrders(
        'DOMESTIC',
        [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 4 }],
        [],
        [],
      );

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-4',
          status: 'PARTIAL',
          orderNo: '1004',
          cancellationStatus: null,
        },
        data: {
          orderNo: null,
          reason: 'DCA 매수 | 잔량 미체결 종료',
        },
      });
    });

    it('does not clear a partial order number when cancellation is claimed after the stale read', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-partial-race',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 10,
          price: 70_000,
          executedQty: 4,
          executedPrice: 70_500,
          orderNo: 'partial-race-order',
          status: 'PARTIAL',
          cancellationStatus: null,
          strategyName: 'daily-dca',
          reason: 'DCA buy',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);
      mockPrisma.tradeRecord.updateMany.mockResolvedValue({ count: 0 });

      await service.reconcileOpenOrders('DOMESTIC', [], [], []);

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-partial-race',
          status: 'PARTIAL',
          orderNo: 'partial-race-order',
          cancellationStatus: null,
        },
        data: {
          orderNo: null,
          reason: 'DCA buy | 잔량 미체결 종료',
        },
      });
      expect(mockPrisma.tradeRecord.update).not.toHaveBeenCalled();
      expect(mockPrisma.watchStockExecutionLog.create).not.toHaveBeenCalled();
      expect(mockSlackService.sendTradeAlert).not.toHaveBeenCalled();
    });

    it('should append broker rejection reason when broker reports failed order', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-6',
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'AAPL',
          stockName: 'Apple',
          side: 'BUY',
          quantity: 5,
          price: 190,
          executedQty: null,
          executedPrice: null,
          orderNo: '2006',
          status: 'PENDING',
          strategyName: 'manual',
          reason: '수동 매수',
          createdAt: new Date('2026-04-09T01:00:00Z'),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-6',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'AAPL',
        stockName: 'Apple',
        side: 'BUY',
        quantity: 5,
        price: 190,
        executedPrice: null,
        executedQty: 0,
        orderNo: '2006',
        status: 'FAILED',
        strategyName: 'manual',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({ id: 'ws-1' });

      await service.reconcileOpenOrders(
        'OVERSEAS',
        [],
        [],
        [
          {
            orderNo: '2006',
            stockCode: 'AAPL',
            side: 'BUY',
            orderQuantity: 5,
            filledQuantity: 0,
            remainingQuantity: 5,
            exchangeCode: 'NASD',
            rejected: true,
            rejectedReason: '가격제한초과',
          },
        ],
      );

      expect(mockPrisma.tradeRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'trade-6',
          status: 'PENDING',
          orderNo: '2006',
          cancellationStatus: null,
        },
        data: {
          status: 'FAILED',
          executedQty: 0,
          executedPrice: 190,
          reason: '수동 매수 | 브로커 거부: 가격제한초과',
        },
      });
    });
  });

  describe('FAILED / CANCELLED carry restore (quota recovery)', () => {
    const setupFailedBuyReconcile = () => {
      // 현재 trade_record: infinite-buy BUY 2주 @ 56.87, FAILED로 확정될 것
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-fail-1',
          market: 'OVERSEAS',
          exchangeCode: 'NAS',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'BUY',
          quantity: 2,
          price: 56.87,
          executedQty: 0,
          executedPrice: null,
          orderNo: '0030301568',
          status: 'PENDING',
          strategyName: 'infinite-buy',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve({
          id: where.id,
          market: 'OVERSEAS',
          exchangeCode: 'NAS',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'BUY',
          quantity: 2,
          price: 56.87,
          executedQty: 0,
          executedPrice: null,
          orderNo: '0030301568',
          status: 'FAILED',
          strategyName: 'infinite-buy',
        }),
      );
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-tqqq',
        market: 'OVERSEAS',
        exchangeCode: 'NAS',
        stockCode: 'TQQQ',
        quota: 10000,
        maxCycles: 40,
        strategyParams: { accumulatedQuota: 0, rsiPolicy: 'hard-stop-70' },
      });
      mockPrisma.position.findFirst.mockResolvedValue({ totalInvested: 332 });
      (mockPrisma.watchStock as any).update = jest.fn().mockResolvedValue({});
    };

    it('restores accumulatedQuota when a BUY order is reconciled as FAILED (broker rejected)', async () => {
      setupFailedBuyReconcile();

      await service.reconcileOpenOrders(
        'OVERSEAS',
        [{ market: 'OVERSEAS', exchangeCode: 'NAS', stockCode: 'TQQQ', quantity: 6 }],
        [],
        [
          {
            orderNo: '0030301568',
            stockCode: 'TQQQ',
            side: 'BUY',
            orderQuantity: 2,
            filledQuantity: 0,
            remainingQuantity: 0,
            filledPrice: undefined,
            exchangeCode: 'NAS',
            rejected: true,
            rejectedReason: 'DFD 주문종료 취소',
          },
        ],
      );

      // perCycleQuota = 10000 / 40 = 250 → accumulatedQuota 복구
      expect((mockPrisma.watchStock as any).update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ws-tqqq' },
          data: expect.objectContaining({
            strategyParams: expect.objectContaining({
              accumulatedQuota: 250,
            }),
          }),
        }),
      );
    });

    it('logs FAILED order with ORDER_FAILED event type and "주문 실패 확인" message', async () => {
      setupFailedBuyReconcile();

      await service.reconcileOpenOrders(
        'OVERSEAS',
        [{ market: 'OVERSEAS', exchangeCode: 'NAS', stockCode: 'TQQQ', quantity: 6 }],
        [],
        [
          {
            orderNo: '0030301568',
            stockCode: 'TQQQ',
            side: 'BUY',
            orderQuantity: 2,
            filledQuantity: 0,
            remainingQuantity: 0,
            filledPrice: undefined,
            exchangeCode: 'NAS',
            rejected: true,
            rejectedReason: 'DFD 주문종료 취소',
          },
        ],
      );

      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'ORDER_FAILED',
            message: '주문 실패 확인: BUY 2주 (브로커 거부)',
            details: expect.objectContaining({
              status: 'FAILED',
            }),
          }),
        }),
      );
    });

    it('does NOT double-accumulate when executePerStockStrategy already carried today', async () => {
      // Given: 오늘 `executePerStockStrategy`에서 이미 carry 적립됐음 (lastAccumulatedDate = today)
      const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-dup',
          market: 'OVERSEAS',
          exchangeCode: 'NAS',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'BUY',
          quantity: 2,
          price: 56.87,
          executedQty: 0,
          executedPrice: null,
          orderNo: 'ORD-DUP',
          status: 'PENDING',
          strategyName: 'infinite-buy',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-dup',
        market: 'OVERSEAS',
        exchangeCode: 'NAS',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        side: 'BUY',
        quantity: 2,
        price: 56.87,
        executedQty: 0,
        strategyName: 'infinite-buy',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-tqqq',
        market: 'OVERSEAS',
        exchangeCode: 'NAS',
        stockCode: 'TQQQ',
        quota: 10000,
        maxCycles: 40,
        strategyParams: { accumulatedQuota: 250, lastAccumulatedDate: today },
      });
      mockPrisma.position.findFirst.mockResolvedValue({ totalInvested: 332 });
      (mockPrisma.watchStock as any).update = jest.fn().mockResolvedValue({});

      await service.reconcileOpenOrders(
        'OVERSEAS',
        [{ market: 'OVERSEAS', exchangeCode: 'NAS', stockCode: 'TQQQ', quantity: 6 }],
        [],
        [
          {
            orderNo: 'ORD-DUP',
            stockCode: 'TQQQ',
            side: 'BUY',
            orderQuantity: 2,
            filledQuantity: 0,
            remainingQuantity: 0,
            filledPrice: undefined,
            exchangeCode: 'NAS',
            rejected: true,
            rejectedReason: 'DFD 주문종료 취소',
          },
        ],
      );

      // watchStock.update 가 accumulatedQuota 를 수정하면 안 됨 (이미 오늘 적립됨)
      const quotaUpdateCall = ((mockPrisma.watchStock as any).update.mock.calls as any[]).find(
        (args) => args[0]?.data?.strategyParams?.accumulatedQuota !== undefined,
      );
      expect(quotaUpdateCall).toBeUndefined();
    });

    it('does NOT restore quota for a SELL order failure', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-sell-fail',
          market: 'OVERSEAS',
          exchangeCode: 'NAS',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'SELL',
          quantity: 3,
          price: 63.66,
          executedQty: 0,
          executedPrice: null,
          orderNo: '0030301581',
          status: 'PENDING',
          strategyName: 'infinite-buy',
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-sell-fail',
        market: 'OVERSEAS',
        exchangeCode: 'NAS',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        side: 'SELL',
        quantity: 3,
        price: 63.66,
        executedQty: 0,
        executedPrice: null,
        orderNo: '0030301581',
        strategyName: 'infinite-buy',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'ws-tqqq',
        market: 'OVERSEAS',
        exchangeCode: 'NAS',
        stockCode: 'TQQQ',
        quota: 10000,
        maxCycles: 40,
        strategyParams: { accumulatedQuota: 0 },
      });
      mockPrisma.position.findFirst.mockResolvedValue(null);
      (mockPrisma.watchStock as any).update = jest.fn().mockResolvedValue({});

      await service.reconcileOpenOrders(
        'OVERSEAS',
        [{ market: 'OVERSEAS', exchangeCode: 'NAS', stockCode: 'TQQQ', quantity: 6 }],
        [],
        [
          {
            orderNo: '0030301581',
            stockCode: 'TQQQ',
            side: 'SELL',
            orderQuantity: 3,
            filledQuantity: 0,
            remainingQuantity: 0,
            filledPrice: undefined,
            exchangeCode: 'NAS',
            rejected: true,
            rejectedReason: 'DFD 주문종료 취소',
          },
        ],
      );

      // SELL 실패 시에는 watchStock 이 업데이트되면 안 됨 (이월금 변동 없음)
      expect((mockPrisma.watchStock as any).update).not.toHaveBeenCalled();
    });
  });
});
