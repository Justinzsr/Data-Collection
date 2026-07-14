import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { getDemoNow } from "@/storage/seed/demo-data";
import { endOfAppDateUtc, formatAppDateTime, getAppDateRange, startOfAppDateUtc, type AppDateRangeKey } from "@/storage/runtime/app-time";

export type ExplorerTab = "website" | "supabase" | "sync_runs" | "raw_ingestions" | "metrics_daily" | "connector_events" | "platform_change_events";
export type ExplorerRow = { id: string; cells: Record<string, string | number | null>; json: JsonRecord };
export type ExplorerResult = { tab: ExplorerTab; columns: string[]; rows: ExplorerRow[]; page: number; pageSize: number; hasNextPage: boolean };

const tabColumns: Record<ExplorerTab, string[]> = {
  website: ["occurred_at_pt", "event_name", "path", "referrer", "country", "device_type", "browser_client", "source_mode", "payload_hash"],
  supabase: ["date_pt", "metric_key", "metric_value", "provider", "users_total", "confirmed_users", "sync_run_id"],
  sync_runs: ["started_at_pt", "finished_at_pt", "source", "trigger", "status", "records_fetched", "metrics_upserted", "error_message"],
  raw_ingestions: ["fetched_at_pt", "source_type_key", "source", "external_id", "payload_hash", "payload_preview"],
  metrics_daily: ["date_pt", "source", "metric_key", "metric_value", "dimensions"],
  connector_events: ["created_at_pt", "source", "event_type", "severity", "message", "metadata_preview"],
  platform_change_events: ["changed_at_pt", "source", "platform_record_type", "external_record_id", "change_type", "changed_fields", "payload_preview"],
};

const sensitiveKeyPattern = /(secret|token|password|credential|authorization|service_role|encrypted_value|auth_tag|iv)/i;

