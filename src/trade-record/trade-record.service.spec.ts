import { Test, TestingModule } from '@nestjs/testing';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { TradeRecordService } from './trade-record.service';
import { PrismaService } from '../prisma.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { ConfigService } from '@nestjs/config';
import { Broker } from '@prisma/client';
import { MarketAnalysisService } from '../trading/market-analysis.service';
import { TradingAccountCashSyncService } from '../trading/trading-account-cash-sync.service';
import { TradingPositionSyncService } from '../trading/trading-position-sync.service';

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
  const mockRegistry = {
    get: jest.fn().mockReturnValue({
      broker: Broker.KIS,
      getBalance: jest.fn((market) => market === 'DOMESTIC'
        ? mockKisDomestic.getBalance()
        : mockKisOverseas.getBalance()),
      getDomesticBuyableAmount: jest.fn(() => mockKisDomestic.getBuyableAmount()),
      getOverseasAccountSnapshot: jest.fn(() => mockKisOverseas.getAccountSnapshot()),
    }),
    getActive: jest.fn(),
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

  const mockAccountCashSync = {
    replaceCache: jest.fn(),
    getCache: jest.fn(),
  };
  const mockPositionSync = { syncPositions: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeRecordService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KisDomesticService, useValue: mockKisDomestic },
        { provide: KisOverseasService, useValue: mockKisOverseas },
        { provide: BrokerPortRegistry, useValue: mockRegistry },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MarketAnalysisService, useValue: mockMarketAnalysis },
        { provide: TradingAccountCashSyncService, useValue: mockAccountCashSync },
        { provide: TradingPositionSyncService, useValue: mockPositionSync },
      ],
    }).compile();

    service = module.get<TradeRecordService>(TradeRecordService);
    mockRegistry.getActive.mockReturnValue([mockRegistry.get(Broker.KIS)]);
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

    it('filters same-symbol trade history by broker', async () => {
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);

      await service.findAll({
        broker: Broker.TOSS,
        market: 'OVERSEAS',
        stockCode: 'TQQQ',
        exchangeCode: 'NASD',
      } as any);

      expect(mockPrisma.tradeRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            broker: Broker.TOSS,
            market: 'OVERSEAS',
            stockCode: 'TQQQ',
            exchangeCode: 'NASD',
          },
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
      mockAccountCashSync.getCache.mockResolvedValue({
          cashBalances: [
            { broker: Broker.KIS, market: 'DOMESTIC', currencyCode: 'KRW', amount: 700000, withdrawableAmount: 700000 },
            { broker: Broker.TOSS, market: 'OVERSEAS', currencyCode: 'USD', amount: 1200.5, withdrawableAmount: 1200.5 },
          ],
          lastSyncedAt: '2026-04-09T14:30:00.000Z',
      });

      const result = await service.getAccountSummary();

      expect(result.cashBalances).toHaveLength(2);
      expect(result.lastSyncedAt).toBe('2026-04-09T14:30:00.000Z');
      expect(result.totalAssets).toBe(1750000);
    });

    it('falls back to the latest cash snapshot for every broker and market', async () => {
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.riskSnapshot.findMany.mockResolvedValue([
        { cashBalance: '100' },
        { cashBalance: '200' },
        { cashBalance: '300' },
        { cashBalance: '400' },
      ]);
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);
      mockAccountCashSync.getCache.mockResolvedValue(null);

      const result = await service.getAccountSummary();

      expect(mockPrisma.riskSnapshot.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        distinct: ['broker', 'market'],
      });
      expect(result.cashBalance).toBe(1000);
    });

    it('calculates realized PnL within the full broker instrument tuple', async () => {
      const at = (day: number) => new Date(`2026-04-${String(day).padStart(2, '0')}T00:00:00.000Z`);
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.riskSnapshot.findMany.mockResolvedValue([]);
      mockAccountCashSync.getCache.mockResolvedValue(null);
      mockPrisma.tradeRecord.findMany.mockResolvedValue([
        { broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', side: 'BUY', status: 'FILLED', createdAt: at(1), price: 100, executedPrice: 100, quantity: 10, executedQty: 10 },
        { broker: Broker.TOSS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', side: 'BUY', status: 'FILLED', createdAt: at(2), price: 200, executedPrice: 200, quantity: 10, executedQty: 10 },
        { broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: 'AMEX', stockCode: 'TQQQ', side: 'BUY', status: 'FILLED', createdAt: at(3), price: 300, executedPrice: 300, quantity: 10, executedQty: 10 },
        { broker: Broker.KIS, market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: 'TQQQ', side: 'BUY', status: 'FILLED', createdAt: at(4), price: 400, executedPrice: 400, quantity: 10, executedQty: 10 },
        { broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', side: 'SELL', status: 'FILLED', createdAt: at(5), price: 120, executedPrice: 120, quantity: 5, executedQty: 5 },
        { broker: Broker.TOSS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ', side: 'SELL', status: 'FILLED', createdAt: at(6), price: 220, executedPrice: 220, quantity: 5, executedQty: 5 },
      ]);

      const result = await service.getAccountSummary();

      expect(result.realizedPnL).toBe(200);
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
      mockAccountCashSync.getCache.mockResolvedValue({
          cashBalances: [
            { broker: Broker.KIS, market: 'DOMESTIC', currencyCode: 'KRW', amount: 500000, withdrawableAmount: 500000 },
            { broker: Broker.KIS, market: 'OVERSEAS', currencyCode: 'USD', amount: 1200.5, withdrawableAmount: 1000.25 },
          ],
          lastSyncedAt: '2026-04-09T15:00:00.000Z',
      });

      const result = await service.refreshAccountState();

      expect(result.success).toBe(true);
      expect(mockAccountCashSync.replaceCache).toHaveBeenCalledWith(Broker.KIS, [
        expect.objectContaining({ market: 'DOMESTIC', currencyCode: 'KRW', amount: 500000 }),
        expect.objectContaining({ market: 'OVERSEAS', currencyCode: 'USD', amount: 1200.5 }),
      ], ['DOMESTIC', 'OVERSEAS']);
      expect(mockPositionSync.syncPositions).toHaveBeenCalledWith(Broker.KIS, 'DOMESTIC', []);
      expect(mockPositionSync.syncPositions).toHaveBeenCalledWith(Broker.KIS, 'OVERSEAS', []);
      expect(result.accountSummary.cashBalances).toEqual([
        expect.objectContaining({ currencyCode: 'KRW', amount: 500000 }),
        expect.objectContaining({ currencyCode: 'USD', amount: 1200.5 }),
      ]);
    });

    it('preserves a failed market cache while replacing each successful authoritative market', async () => {
      mockKisDomestic.getBalance.mockResolvedValue([]);
      mockKisDomestic.getBuyableAmount.mockResolvedValue({ cashAvailable: 500000 });
      mockKisOverseas.getAccountSnapshot.mockRejectedValue(new Error('overseas unavailable'));
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.tradeRecord.findMany.mockResolvedValue([]);
      mockPrisma.riskSnapshot.findMany.mockResolvedValue([]);
      mockAccountCashSync.getCache.mockResolvedValue(null);

      await service.refreshAccountState();

      expect(mockAccountCashSync.replaceCache).toHaveBeenCalledWith(
        Broker.KIS,
        [expect.objectContaining({ market: 'DOMESTIC', amount: 500000 })],
        ['DOMESTIC'],
      );
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
