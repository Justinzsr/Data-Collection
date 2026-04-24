import { randomUUID } from "node:crypto";
import { listSourceTypes } from "@/collection/connectors/registry";
import { isRuntimeDatabaseConfigured, query, queryRows } from "@/storage/db/client";
import { buildUpdateClause } from "@/storage/db/sql";
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

async function ensureSourceTypeRow(sourceTypeKey: SourceTypeKey) {
  const sourceType = listSourceTypes().find((item) => item.key === sourceTypeKey);
  if (!sourceType) {
    throw new Error(`Unknown source type: ${sourceTypeKey}`);
  }
  await query(
    `
      insert into source_types (
        key,
        display_name,
        description,
        category,
        icon,
        url_patterns,
        required_fields,
        optional_fields,
        supported_metrics,
        auth_type,
        docs_url,
        enabled,
        created_at,
        updated_at
      ) values (
        $1, $2, $3, $4, $5,
        $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
        $10, $11, $12, $13, $14
      )
      on conflict (key) do update set
        display_name = excluded.display_name,
        description = excluded.description,
        category = excluded.category,
        icon = excluded.icon,
        url_patterns = excluded.url_patterns,
        required_fields = excluded.required_fields,
        optional_fields = excluded.optional_fields,
        supported_metrics = excluded.supported_metrics,
        auth_type = excluded.auth_type,
        docs_url = excluded.docs_url,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `,
    [
      sourceType.key,
      sourceType.display_name,
      sourceType.description,
      sourceType.category,
      sourceType.icon,
      JSON.stringify(sourceType.url_patterns),
      JSON.stringify(sourceType.required_fields),
      JSON.stringify(sourceType.optional_fields),
      JSON.stringify(sourceType.supported_metrics),
      sourceType.auth_type,
      sourceType.docs_url,
      sourceType.enabled,
      sourceType.created_at,
      sourceType.updated_at,
    ],
  );
}

export async function listSources(): Promise<Source[]> {
  if (!isRuntimeDatabaseConfigured()) {
    return [...getDemoStore().sources].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }
  return queryRows<Source>("select * from sources order by display_name asc");
}

export async function getSource(sourceId: string): Promise<Source | null> {
  if (!isRuntimeDatabaseConfigured()) {
    return getDemoStore().sources.find((source) => source.id === sourceId) ?? null;
  }
  const rows = await queryRows<Source>("select * from sources where id = $1 limit 1", [sourceId]);
  return rows[0] ?? null;
}

export async function createSource(input: CreateSourceInput): Promise<Source> {
  const now = new Date().toISOString();
  const metadata: JsonRecord = {
    demo: !isRuntimeDatabaseConfigured(),
    ...input.metadata,
  };
  const supportsWebhook = input.supports_webhook ?? false;
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
    supports_webhook: supportsWebhook,
    webhook_url: supportsWebhook ? `/api/webhooks/${input.source_type_key}/${input.source_type_key === "website" ? "pending" : "pending"}` : null,
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
  if (source.source_type_key === "website" && !source.metadata.public_tracking_key) {
    source.metadata.public_tracking_key = `mq_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  }
  if (source.supports_webhook) {
    source.webhook_url = `/api/webhooks/${
      source.source_type_key === "supabase"
        ? "supabase"
        : source.source_type_key === "vercel_web_analytics_drain"
          ? "vercel/analytics-drain"
          : source.source_type_key
    }/${source.id}`;
  }

  if (!isRuntimeDatabaseConfigured()) {
    getDemoStore().sources.unshift(source);
    return source;
  }

  await ensureSourceTypeRow(source.source_type_key);
  const rows = await queryRows<Source>(
    `
      insert into sources (
        id,
        source_type_key,
        display_name,
        input_url,
        normalized_url,
        external_account_id,
        account_name,
        status,
        sync_mode,
        sync_frequency_minutes,
        supports_webhook,
        webhook_url,
        webhook_secret_hint,
        last_manual_sync_at,
        last_cron_sync_at,
        last_webhook_sync_at,
        last_success_at,
        last_error_at,
        last_error,
        next_sync_at,
        metadata,
        created_at,
        updated_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23
      )
      returning *
    `,
    [
      source.id,
      source.source_type_key,
      source.display_name,
      source.input_url,
      source.normalized_url,
      source.external_account_id,
      source.account_name,
      source.status,
      source.sync_mode,
      source.sync_frequency_minutes,
      source.supports_webhook,
      source.webhook_url,
      source.webhook_secret_hint,
      source.last_manual_sync_at,
      source.last_cron_sync_at,
      source.last_webhook_sync_at,
      source.last_success_at,
      source.last_error_at,
      source.last_error,
      source.next_sync_at,
      JSON.stringify(source.metadata),
      source.created_at,
      source.updated_at,
    ],
  );
  return rows[0];
}

export async function updateSource(sourceId: string, patch: Partial<Source>): Promise<Source | null> {
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const index = store.sources.findIndex((source) => source.id === sourceId);
    if (index < 0) return null;
    store.sources[index] = { ...store.sources[index], ...patch, id: sourceId, updated_at: new Date().toISOString() };
    return store.sources[index];
  }

  const nextPatch = {
    ...patch,
    metadata: patch.metadata ? JSON.stringify(patch.metadata) : undefined,
    updated_at: new Date().toISOString(),
  };
  const { clause, values } = buildUpdateClause(nextPatch, 2);
  if (!clause) return getSource(sourceId);
  const rows = await queryRows<Source>(`update sources set ${clause} where id = $1 returning *`, [sourceId, ...values]);
  return rows[0] ?? null;
}

export async function deleteSource(sourceId: string): Promise<boolean> {
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const before = store.sources.length;
    store.sources = store.sources.filter((source) => source.id !== sourceId);
    return store.sources.length !== before;
  }
  const result = await query("delete from sources where id = $1", [sourceId]);
  return (result.rowCount ?? 0) > 0;
}

export async function listDueSources(now = new Date()): Promise<Source[]> {
  if (!isRuntimeDatabaseConfigured()) {
    return (await listSources()).filter((source) => {
      if (source.status === "disabled") return false;
      if (source.sync_mode === "manual" || source.sync_mode === "webhook") return false;
      if (!source.next_sync_at) return true;
      return new Date(source.next_sync_at).getTime() <= now.getTime();
    });
  }
  return queryRows<Source>(
    `
      select *
      from sources
      where status <> 'disabled'
        and sync_mode not in ('manual', 'webhook')
        and (next_sync_at is null or next_sync_at <= $1)
      order by coalesce(next_sync_at, created_at) asc
    `,
    [now.toISOString()],
  );
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
