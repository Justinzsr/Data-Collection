import { runDueSources } from "@/collection/sync/engine";

export async function runScheduledSync() {
  return runDueSources("cron");
}
