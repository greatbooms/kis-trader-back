import { Test, TestingModule } from '@nestjs/testing';
import { WatchStockService } from './watch-stock.service';
import { PrismaService } from '../prisma.service';

describe('WatchStockService', () => {
  let service: WatchStockService;

  const mockPrisma = {
    watchStock: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    simulationWatchStock: {
      count: jest.fn().mockResolvedValue(0),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WatchStockService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WatchStockService>(WatchStockService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all watch stocks when no market filter', async () => {
      const mockStocks = [
        { id: '1', stockCode: '005930', market: 'DOMESTIC' },
        { id: '2', stockCode: 'AAPL', market: 'OVERSEAS' },
      ];
      mockPrisma.watchStock.findMany.mockResolvedValue(mockStocks);

      const result = await service.findAll();

      expect(result).toEqual(mockStocks);
      expect(mockPrisma.watchStock.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by market when specified', async () => {
      mockPrisma.watchStock.findMany.mockResolvedValue([]);

      await service.findAll('DOMESTIC' as any);

      expect(mockPrisma.watchStock.findMany).toHaveBeenCalledWith({
        where: { market: 'DOMESTIC' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a single watch stock by id', async () => {
      const mockStock = { id: '1', stockCode: '005930' };
      mockPrisma.watchStock.findUnique.mockResolvedValue(mockStock);

      const result = await service.findOne('1');

      expect(result).toEqual(mockStock);
      expect(mockPrisma.watchStock.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null for non-existent id', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue(null);

      const result = await service.findOne('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new watch stock with required fields', async () => {
      const input = {
        market: 'DOMESTIC' as any,
        stockCode: '005930',
        stockName: 'Samsung',
      };

      mockPrisma.watchStock.create.mockResolvedValue({ id: '1', ...input });

      const result = await service.create(input);

      expect(result.id).toBe('1');
      expect(mockPrisma.watchStock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          market: 'DOMESTIC',
          stockCode: '005930',
          stockName: 'Samsung',
        }),
      });
    });

    it('should create with all optional fields', async () => {
      const input = {
        market: 'OVERSEAS' as any,
        exchangeCode: 'NASD',
        stockCode: 'AAPL',
        stockName: 'Apple',
        isActive: true,
        strategyName: 'infinite-buy',
        quota: 100000,
        maxCycles: 40,
        stopLossRate: 0.3,
        maxPortfolioRate: 0.15,
        strategyParams: { custom: true },
      };

      mockPrisma.watchStock.create.mockResolvedValue({ id: '2', ...input });

      await service.create(input);

      expect(mockPrisma.watchStock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          exchangeCode: 'NASD',
          strategyName: 'infinite-buy',
        }),
      });
    });
  });

  describe('update', () => {
    it('should update specified fields only', async () => {
      mockPrisma.watchStock.update.mockResolvedValue({
        id: '1',
        isActive: false,
      });

      await service.update('1', { isActive: false });

      expect(mockPrisma.watchStock.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { isActive: false },
      });
    });

    it('should convert numeric fields to Decimal', async () => {
      mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });

      await service.update('1', { quota: 200000, stopLossRate: 0.25 });

      const callArgs = mockPrisma.watchStock.update.mock.calls[0][0];
      expect(callArgs.data.quota).toBeDefined();
      expect(callArgs.data.stopLossRate).toBeDefined();
    });

    it('should not include undefined fields in update', async () => {
      mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });

      await service.update('1', { stockName: 'NewName' });

      const callArgs = mockPrisma.watchStock.update.mock.calls[0][0];
      expect(callArgs.data).toEqual({ stockName: 'NewName' });
      expect(callArgs.data.quota).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete a watch stock by id', async () => {
      mockPrisma.watchStock.delete.mockResolvedValue({ id: '1' });

      await service.delete('1');

      expect(mockPrisma.watchStock.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });
  });
});
