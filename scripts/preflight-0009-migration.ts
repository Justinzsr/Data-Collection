import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env";
import {
  closeDatabasePool,
  isRuntimeDatabaseConfigured,
  withDatabaseTransaction,
} from "../src/storage/db/client";
import { selectPendingMigrations } from "./db-migration-plan";
import {
  assertSafeDatabaseMigrationTransport,
  DatabaseMigrationTransportError,
} from "./db-migration-safety";

const TARGET_MIGRATION = "0009_website_event_contract_v1.sql";
const EXPECTED_APPLIED_MIGRATIONS = [
  "0001_initial.sql",
  "0002_reporting_layer.sql",
  "0003_data_spaces.sql",
  "0004_tiktok_data_integrity.sql",
  "0005_foreign_key_indexes.sql",
  "0006_shopify_official_connector.sql",
  "0007_repair_time_zone_rollups.sql",
  "0008_meta_ads_attribution.sql",
] as const;

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/storage/db/migrations",
);

class MigrationPreflightError extends Error {}

function listsMatch(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function main() {
  if (!isRuntimeDatabaseConfigured()) {
    throw new MigrationPreflightError(
      "DATABASE_URL is required for the read-only 0009 migration preflight.",
    );
  }
  assertSafeDatabaseMigrationTransport({
    databaseUrl: process.env.DATABASE_URL!,
    sslMode: process.env.DATABASE_SSL_MODE,
    sslNoVerify: process.env.DATABASE_SSL_NO_VERIFY,
    sslCa: process.env.DATABASE_SSL_CA,
  });

  await withDatabaseTransaction(async (client) => {
    await client.query("set transaction read only");
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");

    const migrationTableResult = await client.query<{ migration_table: string | null }>(
      "select to_regclass('public.schema_migrations')::text as migration_table",
    );
    if (migrationTableResult.rows[0]?.migration_table === null) {
      throw new MigrationPreflightError(
        "Production schema_migrations is missing; do not run migration 0009.",
      );
    }

    const appliedResult = await client.query<{ filename: string }>(
      "select filename from public.schema_migrations order by filename",
    );
    const appliedFilenames = appliedResult.rows.map((row) => row.filename);
    if (!listsMatch(appliedFilenames, EXPECTED_APPLIED_MIGRATIONS)) {
      throw new MigrationPreflightError(
        "Production migration state is not exactly 0001 through 0008; do not run migration 0009.",
      );
    }

    const pending = selectPendingMigrations({
      filenames: await readdir(migrationsDir),
      appliedFilenames: new Set(appliedFilenames),
      target: TARGET_MIGRATION,
    });
    if (!listsMatch(pending, [TARGET_MIGRATION])) {
      throw new MigrationPreflightError(
        "Targeting 0009 would not apply exactly one migration; do not run the migration command.",
      );
    }
  });

  console.log(`Migration plan verified: only ${TARGET_MIGRATION} is pending through the target.`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof MigrationPreflightError || error instanceof DatabaseMigrationTransportError) {
      console.error(error.message);
    } else {
      console.error("The read-only 0009 migration preflight failed without exposing connection details.");
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabasePool().catch(() => undefined);
  });
