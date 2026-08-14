import { Test, TestingModule } from '@nestjs/testing';
import { BrokerPortRegistry } from '../broker/broker-port.registry';
import { PrismaService } from '../prisma.service';
import { TradingAccountCashSyncService } from './trading-account-cash-sync.service';

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

  it('replaces only domestic cash and preserves overseas cache', async () => {
    const existingUsdBalance = {
      market: 'OVERSEAS',
      currencyCode: 'USD',
      currencyName: '미국달러',
      amount: 900,
      withdrawableAmount: 850,
    };
    mockPort.getDomesticBuyableAmount.mockResolvedValue({ cashAvailable: 1_500_000 });
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      value: {
        cashBalances: [
          { market: 'DOMESTIC', currencyCode: 'KRW', amount: 2_000_000 },
          existingUsdBalance,
        ],
        lastSyncedAt: '2026-07-18T00:00:00.000Z',
      },
    });

    await service.refreshMarketCash('DOMESTIC');

    const savedValue = mockPrisma.appSetting.upsert.mock.calls[0][0].update.value;
    expect(savedValue.cashBalances).toEqual([
      expect.objectContaining(existingUsdBalance),
      expect.objectContaining({
        market: 'DOMESTIC',
        currencyCode: 'KRW',
        amount: 1_500_000,
        orderableAmount: 1_500_000,
      }),
    ]);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('replaces all overseas currencies and preserves domestic cash', async () => {
    const domesticBalance = {
      market: 'DOMESTIC',
      currencyCode: 'KRW',
      amount: 1_000_000,
    };
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
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      value: {
        cashBalances: [domesticBalance, { market: 'OVERSEAS', currencyCode: 'USD', amount: 900 }],
        lastSyncedAt: '2026-07-18T00:00:00.000Z',
      },
    });

    await service.refreshMarketCash('OVERSEAS');

    const savedValue = mockPrisma.appSetting.upsert.mock.calls[0][0].update.value;
    expect(savedValue.cashBalances).toEqual([
      expect.objectContaining(domesticBalance),
      expect.objectContaining({ market: 'OVERSEAS', currencyCode: 'USD', amount: 700 }),
      expect.objectContaining({
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

    await service.refreshMarketCash('DOMESTIC');

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'account_status_cache' },
      create: {
        key: 'account_status_cache',
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
});
