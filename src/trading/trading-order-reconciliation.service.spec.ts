import { Test, TestingModule } from '@nestjs/testing';
import { TradingOrderReconciliationService } from './trading-order-reconciliation.service';
import { TradingService } from './trading.service';
import { PrismaService } from '../prisma.service';
import { SlackService } from '../notification/slack.service';

describe('TradingOrderReconciliationService', () => {
  let service: TradingOrderReconciliationService;

  const mockPrisma = {
    tradeRecord: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
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
    },
  };

  const mockSlackService = {
    isEnabled: jest.fn().mockReturnValue(true),
    sendTradeAlert: jest.fn(),
  };

  const mockTradingService = {
    handleStrategySignalFill: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingOrderReconciliationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TradingService, useValue: mockTradingService },
        { provide: SlackService, useValue: mockSlackService },
      ],
    }).compile();

    service = module.get<TradingOrderReconciliationService>(TradingOrderReconciliationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockSlackService.isEnabled.mockReturnValue(true);
  });

  describe('reconcileOpenOrders', () => {
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

      await service.reconcileOpenOrders(
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

      expect(mockPrisma.tradeRecord.update).toHaveBeenCalledWith({
        where: { id: 'trade-1' },
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

      expect(mockPrisma.tradeRecord.update).toHaveBeenCalledWith({
        where: { id: 'trade-2' },
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

      expect(mockPrisma.tradeRecord.update).toHaveBeenCalledWith({
        where: { id: 'trade-3' },
        data: {
          status: 'PARTIAL',
          executedQty: 4,
          executedPrice: 70500,
          reason: '부분체결 4/10주, 잔량 6주, 평균체결가 70500',
        },
      });
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

      expect(mockPrisma.tradeRecord.update).toHaveBeenCalledWith({
        where: { id: 'trade-4' },
        data: {
          orderNo: null,
          reason: 'DCA 매수 | 잔량 미체결 종료',
        },
      });
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

      expect(mockPrisma.tradeRecord.update).toHaveBeenCalledWith({
        where: { id: 'trade-6' },
        data: {
          status: 'FAILED',
          executedQty: 0,
          executedPrice: 190,
          reason: '수동 매수 | 브로커 거부: 가격제한초과',
        },
      });
    });
  });

  describe('markOpenOrderCancelled', () => {
    it('should append cancellation reason and log cancelled remainder for partial orders', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-5',
          market: 'DOMESTIC',
          exchangeCode: 'KRX',
          stockCode: '005930',
          stockName: 'Samsung',
          side: 'BUY',
          quantity: 10,
          price: 70000,
          executedQty: 4,
          executedPrice: 70500,
          orderNo: '1005',
          status: 'PARTIAL',
          strategyName: 'daily-dca',
          reason: 'DCA 매수',
          createdAt: new Date('2026-04-09T01:00:00Z'),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-5',
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
        status: 'PARTIAL',
        strategyName: 'daily-dca',
      });
      mockPrisma.watchStock.findUnique.mockResolvedValue({ id: 'ws-1' });

      await service.markOpenOrderCancelled('DOMESTIC', '1005', '장중 재실행 전 미체결 주문 취소');

      expect(mockPrisma.tradeRecord.update).toHaveBeenCalledWith({
        where: { id: 'trade-5' },
        data: {
          orderNo: null,
          reason: 'DCA 매수 | 장중 재실행 전 미체결 주문 취소',
        },
      });
      expect(mockPrisma.watchStockExecutionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'ORDER_CANCELLED',
            message: '주문 잔량 취소 확인: BUY 4/10주 체결, 잔량 6주 종료',
            details: expect.objectContaining({
              cancelledRemainder: true,
              remainingQty: 6,
            }),
          }),
        }),
      );
    });

    it('does NOT restore quota when cancelling remainder of a PARTIAL order (partial fill already counted)', async () => {
      // PARTIAL → 잔량 취소는 이미 일부 체결됐으므로 이월금 복구 금지
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        {
          id: 'trade-partial-cancel',
          market: 'OVERSEAS',
          exchangeCode: 'NAS',
          stockCode: 'TQQQ',
          stockName: 'TQQQ',
          side: 'BUY',
          quantity: 10,
          price: 56.87,
          executedQty: 4,
          executedPrice: 56.87,
          orderNo: 'PRT-1',
          status: 'PARTIAL',
          strategyName: 'infinite-buy',
          createdAt: new Date('2026-04-09T01:00:00Z'),
        },
      ]);
      mockPrisma.tradeRecord.findUnique.mockResolvedValue({
        id: 'trade-partial-cancel',
        market: 'OVERSEAS',
        exchangeCode: 'NAS',
        stockCode: 'TQQQ',
        stockName: 'TQQQ',
        side: 'BUY',
        quantity: 10,
        price: 56.87,
        executedQty: 4,
        executedPrice: 56.87,
        status: 'PARTIAL',
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
      mockPrisma.position.findFirst.mockResolvedValue({ totalInvested: 332 });
      (mockPrisma.watchStock as any).update = jest.fn().mockResolvedValue({});

      await service.markOpenOrderCancelled('OVERSEAS', 'PRT-1', '잔량 종료');

      // watchStock 가 strategyParams(accumulatedQuota)로 수정되면 안 됨
      const quotaUpdateCall = ((mockPrisma.watchStock as any).update.mock.calls as any[]).find(
        (args) => args[0]?.data?.strategyParams?.accumulatedQuota !== undefined,
      );
      expect(quotaUpdateCall).toBeUndefined();
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
