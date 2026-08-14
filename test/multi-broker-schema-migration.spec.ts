import { access, readFile } from 'fs/promises';
import { resolve } from 'path';

const SCHEMA_FILE = resolve(__dirname, '../prisma/schema.prisma');
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
  it('keeps broker uniqueness canonical and drops only the four overdue brokerless indexes', async () => {
    const schema = await readFile(SCHEMA_FILE, 'utf8');
    const migration = await readFile(DEFERRED_MIGRATION_FILE, 'utf8').catch(() => '');
    const modelContracts = [
      ['Position', '@@unique([market, exchangeCode, stockCode])', '@@unique([broker, market, exchangeCode, stockCode])'],
      ['WatchStock', '@@unique([market, exchangeCode, stockCode])', '@@unique([broker, market, exchangeCode, stockCode])'],
      ['RiskSnapshot', '@@unique([market, snapshotDate])', '@@unique([broker, market, snapshotDate])'],
      ['StrategyAllocation', '@@unique([market, strategyName])', '@@unique([broker, market, strategyName])'],
    ] as const;

    for (const [modelName, legacyUnique, brokerUnique] of modelContracts) {
      const block = modelBlock(schema, modelName);
      expect(block).toContain(brokerUnique);
      expect(block).not.toContain(legacyUnique);
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
  });
});
