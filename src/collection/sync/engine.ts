import { getConnector } from "@/collection/connectors/registry";
import { acquireSourceLock, releaseSourceLock } from "@/collection/sync/locks";
import type { SyncRun, SyncTrigger } from "@/storage/db/schema";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { upsertMetrics } from "@/storage/repositories/metrics-repository";
import { storeRawPayloads } from "@/storage/repositories/raw-ingestions-repository";
import { getSource, listDueSources, markSourceSyncState } from "@/storage/repositories/sources-repository";
import { createSyncRun, updateSyncRun } from "@/storage/repositories/sync-runs-repository";

export interface EnqueueSyncRunInput {
  sourceId: string;
  trigger: SyncTrigger;
  idempotencyKey?: string;
}

export async function enqueueSyncRun(input: EnqueueSyncRunInput): Promise<SyncRun> {
  const source = await getSource(input.sourceId);
  if (!source) {
    const run = await createSyncRun({
      source_id: input.sourceId,
      source_type_key: null,
      trigger: input.trigger,
      idempotency_key: input.idempotencyKey ?? null,
    });
    await updateSyncRun(run.id, {
      status: "error",
      error_message: "Source not found.",
      finished_at: new Date().toISOString(),
    });
    return { ...run, status: "error", error_message: "Source not found.", finished_at: new Date().toISOString() };
  }

  const run = await createSyncRun({
    source_id: source.id,
    source_type_key: source.source_type_key,
    trigger: input.trigger,
    idempotency_key: input.idempotencyKey ?? `${source.id}:${input.trigger}:${new Date().toISOString().slice(0, 13)}`,
    metadata: { demoMode: !process.env.DATABASE_URL },
  });

  const startedAt = new Date();
  const lock = await acquireSourceLock(source.id, run.id);
  if (!lock) {
    await updateSyncRun(run.id, {
      status: "skipped",
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      error_message: "Source is already locked by another sync run.",
    });
    return (await updateSyncRun(run.id, {})) ?? run;
  }

  await updateSyncRun(run.id, { status: "running", started_at: startedAt.toISOString(), lock_key: lock.lock_key });

  try {
    const connector = getConnector(source.source_type_key);
    const credentials = await getDecryptedCredentialMap(source.id);
    const syncResult = await connector.sync({
      source,
      credentials,
      trigger: input.trigger,
      isDemoMode: source.status === "demo" || !process.env.DATABASE_URL,
    });
    const raw = await storeRawPayloads(source, syncResult.rawPayloads);
    const normalized = await connector.normalize(syncResult.rawPayloads, source);
    const metrics = await upsertMetrics(normalized.metrics);
    const finishedAt = new Date();

    await markSourceSyncState(source.id, input.trigger, { ok: true });
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "sync_success",
      severity: "info",
      message: syncResult.message,
      metadata: { trigger: input.trigger, syncRunId: run.id },
    });

    return (await updateSyncRun(run.id, {
      status: "success",
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      records_fetched: syncResult.recordsFetched,
      records_inserted: raw.inserted + (syncResult.recordsInserted ?? 0),
      records_updated: syncResult.recordsUpdated ?? 0,
      metrics_upserted: metrics.upserted,
      cursor_after: syncResult.cursorAfter ?? null,
    })) as SyncRun;
  } catch (error) {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : "Unknown sync failure.";
    await markSourceSyncState(source.id, input.trigger, { ok: false, error: message });
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "sync_error",
      severity: "error",
      message,
      metadata: { trigger: input.trigger, syncRunId: run.id },
    });
    return (await updateSyncRun(run.id, {
      status: "error",
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      error_message: message,
      error_stack: error instanceof Error ? error.stack ?? null : null,
    })) as SyncRun;
  } finally {
    await releaseSourceLock(source.id, run.id);
  }
}

export async function runDueSources(trigger: SyncTrigger = "cron") {
  const dueSources = await listDueSources();
  const runs: SyncRun[] = [];
  for (const source of dueSources) {
    runs.push(await enqueueSyncRun({ sourceId: source.id, trigger }));
  }
  return runs;
}
