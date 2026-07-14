import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { PrismaService } from '../src/prisma.service';
import { TradingOrderGuardService } from '../src/trading/trading-order-guard.service';
import { TradingSellApprovalService } from '../src/trading/trading-sell-approval.service';
import { OrderAdmissionKey } from '../src/trading/types/order-admission-key.type';
import { TradingSignal } from '../src/trading/types/trading-signal.type';
import {
  createPostgresTestHarness,
  PostgresTestHarness,
} from './postgres-test-harness';

jest.setTimeout(30_000);

const MIGRATIONS_DIRECTORY = resolve(__dirname, '../prisma/migrations');

async function applyCurrentMigrations(harness: PostgresTestHarness): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIRECTORY, { withFileTypes: true });
  const migrationDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationDirectory of migrationDirectories) {
    await harness.applySqlFile(
      resolve(MIGRATIONS_DIRECTORY, migrationDirectory, 'migration.sql'),
    );
  }
}

async function createIntent(
  tx: Prisma.TransactionClient,
  id: string,
  key: OrderAdmissionKey,
): Promise<string> {
  await tx.tradeRecord.create({
    data: {
      id,
      market: key.market,
      exchangeCode: key.market === 'DOMESTIC' ? 'KRX' : key.exchangeCode,
      stockCode: key.stockCode,
      stockName: key.stockCode,
      side: key.side,
      orderType: 'MARKET',
      quantity: 1,
      price: 1,
      status: 'PENDING',
    },
  });
  return id;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('TradingOrderGuardService PostgreSQL concurrency', () => {
  let harness: PostgresTestHarness | undefined;
  let firstClient: PrismaClient | undefined;
  let secondClient: PrismaClient | undefined;
  let firstGuard: TradingOrderGuardService;
  let secondGuard: TradingOrderGuardService;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

    harness = await createPostgresTestHarness(databaseUrl);
    await applyCurrentMigrations(harness);

    firstClient = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, max: 1 },
        { schema: harness.schemaName },
      ),
    });
    secondClient = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: databaseUrl, max: 1 },
        { schema: harness.schemaName },
      ),
    });
    await Promise.all([firstClient.$connect(), secondClient.$connect()]);

    firstGuard = new TradingOrderGuardService(firstClient as unknown as PrismaService);
    secondGuard = new TradingOrderGuardService(secondClient as unknown as PrismaService);
  });

  beforeEach(async () => {
    await firstClient!.stopLossApproval.deleteMany();
    await firstClient!.tradeRecord.deleteMany();
  });

  afterAll(async () => {
    await Promise.allSettled([
      firstClient?.$disconnect() ?? Promise.resolve(),
      secondClient?.$disconnect() ?? Promise.resolve(),
    ]);
    await harness?.cleanup();
  });

  it('uses two separate Prisma adapters and PostgreSQL connections', async () => {
    const [firstPid] = await firstClient!.$queryRaw<Array<{ pid: number }>>`
      SELECT pg_backend_pid() AS pid
    `;
    const [secondPid] = await secondClient!.$queryRaw<Array<{ pid: number }>>`
      SELECT pg_backend_pid() AS pid
    `;

    expect(firstPid.pid).not.toBe(secondPid.pid);
  });

  it('admits exactly one unresolved intent for the same canonical key', async () => {
    const key: OrderAdmissionKey = {
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'AAPL',
      side: 'SELL',
    };
    const firstInserted = deferred();
    const releaseFirst = deferred();

    const first = firstGuard.admit(key, async (tx) => {
      const id = await createIntent(tx, 'same-key-first', key);
      firstInserted.resolve();
      await releaseFirst.promise;
      return id;
    });

    await firstInserted.promise;
    const second = secondGuard.admit(key, (tx) =>
      createIntent(tx, 'same-key-second', key),
    );

    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
    releaseFirst.resolve();

    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(
      await firstClient!.tradeRecord.count({
        where: {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'AAPL',
          side: 'SELL',
          status: 'PENDING',
        },
      }),
    ).toBe(1);
  });

  it('does not block a different side or a different instrument key', async () => {
    const heldKey: OrderAdmissionKey = {
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'AAPL',
      side: 'SELL',
    };
    const heldInserted = deferred();
    const releaseHeld = deferred();
    const held = firstGuard.admit(heldKey, async (tx) => {
      const id = await createIntent(tx, 'held-sell', heldKey);
      heldInserted.resolve();
      await releaseHeld.promise;
      return id;
    });

    await heldInserted.promise;
    try {
      const differentSideKey: OrderAdmissionKey = { ...heldKey, side: 'BUY' };
      await expect(
        secondGuard.admit(differentSideKey, (tx) =>
          createIntent(tx, 'different-side-buy', differentSideKey),
        ),
      ).resolves.toBe('different-side-buy');

      const differentInstrumentKey: OrderAdmissionKey = {
        ...heldKey,
        stockCode: 'MSFT',
      };
      await expect(
        secondGuard.admit(differentInstrumentKey, (tx) =>
          createIntent(tx, 'different-instrument-sell', differentInstrumentKey),
        ),
      ).resolves.toBe('different-instrument-sell');
    } finally {
      releaseHeld.resolve();
    }

    await expect(held).resolves.toBe('held-sell');
  });

  it('rolls back the trade record when approval creation fails inside admission', async () => {
    await firstClient!.tradeRecord.create({
      data: {
        id: 'approval-conflict-seed-trade',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'SEED',
        stockName: 'SEED',
        side: 'SELL',
        orderType: 'LIMIT',
        quantity: 1,
        price: 1,
        status: 'CANCELLED',
      },
    });
    await firstClient!.stopLossApproval.create({
      data: {
        id: 'forced-approval-conflict',
        tradeRecordId: 'approval-conflict-seed-trade',
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'SEED',
        stockName: 'SEED',
        signal: { side: 'SELL' },
        currentPrice: 1,
        avgPrice: 1,
        quantity: 1,
        lossRate: 0,
        status: 'EXPIRED',
        expiresAt: new Date('2026-07-13T00:00:00.000Z'),
      },
    });

    const key: OrderAdmissionKey = {
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'ROLLBACK',
      side: 'SELL',
    };
    await expect(
      firstGuard.admit(key, async (tx) => {
        const record = await tx.tradeRecord.create({
          data: {
            id: 'trade-that-must-roll-back',
            market: key.market,
            exchangeCode: key.exchangeCode,
            stockCode: key.stockCode,
            stockName: key.stockCode,
            side: key.side,
            orderType: 'LIMIT',
            quantity: 1,
            price: 1,
            status: 'AWAITING_APPROVAL',
          },
        });
        return tx.stopLossApproval.create({
          data: {
            id: 'forced-approval-conflict',
            tradeRecordId: record.id,
            market: key.market,
            exchangeCode: key.exchangeCode,
            stockCode: key.stockCode,
            stockName: key.stockCode,
            signal: { side: key.side },
            currentPrice: 1,
            avgPrice: 1,
            quantity: 1,
            lossRate: 0,
            status: 'PENDING',
            expiresAt: new Date('2026-07-13T01:00:00.000Z'),
          },
        });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(
      await firstClient!.tradeRecord.findUnique({
        where: { id: 'trade-that-must-roll-back' },
      }),
    ).toBeNull();
    expect(
      await firstClient!.stopLossApproval.count({
        where: { id: 'forced-approval-conflict' },
      }),
    ).toBe(1);
  });

  it('creates one canonical approval pair and sends Slack once for normalized-equivalent requests', async () => {
    const sendStopLossApproval = jest.fn(async () => ({
      ts: String(Date.now() / 1000),
      channel: 'C-APPROVALS',
    }));
    const slackService = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendStopLossApproval,
    };
    const brokerContext = {
      getCurrentContext: jest.fn().mockReturnValue({
        environment: 'PAPER',
        accountHash: 'integration-account',
      }),
    };
    const firstService = new TradingSellApprovalService(
      firstClient as unknown as PrismaService,
      brokerContext as any,
      firstGuard,
      slackService as any,
    );
    const secondService = new TradingSellApprovalService(
      secondClient as unknown as PrismaService,
      brokerContext as any,
      secondGuard,
      slackService as any,
    );
    const firstSignal: TradingSignal = {
      market: 'OVERSEAS',
      exchangeCode: ' nasd ',
      stockCode: ' tqqq ',
      side: 'SELL',
      quantity: 2,
      price: 75,
      reason: 'Stop loss: integration concurrency',
      metadata: { phase: 'stop-loss' },
    };
    const secondSignal: TradingSignal = {
      ...firstSignal,
      exchangeCode: 'NASD',
      stockCode: 'TqQq',
    };

    await expect(
      Promise.all([
        firstService.requestApproval(firstSignal, 'infinite-buy', undefined, 'LIMIT'),
        secondService.requestApproval(secondSignal, 'infinite-buy', undefined, 'LIMIT'),
      ]),
    ).resolves.toEqual([false, false]);

    expect(sendStopLossApproval).toHaveBeenCalledTimes(1);
    expect(
      await firstClient!.tradeRecord.count({
        where: {
          market: 'OVERSEAS',
          exchangeCode: 'NASD',
          stockCode: 'TQQQ',
          side: 'SELL',
          status: 'AWAITING_APPROVAL',
        },
      }),
    ).toBe(1);
    const approvals = await firstClient!.stopLossApproval.findMany({
      where: {
        market: 'OVERSEAS',
        exchangeCode: 'NASD',
        stockCode: 'TQQQ',
      },
    });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      status: 'PENDING',
      slackMessageTs: expect.any(String),
      slackChannel: 'C-APPROVALS',
      notifiedAt: expect.any(Date),
    });
    expect(approvals[0].signal).toMatchObject({
      market: 'OVERSEAS',
      exchangeCode: 'NASD',
      stockCode: 'TQQQ',
    });
  });
});
