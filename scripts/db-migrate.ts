import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env";
import {
  getDatabasePool,
  isRuntimeDatabaseConfigured,
  withDatabaseTransaction,
} from "../src/storage/db/client";
import { parseDatabaseMigrationArgs } from "./db-migrate-args";
import { selectPendingMigrations } from "./db-migration-plan";
import {
  assertSafeDatabaseMigrationTransport,
  DatabaseMigrationTransportError,
} from "./db-migration-safety";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../src/storage/db/migrations");

async function main() {
  const { target } = parseDatabaseMigrationArgs(process.argv.slice(2));
  if (!isRuntimeDatabaseConfigured()) {
    console.error("DATABASE_URL is required for pnpm db:migrate.");
    process.exit(1);
  }
  assertSafeDatabaseMigrationTransport({
    databaseUrl: process.env.DATABASE_URL!,
    sslMode: process.env.DATABASE_SSL_MODE,
    sslNoVerify: process.env.DATABASE_SSL_NO_VERIFY,
    sslCa: process.env.DATABASE_SSL_CA,
  });

  const appliedFilenames = await withDatabaseTransaction(async (client) => {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const filenames = await readdir(migrationsDir);

    const appliedRows = await client.query<{ filename: string }>(
      "select filename from schema_migrations"
    );
    const applied = new Set(appliedRows.rows.map((row) => row.filename));
    const pending = selectPendingMigrations({
      filenames,
      appliedFilenames: applied,
      target,
    });

    for (const filename of pending) {
      const sql = await readFile(path.join(migrationsDir, filename), "utf8");
      await client.query(sql);
      await client.query(
        "insert into schema_migrations (filename) values ($1)",
        [filename]
      );
    }
    return pending;
  });

  for (const filename of appliedFilenames) {
    console.log(`Applied migration ${filename}`);
  }

  await getDatabasePool().end();
}

main().catch(async (error: unknown) => {
  if (error instanceof DatabaseMigrationTransportError) {
    console.error(error.message);
  } else {
    console.error("Database migration failed without exposing connection details or row contents.");
  }
  try {
    await getDatabasePool().end();
  } catch {}
  process.exit(1);
});
