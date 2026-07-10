#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { dirname, join } = require('path');
const dotenv = require('dotenv');

const DEFAULT_SOURCE_ENV = '.env.prod';
const DEFAULT_TARGET_ENV = '.env';
const DEFAULT_SCHEMA = 'public';

function parseArgs(argv) {
  const options = {
    sourceEnvPath: DEFAULT_SOURCE_ENV,
    targetEnvPath: DEFAULT_TARGET_ENV,
    dryRun: false,
    keepDump: false,
    dumpFile: undefined,
    confirmTarget: undefined,
    pgClientImage: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--source-env') {
      options.sourceEnvPath = readRequiredArg(argv, i, arg);
      i += 1;
      continue;
    }

    if (arg === '--target-env') {
      options.targetEnvPath = readRequiredArg(argv, i, arg);
      i += 1;
      continue;
    }

    if (arg === '--confirm-target') {
      options.confirmTarget = readRequiredArg(argv, i, arg);
      i += 1;
      continue;
    }

    if (arg === '--dump-file') {
      options.dumpFile = readRequiredArg(argv, i, arg);
      i += 1;
      continue;
    }

    if (arg === '--pg-client-image') {
      options.pgClientImage = readRequiredArg(argv, i, arg);
      i += 1;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--keep-dump') {
      options.keepDump = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function readRequiredArg(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function loadDatabaseUrl(envPath) {
  if (!existsSync(envPath)) {
    throw new Error(`Missing env file: ${envPath}`);
  }

  const parsed = dotenv.parse(readFileSync(envPath));
  if (!parsed.DATABASE_URL) {
    throw new Error(`Missing DATABASE_URL in ${envPath}`);
  }

  return parsed.DATABASE_URL;
}

function parseDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`DATABASE_URL must use postgres:// or postgresql://: ${redactDatabaseUrl(databaseUrl)}`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error(`DATABASE_URL is missing a database name: ${redactDatabaseUrl(databaseUrl)}`);
  }

  return {
    database,
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    schema: url.searchParams.get('schema') || DEFAULT_SCHEMA,
    sslmode: url.searchParams.get('sslmode') || undefined,
    redactedUrl: redactDatabaseUrl(databaseUrl),
  };
}

function buildPgEnv(databaseUrl) {
  const parsed = parseDatabaseUrl(databaseUrl);
  const pgEnv = {
    PGCONNECT_TIMEOUT: '10',
    PGHOST: parsed.host,
    PGPORT: parsed.port,
    PGDATABASE: parsed.database,
  };

  if (parsed.user) {
    pgEnv.PGUSER = parsed.user;
  }

  if (parsed.password) {
    pgEnv.PGPASSWORD = parsed.password;
  }

  if (parsed.sslmode) {
    pgEnv.PGSSLMODE = parsed.sslmode;
  }

  return pgEnv;
}

function redactDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const username = url.username ? decodeURIComponent(url.username) : '';
  const password = url.password ? ':<redacted>' : '';
  const auth = username ? `${username}${password}@` : '';

  return `${url.protocol}//${auth}${url.host}${url.pathname}${url.search}`;
}

