import { runDueSources } from "../src/collection/sync/engine";

const runs = await runDueSources("manual");
console.log(`Created ${runs.length} sync run(s).`);
