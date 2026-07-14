import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { Client } from 'pg';
import {
  createPostgresTestHarness,
  PostgresTestHarness,
} from './postgres-test-harness';

const TARGET_MIGRATION = '20260713000000_harden_sell_approval_state';
const MIGRATIONS_DIRECTORY = resolve(__dirname, '../prisma/migrations');
const TARGET_MIGRATION_FILE = resolve(
  MIGRATIONS_DIRECTORY,
  TARGET_MIGRATION,
  'migration.sql',
);

interface LegacyTradeFixture {
  id: string;
  status: 'PENDING' | 'FILLED' | 'PARTIAL' | 'CANCELLED' | 'FAILED' | 'AWAITING_APPROVAL';
  createdAt: Date;
  orderNo?: string;
}

interface LegacyApprovalFixture {
  id: string;
  tradeRecordId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  requestedAt: Date;
  timeoutMinutes: number;
  respondedAt?: Date;
}

const now = new Date();
const hoursAgo = (hours: number): Date => new Date(now.getTime() - hours * 60 * 60 * 1000);
const daysAgo = (days: number): Date => hoursAgo(days * 24);

const legacyTrades: LegacyTradeFixture[] = [
  { id: 'approved-awaiting', status: 'AWAITING_APPROVAL', createdAt: daysAgo(3) },
  { id: 'orphan-awaiting', status: 'AWAITING_APPROVAL', createdAt: daysAgo(3) },
  { id: 'pending-approval-awaiting', status: 'AWAITING_APPROVAL', createdAt: daysAgo(3) },
  { id: 'decided-awaiting', status: 'AWAITING_APPROVAL', createdAt: daysAgo(3) },
  { id: 'pending-without-order', status: 'PENDING', createdAt: daysAgo(4) },
  { id: 'pending-with-order', status: 'PENDING', createdAt: daysAgo(4), orderNo: '100001' },
  { id: 'recent-failed-without-order', status: 'FAILED', createdAt: daysAgo(5) },
  {
    id: 'recent-failed-with-order',
    status: 'FAILED',
    createdAt: daysAgo(5),
    orderNo: '100002',
  },
  { id: 'old-failed-without-order', status: 'FAILED', createdAt: daysAgo(31) },
  { id: 'filled-with-order', status: 'FILLED', createdAt: daysAgo(60), orderNo: '100003' },
  { id: 'approval-race-a', status: 'CANCELLED', createdAt: daysAgo(2) },
  { id: 'approval-race-b', status: 'CANCELLED', createdAt: daysAgo(2) },
];

const approvedRespondedAt = daysAgo(2);
const legacyApprovals: LegacyApprovalFixture[] = [
  {
    id: 'approval-approved',
    tradeRecordId: 'approved-awaiting',
    status: 'APPROVED',
    requestedAt: daysAgo(3),
    timeoutMinutes: 7,
    respondedAt: approvedRespondedAt,
  },
  {
    id: 'approval-pending',
    tradeRecordId: 'pending-approval-awaiting',
    status: 'PENDING',
    requestedAt: daysAgo(3),
    timeoutMinutes: 5,
  },
  {
    id: 'approval-rejected',
    tradeRecordId: 'decided-awaiting',
    status: 'REJECTED',
    requestedAt: daysAgo(3),
    timeoutMinutes: 12,
    respondedAt: daysAgo(2),
  },
  {
    id: 'approval-expired',
    tradeRecordId: 'decided-awaiting',
    status: 'EXPIRED',
    requestedAt: daysAgo(4),
    timeoutMinutes: 9,
  },
];

async function applyLegacyMigrations(harness: PostgresTestHarness): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIRECTORY, { withFileTypes: true });
  const legacyMigrationDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name < TARGET_MIGRATION)
    .map((entry) => entry.name)
    .sort();

  for (const migrationDirectory of legacyMigrationDirectories) {
    await harness.applySqlFile(
      resolve(MIGRATIONS_DIRECTORY, migrationDirectory, 'migration.sql'),
    );
  }
}

