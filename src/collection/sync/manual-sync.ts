import { enqueueSyncRun } from "@/collection/sync/engine";

export async function runManualSync(sourceId: string) {
  return enqueueSyncRun({ sourceId, trigger: "manual" });
}
