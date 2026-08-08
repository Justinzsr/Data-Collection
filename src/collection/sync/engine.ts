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
import { isRuntimeDatabaseConfigured, withDatabaseTransaction, type DatabaseExecutor } from "@/storage/db/client";
import type { SyncRun, SyncTrigger } from "@/storage/db/schema";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { upsertContentMetrics } from "@/storage/repositories/content-repository";
import { replaceCommerceOrdersWindow } from "@/storage/repositories/commerce-orders-repository";
import { replaceMetricsWindow, upsertMetrics } from "@/storage/repositories/metrics-repository";
import { recordChangeEventsForRawPayloads } from "@/storage/repositories/platform-change-events-repository";
import { storeRawPayloads } from "@/storage/repositories/raw-ingestions-repository";
import { getSource, listDueSources, markSourceSyncState } from "@/storage/repositories/sources-repository";
import { createOrGetSyncRun, updateSyncRun } from "@/storage/repositories/sync-runs-repository";
import { isShopifyCommerceFactsV2Enabled } from "@/storage/runtime/commerce-feature-flags";

export interface EnqueueSyncRunInput {
  sourceId: string;
  trigger: SyncTrigger;
  idempotencyKey?: string;
  webhookPayload?: import("@/storage/db/schema").JsonRecord | null;
}

export function assertCommerceFactsPersistenceGate(input: {
  sourceTypeKey: string;
  hasCommerceFacts: boolean;
  hasCommerceWindow: boolean;
  enabled?: boolean;
}) {
  const enabled = input.enabled ?? isShopifyCommerceFactsV2Enabled();
  if (!enabled && (input.hasCommerceFacts || input.hasCommerceWindow)) {
    throw new Error("Shopify commerce facts V2 are disabled for this release.");
  }
  if (
    input.hasCommerceFacts !== input.hasCommerceWindow
    || (input.hasCommerceFacts && input.sourceTypeKey !== "shopify")
  ) {
    throw new Error("Commerce facts require a Shopify-owned replacement window.");
  }
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
    const hasCommerceFacts = syncResult.commerceOrderFacts !== undefined;
    const hasCommerceWindow = syncResult.replaceCommerceOrderWindow !== undefined;
    assertCommerceFactsPersistenceGate({
      sourceTypeKey: source.source_type_key,
      hasCommerceFacts,
      hasCommerceWindow,
    });
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
    const webEvents = syncResult.webEvents ?? [];
    if (webEvents.length > 0 && webEvents.length !== syncResult.rawPayloads.length) {
      throw new Error("Connector web events must align one-to-one with raw payloads for idempotent ingestion.");
    }
    const validateMetricWindowOwnership = (
      normalized: Awaited<ReturnType<typeof connector.normalize>>,
    ) => {
      if (!normalized.replaceMetricWindow) return;
      const connectorMetricKeys = new Set(connector.getMetricDefinitions().map((definition) => definition.key));
      if (normalized.replaceMetricWindow.metricKeys.some((metricKey) => !connectorMetricKeys.has(metricKey))) {
        throw new Error("Connector requested replacement of a metric it does not own.");
      }
    };

    const persistRawAndWebEvents = async (executor?: DatabaseExecutor) => {
      if (webEvents.length === 0) {
        return {
          raw: await storeRawPayloads(source, syncResult.rawPayloads, executor),
          webEventsInserted: 0,
        };
      }
      const raw: Awaited<ReturnType<typeof storeRawPayloads>> = {
        inserted: 0,
        duplicates: 0,
        rows: [],
        insertedIndexes: [],
      };
      let webEventsInserted = 0;
      for (const [index, webEvent] of webEvents.entries()) {
        const persistPair = async (pairExecutor?: DatabaseExecutor) => {
          const stored = await storeRawPayloads(
            source,
            [syncResult.rawPayloads[index]],
            pairExecutor,
          );
          if (stored.inserted === 1) await ingestWebsiteEvent(webEvent, pairExecutor);
          return stored;
        };
        const stored = executor
          ? await persistPair(executor)
          : isRuntimeDatabaseConfigured()
            ? await withDatabaseTransaction((client) => persistPair(client))
            : await persistPair();
        raw.inserted += stored.inserted;
        raw.duplicates += stored.duplicates;
        raw.rows.push(...stored.rows);
        if (stored.inserted === 1) {
          raw.insertedIndexes.push(index);
          webEventsInserted += 1;
        }
        assertLockLease();
      }
      return { raw, webEventsInserted };
    };

    const persistNormalized = async (
      normalized: Awaited<ReturnType<typeof connector.normalize>>,
      executor?: DatabaseExecutor,
    ) => {
      const metrics = normalized.replaceMetricWindow
        ? await replaceMetricsWindow(
          normalized.metrics,
          {
            ...normalized.replaceMetricWindow,
            sourceId: source.id,
            sourceTypeKey: source.source_type_key,
          },
          {
            syncRunId: run.id,
            lockKey: lock.lock_key,
          },
          executor,
        )
        : await upsertMetrics(normalized.metrics, executor);
      assertLockLease();
      const content = await upsertContentMetrics(normalized.contentMetrics ?? [], executor);
      assertLockLease();
      const commerce = hasCommerceFacts && syncResult.replaceCommerceOrderWindow
        ? await replaceCommerceOrdersWindow(
          syncResult.commerceOrderFacts ?? [],
          {
            sourceId: source.id,
            ...syncResult.replaceCommerceOrderWindow,
          },
          {
            syncRunId: run.id,
            lockKey: lock.lock_key,
          },
          executor,
        )
        : { ordersInserted: 0, linesInserted: 0 };
      return { metrics, content, commerce };
    };

    let persistedRaw: Awaited<ReturnType<typeof persistRawAndWebEvents>>;
    let persistedNormalized: Awaited<ReturnType<typeof persistNormalized>>;
    if (hasCommerceFacts && isRuntimeDatabaseConfigured()) {
      const normalized = await connector.normalize(syncResult.rawPayloads, source);
      assertLockLease();
      validateMetricWindowOwnership(normalized);
      const persisted = await withDatabaseTransaction(async (client) => {
        const raw = await persistRawAndWebEvents(client);
        assertLockLease();
        await recordChangeEventsForRawPayloads(source, syncResult.rawPayloads, client);
        assertLockLease();
        const normalizedData = await persistNormalized(normalized, client);
        assertLockLease();
        return { raw, normalizedData };
      });
      persistedRaw = persisted.raw;
      persistedNormalized = persisted.normalizedData;
    } else {
      persistedRaw = await persistRawAndWebEvents();
      assertLockLease();
      await recordChangeEventsForRawPayloads(source, syncResult.rawPayloads);
      assertLockLease();
      const normalized = await connector.normalize(syncResult.rawPayloads, source);
      assertLockLease();
      validateMetricWindowOwnership(normalized);
      persistedNormalized = await persistNormalized(normalized);
    }
    assertLockLease();
    const { raw, webEventsInserted } = persistedRaw;
    const { metrics, content, commerce } = persistedNormalized;
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
      records_inserted: raw.inserted + webEventsInserted + content.itemsInserted + (syncResult.recordsInserted ?? 0),
      records_updated:
        content.itemsUpdated
        + commerce.ordersInserted
        + commerce.linesInserted
        + (syncResult.recordsUpdated ?? 0),
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
