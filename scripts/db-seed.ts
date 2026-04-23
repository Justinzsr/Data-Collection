import { resetDemoStore } from "../src/storage/repositories/demo-store";
import { getDatabasePool, isRuntimeDatabaseConfigured } from "../src/storage/db/client";
import { seedRuntimeCatalog } from "../src/storage/db/catalog";

if (!isRuntimeDatabaseConfigured()) {
  const store = resetDemoStore();
  console.log(`Seeded demo store: ${store.sources.length} sources, ${store.metricsDaily.length} daily metric rows.`);
  process.exit(0);
}

await seedRuntimeCatalog();
console.log("Seeded runtime catalog tables: source_types and metric_definitions.");
await getDatabasePool().end();
