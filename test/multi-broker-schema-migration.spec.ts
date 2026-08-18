import { access, readdir, readFile } from 'fs/promises';
import { resolve } from 'path';

const SCHEMA_FILE = resolve(__dirname, '../prisma/schema.prisma');
const MIGRATIONS_DIR = resolve(__dirname, '../prisma/migrations');
const DEFERRED_MIGRATION_FILE = resolve(
  __dirname,
  '../prisma/deferred-migrations/20260814163000_drop_legacy_brokerless_uniques/migration.sql',
);
const ACTIVE_MIGRATION_FILE = resolve(
  __dirname,
  '../prisma/migrations/20260814163000_drop_legacy_brokerless_uniques/migration.sql',
);

function modelBlock(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`);
  const end = schema.indexOf('\n}', start);
  return schema.slice(start, end + 2);
}

describe('multi-broker schema migration contract', () => {
  it('keeps both legacy and broker uniques until Release 2 promotes the deferred drop migration', async () => {
    const schema = await readFile(SCHEMA_FILE, 'utf8');
    const migration = await readFile(DEFERRED_MIGRATION_FILE, 'utf8').catch(() => '');
    const migrationFiles = (await readdir(MIGRATIONS_DIR, { recursive: true }))
      .filter((file) => file.endsWith('.sql'));
    const modelContracts = [
      ['Position', '@@unique([market, exchangeCode, stockCode])', '@@unique([broker, market, exchangeCode, stockCode])'],
      ['WatchStock', '@@unique([market, exchangeCode, stockCode])', '@@unique([broker, market, exchangeCode, stockCode])'],
      ['RiskSnapshot', '@@unique([market, snapshotDate])', '@@unique([broker, market, snapshotDate])'],
      ['StrategyAllocation', '@@unique([market, strategyName])', '@@unique([broker, market, strategyName])'],
    ] as const;

    for (const [modelName, legacyUnique, brokerUnique] of modelContracts) {
      const block = modelBlock(schema, modelName);
      const uniqueLines = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('@@unique('));
      expect(uniqueLines).toHaveLength(2);
      expect(uniqueLines).toEqual(expect.arrayContaining([legacyUnique, brokerUnique]));
    }

    const dropStatements = migration
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('DROP INDEX'));
    expect(dropStatements).toEqual([
      'DROP INDEX IF EXISTS "positions_market_exchange_code_stock_code_key";',
      'DROP INDEX IF EXISTS "watch_stocks_market_exchange_code_stock_code_key";',
      'DROP INDEX IF EXISTS "risk_snapshots_market_snapshot_date_key";',
      'DROP INDEX IF EXISTS "strategy_allocations_market_strategy_name_key";',
    ]);
    expect(migration).not.toBe('');
    await expect(access(ACTIVE_MIGRATION_FILE)).rejects.toThrow();

    for (const migrationFile of migrationFiles) {
      const sql = await readFile(resolve(MIGRATIONS_DIR, migrationFile), 'utf8');
      expect(sql).not.toMatch(/DROP INDEX(?: IF EXISTS)? "positions_market_exchange_code_stock_code_key";/);
      expect(sql).not.toMatch(/DROP INDEX(?: IF EXISTS)? "watch_stocks_market_exchange_code_stock_code_key";/);
      expect(sql).not.toMatch(/DROP INDEX(?: IF EXISTS)? "risk_snapshots_market_snapshot_date_key";/);
      expect(sql).not.toMatch(/DROP INDEX(?: IF EXISTS)? "strategy_allocations_market_strategy_name_key";/);
    }
  });
});
