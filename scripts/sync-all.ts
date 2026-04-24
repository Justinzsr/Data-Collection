import "./load-env";
import { runDueSources } from "../src/collection/sync/engine";

async function main() {
  const runs = await runDueSources("manual");
  console.log(`Created ${runs.length} sync run(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
