import { randomUUID } from "node:crypto";
import type { SourceLock } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export async function acquireSourceLock(sourceId: string, syncRunId: string, leaseMs = 5 * 60_000): Promise<SourceLock | null> {
  const store = getDemoStore();
  const now = new Date();
  const existing = store.sourceLocks.find((lock) => lock.source_id === sourceId);
  if (existing && new Date(existing.expires_at).getTime() > now.getTime()) {
    return null;
  }
  const lock: SourceLock = {
    source_id: sourceId,
    locked_by_sync_run_id: syncRunId,
    lock_key: randomUUID(),
    acquired_at: now.toISOString(),
    expires_at: new Date(now.getTime() + leaseMs).toISOString(),
    created_at: existing?.created_at ?? now.toISOString(),
    updated_at: now.toISOString(),
  };
  if (existing) Object.assign(existing, lock);
  else store.sourceLocks.push(lock);
  return lock;
}

export async function releaseSourceLock(sourceId: string, syncRunId: string): Promise<void> {
  const store = getDemoStore();
  store.sourceLocks = store.sourceLocks.filter(
    (lock) => !(lock.source_id === sourceId && lock.locked_by_sync_run_id === syncRunId),
  );
}
