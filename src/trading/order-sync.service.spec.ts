import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { KisDomesticService } from '../kis/kis-domestic.service';
import { KisOverseasService } from '../kis/kis-overseas.service';
import { TradingService } from './trading.service';
import { OrderSyncService } from './order-sync.service';

describe('OrderSyncService', () => {
  let service: OrderSyncService;

  const mockTradingService = {
    reconcileOpenOrders: jest.fn(),
  };

  const mockKisDomestic = {
    getOrderExecutions: jest.fn(),
    getUnfilledOrders: jest.fn(),
  };

  const mockKisOverseas = {
    getOrderExecutions: jest.fn(),
    getUnfilledOrders: jest.fn(),
  };

  const mockPrisma = {
    tradeRecord: {
      findMany: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'kis.env') return 'paper';
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-09T06:00:00.000Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderSyncService,
        { provide: TradingService, useValue: mockTradingService },
        { provide: KisDomesticService, useValue: mockKisDomestic },
        { provide: KisOverseasService, useValue: mockKisOverseas },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<OrderSyncService>(OrderSyncService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('should sync domestic open orders with broker executions and unfilled orders', async () => {
    mockPrisma.tradeRecord.findMany.mockResolvedValue([
      { createdAt: new Date('2026-04-08T00:30:00.000Z') },
    ]);
    mockKisDomestic.getOrderExecutions.mockResolvedValue([
      {
        orderNo: '1001',
        stockCode: '005930',
        side: 'BUY',
        orderQuantity: 10,
        filledQuantity: 10,
        remainingQuantity: 0,
        filledPrice: 70000,
        exchangeCode: 'KRX',
      },
    ]);
    mockKisDomestic.getUnfilledOrders.mockResolvedValue([]);

    await service.syncMarketOrders('DOMESTIC', [
      { market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 10 },
    ]);

    expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledWith('20260407', '20260409');
    expect(mockKisDomestic.getUnfilledOrders).toHaveBeenCalled();
    expect(mockTradingService.reconcileOpenOrders).toHaveBeenCalledWith(
      'DOMESTIC',
      [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 10 }],
      [],
      [
        {
          orderNo: '1001',
          stockCode: '005930',
          side: 'BUY',
          orderQuantity: 10,
          filledQuantity: 10,
          remainingQuantity: 0,
          filledPrice: 70000,
          exchangeCode: 'KRX',
        },
      ],
    );
  });

  it('should skip non-forced sync when last sync is still within the dynamic interval', async () => {
    mockPrisma.tradeRecord.findMany.mockResolvedValue([
      { createdAt: new Date('2026-04-09T05:59:20.000Z') },
    ]);
    mockKisDomestic.getOrderExecutions.mockResolvedValue([]);
    mockKisDomestic.getUnfilledOrders.mockResolvedValue([]);

    await service.syncMarketOrders(
      'DOMESTIC',
      [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 1 }],
      { force: false },
    );

    jest.setSystemTime(new Date('2026-04-09T06:00:05.000Z'));

    await service.syncMarketOrders(
      'DOMESTIC',
      [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 1 }],
      { force: false },
    );

    expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledTimes(1);
    expect(mockTradingService.reconcileOpenOrders).toHaveBeenCalledTimes(1);
  });

  it('should always sync when force option is enabled', async () => {
    mockPrisma.tradeRecord.findMany.mockResolvedValue([
      { createdAt: new Date('2026-04-09T05:59:20.000Z') },
    ]);
    mockKisDomestic.getOrderExecutions.mockResolvedValue([]);
    mockKisDomestic.getUnfilledOrders.mockResolvedValue([]);

    await service.syncMarketOrders(
      'DOMESTIC',
      [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 1 }],
      { force: true },
    );

    jest.setSystemTime(new Date('2026-04-09T06:00:05.000Z'));

    await service.syncMarketOrders(
      'DOMESTIC',
      [{ market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '005930', quantity: 1 }],
      { force: true },
    );

    expect(mockKisDomestic.getOrderExecutions).toHaveBeenCalledTimes(2);
    expect(mockTradingService.reconcileOpenOrders).toHaveBeenCalledTimes(2);
  });

  it('should derive overseas paper unfilled orders from broker executions', async () => {
    mockPrisma.tradeRecord.findMany.mockResolvedValue([
      { createdAt: new Date('2026-04-08T00:30:00.000Z') },
    ]);
    mockKisOverseas.getOrderExecutions.mockResolvedValue([
      {
        orderNo: '2001',
        stockCode: 'AAPL',
        side: 'BUY',
        orderQuantity: 10,
        filledQuantity: 4,
        remainingQuantity: 6,
        orderPrice: 190.5,
        filledPrice: 190.25,
        exchangeCode: 'NASD',
      },
    ]);

    const unfilledOrders = await service.getMarketUnfilledOrders('OVERSEAS');

    expect(mockKisOverseas.getOrderExecutions).toHaveBeenCalledWith('20260407', '20260409');
    expect(mockKisOverseas.getUnfilledOrders).not.toHaveBeenCalled();
    expect(unfilledOrders).toEqual([
      {
        orderNo: '2001',
        stockCode: 'AAPL',
        side: 'BUY',
        quantity: 6,
        price: 190.5,
        exchangeCode: 'NASD',
      },
    ]);
  });
});
