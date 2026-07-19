export interface DatabaseMigrationTransportInput {
  databaseUrl: string;
  sslMode?: string;
  sslNoVerify?: string;
  sslCa?: string;
}

export class DatabaseMigrationTransportError extends Error {}

function isLocalDatabaseHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isSupabaseHost(hostname: string) {
  return hostname.endsWith(".supabase.com") || hostname.endsWith(".supabase.co");
}

export function assertSafeDatabaseMigrationTransport({
  databaseUrl,
  sslMode,
  sslNoVerify,
  sslCa,
}: DatabaseMigrationTransportInput): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new DatabaseMigrationTransportError(
      "The migration database connection is invalid; no connection details were logged.",
    );
  }

  const normalizedSslMode = sslMode?.trim().toLowerCase();
  const urlSslMode = parsedUrl.searchParams.get("sslmode")?.trim().toLowerCase();
  const isTransactionPooler =
    parsedUrl.port === "6543" ||
    parsedUrl.searchParams.get("pgbouncer")?.trim().toLowerCase() === "true";

  if (isTransactionPooler) {
    throw new DatabaseMigrationTransportError(
      "The migration connection uses transaction-pooler mode. Use a temporary direct or Session Pooler migration connection.",
    );
  }

  if (
    !isLocalDatabaseHost(parsedUrl.hostname) &&
    (normalizedSslMode === "disable" ||
      normalizedSslMode === "no-verify" ||
      sslNoVerify === "true" ||
      urlSslMode === "disable" ||
      urlSslMode === "no-verify")
  ) {
    throw new DatabaseMigrationTransportError(
      "Remote database migrations require certificate-verified TLS.",
    );
  }

  if (
    !isLocalDatabaseHost(parsedUrl.hostname) &&
    isSupabaseHost(parsedUrl.hostname) &&
    !sslCa?.trim()
  ) {
    throw new DatabaseMigrationTransportError(
      "Supabase database migrations require DATABASE_SSL_CA for certificate-verified TLS.",
    );
  }
}
