import { resetDemoStore } from "../src/storage/repositories/demo-store";

const store = resetDemoStore();
console.log(`Seeded demo store: ${store.sources.length} sources, ${store.metricsDaily.length} daily metric rows.`);
