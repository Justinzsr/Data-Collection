import { randomUUID } from "node:crypto";
import type { JsonRecord, Source, SourceStatus, SourceTypeKey, SyncMode } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export interface CreateSourceInput {
  source_type_key: SourceTypeKey;
  display_name: string;
  input_url?: string | null;
  normalized_url?: string | null;
  external_account_id?: string | null;
  account_name?: string | null;
  status?: SourceStatus;
  sync_mode?: SyncMode;
  sync_frequency_minutes?: number;
  supports_webhook?: boolean;
  metadata?: JsonRecord;
}

export async function listSources(): Promise<Source[]> {
  return [...getDemoStore().sources].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export async function getSource(sourceId: string): Promise<Source | null> {
  return getDemoStore().sources.find((source) => source.id === sourceId) ?? null;
}

export async function createSource(input: CreateSourceInput): Promise<Source> {
  const now = new Date().toISOString();
  const metadata: JsonRecord = {
    demo: true,
    ...input.metadata,
  };
  if (input.source_type_key === "website") {
    metadata.public_tracking_key = `mq_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  }
  const source: Source = {
    id: randomUUID(),
    source_type_key: input.source_type_key,
    display_name: input.display_name,
    input_url: input.input_url ?? null,
    normalized_url: input.normalized_url ?? null,
    external_account_id: input.external_account_id ?? null,
    account_name: input.account_name ?? null,
    status: input.status ?? "needs_credentials",
    sync_mode: input.sync_mode ?? "hybrid",
    sync_frequency_minutes: input.sync_frequency_minutes ?? 60,
    supports_webhook: input.supports_webhook ?? false,
    webhook_url: input.supports_webhook ? `/api/webhooks/${input.source_type_key}/pending` : null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    next_sync_at: new Date(Date.now() + (input.sync_frequency_minutes ?? 60) * 60_000).toISOString(),
    metadata,
    created_at: now,
    updated_at: now,
  };
  if (source.supports_webhook) {
    source.webhook_url = `/api/webhooks/${source.source_type_key === "supabase" ? "supabase" : source.source_type_key}/${source.id}`;
  }
  getDemoStore().sources.unshift(source);
  return source;
}

export async function updateSource(sourceId: string, patch: Partial<Source>): Promise<Source | null> {
  const store = getDemoStore();
  const index = store.sources.findIndex((source) => source.id === sourceId);
  if (index < 0) return null;
  store.sources[index] = { ...store.sources[index], ...patch, id: sourceId, updated_at: new Date().toISOString() };
  return store.sources[index];
}

export async function deleteSource(sourceId: string): Promise<boolean> {
  const store = getDemoStore();
  const before = store.sources.length;
  store.sources = store.sources.filter((source) => source.id !== sourceId);
  return store.sources.length !== before;
}

export async function listDueSources(now = new Date()): Promise<Source[]> {
  return (await listSources()).filter((source) => {
    if (source.status === "disabled") return false;
    if (source.sync_mode === "manual" || source.sync_mode === "webhook") return false;
    if (!source.next_sync_at) return true;
    return new Date(source.next_sync_at).getTime() <= now.getTime();
  });
}

export async function markSourceSyncState(
  sourceId: string,
  trigger: "manual" | "cron" | "webhook" | "initial" | "retry",
  state: { ok: boolean; error?: string | null },
): Promise<void> {
  const source = await getSource(sourceId);
  if (!source) return;
  const now = new Date();
  const patch: Partial<Source> = {
    updated_at: now.toISOString(),
    next_sync_at: new Date(now.getTime() + source.sync_frequency_minutes * 60_000).toISOString(),
  };
  if (trigger === "manual") patch.last_manual_sync_at = now.toISOString();
  if (trigger === "cron") patch.last_cron_sync_at = now.toISOString();
  if (trigger === "webhook") patch.last_webhook_sync_at = now.toISOString();
  if (state.ok) {
    patch.last_success_at = now.toISOString();
    patch.last_error = null;
    patch.status = source.status === "demo" ? "demo" : "healthy";
  } else {
    patch.last_error_at = now.toISOString();
    patch.last_error = state.error ?? "Sync failed.";
    patch.status = "error";
  }
  await updateSource(sourceId, patch);
}
