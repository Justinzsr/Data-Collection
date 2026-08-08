import { createHash, randomUUID } from "node:crypto";
import type { RawPayload } from "@/collection/connectors/types";
import { isRuntimeDatabaseConfigured, queryRows, type DatabaseExecutor } from "@/storage/db/client";
import type { JsonRecord, JsonValue, PlatformChangeEvent, PlatformChangeType, Source } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listSources } from "@/storage/repositories/sources-repository";
import { formatAppDateTime } from "@/storage/runtime/app-time";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function stablePayloadHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function emailHash(value: unknown) {
  return typeof value === "string" && value ? stablePayloadHash(value).slice(0, 24) : null;
}

function sanitizeSupabaseUser(payload: JsonRecord): JsonRecord {
  return {
    id: typeof payload.id === "string" ? payload.id : null,
    email_hash: emailHash(payload.email),
    created_at: typeof payload.created_at === "string" ? payload.created_at : null,
    confirmed_at: typeof payload.confirmed_at === "string" ? payload.confirmed_at : null,
    email_confirmed_at: typeof payload.email_confirmed_at === "string" ? payload.email_confirmed_at : null,
    provider: typeof payload.provider === "string" ? payload.provider : isRecord(payload.app_metadata) && typeof payload.app_metadata.provider === "string" ? payload.app_metadata.provider : "email",
  };
}

export function getExternalRecordId(sourceTypeKey: Source["source_type_key"], payload: JsonRecord, fallback?: string | null): string {
  if (sourceTypeKey === "supabase" && typeof payload.id === "string") return payload.id;
  if (sourceTypeKey === "vercel_web_analytics_drain") return [payload.eventType ?? payload.eventName ?? "event", payload.timestamp ?? "unknown-time", payload.deviceId ?? "unknown-device", payload.sessionId ?? "unknown-session", payload.path ?? "/"].join(":");
  if (typeof payload.id === "string") return payload.id;
  return fallback ?? stablePayloadHash(payload);
}

export function detectChangedFields(previousPayload: unknown, newPayload: unknown): string[] {
  if (!isRecord(previousPayload) || !isRecord(newPayload)) return stablePayloadHash(previousPayload) === stablePayloadHash(newPayload) ? [] : ["payload"];
  return [...new Set([...Object.keys(previousPayload), ...Object.keys(newPayload)])].filter((key) => stablePayloadHash(previousPayload[key]) !== stablePayloadHash(newPayload[key])).sort();
}

async function latestChange(
  sourceId: string | null,
  platformRecordType: string,
  externalRecordId: string,
  executor?: DatabaseExecutor,
) {
  if (!isRuntimeDatabaseConfigured()) {
    return getDemoStore().platformChangeEvents
      .filter((event) => event.source_id === sourceId && event.platform_record_type === platformRecordType && event.external_record_id === externalRecordId)
      .sort((a, b) => `${a.changed_at}:${a.created_at}`.localeCompare(`${b.changed_at}:${b.created_at}`))
      .at(-1) ?? null;
  }
  return (await queryRows<PlatformChangeEvent>("select * from platform_change_events where source_id is not distinct from $1 and platform_record_type = $2 and external_record_id = $3 order by changed_at desc, created_at desc limit 1", [sourceId, platformRecordType, externalRecordId], executor))[0] ?? null;
}

export async function recordPlatformChangeEvent(input: {
  sourceId: string | null;
  sourceTypeKey: Source["source_type_key"];
  platformRecordType: string;
  externalRecordId: string;
  changeType?: PlatformChangeType;
  changedAt: string;
  payload: JsonRecord;
}, executor?: DatabaseExecutor) {
  const previous = await latestChange(
    input.sourceId,
    input.platformRecordType,
    input.externalRecordId,
    executor,
  );
  const newHash = stablePayloadHash(input.payload);
  if (previous?.new_hash === newHash) return { inserted: false, event: previous };
  const event: PlatformChangeEvent = {
    id: randomUUID(),
    source_id: input.sourceId,
    source_type_key: input.sourceTypeKey,
    platform_record_type: input.platformRecordType,
    external_record_id: input.externalRecordId,
    change_type: input.changeType ?? (previous ? "updated" : "inserted"),
    changed_at: input.changedAt,
    changed_at_pt: formatAppDateTime(input.changedAt),
    previous_hash: previous?.new_hash ?? null,
    new_hash: newHash,
    changed_fields: detectChangedFields(previous?.payload ?? {}, input.payload) as JsonValue[],
    payload: input.payload,
    created_at: new Date().toISOString(),
  };
  if (!isRuntimeDatabaseConfigured()) {
    const duplicate = getDemoStore().platformChangeEvents.find((item) => item.source_id === event.source_id && item.platform_record_type === event.platform_record_type && item.external_record_id === event.external_record_id && item.new_hash === event.new_hash);
    if (duplicate) return { inserted: false, event: duplicate };
    getDemoStore().platformChangeEvents.unshift(event);
    return { inserted: true, event };
  }
  const rows = await queryRows<PlatformChangeEvent>("insert into platform_change_events (id, source_id, source_type_key, platform_record_type, external_record_id, change_type, changed_at, changed_at_pt, previous_hash, new_hash, changed_fields, payload, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13) on conflict do nothing returning *", [event.id, event.source_id, event.source_type_key, event.platform_record_type, event.external_record_id, event.change_type, event.changed_at, event.changed_at_pt, event.previous_hash, event.new_hash, JSON.stringify(event.changed_fields), JSON.stringify(event.payload), event.created_at], executor);
  return { inserted: Boolean(rows[0]), event: rows[0] ?? previous };
}

