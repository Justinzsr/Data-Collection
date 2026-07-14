import { randomUUID } from "node:crypto";
import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import { buildUpdateClause } from "@/storage/db/sql";
import type { JsonRecord, SourceTypeKey, SyncRun, SyncRunStatus, SyncTrigger } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listSources } from "@/storage/repositories/sources-repository";

export interface CreateSyncRunInput {
  source_id: string | null;
  source_type_key: SourceTypeKey | null;
  trigger: SyncTrigger;
  idempotency_key?: string | null;
  metadata?: JsonRecord;
}

export interface CreateSyncRunResult {
  run: SyncRun;
  created: boolean;
}

function assertIdempotentRunMatches(existing: SyncRun, input: CreateSyncRunInput) {
  if (existing.source_id !== input.source_id || existing.trigger !== input.trigger) {
    throw new Error("Sync run idempotency key is already assigned to a different source or trigger.");
  }
}

export async function createOrGetSyncRun(input: CreateSyncRunInput): Promise<CreateSyncRunResult> {
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

  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const existing = run.idempotency_key
      ? store.syncRuns.find((item) => item.idempotency_key === run.idempotency_key)
      : null;
    if (existing) {
      assertIdempotentRunMatches(existing, input);
      return { run: existing, created: false };
    }
    store.syncRuns.unshift(run);
    return { run, created: true };
  }

  const rows = await queryRows<SyncRun>(
    `
      insert into sync_runs (
        id,
        source_id,
        source_type_key,
        trigger,
        status,
        idempotency_key,
        lock_key,
        started_at,
        finished_at,
        duration_ms,
        records_fetched,
        records_inserted,
        records_updated,
        metrics_upserted,
        error_message,
        error_stack,
        cursor_before,
        cursor_after,
        metadata,
        created_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20
      )
      on conflict (idempotency_key) do nothing
      returning *
    `,
    [
      run.id,
      run.source_id,
      run.source_type_key,
      run.trigger,
      run.status,
      run.idempotency_key,
      run.lock_key,
      run.started_at,
      run.finished_at,
      run.duration_ms,
      run.records_fetched,
      run.records_inserted,
      run.records_updated,
      run.metrics_upserted,
      run.error_message,
      run.error_stack,
      run.cursor_before ? JSON.stringify(run.cursor_before) : null,
      run.cursor_after ? JSON.stringify(run.cursor_after) : null,
      JSON.stringify(run.metadata),
      run.created_at,
    ],
  );
  if (rows[0]) return { run: rows[0], created: true };
  if (!run.idempotency_key) {
    throw new Error("Could not create sync run.");
  }
  const existingRows = await queryRows<SyncRun>(
    "select * from sync_runs where idempotency_key = $1 limit 1",
    [run.idempotency_key],
  );
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Could not resolve the existing idempotent sync run.");
  }
  assertIdempotentRunMatches(existing, input);
  return { run: existing, created: false };
}

export async function createSyncRun(input: CreateSyncRunInput): Promise<SyncRun> {
  return (await createOrGetSyncRun(input)).run;
}

export async function updateSyncRun(syncRunId: string, patch: Partial<SyncRun>): Promise<SyncRun | null> {
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const run = store.syncRuns.find((item) => item.id === syncRunId);
    if (!run) return null;
    Object.assign(run, patch);
    return run;
  }

  const nextPatch = {
    ...patch,
    cursor_before: patch.cursor_before ? JSON.stringify(patch.cursor_before) : patch.cursor_before,
    cursor_after: patch.cursor_after ? JSON.stringify(patch.cursor_after) : patch.cursor_after,
    metadata: patch.metadata ? JSON.stringify(patch.metadata) : patch.metadata,
  };
  const { clause, values } = buildUpdateClause(nextPatch, 2);
  if (!clause) return queryRows<SyncRun>("select * from sync_runs where id = $1 limit 1", [syncRunId]).then((rows) => rows[0] ?? null);
  const rows = await queryRows<SyncRun>(`update sync_runs set ${clause} where id = $1 returning *`, [syncRunId, ...values]);
  return rows[0] ?? null;
}

export async function listSyncRuns(limit = 50, status?: SyncRunStatus, options: { dataSpaceId?: string } = {}): Promise<SyncRun[]> {
  if (!isRuntimeDatabaseConfigured()) {
    const sourceIds = options.dataSpaceId
      ? new Set((await listSources({ dataSpaceId: options.dataSpaceId })).map((source) => source.id))
      : null;
    return getDemoStore().syncRuns
      .filter((run) => (sourceIds ? Boolean(run.source_id && sourceIds.has(run.source_id)) : true))
      .filter((run) => (status ? run.status === status : true))
      .slice(0, limit);
  }
  const join = options.dataSpaceId ? "join sources s on s.id = r.source_id" : "";
  const where: string[] = [];
  const values: unknown[] = [];
  if (status) {
    values.push(status);
    where.push(`r.status = $${values.length}`);
  }
  if (options.dataSpaceId) {
    values.push(options.dataSpaceId);
    where.push(`s.data_space_id = $${values.length}`);
  }
  values.push(limit);
  return queryRows<SyncRun>(
    `
      select r.*
      from sync_runs r
      ${join}
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by r.created_at desc
      limit $${values.length}
    `,
    values,
  );
}