async function insertLegacyTrade(
  harness: PostgresTestHarness,
  fixture: LegacyTradeFixture,
): Promise<void> {
  await harness.query(
    `INSERT INTO "trade_records" (
      "id", "market", "exchange_code", "stock_code", "stock_name", "side",
      "order_type", "quantity", "price", "order_no", "status", "strategy_name",
      "reason", "created_at", "updated_at"
    ) VALUES ($1, 'DOMESTIC', 'KRX', $2, $3, 'SELL', 'MARKET', 1, 1000,
      $4, $5, 'migration-fixture', 'legacy migration fixture', $6, $6)`,
    [
      fixture.id,
      `stock-${fixture.id}`,
      `Stock ${fixture.id}`,
      fixture.orderNo ?? null,
      fixture.status,
      fixture.createdAt,
    ],
  );
}

async function insertLegacyApproval(
  harness: PostgresTestHarness,
  fixture: LegacyApprovalFixture,
): Promise<void> {
  await harness.query(
    `INSERT INTO "stop_loss_approvals" (
      "id", "trade_record_id", "market", "exchange_code", "stock_code", "stock_name",
      "strategy_name", "signal", "current_price", "avg_price", "quantity", "loss_rate",
      "status", "requested_at", "responded_at", "timeout_minutes"
    ) VALUES ($1, $2, 'DOMESTIC', 'KRX', $3, $4, 'migration-fixture', $5::jsonb,
      900, 1000, 1, -0.1, $6, $7, $8, $9)`,
    [
      fixture.id,
      fixture.tradeRecordId,
      `stock-${fixture.tradeRecordId}`,
      `Stock ${fixture.tradeRecordId}`,
      JSON.stringify({ reason: 'legacy fixture' }),
      fixture.status,
      fixture.requestedAt,
      fixture.respondedAt ?? null,
      fixture.timeoutMinutes,
    ],
  );
}

async function seedLegacyFixtures(harness: PostgresTestHarness): Promise<void> {
  for (const trade of legacyTrades) await insertLegacyTrade(harness, trade);
  for (const approval of legacyApprovals) await insertLegacyApproval(harness, approval);
}

async function runInsertRace(
  harness: PostgresTestHarness,
  first: (client: Client) => Promise<unknown>,
  second: (client: Client) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const firstClient = await harness.createIsolatedClient();
  const secondClient = await harness.createIsolatedClient();

  try {
    return await Promise.allSettled([first(firstClient), second(secondClient)]);
  } finally {
    await Promise.all([firstClient.end(), secondClient.end()]);
  }
}

function expectOneUniqueViolation(results: PromiseSettledResult<unknown>[]): void {
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  expect(rejected).toHaveLength(1);
  expect(rejected[0].reason).toMatchObject({ code: '23505' });
}

describe('PostgreSQL test database safety guard', () => {
  it('refuses a database whose name does not end in _test', async () => {
    await expect(
      createPostgresTestHarness('postgresql://localhost:55432/kis_trader'),
    ).rejects.toThrow('PostgreSQL integration tests require a *_test database');
  });
});

