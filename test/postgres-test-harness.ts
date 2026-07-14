import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { Client, QueryResult, QueryResultRow } from 'pg';

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollarQuote: string | undefined;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let blockCommentDepth = 0;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (inLineComment) {
      current += character;
      if (character === '\n') inLineComment = false;
      continue;
    }

    if (blockCommentDepth > 0) {
      current += character;
      if (character === '/' && nextCharacter === '*') {
        current += nextCharacter;
        blockCommentDepth += 1;
        index += 1;
      } else if (character === '*' && nextCharacter === '/') {
        current += nextCharacter;
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }

    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        current += dollarQuote;
        index += dollarQuote.length - 1;
        dollarQuote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (inSingleQuote) {
      current += character;
      if (character === "'" && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
      } else if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += character;
      if (character === '"' && nextCharacter === '"') {
        current += nextCharacter;
        index += 1;
      } else if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (character === '-' && nextCharacter === '-') {
      current += character + nextCharacter;
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === '/' && nextCharacter === '*') {
      current += character + nextCharacter;
      blockCommentDepth = 1;
      index += 1;
      continue;
    }

    if (character === "'") {
      current += character;
      inSingleQuote = true;
      continue;
    }

    if (character === '"') {
      current += character;
      inDoubleQuote = true;
      continue;
    }

    if (character === '$') {
      const match = sql.slice(index).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/);
      if (match) {
        dollarQuote = match[0];
        current += dollarQuote;
        index += dollarQuote.length - 1;
        continue;
      }
    }

    current += character;
    if (character === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

export class PostgresTestHarness {
  private cleanedUp = false;

  private constructor(
    readonly databaseUrl: string,
    readonly schemaName: string,
    private readonly adminClient: Client,
    private readonly testClient: Client,
  ) {}

  static async create(databaseUrl: string): Promise<PostgresTestHarness> {
    if (!new URL(databaseUrl).pathname.endsWith('_test')) {
      throw new Error('PostgreSQL integration tests require a *_test database');
    }

    const schemaName = `test_${process.pid}_${Date.now()}_${randomUUID().replaceAll('-', '')}`;
    const adminClient = new Client({ connectionString: databaseUrl });
    const testClient = new Client({ connectionString: databaseUrl });

    await adminClient.connect();

    try {
      await adminClient.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
      await testClient.connect();
      await testClient.query(`SET search_path TO ${quoteIdentifier(schemaName)}`);
      return new PostgresTestHarness(databaseUrl, schemaName, adminClient, testClient);
    } catch (error) {
      await testClient.end().catch(() => undefined);
      await adminClient
        .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
        .catch(() => undefined);
      await adminClient.end().catch(() => undefined);
      throw error;
    }
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.testClient.query<T>(text, values);
  }

  async applySqlFile(filePath: string): Promise<void> {
    const sql = await readFile(filePath, 'utf8');
    for (const statement of splitSqlStatements(sql)) {
      await this.testClient.query(statement);
    }
  }

  async createIsolatedClient(): Promise<Client> {
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    await client.query(`SET search_path TO ${quoteIdentifier(this.schemaName)}`);
    return client;
  }

  async cleanup(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    try {
      await this.testClient.end();
    } finally {
      try {
        await this.adminClient.query(
          `DROP SCHEMA IF EXISTS ${quoteIdentifier(this.schemaName)} CASCADE`,
        );
      } finally {
        await this.adminClient.end();
      }
    }
  }
}

export async function createPostgresTestHarness(
  databaseUrl: string,
): Promise<PostgresTestHarness> {
  return PostgresTestHarness.create(databaseUrl);
}
