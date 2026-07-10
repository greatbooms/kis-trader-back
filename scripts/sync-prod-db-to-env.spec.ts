const {
  buildDockerPgEnv,
  buildDockerRunArgs,
  buildPgEnv,
  createSyncPlan,
  filterRestoreSql,
  parseArgs,
  redactDatabaseUrl,
  run,
} = require('./sync-prod-db-to-env.js');
const { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

describe('sync-prod-db-to-env', () => {
  const sourceUrl =
    'postgresql://prod_user:prod_pass@prod.example.com:5432/kis_trader_prod?schema=public&sslmode=require';
  const targetUrl = 'postgresql://local_user:local_pass@127.0.0.1:5432/kis_trader_local?schema=public';

  it('uses .env.prod as the source and .env as the target by default', () => {
    expect(parseArgs([])).toMatchObject({
      sourceEnvPath: '.env.prod',
      targetEnvPath: '.env',
      dryRun: false,
    });
  });

  it('requires explicit target database confirmation before overwriting the target', () => {
    expect(() =>
      createSyncPlan({
        sourceDatabaseUrl: sourceUrl,
        targetDatabaseUrl: targetUrl,
      }),
    ).toThrow('--confirm-target kis_trader_local');

    expect(() =>
      createSyncPlan({
        sourceDatabaseUrl: sourceUrl,
        targetDatabaseUrl: targetUrl,
        confirmTarget: 'kis_trader_local',
      }),
    ).not.toThrow();
  });

  it('refuses to sync when source and target URLs are identical', () => {
    expect(() =>
      createSyncPlan({
        sourceDatabaseUrl: sourceUrl,
        targetDatabaseUrl: sourceUrl,
        confirmTarget: 'kis_trader_prod',
      }),
    ).toThrow('Source and target DATABASE_URL must be different');
  });

  it('builds pg client environment without leaking DATABASE_URL through command arguments', () => {
    const pgEnv = buildPgEnv(sourceUrl);

    expect(pgEnv).toMatchObject({
      PGHOST: 'prod.example.com',
      PGPORT: '5432',
      PGDATABASE: 'kis_trader_prod',
      PGUSER: 'prod_user',
      PGPASSWORD: 'prod_pass',
      PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '10',
    });

    const plan = createSyncPlan({
      sourceDatabaseUrl: sourceUrl,
      targetDatabaseUrl: targetUrl,
      confirmTarget: 'kis_trader_local',
      dumpFile: '/tmp/kis-trader-back.dump',
    });

    expect(plan.steps.map((step) => step.command)).toEqual(['pg_dump', 'psql', 'pg_restore']);
    expect(plan.steps.flatMap((step) => step.args)).not.toContain(sourceUrl);
    expect(plan.steps.flatMap((step) => step.args)).not.toContain(targetUrl);
  });

  it('can run PostgreSQL clients through Docker without exposing passwords in args', () => {
    const step = {
      command: 'pg_restore',
      args: ['--dbname', 'kis_trader_local', '/tmp/kis-trader-back/prod.dump'],
      env: buildPgEnv(targetUrl),
    };

    const dockerEnv = buildDockerPgEnv(step);
    const dockerArgs = buildDockerRunArgs(step, {
      dumpFile: '/tmp/kis-trader-back/prod.dump',
      pgClientImage: 'postgres:18-alpine',
    });

    expect(dockerEnv.PGHOST).toBe('host.docker.internal');
    expect(dockerEnv.PGPASSWORD).toBe('local_pass');
    expect(dockerArgs).toEqual([
      'run',
      '--rm',
      '-v',
      '/tmp/kis-trader-back:/tmp/kis-trader-back',
      '-e',
      'PGCONNECT_TIMEOUT',
      '-e',
      'PGDATABASE',
      '-e',
      'PGHOST',
      '-e',
      'PGPASSWORD',
      '-e',
      'PGPORT',
      '-e',
      'PGUSER',
      'postgres:18-alpine',
      'pg_restore',
      '--dbname',
      'kis_trader_local',
      '/tmp/kis-trader-back/prod.dump',
    ]);
    expect(dockerArgs).not.toContain('local_pass');
  });

  it('redacts credentials when printing database URLs', () => {
    const redacted = redactDatabaseUrl(sourceUrl);

    expect(redacted).toContain('prod_user:<redacted>@prod.example.com');
    expect(redacted).not.toContain('prod_pass');
  });

  it('removes PostgreSQL 18-only transaction_timeout statements from restore SQL', () => {
    const sql = [
      'SET statement_timeout = 0;',
      'SET transaction_timeout = 0;',
      'CREATE TABLE sample(id integer);',
      '',
    ].join('\n');

    expect(filterRestoreSql(sql)).toBe('SET statement_timeout = 0;\nCREATE TABLE sample(id integer);\n');
  });

  it('cleans up temporary dump directories after dry-run', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'kis-trader-db-sync-test-'));
    const sourceEnv = join(testDir, '.env.prod');
    const targetEnv = join(testDir, '.env');
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('kis-trader-db-sync-')));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    writeFileSync(sourceEnv, `DATABASE_URL=${sourceUrl}\n`);
    writeFileSync(targetEnv, `DATABASE_URL=${targetUrl}\n`);

    try {
      run([
        '--source-env',
        sourceEnv,
        '--target-env',
        targetEnv,
        '--confirm-target',
        'kis_trader_local',
        '--dry-run',
      ]);

      const after = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('kis-trader-db-sync-')));
      expect(after).toEqual(before);
      expect(existsSync(testDir)).toBe(true);
    } finally {
      logSpy.mockRestore();
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
