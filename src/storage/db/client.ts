import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow, types } from "pg";

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

function isSupabaseHost(hostname: string) {
  return hostname.endsWith(".supabase.com") || hostname.endsWith(".supabase.co");
}

function stripConnectionStringSslParams(databaseUrl: string) {
  const url = new URL(databaseUrl);
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function buildPoolConfig(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl);
  const hostname = url.hostname;
  const sslMode = process.env.DATABASE_SSL_MODE?.trim();
  const sslCa = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  const disableVerification =
    process.env.DATABASE_SSL_NO_VERIFY === "true" ||
    sslMode === "no-verify" ||
    isSupabaseHost(hostname);

  const config: PoolConfig = {
    connectionString: stripConnectionStringSslParams(databaseUrl),
    max: process.env.NODE_ENV === "development" ? 5 : 10,
  };

  if (sslMode === "disable") {
    return config;
  }

  if (sslCa) {
    config.ssl = {
      ca: sslCa,
      rejectUnauthorized: true,
    };
    return config;
  }

  if (disableVerification) {
    config.ssl = {
      rejectUnauthorized: false,
    };
    return config;
  }

  if (!isLocalHostname(hostname)) {
    config.ssl = true;
  }

  return config;
}

export function isRuntimeDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDatabasePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured for MoonArq runtime storage.");
  }
  if (!globalThis.__moonarqPool) {
    globalThis.__moonarqPool = new Pool(buildPoolConfig(process.env.DATABASE_URL));
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
