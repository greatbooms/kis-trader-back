import { Test, TestingModule } from '@nestjs/testing';
import { TradingPositionSyncService } from './trading-position-sync.service';
import { PrismaService } from '../prisma.service';

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

      await service.syncPositions('DOMESTIC', items);

      expect(mockPrisma.position.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.position.deleteMany).toHaveBeenCalledWith({
        where: {
          market: 'DOMESTIC',
          stockCode: { notIn: ['005930'] },
        },
      });
    });

    it('deletes all market positions after a successful empty broker snapshot', async () => {
      mockPrisma.position.deleteMany.mockResolvedValue({ count: 1 });

      await service.syncPositions('DOMESTIC', []);

      expect(mockPrisma.position.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.position.deleteMany).toHaveBeenCalledWith({
        where: { market: 'DOMESTIC' },
      });
    });
  });
});
