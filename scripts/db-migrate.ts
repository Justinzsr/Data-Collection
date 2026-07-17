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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../src/storage/db/migrations");

async function main() {
  const { target } = parseDatabaseMigrationArgs(process.argv.slice(2));
  if (!isRuntimeDatabaseConfigured()) {
    console.error("DATABASE_URL is required for pnpm db:migrate.");
    process.exit(1);
  }

  await withDatabaseTransaction(async (client) => {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const filenames = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    if (target !== null && !filenames.includes(target)) {
      throw new Error(`Unknown migration target: ${target}`);
    }

    const appliedRows = await client.query<{ filename: string }>(
      "select filename from schema_migrations"
    );
    const applied = new Set(appliedRows.rows.map((row) => row.filename));

    for (const filename of filenames) {
      if (target && filename > target) break;
      if (applied.has(filename)) continue;

      const sql = await readFile(path.join(migrationsDir, filename), "utf8");
      await client.query(sql);
      await client.query(
        "insert into schema_migrations (filename) values ($1)",
        [filename]
      );
      console.log(`Applied migration ${filename}`);
    }
  });

  await getDatabasePool().end();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await getDatabasePool().end();
  } catch {}
  process.exit(1);
});
