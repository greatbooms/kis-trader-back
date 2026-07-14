import { Test, TestingModule } from '@nestjs/testing';
import { TradeRecordService } from './trade-record.service';
import { PrismaService } from '../prisma.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { ConfigService } from '@nestjs/config';
import { MarketAnalysisService } from '../trading/market-analysis.service';

describe('TradeRecordService', () => {
  let service: TradeRecordService;

  const mockPrisma = {
    tradeRecord: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    position: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    riskSnapshot: {
      findMany: jest.fn(),
    },
    appSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const mockKisDomestic = {
    getBalance: jest.fn(),
    getBuyableAmount: jest.fn(),
    getPrice: jest.fn(),
    orderSell: jest.fn(),
    cancelOrder: jest.fn(),
    getUnfilledOrders: jest.fn(),
    getOrderExecutions: jest.fn(),
  };

  const mockKisOverseas = {
    getBalance: jest.fn(),
    getCashBalances: jest.fn(),
    getAccountSnapshot: jest.fn(),
    getPrice: jest.fn(),
    orderSell: jest.fn(),
    cancelOrder: jest.fn(),
    getUnfilledOrders: jest.fn(),
    getOrderExecutions: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'trading.enabled') return true;
      return undefined;
    }),
  };

  const mockMarketAnalysis = {
    fetchDailyPrices: jest.fn(),
    calculateTechnicalRatings: jest.fn(() => ({
      timeframe: '1D',
      oscillators: [],
      movingAverages: [],
      oscillatorSummary: { score: 0, recommendation: 'NEUTRAL', buyCount: 0, neutralCount: 0, sellCount: 0 },
      movingAverageSummary: { score: 0, recommendation: 'NEUTRAL', buyCount: 0, neutralCount: 0, sellCount: 0 },
      overallSummary: { score: 0, recommendation: 'NEUTRAL', buyCount: 0, neutralCount: 0, sellCount: 0 },
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeRecordService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KisDomesticService, useValue: mockKisDomestic },
        { provide: KisOverseasService, useValue: mockKisOverseas },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MarketAnalysisService, useValue: mockMarketAnalysis },
      ],
    }).compile();

    service = module.get<TradeRecordService>(TradeRecordService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return trade records with default limit', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(mockPrisma.tradeRecord.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter by market', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);

      await service.findAll({ market: 'DOMESTIC' as any });

      expect(mockPrisma.tradeRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { market: 'DOMESTIC' },
        }),
      );
    });

    it('should filter by side', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);

      await service.findAll({ side: 'BUY' as any });

      expect(mockPrisma.tradeRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { side: 'BUY' },
        }),
      );
    });

    it('should apply custom limit and offset', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);

      await service.findAll({ limit: 10, offset: 20 });

      expect(mockPrisma.tradeRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should find a trade record by id', async () => {
      const mockRecord = { id: 'trade-1', stockCode: '005930' };
      mockPrisma.tradeRecord.findUnique.mockResolvedValue(mockRecord);

      const result = await service.findOne('trade-1');

      expect(result).toEqual(mockRecord);
    });

    it('should return null for non-existent id', async () => {
      mockPrisma.tradeRecord.findUnique.mockResolvedValue(null);

      const result = await service.findOne('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getDashboardSummary', () => {
    it('should return zero values when no trades', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);

      const result = await service.getDashboardSummary();

      expect(result).toEqual({
        totalProfitLoss: 0,
        totalTradeCount: 0,
        todayTradeCount: 0,
        winRate: 0,
      });
    });

    it('should calculate correct total trade count', async () => {
      const trades = [
        { id: '1', side: 'BUY', status: 'FILLED', createdAt: new Date('2026-01-01'), price: '100', executedPrice: null, quantity: 10, executedQty: null },
        { id: '2', side: 'SELL', status: 'FILLED', createdAt: new Date('2026-01-02'), price: '100', executedPrice: '110', quantity: 10, executedQty: 10 },
      ];
      mockPrisma.tradeRecord.findMany.mockResolvedValue(trades);

      const result = await service.getDashboardSummary();

      expect(result.totalTradeCount).toBe(2);
    });

    it('should calculate win rate from sell trades', async () => {
      const trades = [
        { id: '1', side: 'SELL', status: 'FILLED', createdAt: new Date('2026-01-01'), price: '100', executedPrice: '110', quantity: 10, executedQty: 10 }, // win
        { id: '2', side: 'SELL', status: 'FILLED', createdAt: new Date('2026-01-02'), price: '100', executedPrice: '90', quantity: 10, executedQty: 10 },  // loss
        { id: '3', side: 'SELL', status: 'FILLED', createdAt: new Date('2026-01-03'), price: '100', executedPrice: '120', quantity: 10, executedQty: 10 }, // win
      ];
      mockPrisma.tradeRecord.findMany.mockResolvedValue(trades);

      const result = await service.getDashboardSummary();

      // 2 wins out of 3 sells = 66.67%
      expect(result.winRate).toBeCloseTo(66.67, 0);
    });

    it('should count today trades', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const trades = [
        { id: '1', side: 'BUY', status: 'FILLED', createdAt: today, price: '100', executedPrice: null, quantity: 10, executedQty: null },
        { id: '2', side: 'SELL', status: 'FILLED', createdAt: today, price: '100', executedPrice: '110', quantity: 10, executedQty: 10 },
        { id: '3', side: 'BUY', status: 'FILLED', createdAt: yesterday, price: '100', executedPrice: null, quantity: 10, executedQty: null },
      ];
      mockPrisma.tradeRecord.findMany.mockResolvedValue(trades);

      const result = await service.getDashboardSummary();

      expect(result.todayTradeCount).toBe(2);
    });
  });

  describe('getAccountSummary', () => {
    it('should include cached cash balances and last synced time', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        { totalInvested: '1000000', profitLoss: '50000' },
      ]);
      mockPrisma.riskSnapshot.findMany.mockResolvedValue([
        { cashBalance: '700000' },
      ]);
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);
      mockPrisma.appSetting.findUnique.mockResolvedValue({
        value: {
          cashBalances: [
            { market: 'DOMESTIC', currencyCode: 'KRW', amount: 700000, withdrawableAmount: 700000 },
            { market: 'OVERSEAS', currencyCode: 'USD', amount: 1200.5, withdrawableAmount: 1200.5 },
          ],
          lastSyncedAt: '2026-04-09T14:30:00.000Z',
        },
      });

      const result = await service.getAccountSummary();

      expect(result.cashBalances).toHaveLength(2);
      expect(result.lastSyncedAt).toBe('2026-04-09T14:30:00.000Z');
      expect(result.totalAssets).toBe(1750000);
    });
  });

  describe('refreshAccountState', () => {
    it('should refresh balances and persist account cash cache', async () => {
      mockKisDomestic.getBalance.mockResolvedValue([]);
      mockKisDomestic.getBuyableAmount.mockResolvedValue({ cashAvailable: 500000 });
      mockKisOverseas.getAccountSnapshot.mockResolvedValue({
        balance: [],
        cashBalances: [
          { currencyCode: 'USD', currencyName: '미국달러', amount: 1200.5, withdrawableAmount: 1000.25 },
        ],
      });
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);
      mockPrisma.riskSnapshot.findMany.mockResolvedValue([]);
      mockPrisma.appSetting.findUnique.mockResolvedValue({
        value: {
          cashBalances: [
            { market: 'DOMESTIC', currencyCode: 'KRW', amount: 500000, withdrawableAmount: 500000 },
            { market: 'OVERSEAS', currencyCode: 'USD', amount: 1200.5, withdrawableAmount: 1000.25 },
          ],
          lastSyncedAt: '2026-04-09T15:00:00.000Z',
        },
      });

      const result = await service.refreshAccountState();

      expect(result.success).toBe(true);
      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'account_status_cache' },
        }),
      );
      expect(result.accountSummary.cashBalances).toEqual([
        expect.objectContaining({ currencyCode: 'KRW', amount: 500000 }),
        expect.objectContaining({ currencyCode: 'USD', amount: 1200.5 }),
      ]);
    });
  });

  describe('findPositions', () => {
    it('should return all positions', async () => {
      const positions = [{ id: '1', stockCode: '005930' }];
      mockPrisma.position.findMany.mockResolvedValue(positions);

      const result = await service.findPositions();

      expect(result).toEqual(positions);
      expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { updatedAt: 'desc' },
      });
    });

    it('should filter by market', async () => {
      mockPrisma.position.findMany.mockResolvedValue([]);

      await service.findPositions('OVERSEAS' as any);

      expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
        where: { market: 'OVERSEAS' },
        orderBy: { updatedAt: 'desc' },
      });
    });
  });

});
