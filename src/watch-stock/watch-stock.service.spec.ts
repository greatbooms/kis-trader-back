import { Test, TestingModule } from '@nestjs/testing';
import { Broker } from '@prisma/client';
import { WatchStockService } from './watch-stock.service';
import { PrismaService } from '../prisma.service';
import { CreateWatchStockInput } from './dto';

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
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WatchStockService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WatchStockService>(WatchStockService);
    mockPrisma.$transaction.mockImplementation((callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
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
    it('keeps same-symbol KIS and TOSS cycles isolated by broker', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        {
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          totalInvested: 1000,
        },
        {
          broker: Broker.TOSS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          totalInvested: 2000,
        },
      ]);

      const result = await service.findCurrentCycleMap([
        {
          id: 'kis',
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          strategyName: 'infinite-buy',
          quota: 4000,
          cycle: 0,
          maxCycles: 40,
        },
        {
          id: 'toss',
          broker: Broker.TOSS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          strategyName: 'infinite-buy',
          quota: 4000,
          cycle: 0,
          maxCycles: 40,
        },
      ] as any);

      expect(result).toEqual(new Map([['kis', 10], ['toss', 20]]));
      expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ' },
            { broker: Broker.TOSS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ' },
          ],
        },
        select: {
          broker: true,
          market: true,
          exchangeCode: true,
          stockCode: true,
          totalInvested: true,
        },
      });
    });

    it('should calculate fractional cycle for cycle-based strategies from total invested', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        {
          broker: Broker.KIS,
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          totalInvested: 156.1999,
        },
      ]);

      const result = await service.findCurrentCycleMap([
        {
          id: '1',
          broker: Broker.KIS,
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
          broker: Broker.KIS,
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
    it('defaults omitted GraphQL broker input to KIS', () => {
      expect((new CreateWatchStockInput() as any).broker).toBe(Broker.KIS);
    });

    it('allows the same symbol once per broker', async () => {
      mockPrisma.watchStock.findFirst.mockResolvedValue(null);
      mockPrisma.watchStock.create
        .mockResolvedValueOnce({ id: 'kis' })
        .mockResolvedValueOnce({ id: 'toss' });
      const stock = {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        stockName: 'ProShares UltraPro QQQ',
      };

      await service.create({ ...stock, broker: Broker.KIS } as any);
      await service.create({ ...stock, broker: Broker.TOSS } as any);

      expect(mockPrisma.watchStock.findFirst).toHaveBeenNthCalledWith(1, {
        where: { broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ' },
        select: { id: true },
      });
      expect(mockPrisma.watchStock.findFirst).toHaveBeenNthCalledWith(2, {
        where: { broker: Broker.TOSS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'TQQQ' },
        select: { id: true },
      });
      expect(mockPrisma.watchStock.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: expect.objectContaining({ broker: Broker.KIS }) }),
      );
      expect(mockPrisma.watchStock.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: expect.objectContaining({ broker: Broker.TOSS }) }),
      );
    });

    it('should create a new watch stock with required fields', async () => {
      const input = {
        broker: Broker.KIS,
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
        broker: Broker.KIS,
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
        broker: Broker.KIS,
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
        broker: Broker.KIS,
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
        broker: Broker.KIS,
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

    it.each([
      [Broker.KIS, Broker.TOSS],
      [Broker.TOSS, Broker.KIS],
    ])('rejects a %s to %s broker change before carrying strategy state', async (currentBroker, nextBroker) => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: '1',
        broker: currentBroker,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        strategyName: 'infinite-buy',
        quota: 4000,
        maxCycles: 40,
        strategyParams: { accumulatedQuota: 100 },
      });

      await expect(service.update('1', { broker: nextBroker, quota: 8000 })).rejects.toThrow(
        '기존 관심종목을 삭제한 뒤 새 브로커로 다시 등록하세요',
      );

      expect(mockPrisma.position.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.watchStock.update).not.toHaveBeenCalled();
    });

    it('should rebase infinite-buy cycle and accumulated quota when quota changes', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: '1',
        broker: Broker.KIS,
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

    it('rebases a TOSS watch stock from only the TOSS position', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: 'toss-watch',
        broker: Broker.TOSS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        strategyName: 'infinite-buy',
        quota: 4000,
        maxCycles: 40,
        strategyParams: null,
      });
      mockPrisma.position.findUnique.mockResolvedValue({ totalInvested: 1000 });
      mockPrisma.watchStock.update.mockResolvedValue({ id: 'toss-watch' });

      await service.update('toss-watch', { quota: 8000 });

      expect(mockPrisma.position.findUnique).toHaveBeenCalledWith({
        where: {
          broker_market_exchangeCode_stockCode: {
            broker: Broker.TOSS,
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
          },
        },
        select: { totalInvested: true },
      });
    });

    it('should not rebase non-infinite-buy quota updates', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        id: '1',
        broker: Broker.KIS,
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

    describe('V4 quota → 장부 잔금 동기화 (D10)', () => {
      const v4WatchStock = {
        id: '1',
        broker: Broker.KIS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
        strategyName: 'infinite-buy-v4',
        quota: 500000,
        maxCycles: 40,
        strategyParams: {
          v4: {
            mode: 'NORMAL',
            turn: 8,
            cashRemaining: 400000,
            cycleSeq: 0,
            recentCloses: [],
            lastKnownHoldQty: 30,
          },
        },
      };

      it('should add a quota increase to the v4 ledger cashRemaining inside a transaction', async () => {
        mockPrisma.watchStock.findUnique
          .mockResolvedValueOnce(v4WatchStock)
          .mockResolvedValueOnce(v4WatchStock);
        mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });

        await service.update('1', { quota: 600000 });

        expect(mockPrisma.$transaction).toHaveBeenCalled();
        const callArgs = mockPrisma.watchStock.update.mock.calls[0][0];
        expect(Number(callArgs.data.quota)).toBe(600000);
        expect(callArgs.data.strategyParams.v4.cashRemaining).toBe(500000);
        expect(callArgs.data.strategyParams.v4.turn).toBe(8);
      });

      it('should allow a quota decrease within the ledger cashRemaining boundary', async () => {
        mockPrisma.watchStock.findUnique
          .mockResolvedValueOnce(v4WatchStock)
          .mockResolvedValueOnce(v4WatchStock);
        mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });

        await service.update('1', { quota: 300000 });

        const callArgs = mockPrisma.watchStock.update.mock.calls[0][0];
        expect(callArgs.data.strategyParams.v4.cashRemaining).toBe(200000);
      });

      it('should allow a quota decrease that brings ledger cashRemaining exactly to zero', async () => {
        mockPrisma.watchStock.findUnique
          .mockResolvedValueOnce(v4WatchStock)
          .mockResolvedValueOnce(v4WatchStock);
        mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });

        await service.update('1', { quota: 100000 });

        const callArgs = mockPrisma.watchStock.update.mock.calls[0][0];
        expect(callArgs.data.strategyParams.v4.cashRemaining).toBe(0);
      });

      it('should reject a quota decrease that would push ledger cashRemaining negative', async () => {
        mockPrisma.watchStock.findUnique
          .mockResolvedValueOnce(v4WatchStock)
          .mockResolvedValueOnce(v4WatchStock);

        await expect(service.update('1', { quota: 50000 })).rejects.toThrow(
          '감액은 장부 잔금 범위 내에서만 가능합니다',
        );
        expect(mockPrisma.watchStock.update).not.toHaveBeenCalled();
      });

      it('should not touch the ledger when quota is unchanged', async () => {
        mockPrisma.watchStock.findUnique.mockResolvedValueOnce(v4WatchStock);
        mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });

        await service.update('1', { isActive: false });

        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        const callArgs = mockPrisma.watchStock.update.mock.calls[0][0];
        expect(callArgs.data).toEqual({ isActive: false });
      });

      it('should warn and skip ledger sync when a v4 stock has no v4 ledger yet', async () => {
        const v4WithoutLedger = { ...v4WatchStock, strategyParams: {} };
        mockPrisma.watchStock.findUnique
          .mockResolvedValueOnce(v4WithoutLedger)
          .mockResolvedValueOnce(v4WithoutLedger);
        mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });
        const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

        await service.update('1', { quota: 600000 });

        const callArgs = mockPrisma.watchStock.update.mock.calls[0][0];
        expect(Number(callArgs.data.quota)).toBe(600000);
        expect(callArgs.data.strategyParams).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('v4 장부가 없어'));
      });
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

  describe('convertToInfiniteBuyV4', () => {
    const baseWatchStock = {
      id: '1',
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      strategyName: 'infinite-buy',
      isActive: true,
      quota: 500000,
      maxCycles: 40,
      strategyParams: null,
    };

    it('should seed T=0 / full cashRemaining when there is no position', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue(baseWatchStock);
      mockPrisma.position.findUnique.mockResolvedValue(null);

      const result = await service.convertToInfiniteBuyV4('1', true);

      expect(result.turn).toBe(0);
      expect(result.cashRemaining).toBe(500000);
      expect(result.lastKnownHoldQty).toBe(0);
      expect(result.mode).toBe('NORMAL');
      expect(result.cycleSeq).toBe(0);
      expect(result.starBasePct).toBe(15);
      expect(result.warnings).toEqual([]);
      expect(result.applied).toBe(false);
      expect(mockPrisma.watchStock.update).not.toHaveBeenCalled();
    });

    it('seeds a TOSS V4 conversion from only the TOSS position', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({ ...baseWatchStock, broker: Broker.TOSS });
      mockPrisma.position.findUnique.mockResolvedValue(null);

      await service.convertToInfiniteBuyV4('1', true);

      expect(mockPrisma.position.findUnique).toHaveBeenCalledWith({
        where: {
          broker_market_exchangeCode_stockCode: {
            broker: Broker.TOSS,
            market: 'OVERSEAS',
            exchangeCode: 'NASD',
            stockCode: 'TQQQ',
          },
        },
        select: { totalInvested: true, quantity: true },
      });
    });

    it('should seed turn/cashRemaining from an existing position in the front half with no warnings', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue(baseWatchStock);
      mockPrisma.position.findUnique.mockResolvedValue({ totalInvested: 100000, quantity: 30 });

      const result = await service.convertToInfiniteBuyV4('1', true);

      // perCycleQuota = 500000/40 = 12500, T = 100000/12500 = 8 (< maxCycles/2 = 20)
      expect(result.turn).toBe(8);
      expect(result.cashRemaining).toBe(400000);
      expect(result.lastKnownHoldQty).toBe(30);
      expect(result.warnings).toEqual([]);
    });

    it('should warn about back-half takeover when turn >= maxCycles/2', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue(baseWatchStock);
      mockPrisma.position.findUnique.mockResolvedValue({ totalInvested: 250000, quantity: 100 });

      const result = await service.convertToInfiniteBuyV4('1', true);

      expect(result.turn).toBe(20);
      expect(result.warnings).toEqual(['후반전 이어받기 — 별지점이 평단 아래라 쿼터매도가 손절성으로 즉시 나갈 수 있습니다.']);
    });

    it('should warn about exhausted state when turn > maxCycles-1', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue(baseWatchStock);
      mockPrisma.position.findUnique.mockResolvedValue({ totalInvested: 495000, quantity: 200 });

      const result = await service.convertToInfiniteBuyV4('1', true);

      expect(result.turn).toBeCloseTo(39.6);
      expect(result.warnings).toEqual([
        '후반전 이어받기 — 별지점이 평단 아래라 쿼터매도가 손절성으로 즉시 나갈 수 있습니다.',
        '소진 상태 — 첫 평가에서 REVERSE 모드로 진입합니다.',
      ]);
    });

    it('should reject DOMESTIC stocks', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({ ...baseWatchStock, market: 'DOMESTIC' });

      await expect(service.convertToInfiniteBuyV4('1', true)).rejects.toThrow(
        'V4 전환은 해외(OVERSEAS) 종목만 지원합니다.',
      );
    });

    it('should reject stocks already on infinite-buy-v4', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({ ...baseWatchStock, strategyName: 'infinite-buy-v4' });

      await expect(service.convertToInfiniteBuyV4('1', true)).rejects.toThrow('이미 infinite-buy-v4 전략입니다.');
    });

    it('should reject non-infinite-buy source strategies (UI 우회 직접 호출 방지)', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({ ...baseWatchStock, strategyName: 'momentum-breakout' });

      await expect(service.convertToInfiniteBuyV4('1', true)).rejects.toThrow(
        'V4 전환은 infinite-buy 전략 종목만 지원합니다.',
      );
    });

    it('should reject when quota/maxCycles are not configured', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({ ...baseWatchStock, quota: 0 });

      await expect(service.convertToInfiniteBuyV4('1', true)).rejects.toThrow(
        '투자금(quota)과 최대 사이클(maxCycles)이 설정되어야 V4로 전환할 수 있습니다.',
      );
    });

    it('should reject unknown stocks without an explicit starBasePct override', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({ ...baseWatchStock, stockCode: 'AAPL' });
      mockPrisma.position.findUnique.mockResolvedValue(null);

      await expect(service.convertToInfiniteBuyV4('1', true)).rejects.toThrow('별% 기본값이 없습니다');
    });

    it('should accept an explicit strategyParams.v4.starBasePct override for unknown stocks', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        ...baseWatchStock,
        stockCode: 'AAPL',
        strategyParams: { v4: { starBasePct: 12 } },
      });
      mockPrisma.position.findUnique.mockResolvedValue(null);

      const result = await service.convertToInfiniteBuyV4('1', true);

      expect(result.starBasePct).toBe(12);
    });

    it('should not touch the DB when dryRun is true', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue(baseWatchStock);
      mockPrisma.position.findUnique.mockResolvedValue({ totalInvested: 100000, quantity: 30 });

      await service.convertToInfiniteBuyV4('1', true);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.watchStock.update).not.toHaveBeenCalled();
    });

    it('should atomically update strategyName + strategyParams.v4 when dryRun is false, preserving other params', async () => {
      mockPrisma.watchStock.findUnique.mockResolvedValue({
        ...baseWatchStock,
        strategyParams: { accumulatedQuota: 12345 },
      });
      mockPrisma.position.findUnique.mockResolvedValue({ totalInvested: 100000, quantity: 30 });
      mockPrisma.watchStock.update.mockResolvedValue({ id: '1' });

      const result = await service.convertToInfiniteBuyV4('1', false);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.watchStock.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          strategyName: 'infinite-buy-v4',
          strategyParams: {
            accumulatedQuota: 12345,
            v4: {
              mode: 'NORMAL',
              turn: 8,
              cashRemaining: 400000,
              cycleSeq: 0,
              recentCloses: [],
              lastKnownHoldQty: 30,
            },
          },
        },
      });
      expect(result.applied).toBe(true);
    });

    it('should re-check inside the transaction and refuse a stock already converted concurrently', async () => {
      mockPrisma.watchStock.findUnique
        .mockResolvedValueOnce(baseWatchStock)
        .mockResolvedValueOnce({ ...baseWatchStock, strategyName: 'infinite-buy-v4' });
      mockPrisma.position.findUnique.mockResolvedValue(null);

      await expect(service.convertToInfiniteBuyV4('1', false)).rejects.toThrow('전환 도중 전략이 변경되어 중단합니다');
      expect(mockPrisma.watchStock.update).not.toHaveBeenCalled();
    });

    it('refuses conversion when the broker unit changes after position seeding', async () => {
      mockPrisma.watchStock.findUnique
        .mockResolvedValueOnce(baseWatchStock)
        .mockResolvedValueOnce({ ...baseWatchStock, broker: Broker.TOSS });
      mockPrisma.position.findUnique.mockResolvedValue({ totalInvested: 100000, quantity: 30 });

      await expect(service.convertToInfiniteBuyV4('1', false)).rejects.toThrow(
        '전환 도중 관심종목 식별자가 변경되어 중단합니다',
      );
      expect(mockPrisma.watchStock.update).not.toHaveBeenCalled();
    });
  });
});