function supabaseUsers(rawPayload: RawPayload) {
  return Array.isArray(rawPayload.payload.users) ? rawPayload.payload.users.filter(isRecord) : [];
}

function confirmedCount(users: JsonRecord[]) {
  return users.filter((user) => Boolean(user.confirmed_at || user.email_confirmed_at)).length;
}

export async function recordChangeEventsForRawPayloads(
  source: Source,
  rawPayloads: RawPayload[],
  executor?: DatabaseExecutor,
) {
  let inserted = 0;
  for (const rawPayload of rawPayloads) {
    if (source.source_type_key === "supabase") {
      const users = supabaseUsers(rawPayload);
      for (const user of users) {
        const result = await recordPlatformChangeEvent({ sourceId: source.id, sourceTypeKey: source.source_type_key, platformRecordType: "auth_user", externalRecordId: getExternalRecordId(source.source_type_key, user, rawPayload.externalId), changedAt: rawPayload.fetchedAt, payload: sanitizeSupabaseUser(user) }, executor);
        if (result.inserted) inserted += 1;
      }
      if (users.length > 0) {
        const result = await recordPlatformChangeEvent({ sourceId: source.id, sourceTypeKey: source.source_type_key, platformRecordType: "auth_snapshot", externalRecordId: "users_total_confirmed_users", changeType: "snapshot", changedAt: rawPayload.fetchedAt, payload: { users_total: users.length, confirmed_users: confirmedCount(users) } }, executor);
        if (result.inserted) inserted += 1;
      }
    } else if (source.source_type_key === "vercel_web_analytics_drain" && isRecord(rawPayload.payload)) {
      const result = await recordPlatformChangeEvent({ sourceId: source.id, sourceTypeKey: source.source_type_key, platformRecordType: "vercel_analytics_event", externalRecordId: getExternalRecordId(source.source_type_key, rawPayload.payload, rawPayload.externalId), changeType: "event", changedAt: typeof rawPayload.payload.timestamp === "number" ? new Date(rawPayload.payload.timestamp).toISOString() : rawPayload.fetchedAt, payload: rawPayload.payload }, executor);
      if (result.inserted) inserted += 1;
    } else if (source.source_type_key === "instagram" && isRecord(rawPayload.payload) && isRecord(rawPayload.payload.account)) {
      const account = rawPayload.payload.account;
      const accountResult = await recordPlatformChangeEvent({
        sourceId: source.id,
        sourceTypeKey: source.source_type_key,
        platformRecordType: "instagram_account",
        externalRecordId: typeof account.id === "string" ? account.id : rawPayload.externalId ?? source.id,
        changeType: "snapshot",
        changedAt: rawPayload.fetchedAt,
        payload: {
          id: typeof account.id === "string" ? account.id : null,
          username: typeof account.username === "string" ? account.username : null,
          followers_count: typeof account.followers_count === "number" ? account.followers_count : null,
          media_count: typeof account.media_count === "number" ? account.media_count : null,
        },
      }, executor);
      if (accountResult.inserted) inserted += 1;
      const media = Array.isArray(rawPayload.payload.media) ? rawPayload.payload.media.filter(isRecord) : [];
      for (const item of media) {
        const mediaResult = await recordPlatformChangeEvent({
          sourceId: source.id,
          sourceTypeKey: source.source_type_key,
          platformRecordType: "instagram_media",
          externalRecordId: typeof item.id === "string" ? item.id : rawPayload.externalId ?? stablePayloadHash(item),
          changeType: "snapshot",
          changedAt: typeof item.timestamp === "string" ? item.timestamp : rawPayload.fetchedAt,
          payload: {
            id: typeof item.id === "string" ? item.id : null,
            media_type: typeof item.media_type === "string" ? item.media_type : null,
            permalink: typeof item.permalink === "string" ? item.permalink : null,
            timestamp: typeof item.timestamp === "string" ? item.timestamp : null,
            like_count: typeof item.like_count === "number" ? item.like_count : null,
            comments_count: typeof item.comments_count === "number" ? item.comments_count : null,
            insights: isRecord(item.insights) ? item.insights : {},
          },
        }, executor);
        if (mediaResult.inserted) inserted += 1;
      }
    }
  }
  return { inserted };
}

export async function listPlatformChangeEvents(options: {
  dataSpaceId?: string;
  limit?: number;
  sourceId?: string;
} = {}) {
  const limit = options.limit ?? 100;
  if (!isRuntimeDatabaseConfigured()) {
    const sourceIds = options.dataSpaceId
      ? new Set((await listSources({ dataSpaceId: options.dataSpaceId })).map((source) => source.id))
      : null;
    return getDemoStore().platformChangeEvents
      .filter((event) => (sourceIds ? Boolean(event.source_id && sourceIds.has(event.source_id)) : true))
      .filter((event) => (options.sourceId ? event.source_id === options.sourceId : true))
      .slice(0, limit);
  }
  const where: string[] = [];
  const values: unknown[] = [];
  const join = options.dataSpaceId ? "join sources s on s.id = e.source_id" : "";
  if (options.dataSpaceId) {
    values.push(options.dataSpaceId);
    where.push(`s.data_space_id = $${values.length}`);
  }
  if (options.sourceId) {
    values.push(options.sourceId);
    where.push(`e.source_id = $${values.length}`);
  }
  values.push(limit);
  return queryRows<PlatformChangeEvent>(
    `
      select e.*
      from platform_change_events e
      ${join}
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by e.changed_at desc, e.created_at desc
      limit $${values.length}
    `,
    values,
  );
}