export function redactSensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, sensitiveKeyPattern.test(key) ? "[redacted]" : redactSensitiveJson(nested)]));
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function preview(value: unknown) {
  const text = JSON.stringify(redactSensitiveJson(value));
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function sourceNames(sources: Source[]) {
  return new Map(sources.map((source) => [source.id, source.display_name]));
}

function selectedSource(sourceId?: string) {
  return sourceId && sourceId !== "all" ? sourceId : undefined;
}

function rangeFor(range: AppDateRangeKey, now?: Date) {
  return getAppDateRange(range, now);
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  return rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
}

async function dbRows(tab: ExplorerTab, options: { range: AppDateRangeKey; sourceId?: string; page: number; pageSize: number; dataSpaceId?: string }) {
  const range = rangeFor(options.range);
  const sourceId = selectedSource(options.sourceId);
  const offset = (options.page - 1) * options.pageSize;
  const values: unknown[] = [];
  const addDataSpaceFilter = (alias = "s") => {
    if (!options.dataSpaceId) return "";
    values.push(options.dataSpaceId);
    return `${alias}.data_space_id = $${values.length}`;
  };
  if (tab === "website") {
    values.push(startOfAppDateUtc(range.startDate), endOfAppDateUtc(range.endDate));
    const where = ["e.occurred_at >= $1", "e.occurred_at <= $2"];
    const spaceFilter = addDataSpaceFilter("s");
    if (spaceFilter) where.push(spaceFilter);
    if (sourceId) {
      values.push(sourceId);
      where.push(`e.source_id = $${values.length}`);
    }
    values.push(options.pageSize + 1, offset);
    return queryRows(`select e.id, to_char(timezone('America/Los_Angeles', e.occurred_at), 'Mon DD, YYYY HH12:MI AM "PT"') as occurred_at_pt, e.event_name, e.path, coalesce(e.referrer,'direct') as referrer, coalesce(e.country,'Unknown') as country, coalesce(e.device_type,'Unknown') as device_type, coalesce(e.user_agent, e.properties->'vercel'->>'client_name', 'Unknown') as browser_client, case when s.source_type_key='vercel_web_analytics_drain' then 'Vercel Drain' else 'Website Tracker' end as source_mode, null::text as payload_hash, e.properties as json from web_events e join sources s on s.id=e.source_id where ${where.join(" and ")} order by e.occurred_at desc limit $${values.length - 1} offset $${values.length}`, values);
  }
  if (tab === "supabase" || tab === "metrics_daily") {
    values.push(range.startDate, range.endDate);
    const where = ["m.date >= $1", "m.date <= $2"];
    if (tab === "supabase") where.push("m.source_type_key = 'supabase'");
    const spaceFilter = addDataSpaceFilter("s");
    if (spaceFilter) where.push(spaceFilter);
    if (sourceId) {
      values.push(sourceId);
      where.push(`m.source_id = $${values.length}`);
    }
    values.push(options.pageSize + 1, offset);
    return queryRows(`select m.id, m.date::text as date_pt, coalesce(s.display_name,m.source_type_key) as source, m.metric_key, m.metric_value, coalesce(m.dimensions->>'provider','') as provider, case when m.metric_key='users_total' then m.metric_value else null end as users_total, case when m.metric_key='confirmed_users' then m.metric_value else null end as confirmed_users, coalesce(m.dimensions->>'sync_run_id','') as sync_run_id, m.dimensions, m.dimensions as json from metrics_daily m join sources s on s.id=m.source_id where ${where.join(" and ")} order by m.date desc, m.source_type_key asc, m.metric_key asc limit $${values.length - 1} offset $${values.length}`, values);
  }
  if (tab === "sync_runs") {
    values.push(startOfAppDateUtc(range.startDate), endOfAppDateUtc(range.endDate));
    const where = ["coalesce(r.started_at,r.created_at) >= $1", "coalesce(r.started_at,r.created_at) <= $2"];
    const spaceFilter = addDataSpaceFilter("s");
    if (spaceFilter) where.push(spaceFilter);
    if (sourceId) {
      values.push(sourceId);
      where.push(`r.source_id = $${values.length}`);
    }
    values.push(options.pageSize + 1, offset);
    return queryRows(`select r.id, to_char(timezone('America/Los_Angeles', r.started_at), 'Mon DD, YYYY HH12:MI AM "PT"') as started_at_pt, to_char(timezone('America/Los_Angeles', r.finished_at), 'Mon DD, YYYY HH12:MI AM "PT"') as finished_at_pt, coalesce(s.display_name,r.source_type_key,'system') as source, r.trigger, r.status, r.records_fetched, r.metrics_upserted, coalesce(r.error_message,'') as error_message, r.metadata as json from sync_runs r join sources s on s.id=r.source_id where ${where.join(" and ")} order by r.created_at desc limit $${values.length - 1} offset $${values.length}`, values);
  }
  if (tab === "raw_ingestions") {
    values.push(startOfAppDateUtc(range.startDate), endOfAppDateUtc(range.endDate));
    const where = ["r.fetched_at >= $1", "r.fetched_at <= $2"];
    const spaceFilter = addDataSpaceFilter("s");
    if (spaceFilter) where.push(spaceFilter);
    if (sourceId) {
      values.push(sourceId);
      where.push(`r.source_id = $${values.length}`);
    }
    values.push(options.pageSize + 1, offset);
    return queryRows(`select r.id, to_char(timezone('America/Los_Angeles', r.fetched_at), 'Mon DD, YYYY HH12:MI AM "PT"') as fetched_at_pt, r.source_type_key, coalesce(s.display_name,r.source_type_key) as source, coalesce(r.external_id,'') as external_id, r.payload_hash, left(r.payload::text,180) as payload_preview, r.payload as json from raw_ingestions r join sources s on s.id=r.source_id where ${where.join(" and ")} order by r.fetched_at desc limit $${values.length - 1} offset $${values.length}`, values);
  }
  if (tab === "platform_change_events") {
    values.push(startOfAppDateUtc(range.startDate), endOfAppDateUtc(range.endDate));
    const where = ["e.changed_at >= $1", "e.changed_at <= $2"];
    const spaceFilter = addDataSpaceFilter("s");
    if (spaceFilter) where.push(spaceFilter);
    if (sourceId) {
      values.push(sourceId);
      where.push(`e.source_id = $${values.length}`);
    }
    values.push(options.pageSize + 1, offset);
    return queryRows(`select e.id, e.changed_at_pt, coalesce(s.display_name,e.source_type_key) as source, e.platform_record_type, e.external_record_id, e.change_type, e.changed_fields, left(e.payload::text,180) as payload_preview, e.payload as json from platform_change_events e join sources s on s.id=e.source_id where ${where.join(" and ")} order by e.changed_at desc, e.created_at desc limit $${values.length - 1} offset $${values.length}`, values);
  }
  values.push(startOfAppDateUtc(range.startDate), endOfAppDateUtc(range.endDate));
  const where = ["e.created_at >= $1", "e.created_at <= $2"];
  const spaceFilter = addDataSpaceFilter("s");
  if (spaceFilter) where.push(spaceFilter);
  if (sourceId) {
    values.push(sourceId);
    where.push(`e.source_id = $${values.length}`);
  }
  values.push(options.pageSize + 1, offset);
  return queryRows(`select e.id, to_char(timezone('America/Los_Angeles', e.created_at), 'Mon DD, YYYY HH12:MI AM "PT"') as created_at_pt, coalesce(s.display_name,'system') as source, e.event_type, e.severity, e.message, left(e.metadata::text,180) as metadata_preview, e.metadata as json from connector_events e join sources s on s.id=e.source_id where ${where.join(" and ")} order by e.created_at desc limit $${values.length - 1} offset $${values.length}`, values);
}

function demoRows(tab: ExplorerTab, options: { range: AppDateRangeKey; sourceId?: string; page: number; pageSize: number; dataSpaceId?: string }) {
  const store = getDemoStore();
  const scopedSources = options.dataSpaceId ? store.sources.filter((source) => source.data_space_id === options.dataSpaceId) : store.sources;
  const scopedSourceIds = new Set(scopedSources.map((source) => source.id));
  const names = sourceNames(scopedSources);
  const range = rangeFor(options.range, getDemoNow());
  const sourceId = selectedSource(options.sourceId);
  if (tab === "website") return paginate(store.webEvents.filter((event) => event.source_id && scopedSourceIds.has(event.source_id) && (!sourceId || event.source_id === sourceId) && event.occurred_at >= startOfAppDateUtc(range.startDate) && event.occurred_at <= endOfAppDateUtc(range.endDate)).map((event) => ({ id: event.id, occurred_at_pt: formatAppDateTime(event.occurred_at), event_name: event.event_name, path: event.path, referrer: event.referrer ?? "direct", country: event.country ?? "Unknown", device_type: event.device_type ?? "Unknown", browser_client: event.user_agent ?? "Unknown", source_mode: "Website Tracker", payload_hash: null, json: event.properties })), options.page, options.pageSize + 1);
  if (tab === "supabase" || tab === "metrics_daily") return paginate(store.metricsDaily.filter((metric) => metric.source_id && scopedSourceIds.has(metric.source_id) && (!sourceId || metric.source_id === sourceId) && metric.date >= range.startDate && metric.date <= range.endDate).filter((metric) => tab === "supabase" ? metric.source_type_key === "supabase" : true).map((metric) => ({ id: metric.id, date_pt: metric.date, source: names.get(metric.source_id ?? "") ?? metric.source_type_key, metric_key: metric.metric_key, metric_value: metric.metric_value, provider: typeof metric.dimensions.provider === "string" ? metric.dimensions.provider : "", users_total: metric.metric_key === "users_total" ? metric.metric_value : null, confirmed_users: metric.metric_key === "confirmed_users" ? metric.metric_value : null, sync_run_id: "", dimensions: preview(metric.dimensions), json: metric.dimensions })), options.page, options.pageSize + 1);
  if (tab === "sync_runs") return paginate(store.syncRuns.filter((run) => run.source_id && scopedSourceIds.has(run.source_id)).map((run) => ({ id: run.id, started_at_pt: formatAppDateTime(run.started_at), finished_at_pt: formatAppDateTime(run.finished_at), source: names.get(run.source_id ?? "") ?? run.source_type_key ?? "system", trigger: run.trigger, status: run.status, records_fetched: run.records_fetched, metrics_upserted: run.metrics_upserted, error_message: run.error_message ?? "", json: run.metadata })), options.page, options.pageSize + 1);
  if (tab === "raw_ingestions") return paginate(store.rawIngestions.filter((item) => item.source_id && scopedSourceIds.has(item.source_id)).map((item) => ({ id: item.id, fetched_at_pt: formatAppDateTime(item.fetched_at), source_type_key: item.source_type_key, source: names.get(item.source_id ?? "") ?? item.source_type_key, external_id: item.external_id ?? "", payload_hash: item.payload_hash, payload_preview: preview(item.payload), json: item.payload })), options.page, options.pageSize + 1);
  if (tab === "platform_change_events") return paginate(store.platformChangeEvents.filter((event) => event.source_id && scopedSourceIds.has(event.source_id)).map((event) => ({ id: event.id, changed_at_pt: event.changed_at_pt, source: names.get(event.source_id ?? "") ?? event.source_type_key, platform_record_type: event.platform_record_type, external_record_id: event.external_record_id, change_type: event.change_type, changed_fields: preview(event.changed_fields), payload_preview: preview(event.payload), json: event.payload })), options.page, options.pageSize + 1);
  return paginate(store.connectorEvents.filter((event) => event.source_id && scopedSourceIds.has(event.source_id)).map((event) => ({ id: event.id, created_at_pt: formatAppDateTime(event.created_at), source: names.get(event.source_id ?? "") ?? "system", event_type: event.event_type, severity: event.severity, message: event.message, metadata_preview: preview(event.metadata), json: event.metadata })), options.page, options.pageSize + 1);
}

export async function getSourceDataExplorer(options: { tab?: string; range?: string; sourceId?: string; page?: number; pageSize?: number; dataSpaceId?: string } = {}): Promise<ExplorerResult> {
  const tab = (Object.keys(tabColumns).includes(options.tab ?? "") ? options.tab : "website") as ExplorerTab;
  const range = options.range === "today" || options.range === "7d" || options.range === "30d" ? options.range : "30d";
  const page = Math.max(1, Number(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(options.pageSize ?? 25)));
  const rawRows = isRuntimeDatabaseConfigured()
    ? await dbRows(tab, { range, sourceId: options.sourceId, page, pageSize, dataSpaceId: options.dataSpaceId })
    : demoRows(tab, { range, sourceId: options.sourceId, page, pageSize, dataSpaceId: options.dataSpaceId });
  const limitedRows = rawRows.slice(0, pageSize);
  return {
    tab,
    columns: tabColumns[tab],
    page,
    pageSize,
    hasNextPage: rawRows.length > pageSize,
    rows: limitedRows.map((item: Record<string, unknown>) => {
      const cells = Object.fromEntries(tabColumns[tab].map((column) => [column, typeof item[column] === "number" || typeof item[column] === "string" || item[column] === null ? item[column] as string | number | null : preview(item[column])]));
      return { id: String(item.id ?? crypto.randomUUID()), cells, json: jsonRecord(redactSensitiveJson(item.json ?? item)) };
    }),
  };
}
