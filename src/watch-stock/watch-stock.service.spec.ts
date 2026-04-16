import { Test, TestingModule } from '@nestjs/testing';
import { WatchStockService } from './watch-stock.service';
import { PrismaService } from '../prisma.service';

describe('WatchStockService', () => {
  let service: WatchStockService;

  const mockPrisma = {
    watchStock: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    position: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
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

  describe('findCurrentCycleMap', () => {
    it('should calculate fractional cycle for cycle-based strategies from total invested', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          totalInvested: 156.1999,
        },
      ]);

      const result = await service.findCurrentCycleMap([
        {
          id: '1',
          market: 'OVERSEAS' as any,
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          strategyName: 'infinite-buy',
          quota: 10000,
          cycle: 0,
          maxCycles: 40,
        },
      ]);

      expect(result.get('1')).toBe(0.6);
    });

    it('should keep stored cycle for non-cycle strategies', async () => {
      const result = await service.findCurrentCycleMap([
        {
          id: '1',
          market: 'OVERSEAS' as any,
          exchangeCode: 'NASD',
          stockCode: 'AAPL',
          strategyName: 'trend-following',
          quota: 10000,
          cycle: 3,
          maxCycles: 40,
        },
      ]);

      expect(result.get('1')).toBe(3);
      expect(mockPrisma.position.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a new watch stock with required fields', async () => {
      const input = {
        market: 'DOMESTIC' as any,
        exchangeCode: 'KRX',
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

    it('should throw a friendly error when the stock is already registered', async () => {
      const input = {
        market: 'DOMESTIC' as any,
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
      };

      mockPrisma.watchStock.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.create(input)).rejects.toThrow('이미 등록된 관심종목입니다.');
      expect(mockPrisma.watchStock.create).not.toHaveBeenCalled();
    });

    it('should translate unique constraint errors into a friendly message', async () => {
      const input = {
        market: 'DOMESTIC' as any,
        exchangeCode: 'KRX',
        stockCode: '005930',
        stockName: 'Samsung',
      };

      mockPrisma.watchStock.findFirst.mockResolvedValue(null);
      mockPrisma.watchStock.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.create(input)).rejects.toThrow('이미 등록된 관심종목입니다.');
    });
  });

  describe('update', () => {
    beforeEach(() => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: '1',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        strategyName: 'infinite-buy',
        quota: 4000000,
        maxCycles: 40,
        strategyParams: null,
      });
      mockPrisma.position.findUnique.mockResolvedValue(null);
    });

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

    it('should rebase infinite-buy cycle and accumulated quota when quota changes', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: '1',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        strategyName: 'infinite-buy',
        quota: 4000000,
        maxCycles: 40,
        strategyParams: {
          accumulatedQuota: 200000,
          lastAccumulatedDate: '2026-04-10',
        },
      });
      mockPrisma.position.findUnique.mockResolvedValue({
        totalInvested: 1000000,
      });
      mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });

      await service.update('1', { quota: 8000000 });

      const callArgs = mockPrisma.watchStock.update.mock.calls[0][0];
      expect(Number(callArgs.data.quota)).toBe(8000000);
      expect(callArgs.data.cycle).toBe(5);
      expect(callArgs.data.strategyParams).toEqual({
        accumulatedQuota: 400000,
        lastAccumulatedDate: '2026-04-10',
      });
    });

    it('should not rebase non-infinite-buy quota updates', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: '1',
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        strategyName: 'trend-following',
        quota: 4000000,
        maxCycles: 40,
        strategyParams: {
          accumulatedQuota: 200000,
        },
      });
      mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });

      await service.update('1', { quota: 8000000 });

      const callArgs = mockPrisma.watchStock.update.mock.calls[0][0];
      expect(Number(callArgs.data.quota)).toBe(8000000);
      expect(callArgs.data.cycle).toBeUndefined();
      expect(callArgs.data.strategyParams).toBeUndefined();
      expect(mockPrisma.position.findUnique).not.toHaveBeenCalled();
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

  describe('resetAccumulatedQuota', () => {
    it('should clear accumulated quota fields for infinite-buy', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        strategyName: 'infinite-buy',
        strategyParams: {
          accumulatedQuota: 5000,
          lastAccumulatedDate: '2026-04-10',
          secondaryExitPlan: { secondTargetPrice: 100 },
        },
      });

      await service.resetAccumulatedQuota('1');

      expect(mockPrisma.watchStock.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          strategyParams: {
            secondaryExitPlan: { secondTargetPrice: 100 },
          },
        },
      });
    });
  });
});
