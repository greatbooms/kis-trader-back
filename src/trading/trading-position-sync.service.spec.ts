import { Test, TestingModule } from '@nestjs/testing';
import { TradingPositionSyncService } from './trading-position-sync.service';
import { PrismaService } from '../prisma.service';
import { Broker } from '@prisma/client';

describe('TradingPositionSyncService', () => {
  let service: TradingPositionSyncService;

  const mockPrisma = {
    position: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingPositionSyncService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TradingPositionSyncService>(TradingPositionSyncService);
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

      await service.syncPositions(Broker.KIS, 'DOMESTIC', items);

      expect(mockPrisma.position.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.position.deleteMany).toHaveBeenCalledWith({
        where: {
          broker: Broker.KIS,
          market: 'DOMESTIC',
          NOT: {
            OR: [{ exchangeCode: 'KRX', stockCode: '005930' }],
          },
        },
      });
    });

    it('deletes all market positions after a successful empty broker snapshot', async () => {
      mockPrisma.position.deleteMany.mockResolvedValue({ count: 1 });

      await service.syncPositions(Broker.KIS, 'DOMESTIC', []);

      expect(mockPrisma.position.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.position.deleteMany).toHaveBeenCalledWith({
        where: { broker: Broker.KIS, market: 'DOMESTIC' },
      });
    });

    it('scopes every KIS upsert and deletion so TOSS positions cannot be changed', async () => {
      mockPrisma.position.upsert.mockResolvedValue({});
      mockPrisma.position.deleteMany.mockResolvedValue({ count: 1 });

      await service.syncPositions(Broker.KIS, 'OVERSEAS', [{
        stockCode: 'TQQQ',
        stockName: 'ProShares UltraPro QQQ',
        quantity: 2,
        avgPrice: 80,
        currentPrice: 82,
        profitLoss: 4,
        profitRate: 2.5,
        exchangeCode: 'NASD',
      }]);

      expect(mockPrisma.position.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          broker_market_exchangeCode_stockCode: {
            broker: Broker.KIS,
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
          },
        },
        create: expect.objectContaining({ broker: Broker.KIS }),
      }));
      expect(mockPrisma.position.deleteMany).toHaveBeenCalledWith({
        where: {
          broker: Broker.KIS,
          market: 'OVERSEAS',
          NOT: {
            OR: [{ exchangeCode: 'NASD', stockCode: 'TQQQ' }],
          },
        },
      });
    });

    it('fails closed before writes when an overseas holding has an unresolved venue', async () => {
      await expect(service.syncPositions(Broker.TOSS, 'OVERSEAS', [{
        stockCode: 'TQQQ',
        stockName: 'ProShares UltraPro QQQ',
        quantity: 2,
        avgPrice: 80,
        currentPrice: 82,
        profitLoss: 4,
        profitRate: 2.5,
        exchangeCode: 'US',
      }])).rejects.toThrow('Unresolved overseas venue');

      expect(mockPrisma.position.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.position.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes stale overseas positions by exchange and stock tuple', async () => {
      mockPrisma.position.upsert.mockResolvedValue({});
      mockPrisma.position.deleteMany.mockResolvedValue({ count: 1 });

      await service.syncPositions(Broker.KIS, 'OVERSEAS', [{
        stockCode: 'TQQQ',
        stockName: 'ProShares UltraPro QQQ',
        quantity: 2,
        avgPrice: 80,
        currentPrice: 82,
        profitLoss: 4,
        profitRate: 2.5,
        exchangeCode: 'NASD',
      }]);

      expect(mockPrisma.position.deleteMany).toHaveBeenCalledWith({
        where: {
          broker: Broker.KIS,
          market: 'OVERSEAS',
          NOT: {
            OR: [{ exchangeCode: 'NASD', stockCode: 'TQQQ' }],
          },
        },
      });
    });
  });
});