describe('sell approval safety migration', () => {
  let harness: PostgresTestHarness | undefined;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');

    harness = await createPostgresTestHarness(databaseUrl);
    await applyLegacyMigrations(harness);
    await seedLegacyFixtures(harness);
    await harness.applySqlFile(TARGET_MIGRATION_FILE);
  });

  afterAll(async () => {
    await harness?.cleanup();
  });

  it('classifies every legacy trade branch without reopening preserved orders', async () => {
    const result = await harness!.query<{
      id: string;
      status: string;
      started_from_created_at: boolean;
    }>(
      `SELECT "id", "status"::text,
        "submission_started_at" IS NOT DISTINCT FROM "created_at" AS "started_from_created_at"
      FROM "trade_records"
      WHERE "id" = ANY($1::text[])
      ORDER BY "id"`,
      [legacyTrades.map((trade) => trade.id)],
    );
    const rows = new Map(result.rows.map((row) => [row.id, row]));

    expect(rows.get('approved-awaiting')?.status).toBe('SUBMISSION_UNKNOWN');
    expect(rows.get('orphan-awaiting')?.status).toBe('CANCELLED');
    expect(rows.get('pending-approval-awaiting')?.status).toBe('CANCELLED');
    expect(rows.get('decided-awaiting')?.status).toBe('CANCELLED');
    expect(rows.get('pending-without-order')).toMatchObject({
      status: 'SUBMISSION_UNKNOWN',
      started_from_created_at: true,
    });
    expect(rows.get('pending-with-order')?.status).toBe('PENDING');
    expect(rows.get('recent-failed-without-order')).toMatchObject({
      status: 'SUBMISSION_UNKNOWN',
      started_from_created_at: true,
    });
    expect(rows.get('recent-failed-with-order')?.status).toBe('FAILED');
    expect(rows.get('old-failed-without-order')?.status).toBe('FAILED');
    expect(rows.get('filled-with-order')?.status).toBe('FILLED');

    const approvedStart = await harness!.query<{ uses_approval_response: boolean }>(
      `SELECT tr."submission_started_at" IS NOT DISTINCT FROM approval."responded_at"
        AS "uses_approval_response"
      FROM "trade_records" tr
      JOIN "stop_loss_approvals" approval ON approval."trade_record_id" = tr."id"
      WHERE tr."id" = 'approved-awaiting' AND approval."status" = 'APPROVED'`,
    );
    expect(approvedStart.rows[0].uses_approval_response).toBe(true);
  });

  it('backfills every approval expiry and expires all legacy pending approvals', async () => {
    const result = await harness!.query<{
      id: string;
      status: string;
      expiry_seconds: number;
    }>(
      `SELECT "id", "status"::text,
        EXTRACT(EPOCH FROM ("expires_at" - "requested_at"))::integer AS "expiry_seconds"
      FROM "stop_loss_approvals"
      ORDER BY "id"`,
    );
    const rows = new Map(result.rows.map((row) => [row.id, row]));

    expect(rows.get('approval-approved')).toMatchObject({ status: 'APPROVED', expiry_seconds: 420 });
    expect(rows.get('approval-pending')).toMatchObject({ status: 'EXPIRED', expiry_seconds: 300 });
    expect(rows.get('approval-rejected')).toMatchObject({ status: 'REJECTED', expiry_seconds: 720 });
    expect(rows.get('approval-expired')).toMatchObject({ status: 'EXPIRED', expiry_seconds: 540 });

    const columnContracts = await harness!.query<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT "column_name", "is_nullable", "column_default"
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = 'stop_loss_approvals'
        AND column_name IN ('expires_at', 'timeout_minutes')`,
      [harness!.schemaName],
    );
    const columns = new Map(columnContracts.rows.map((row) => [row.column_name, row]));
    expect(columns.get('expires_at')?.is_nullable).toBe('NO');
    expect(columns.get('timeout_minutes')?.column_default).toBe('10');
  });

  it('writes authoritative SYSTEM/UNKNOWN_DETECTED audits for migrated unknowns', async () => {
    const result = await harness!.query<{
      trade_record_id: string;
      channel: string;
      action: string;
      before_status: string;
      after_status: string;
    }>(
      `SELECT "trade_record_id", "channel"::text, "action"::text,
        "before_status"::text, "after_status"::text
      FROM "broker_order_action_audit_logs"
      ORDER BY "trade_record_id"`,
    );

    expect(result.rows).toEqual([
      {
        trade_record_id: 'approved-awaiting',
        channel: 'SYSTEM',
        action: 'UNKNOWN_DETECTED',
        before_status: 'AWAITING_APPROVAL',
        after_status: 'SUBMISSION_UNKNOWN',
      },
      {
        trade_record_id: 'pending-without-order',
        channel: 'SYSTEM',
        action: 'UNKNOWN_DETECTED',
        before_status: 'PENDING',
        after_status: 'SUBMISSION_UNKNOWN',
      },
      {
        trade_record_id: 'recent-failed-without-order',
        channel: 'SYSTEM',
        action: 'UNKNOWN_DETECTED',
        before_status: 'FAILED',
        after_status: 'SUBMISSION_UNKNOWN',
      },
    ]);
  });

  it('allows only one concurrent pending approval per instrument', async () => {
    const insertApproval = (id: string, tradeRecordId: string) => (client: Client) =>
      client.query(
        `INSERT INTO "stop_loss_approvals" (
          "id", "trade_record_id", "market", "exchange_code", "stock_code", "stock_name",
          "strategy_name", "signal", "current_price", "avg_price", "quantity", "loss_rate",
          "status", "requested_at", "expires_at", "timeout_minutes"
        ) VALUES ($1, $2, 'DOMESTIC', 'KRX', '005930', 'Samsung Electronics',
          'migration-fixture', '{}'::jsonb, 70000, 71000, 1, -0.014, 'PENDING',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '10 minutes', 10)`,
        [id, tradeRecordId],
      );

    const results = await runInsertRace(
      harness!,
      insertApproval('approval-race-insert-a', 'approval-race-a'),
      insertApproval('approval-race-insert-b', 'approval-race-b'),
    );
    expectOneUniqueViolation(results);

    await expect(
      harness!.query(
        `INSERT INTO "stop_loss_approvals" (
          "id", "trade_record_id", "market", "exchange_code", "stock_code", "stock_name",
          "signal", "current_price", "avg_price", "quantity", "loss_rate", "status",
          "requested_at", "expires_at", "timeout_minutes"
        ) VALUES ('approval-expired-duplicate', 'approval-race-a', 'DOMESTIC', 'KRX',
          '005930', 'Samsung Electronics', '{}'::jsonb, 70000, 71000, 1, -0.014,
          'EXPIRED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 10)`,
      ),
    ).resolves.toBeDefined();
  });

  it('allows only one concurrent link to a complete broker identity', async () => {
    const insertTrade = (id: string) => (client: Client) =>
      client.query(
        `INSERT INTO "trade_records" (
          "id", "market", "exchange_code", "stock_code", "stock_name", "side",
          "order_type", "quantity", "price", "order_no", "status", "created_at", "updated_at",
          "broker_environment", "broker_account_hash", "broker_order_date"
        ) VALUES ($1, 'DOMESTIC', 'KRX', $2, $3, 'SELL', 'MARKET', 1, 70000,
          'broker-race-order', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
          'PAPER', 'fixture-account-hash', '20260713')`,
        [id, `stock-${id}`, `Stock ${id}`],
      );

    const results = await runInsertRace(
      harness!,
      insertTrade('broker-race-a'),
      insertTrade('broker-race-b'),
    );
    expectOneUniqueViolation(results);

    await expect(
      harness!.query(
        `INSERT INTO "trade_records" (
          "id", "market", "exchange_code", "stock_code", "stock_name", "side",
          "order_type", "quantity", "price", "order_no", "status", "created_at", "updated_at",
          "broker_environment", "broker_account_hash", "broker_order_date"
        ) VALUES
          ('broker-partial-a', 'DOMESTIC', 'KRX', 'partial-a', 'Partial A', 'SELL',
            'MARKET', 1, 70000, 'partial-order', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
            NULL, NULL, NULL),
          ('broker-partial-b', 'DOMESTIC', 'KRX', 'partial-b', 'Partial B', 'SELL',
            'MARKET', 1, 70000, 'partial-order', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
            NULL, NULL, NULL)`,
      ),
    ).resolves.toBeDefined();
  });
});
