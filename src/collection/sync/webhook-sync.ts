import { enqueueSyncRun } from "@/collection/sync/engine";

export async function runWebhookSync(sourceId: string) {
  return enqueueSyncRun({ sourceId, trigger: "webhook" });
}
