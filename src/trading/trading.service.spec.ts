import { Test, TestingModule } from '@nestjs/testing';
import { TradingService } from './trading.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';

describe('TradingService', () => {
  let service: TradingService;

  const mockKisDomestic = {
    getPrice: jest.fn(),
    orderBuy: jest.fn(),
    orderSell: jest.fn(),
    getOrderExecutions: jest.fn(),
  };

  const mockKisOverseas = {
    getPrice: jest.fn(),
    orderBuy: jest.fn(),
    orderSell: jest.fn(),
    getOrderExecutions: jest.fn(),
  };

  const mockPrisma = {
    tradeRecord: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    position: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingService,
        { provide: KisDomesticService, useValue: mockKisDomestic },
        { provide: KisOverseasService, useValue: mockKisOverseas },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TradingService>(TradingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('syncPositions', () => {
    it('should upsert positions and delete stale ones', async () => {
      const items = [
        {
          stockCode: '005930',
          stockName: 'Samsung',
          quantity: 100,
          avgPrice: 70000,
          currentPrice: 72000,
          profitLoss: 200000,
          profitRate: 2.86,
          exchangeCode: undefined,
        },
      ];

      mockPrisma.position.upsert.mockResolvedValue({});
      mockPrisma.position.deleteMany.mockResolvedValue({ count: 0 });

      await service.syncPositions('DOMESTIC', items);

      expect(mockPrisma.position.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.position.deleteMany).toHaveBeenCalledWith({
        where: {
          market: 'DOMESTIC',
          stockCode: { notIn: ['005930'] },
        },
      });
    });

    it('should handle empty positions list', async () => {
      await service.syncPositions('DOMESTIC', []);

      expect(mockPrisma.position.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.position.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('reconcileOpenOrders', () => {
    it('should mark a pending buy order as filled when quantity increases and order is no longer unfilled', async () => {
      mockKisDomestic.getOrderExecutions.mockResolvedValue([
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
      ]);
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
    });

    it('should cancel a pending order when it disappears without any filled quantity', async () => {
      mockKisDomestic.getOrderExecutions.mockResolvedValue([]);
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
      mockKisDomestic.getOrderExecutions.mockResolvedValue([
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
      ]);
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
      mockKisDomestic.getOrderExecutions.mockResolvedValue([]);
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
});
