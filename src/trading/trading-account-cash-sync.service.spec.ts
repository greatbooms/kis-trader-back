import { Test, TestingModule } from '@nestjs/testing';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { PrismaService } from '../prisma.service';
import { TradingAccountCashSyncService } from './trading-account-cash-sync.service';
import { Broker } from '@prisma/client';

describe('TradingAccountCashSyncService', () => {
  let service: TradingAccountCashSyncService;

  const mockPrisma = {
    appSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const mockPort = {
    getDomesticBuyableAmount: jest.fn(),
    getOverseasAccountSnapshot: jest.fn(),
  };
  const mockRegistry = { get: jest.fn().mockReturnValue(mockPort) };

  beforeEach(async () => {
    mockPrisma.$transaction.mockImplementation(async (work) => work(mockPrisma));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingAccountCashSyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BrokerPortRegistry, useValue: mockRegistry },
      ],
    }).compile();

    service = module.get(TradingAccountCashSyncService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('writes KIS domestic cash to its broker-market row without mixing legacy overseas cash', async () => {
    mockPort.getDomesticBuyableAmount.mockResolvedValue({ cashAvailable: 1_500_000 });
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      value: {
        cashBalances: [
          { market: 'DOMESTIC', currencyCode: 'KRW', amount: 2_000_000 },
          { market: 'OVERSEAS', currencyCode: 'USD', amount: 900 },
        ],
        lastSyncedAt: '2026-07-18T00:00:00.000Z',
      },
    });

    await service.refreshMarketCash(Broker.KIS, 'DOMESTIC');

    expect(mockRegistry.get).toHaveBeenCalledWith(Broker.KIS);
    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'account_status_cache:KIS:DOMESTIC' },
      create: {
        key: 'account_status_cache:KIS:DOMESTIC',
        value: expect.objectContaining({ cashBalances: [expect.objectContaining({
          broker: Broker.KIS,
          market: 'DOMESTIC',
          currencyCode: 'KRW',
          amount: 1_500_000,
        })] }),
      },
      update: {
        value: expect.objectContaining({ cashBalances: [expect.objectContaining({
          broker: Broker.KIS,
          market: 'DOMESTIC',
          currencyCode: 'KRW',
          amount: 1_500_000,
        })] }),
      },
    });
    expect(mockPrisma.$queryRaw.mock.calls[0][1]).toBe('account_status_cache:KIS:DOMESTIC');
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('routes Toss overseas cash to the Toss broker-market row', async () => {
    mockPort.getOverseasAccountSnapshot.mockResolvedValue({
      balance: [],
      cashBalances: [
        {
          currencyCode: 'USD',
          currencyName: '미국달러',
          amount: 700,
          withdrawableAmount: 650,
          orderableAmount: 680,
          pendingBuyAmount: 20,
          pendingSellAmount: 10,
        },
        {
          currencyCode: 'JPY',
          currencyName: '일본엔',
          amount: 10_000,
          withdrawableAmount: 9_000,
        },
      ],
    });
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    await service.refreshMarketCash(Broker.TOSS, 'OVERSEAS');

    expect(mockRegistry.get).toHaveBeenCalledWith(Broker.TOSS);
    expect(mockPrisma.appSetting.upsert.mock.calls[0][0].where).toEqual({
      key: 'account_status_cache:TOSS:OVERSEAS',
    });
    const savedValue = mockPrisma.appSetting.upsert.mock.calls[0][0].update.value;
    expect(savedValue.cashBalances).toEqual([
      expect.objectContaining({ broker: Broker.TOSS, market: 'OVERSEAS', currencyCode: 'USD', amount: 700 }),
      expect.objectContaining({
        broker: Broker.TOSS,
        market: 'OVERSEAS',
        currencyCode: 'JPY',
        amount: 10_000,
        orderableAmount: null,
        pendingBuyAmount: null,
      }),
    ]);
  });

  it('creates a cache when no previous account cache exists', async () => {
    mockPort.getDomesticBuyableAmount.mockResolvedValue({ cashAvailable: 500_000 });
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    await service.refreshMarketCash(Broker.KIS, 'DOMESTIC');

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'account_status_cache:KIS:DOMESTIC' },
      create: {
        key: 'account_status_cache:KIS:DOMESTIC',
        value: expect.objectContaining({
          cashBalances: [expect.objectContaining({ amount: 500_000 })],
          lastSyncedAt: expect.any(String),
        }),
      },
      update: {
        value: expect.objectContaining({
          cashBalances: [expect.objectContaining({ amount: 500_000 })],
          lastSyncedAt: expect.any(String),
        }),
      },
    });
  });

  it('aggregates scoped rows and interprets the legacy row as KIS only', async () => {
    mockPrisma.appSetting.findUnique.mockImplementation(async ({ where: { key } }) => ({
      account_status_cache: {
        value: {
          cashBalances: [
            { market: 'DOMESTIC', currencyCode: 'KRW', amount: 100 },
            { market: 'OVERSEAS', currencyCode: 'USD', amount: 20 },
          ],
          lastSyncedAt: '2026-07-18T00:00:00.000Z',
        },
      },
      'account_status_cache:TOSS:OVERSEAS': {
        value: {
          cashBalances: [{ market: 'OVERSEAS', currencyCode: 'USD', amount: 30 }],
          lastSyncedAt: '2026-07-19T00:00:00.000Z',
        },
      },
    })[key] ?? null);

    await expect(service.getCache()).resolves.toEqual({
      cashBalances: [
        expect.objectContaining({ broker: Broker.KIS, market: 'DOMESTIC', amount: 100 }),
        expect.objectContaining({ broker: Broker.KIS, market: 'OVERSEAS', amount: 20 }),
        expect.objectContaining({ broker: Broker.TOSS, market: 'OVERSEAS', amount: 30 }),
      ],
      lastSyncedAt: '2026-07-19T00:00:00.000Z',
    });
  });

  it('writes an authoritative empty market snapshot and blocks legacy fallback for that market', async () => {
    await service.replaceCache(Broker.KIS, [], ['OVERSEAS']);

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'account_status_cache:KIS:OVERSEAS' },
      create: {
        key: 'account_status_cache:KIS:OVERSEAS',
        value: expect.objectContaining({ cashBalances: [] }),
      },
      update: {
        value: expect.objectContaining({ cashBalances: [] }),
      },
    });

    mockPrisma.appSetting.findUnique.mockImplementation(async ({ where: { key } }) => ({
      account_status_cache: {
        value: {
          cashBalances: [
            { market: 'DOMESTIC', currencyCode: 'KRW', amount: 100 },
            { market: 'OVERSEAS', currencyCode: 'USD', amount: 999 },
          ],
          lastSyncedAt: '2026-07-18T00:00:00.000Z',
        },
      },
      'account_status_cache:KIS:OVERSEAS': {
        value: {
          cashBalances: [],
          lastSyncedAt: '2026-07-19T00:00:00.000Z',
        },
      },
    })[key] ?? null);

    const cache = await service.getCache();
    expect(cache?.cashBalances).toEqual([
      expect.objectContaining({ broker: Broker.KIS, market: 'DOMESTIC', amount: 100 }),
    ]);
  });
});
