import { randomUUID } from "node:crypto";
import type { JsonRecord, SourceTypeKey, SyncRun, SyncRunStatus, SyncTrigger } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export async function createSyncRun(input: {
  source_id: string | null;
  source_type_key: SourceTypeKey | null;
  trigger: SyncTrigger;
  idempotency_key?: string | null;
  metadata?: JsonRecord;
}): Promise<SyncRun> {
  const now = new Date().toISOString();
  const run: SyncRun = {
    id: randomUUID(),
    source_id: input.source_id,
    source_type_key: input.source_type_key,
    trigger: input.trigger,
    status: "queued",
    idempotency_key: input.idempotency_key ?? null,
    lock_key: null,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    records_fetched: 0,
    records_inserted: 0,
    records_updated: 0,
    metrics_upserted: 0,
    error_message: null,
    error_stack: null,
    cursor_before: null,
    cursor_after: null,
    metadata: input.metadata ?? {},
    created_at: now,
  };
  getDemoStore().syncRuns.unshift(run);
  return run;
}

export async function updateSyncRun(syncRunId: string, patch: Partial<SyncRun>): Promise<SyncRun | null> {
  const store = getDemoStore();
  const run = store.syncRuns.find((item) => item.id === syncRunId);
  if (!run) return null;
  Object.assign(run, patch);
  return run;
}

export async function listSyncRuns(limit = 50, status?: SyncRunStatus): Promise<SyncRun[]> {
  return getDemoStore().syncRuns
    .filter((run) => (status ? run.status === status : true))
    .slice(0, limit);
}
