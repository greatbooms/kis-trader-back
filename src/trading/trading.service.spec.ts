import { Test, TestingModule } from '@nestjs/testing';
import { TradingService } from './trading.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { PrismaService } from '../prisma.service';
import { NoopStrategy } from './strategy/noop.strategy';
import { SlackService } from '../notification/slack.service';
import { TradingStrategy, TradingSignal, TradingStrategyContext } from './types';

describe('TradingService', () => {
  let service: TradingService;

  const mockKisDomestic = {
    getPrice: jest.fn(),
    orderBuy: jest.fn(),
    orderSell: jest.fn(),
  };

  const mockKisOverseas = {
    getPrice: jest.fn(),
    orderBuy: jest.fn(),
    orderSell: jest.fn(),
  };

  const mockPrisma = {
    tradeRecord: {
      create: jest.fn(),
      update: jest.fn(),
    },
    position: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
    },
    strategyExecution: {
      upsert: jest.fn(),
    },
  };

  const mockNoopStrategy = {
    name: 'noop',
    evaluate: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingService,
        { provide: KisDomesticService, useValue: mockKisDomestic },
        { provide: KisOverseasService, useValue: mockKisOverseas },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NoopStrategy, useValue: mockNoopStrategy },
      ],
    }).compile();

    service = module.get<TradingService>(TradingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setStrategy', () => {
    it('should change the active strategy', () => {
      const newStrategy: TradingStrategy = {
        name: 'test-strategy',
        evaluate: jest.fn().mockResolvedValue([]),
      };
      service.setStrategy(newStrategy);
      // No error thrown means success
    });
  });

  describe('fetchDomesticPrices', () => {
    it('should fetch prices for all stock codes', async () => {
      mockKisDomestic.getPrice.mockResolvedValue({
        stockCode: '005930',
        stockName: 'Samsung',
        currentPrice: 70000,
        openPrice: 69000,
        highPrice: 71000,
        lowPrice: 68000,
        volume: 1000000,
      });

      const result = await service.fetchDomesticPrices(['005930', '000660']);

      expect(result.size).toBe(2);
      expect(mockKisDomestic.getPrice).toHaveBeenCalledTimes(2);
    });

    it('should handle errors gracefully', async () => {
      mockKisDomestic.getPrice
        .mockResolvedValueOnce({
          stockCode: '005930',
          currentPrice: 70000,
          stockName: 'Samsung',
          openPrice: 69000,
          highPrice: 71000,
          lowPrice: 68000,
          volume: 1000000,
        })
        .mockRejectedValueOnce(new Error('API error'));

      const result = await service.fetchDomesticPrices(['005930', '000660']);

      expect(result.size).toBe(1);
      expect(result.has('005930')).toBe(true);
    });
  });

  describe('fetchOverseasPrices', () => {
    it('should fetch overseas prices', async () => {
      mockKisOverseas.getPrice.mockResolvedValue({
        stockCode: 'AAPL',
        stockName: 'Apple',
        currentPrice: 150,
        openPrice: 149,
        highPrice: 152,
        lowPrice: 148,
        volume: 5000000,
      });

      const stocks = [
        { exchangeCode: 'NASD', stockCode: 'AAPL' },
        { exchangeCode: 'NYSE', stockCode: 'MSFT' },
      ];
      const result = await service.fetchOverseasPrices(stocks);

      expect(result.size).toBe(2);
      expect(mockKisOverseas.getPrice).toHaveBeenCalledWith('NASD', 'AAPL');
      expect(mockKisOverseas.getPrice).toHaveBeenCalledWith('NYSE', 'MSFT');
    });
  });

  describe('executeStrategy', () => {
    it('should do nothing when strategy returns no signals', async () => {
      mockNoopStrategy.evaluate.mockResolvedValue([]);

      await service.executeStrategy('DOMESTIC', new Map(), []);

      expect(mockPrisma.tradeRecord.create).not.toHaveBeenCalled();
    });

    it('should execute buy order for domestic market', async () => {
      const buyStrategy: TradingStrategy = {
        name: 'buy-strategy',
        evaluate: jest.fn().mockResolvedValue([
          {
            market: 'DOMESTIC',
            stockCode: '005930',
            side: 'BUY',
            quantity: 10,
            price: 70000,
            reason: 'Test buy',
            orderDivision: '00',
          },
        ]),
      };

      service.setStrategy(buyStrategy);

      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'trade-1' });
      mockKisDomestic.orderBuy.mockResolvedValue({
        success: true,
        orderNo: 'ORD001',
        message: 'Order filled',
      });
      mockPrisma.tradeRecord.update.mockResolvedValue({});
      mockPrisma.position.findFirst.mockResolvedValue(null);

      await service.executeStrategy('DOMESTIC', new Map(), []);

      expect(mockPrisma.tradeRecord.create).toHaveBeenCalledTimes(1);
      expect(mockKisDomestic.orderBuy).toHaveBeenCalledWith('005930', 10, 70000, '00');
    });

    it('should execute sell order for domestic market', async () => {
      const sellStrategy: TradingStrategy = {
        name: 'sell-strategy',
        evaluate: jest.fn().mockResolvedValue([
          {
            market: 'DOMESTIC',
            stockCode: '005930',
            side: 'SELL',
            quantity: 5,
            price: 75000,
            reason: 'Test sell',
          },
        ]),
      };

      service.setStrategy(sellStrategy);

      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'trade-2' });
      mockKisDomestic.orderSell.mockResolvedValue({
        success: true,
        orderNo: 'ORD002',
        message: 'Sell filled',
      });
      mockPrisma.tradeRecord.update.mockResolvedValue({});
      mockPrisma.position.findFirst.mockResolvedValue(null);

      await service.executeStrategy('DOMESTIC', new Map(), []);

      expect(mockKisDomestic.orderSell).toHaveBeenCalledWith('005930', 5, 75000, undefined);
    });

    it('should handle failed orders', async () => {
      const failStrategy: TradingStrategy = {
        name: 'fail-strategy',
        evaluate: jest.fn().mockResolvedValue([
          {
            market: 'DOMESTIC',
            stockCode: '005930',
            side: 'BUY',
            quantity: 10,
            price: 70000,
            reason: 'Test',
          },
        ]),
      };

      service.setStrategy(failStrategy);

      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'trade-3' });
      mockKisDomestic.orderBuy.mockResolvedValue({
        success: false,
        message: 'Insufficient funds',
      });
      mockPrisma.tradeRecord.update.mockResolvedValue({});

      await service.executeStrategy('DOMESTIC', new Map(), []);

      expect(mockPrisma.tradeRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trade-3' },
          data: expect.objectContaining({
            status: 'FAILED',
          }),
        }),
      );
    });

    it('should handle order exceptions', async () => {
      const errStrategy: TradingStrategy = {
        name: 'err-strategy',
        evaluate: jest.fn().mockResolvedValue([
          {
            market: 'DOMESTIC',
            stockCode: '005930',
            side: 'BUY',
            quantity: 10,
            reason: 'Test',
          },
        ]),
      };

      service.setStrategy(errStrategy);

      mockPrisma.tradeRecord.create.mockResolvedValue({ id: 'trade-4' });
      mockKisDomestic.orderBuy.mockRejectedValue(new Error('Network error'));
      mockPrisma.tradeRecord.update.mockResolvedValue({});

      await service.executeStrategy('DOMESTIC', new Map(), []);

      expect(mockPrisma.tradeRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            reason: 'Network error',
          }),
        }),
      );
    });
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
      // deleteMany not called because stockCodes.length === 0
      expect(mockPrisma.position.deleteMany).not.toHaveBeenCalled();
    });
  });
});
