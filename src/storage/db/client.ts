import "server-only";

import { Pool, type PoolClient, type QueryResult, type QueryResultRow, types } from "pg";

const PG_NUMERIC_OID = 1700;
const PG_TIMESTAMPTZ_OID = 1184;
const PG_TIMESTAMP_OID = 1114;

types.setTypeParser(PG_NUMERIC_OID, (value) => Number(value));
types.setTypeParser(PG_TIMESTAMPTZ_OID, (value) => new Date(value).toISOString());
types.setTypeParser(PG_TIMESTAMP_OID, (value) => new Date(`${value}Z`).toISOString());

declare global {
  var __moonarqPool: Pool | undefined;
}

export type DatabaseExecutor = Pool | PoolClient;

function normalizeDatabaseUrl(databaseUrl: string) {
  return databaseUrl.includes("?") ? databaseUrl : `${databaseUrl}?sslmode=require`;
}

export function isRuntimeDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDatabasePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured for MoonArq runtime storage.");
  }
  if (!globalThis.__moonarqPool) {
    globalThis.__moonarqPool = new Pool({
      connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL),
      max: process.env.NODE_ENV === "development" ? 5 : 10,
    });
  }
  return globalThis.__moonarqPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
  executor?: DatabaseExecutor,
): Promise<QueryResult<T>> {
  return (executor ?? getDatabasePool()).query<T>(text, values);
}

export async function queryRows<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
  executor?: DatabaseExecutor,
): Promise<T[]> {
  const result = await query<T>(text, values, executor);
  return result.rows;
}

export async function withDatabaseTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabasePool() {
  if (!globalThis.__moonarqPool) return;
  await globalThis.__moonarqPool.end();
  globalThis.__moonarqPool = undefined;
}
