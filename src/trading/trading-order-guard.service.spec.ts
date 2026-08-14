import { PrismaService } from '../prisma.service';
import { TradingOrderGuardService } from './trading-order-guard.service';
import { OrderAdmissionKey } from './types/order-admission-key.type';
import { Broker } from '@prisma/client';

describe('TradingOrderGuardService', () => {
  const buildHarness = (unresolved: object | null = null) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      tradeRecord: {
        findFirst: jest.fn().mockResolvedValue(unresolved),
      },
    };
    const rootTradeRecord = { findFirst: jest.fn() };
    const prisma = {
      $queryRaw: jest.fn(),
      tradeRecord: rootTradeRecord,
      $transaction: jest.fn(
        async (callback: (transactionClient: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    } as unknown as PrismaService;

    return {
      service: new TradingOrderGuardService(prisma),
      prisma: prisma as unknown as {
        $queryRaw: jest.Mock;
        $transaction: jest.Mock;
        tradeRecord: { findFirst: jest.Mock };
      },
      tx,
    };
  };

  const admit = async (
    key: OrderAdmissionKey,
    unresolved: object | null = null,
  ) => {
    const harness = buildHarness(unresolved);
    const createWithTx = jest.fn().mockResolvedValue({ id: 'created' });
    const result = await harness.service.admit(key, createWithTx);
    return { ...harness, createWithTx, result };
  };

  it('uses a collision-safe canonical key and canonical domestic instrument fields', async () => {
    const { tx } = await admit({
      broker: Broker.KIS,
      market: 'DOMESTIC',
      exchangeCode: 'not-krx',
      stockCode: ' 005930 ',
      side: 'SELL',
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(
      '3:KIS|8:DOMESTIC|3:KRX|6:005930|4:SELL',
    );
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain(
      'pg_advisory_xact_lock(hashtextextended(',
    );
  });

  it('normalizes overseas exchange and stock codes before locking and lookup', async () => {
    const { tx } = await admit({
      broker: Broker.TOSS,
      market: 'OVERSEAS',
      exchangeCode: ' nasd ',
      stockCode: ' aapl ',
      side: 'BUY',
    });

    expect(tx.$queryRaw.mock.calls[0][1]).toBe(
      '4:TOSS|8:OVERSEAS|4:NASD|4:AAPL|3:BUY',
    );
    expect(tx.tradeRecord.findFirst).toHaveBeenCalledWith({
      where: {
        broker: Broker.TOSS,
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'AAPL',
        side: 'BUY',
        OR: [
          {
            status: {
              in: [
                'AWAITING_APPROVAL',
                'SUBMITTING',
                'SUBMISSION_UNKNOWN',
                'PENDING',
              ],
            },
          },
          {
            status: 'PARTIAL',
            orderNo: { not: null },
          },
        ],
      },
    });
  });

  it('keeps distinct instruments distinct in the canonical key', async () => {
    const first = await admit({
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'AB',
      stockCode: 'C',
      side: 'BUY',
    });
    const second = await admit({
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'A',
      stockCode: 'BC',
      side: 'BUY',
    });

    expect(first.tx.$queryRaw.mock.calls[0][1]).not.toBe(
      second.tx.$queryRaw.mock.calls[0][1],
    );
    expect(first.tx.$queryRaw.mock.calls[0][1]).toBe(
      '3:KIS|8:OVERSEAS|2:AB|1:C|3:BUY',
    );
    expect(second.tx.$queryRaw.mock.calls[0][1]).toBe(
      '3:KIS|8:OVERSEAS|1:A|2:BC|3:BUY',
    );
  });

  it('runs the lock, lookup, and creator on the interactive transaction client only', async () => {
    const { prisma, tx, createWithTx, result } = await admit({
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'NYSE',
      stockCode: 'BRK.B',
      side: 'SELL',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toEqual(expect.any(Function));
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.tradeRecord.findFirst).not.toHaveBeenCalled();
    expect(createWithTx).toHaveBeenCalledWith(tx, {
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'NYSE',
      stockCode: 'BRK.B',
      side: 'SELL',
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.tradeRecord.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.tradeRecord.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      createWithTx.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({ id: 'created' });
  });

  it('returns null without invoking the creator when an unresolved intent exists', async () => {
    const { createWithTx, result } = await admit(
      {
        broker: Broker.KIS,
        market: 'DOMESTIC',
        exchangeCode: 'KRX',
        stockCode: '005930',
        side: 'SELL',
      },
      { id: 'existing' },
    );

    expect(result).toBeNull();
    expect(createWithTx).not.toHaveBeenCalled();
  });

  it('does not collide equal instrument tuples across KIS and TOSS lock/query scopes', async () => {
    const kis = await admit({
      broker: Broker.KIS,
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      side: 'BUY',
    });
    const toss = await admit({
      broker: Broker.TOSS,
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
      side: 'BUY',
    });

    expect(kis.tx.$queryRaw.mock.calls[0][1]).not.toBe(toss.tx.$queryRaw.mock.calls[0][1]);
    expect(kis.tx.tradeRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ broker: Broker.KIS }),
    }));
    expect(toss.tx.tradeRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ broker: Broker.TOSS }),
    }));
  });

  it.each([
    [{ broker: Broker.KIS, market: 'INVALID', exchangeCode: 'KRX', stockCode: '005930', side: 'SELL' }],
    [{ broker: Broker.KIS, market: 'DOMESTIC', exchangeCode: 'KRX', stockCode: '', side: 'SELL' }],
    [{ broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: ' ', stockCode: 'AAPL', side: 'BUY' }],
    [{ broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'A|B', side: 'BUY' }],
    [{ broker: Broker.KIS, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'AAPL', side: 'HOLD' }],
    [{ broker: undefined, market: 'OVERSEAS', exchangeCode: 'NASD', stockCode: 'AAPL', side: 'BUY' }],
  ])('rejects an invalid admission key before opening a transaction', async (invalidKey) => {
    const { service, prisma } = buildHarness();

    await expect(
      service.admit(invalidKey as OrderAdmissionKey, jest.fn()),
    ).rejects.toThrow('Invalid order admission key');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
