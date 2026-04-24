import { randomUUID } from "node:crypto";
import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { SourceLock } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export async function acquireSourceLock(sourceId: string, syncRunId: string, leaseMs = 5 * 60_000): Promise<SourceLock | null> {
  if (!isRuntimeDatabaseConfigured()) {
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

  const now = new Date();
  const lock = {
    source_id: sourceId,
    locked_by_sync_run_id: syncRunId,
    lock_key: randomUUID(),
    acquired_at: now.toISOString(),
    expires_at: new Date(now.getTime() + leaseMs).toISOString(),
    updated_at: now.toISOString(),
  };
  const rows = await queryRows<SourceLock>(
    `
      insert into source_locks (
        source_id,
        locked_by_sync_run_id,
        lock_key,
        acquired_at,
        expires_at,
        created_at,
        updated_at
      ) values (
        $1, $2, $3, $4, $5, $4, $6
      )
      on conflict (source_id) do update set
        locked_by_sync_run_id = excluded.locked_by_sync_run_id,
        lock_key = excluded.lock_key,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      where source_locks.expires_at <= excluded.acquired_at
      returning *
    `,
    [lock.source_id, lock.locked_by_sync_run_id, lock.lock_key, lock.acquired_at, lock.expires_at, lock.updated_at],
  );
  return rows[0] ?? null;
}

export async function releaseSourceLock(sourceId: string, syncRunId: string): Promise<void> {
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    store.sourceLocks = store.sourceLocks.filter(
      (lock) => !(lock.source_id === sourceId && lock.locked_by_sync_run_id === syncRunId),
    );
    return;
  }
  await queryRows(
    `
      delete from source_locks
      where source_id = $1 and locked_by_sync_run_id = $2
    `,
    [sourceId, syncRunId],
  );
}