function createSyncPlan({ sourceDatabaseUrl, targetDatabaseUrl, confirmTarget, dumpFile }) {
  if (sourceDatabaseUrl.trim() === targetDatabaseUrl.trim()) {
    throw new Error('Source and target DATABASE_URL must be different');
  }

  const source = parseDatabaseUrl(sourceDatabaseUrl);
  const target = parseDatabaseUrl(targetDatabaseUrl);

  if (source.schema !== target.schema) {
    throw new Error(`Source schema (${source.schema}) and target schema (${target.schema}) must match`);
  }

  if (confirmTarget !== target.database) {
    throw new Error(`Refusing to overwrite target database. Re-run with --confirm-target ${target.database}`);
  }

  const temporaryDumpDir = dumpFile ? undefined : mkdtempSync(join(tmpdir(), 'kis-trader-db-sync-'));
  const resolvedDumpFile = dumpFile || join(temporaryDumpDir, 'prod.dump');
  const schemaIdentifier = quoteIdentifier(target.schema);

  return {
    source,
    target,
    dumpFile: resolvedDumpFile,
    temporaryDumpDir,
    steps: [
      {
        command: 'pg_dump',
        args: ['--format=custom', '--no-owner', '--no-acl', '--schema', source.schema, '--file', resolvedDumpFile],
        env: buildPgEnv(sourceDatabaseUrl),
      },
      {
        command: 'psql',
        args: ['-v', 'ON_ERROR_STOP=1', '-c', `DROP SCHEMA IF EXISTS ${schemaIdentifier} CASCADE;`],
        env: buildPgEnv(targetDatabaseUrl),
      },
      {
        command: 'pg_restore',
        args: ['--no-owner', '--no-acl', '--dbname', target.database, resolvedDumpFile],
        env: buildPgEnv(targetDatabaseUrl),
      },
    ],
  };
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function buildDockerPgEnv(step) {
  const env = { ...step.env };

  if (env.PGHOST === '127.0.0.1' || env.PGHOST === 'localhost') {
    env.PGHOST = 'host.docker.internal';
  }

  return env;
}

function buildDockerRunArgs(step, { dumpFile, pgClientImage }) {
  const dockerEnv = buildDockerPgEnv(step);
  const envArgs = Object.keys(dockerEnv)
    .filter((name) => dockerEnv[name] !== undefined && dockerEnv[name] !== '')
    .sort()
    .flatMap((name) => ['-e', name]);

  return [
    'run',
    '--rm',
    '-v',
    `${dirname(dumpFile)}:${dirname(dumpFile)}`,
    ...envArgs,
    pgClientImage,
    step.command,
    ...step.args,
  ];
}

function runStep(step, options = {}) {
  if (!options.pgClientImage && step.command === 'pg_restore') {
    runPgRestoreStep(step);
    return;
  }

  const command = options.pgClientImage ? 'docker' : step.command;
  const args = options.pgClientImage
    ? buildDockerRunArgs(step, options)
    : step.args;
  const pgEnv = options.pgClientImage ? buildDockerPgEnv(step) : step.env;

  const result = spawnSync(command, args, {
    env: { ...process.env, ...pgEnv },
    stdio: 'inherit',
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      if (options.pgClientImage) {
        throw new Error('docker not found. Install Docker or run without --pg-client-image.');
      }
      throw new Error(`${step.command} not found. Install PostgreSQL client tools (pg_dump, psql, pg_restore).`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} failed while running ${step.command} with exit code ${result.status}`);
  }
}

function runPgRestoreStep(step) {
  const dumpFile = step.args[step.args.length - 1];
  const restore = spawnSync('pg_restore', ['--no-owner', '--no-acl', '--file', '-', dumpFile], {
    env: { ...process.env, ...step.env },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });

  if (restore.error) {
    if (restore.error.code === 'ENOENT') {
      throw new Error('pg_restore not found. Install PostgreSQL client tools.');
    }
    throw restore.error;
  }

  if (restore.status !== 0) {
    process.stderr.write(restore.stderr || '');
    throw new Error(`pg_restore failed while generating restore SQL with exit code ${restore.status}`);
  }

  const restoreSql = filterRestoreSql(restore.stdout || '');
  const psql = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1'], {
    env: { ...process.env, ...step.env },
    input: restoreSql,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
    maxBuffer: 1024 * 1024 * 1024,
  });

  if (psql.error) {
    if (psql.error.code === 'ENOENT') {
      throw new Error('psql not found. Install PostgreSQL client tools.');
    }
    throw psql.error;
  }

  if (psql.status !== 0) {
    throw new Error(`psql failed while applying restore SQL with exit code ${psql.status}`);
  }
}

function filterRestoreSql(sql) {
  return sql
    .split('\n')
    .filter((line) => line.trim() !== 'SET transaction_timeout = 0;')
    .join('\n');
}

function printPlan(plan, options) {
  console.log(`Source env: ${options.sourceEnvPath}`);
  console.log(`Source DB:  ${plan.source.redactedUrl}`);
  console.log(`Target env: ${options.targetEnvPath}`);
  console.log(`Target DB:  ${plan.target.redactedUrl}`);
  console.log(`Target schema reset: ${plan.target.schema}`);
  console.log(`Dump file:  ${plan.dumpFile}`);
  if (options.pgClientImage) {
    console.log(`PG client:  Docker image ${options.pgClientImage}`);
  }

  if (options.dryRun) {
    console.log('Dry run: no database commands will be executed.');
  }
}

function printHelp() {
  console.log(`Usage:
  yarn db:sync:prod-to-env -- --confirm-target <target_database>

Copies PostgreSQL data from .env.prod DATABASE_URL into .env DATABASE_URL.

Options:
  --source-env <path>       Source env file. Default: .env.prod
  --target-env <path>       Target env file. Default: .env
  --confirm-target <name>   Required. Must match target database name.
  --dump-file <path>        Reuse a specific dump file path.
  --pg-client-image <image> Run pg_dump/psql/pg_restore through a Docker image.
  --keep-dump               Keep the generated dump file after sync.
  --dry-run                 Print the redacted plan without executing commands.
  --help                    Show this help.
`);
}

function run(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const sourceDatabaseUrl = loadDatabaseUrl(options.sourceEnvPath);
  const targetDatabaseUrl = loadDatabaseUrl(options.targetEnvPath);
  const plan = createSyncPlan({
    sourceDatabaseUrl,
    targetDatabaseUrl,
    confirmTarget: options.confirmTarget,
    dumpFile: options.dumpFile,
  });

  try {
    printPlan(plan, options);

    if (options.dryRun) {
      return;
    }

    for (const step of plan.steps) {
      console.log(`[sync] ${step.command}`);
      runStep(step, {
        dumpFile: plan.dumpFile,
        pgClientImage: options.pgClientImage,
      });
    }
    console.log('Database sync completed.');
  } finally {
    if (!options.keepDump && plan.temporaryDumpDir) {
      rmSync(plan.temporaryDumpDir, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

module.exports = {
  buildDockerPgEnv,
  buildDockerRunArgs,
  buildPgEnv,
  createSyncPlan,
  filterRestoreSql,
  loadDatabaseUrl,
  parseArgs,
  parseDatabaseUrl,
  quoteIdentifier,
  redactDatabaseUrl,
  run,
};
