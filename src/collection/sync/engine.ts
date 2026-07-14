import {
  getConnector,
  getCredentialSetupBlockReason,
  getSourceOperationBlockReason,
} from "@/collection/connectors/registry";
import { ingestWebsiteEvent } from "@/collection/tracking/website-event-ingestion";
import {
  acquireSourceLock,
  releaseSourceLock,
  renewSourceLock,
  SOURCE_LOCK_RENEW_INTERVAL_MS,
} from "@/collection/sync/locks";
import { isRuntimeDatabaseConfigured } from "@/storage/db/client";
import type { SyncRun, SyncTrigger } from "@/storage/db/schema";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { upsertContentMetrics } from "@/storage/repositories/content-repository";
import { upsertMetrics } from "@/storage/repositories/metrics-repository";
import { recordChangeEventsForRawPayloads } from "@/storage/repositories/platform-change-events-repository";
import { storeRawPayloads } from "@/storage/repositories/raw-ingestions-repository";
import { getSource, listDueSources, markSourceSyncState } from "@/storage/repositories/sources-repository";
import { createOrGetSyncRun, updateSyncRun } from "@/storage/repositories/sync-runs-repository";

export interface EnqueueSyncRunInput {
  sourceId: string;
  trigger: SyncTrigger;
  idempotencyKey?: string;
  webhookPayload?: import("@/storage/db/schema").JsonRecord | null;
}

function defaultIdempotencyKey(sourceId: string, trigger: SyncTrigger) {
  if (trigger !== "cron") return null;
  return `${sourceId}:${trigger}:${new Date().toISOString().slice(0, 13)}`;
}

export async function enqueueSyncRun(input: EnqueueSyncRunInput): Promise<SyncRun> {
  const source = await getSource(input.sourceId);
  if (!source) {
    const { run, created } = await createOrGetSyncRun({
      source_id: input.sourceId,
      source_type_key: null,
      trigger: input.trigger,
      idempotency_key: input.idempotencyKey ?? null,
    });
    if (!created) return run;
    await updateSyncRun(run.id, {
      status: "error",
      error_message: "Source not found.",
      finished_at: new Date().toISOString(),
    });
    return { ...run, status: "error", error_message: "Source not found.", finished_at: new Date().toISOString() };
  }

  const { run, created } = await createOrGetSyncRun({
    source_id: source.id,
    source_type_key: source.source_type_key,
    trigger: input.trigger,
    idempotency_key: input.idempotencyKey ?? defaultIdempotencyKey(source.id, input.trigger),
    metadata: { demoMode: !isRuntimeDatabaseConfigured() },
  });
  if (!created) return run;

  const blocked = getSourceOperationBlockReason(source);
  if (blocked) {
    const finishedAt = new Date().toISOString();
    const skipped = await updateSyncRun(run.id, {
      status: "skipped",
      started_at: finishedAt,
      finished_at: finishedAt,
      duration_ms: 0,
      error_message: blocked,
    });
    return skipped ?? {
      ...run,
      status: "skipped",
      started_at: finishedAt,
      finished_at: finishedAt,
      duration_ms: 0,
      error_message: blocked,
    };
  }

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

  let renewalInFlight: Promise<void> | null = null;
  let renewalFailure: Error | null = null;
  const renewLease = () => {
    if (renewalInFlight || renewalFailure) return;
    renewalInFlight = renewSourceLock(source.id, run.id, lock.lock_key)
      .then((renewedLock) => {
        if (!renewedLock) {
          renewalFailure = new Error("Source lock lease was lost during sync.");
        }
      })
      .catch((error: unknown) => {
        renewalFailure = error instanceof Error ? error : new Error("Source lock lease renewal failed.");
      })
      .finally(() => {
        renewalInFlight = null;
      });
  };
  const renewalTimer = setInterval(renewLease, SOURCE_LOCK_RENEW_INTERVAL_MS);
  renewalTimer.unref?.();

  const assertLockLease = () => {
    if (renewalFailure) throw renewalFailure;
  };

  try {
    await updateSyncRun(run.id, { status: "running", started_at: startedAt.toISOString(), lock_key: lock.lock_key });
    const connector = getConnector(source.source_type_key);
    const credentials = await getDecryptedCredentialMap(source.id);
    const credentialBlockReason = getCredentialSetupBlockReason(
      connector,
      Object.entries(credentials).filter(([, value]) => value.trim()).map(([key]) => key),
    );
    if (credentialBlockReason) {
      const finishedAt = new Date();
      return (await updateSyncRun(run.id, {
        status: "skipped",
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        error_message: credentialBlockReason,
      })) as SyncRun;
    }
    const syncResult = await connector.sync({
      source,
      credentials,
      trigger: input.trigger,
      isDemoMode: source.status === "demo" || !isRuntimeDatabaseConfigured(),
      webhookPayload: input.webhookPayload ?? null,
    });
    assertLockLease();
    if (syncResult.skippedReason) {
      const finishedAt = new Date();
      return (await updateSyncRun(run.id, {
        status: "skipped",
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        error_message: syncResult.skippedReason,
        cursor_after: syncResult.cursorAfter ?? null,
      })) as SyncRun;
    }
    const raw = await storeRawPayloads(source, syncResult.rawPayloads);
    assertLockLease();
    await recordChangeEventsForRawPayloads(source, syncResult.rawPayloads);
    assertLockLease();
    let webEventsInserted = 0;
    for (const webEvent of syncResult.webEvents ?? []) {
      await ingestWebsiteEvent(webEvent);
      webEventsInserted += 1;
      assertLockLease();
    }
    const normalized = await connector.normalize(syncResult.rawPayloads, source);
    assertLockLease();
    const metrics = await upsertMetrics(normalized.metrics);
    assertLockLease();
    const content = await upsertContentMetrics(normalized.contentMetrics ?? []);
    assertLockLease();
    const finishedAt = new Date();

    await markSourceSyncState(source.id, input.trigger, { ok: true });
    assertLockLease();
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "sync_success",
      severity: "info",
      message: syncResult.message,
      metadata: { trigger: input.trigger, syncRunId: run.id },
    });
    assertLockLease();

    const completedRun = (await updateSyncRun(run.id, {
      status: "success",
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      records_fetched: syncResult.recordsFetched,
      records_inserted: raw.inserted + webEventsInserted + content.itemsUpserted + content.metricsUpserted + (syncResult.recordsInserted ?? 0),
      records_updated: syncResult.recordsUpdated ?? 0,
      metrics_upserted: metrics.upserted + content.metricsUpserted,
      cursor_after: syncResult.cursorAfter ?? null,
    })) as SyncRun;
    assertLockLease();
    return completedRun;
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
    clearInterval(renewalTimer);
    await renewalInFlight;
    await releaseSourceLock(source.id, run.id, lock.lock_key);
  }
}

export async function runDueSources(trigger: SyncTrigger = "cron", options: { dataSpaceId?: string } = {}) {
  const dueSources = await listDueSources(new Date(), { dataSpaceId: options.dataSpaceId });
  const runs: SyncRun[] = [];
  for (const source of dueSources) {
    runs.push(await enqueueSyncRun({ sourceId: source.id, trigger }));
  }
  return runs;
}
