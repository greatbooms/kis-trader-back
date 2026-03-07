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
});
