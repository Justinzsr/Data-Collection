import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { MetricDaily, Source, WebEvent } from "@/storage/db/schema";
import { findWebEvents } from "@/storage/repositories/events-repository";
import { listMetrics } from "@/storage/repositories/metrics-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { endOfAppDateUtc, formatAppDateTime, startOfAppDateUtc } from "@/storage/runtime/app-time";
import { resolvePrimaryWebsiteSource } from "@/collection/tracking/website-sources";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";

export type WebsiteDailyReportRow = {
  data_space_id?: string;
  data_space_slug?: string;
  data_space_name?: string;
  date_pt: string;
  source_id: string | null;
  source_name: string;
  source_mode: string;
  unique_visitors: number;
  page_views: number;
  sessions: number;
  custom_events: number;
  top_page: string | null;
  top_referrer: string | null;
  top_country: string | null;
  top_device: string | null;
  last_event_at_pt: string | null;
  last_sync_at_pt: string | null;
};

export type SupabaseDailyReportRow = {
  data_space_id?: string;
  data_space_slug?: string;
  data_space_name?: string;
  date_pt: string;
  source_id: string | null;
  source_name: string;
  new_signups: number;
  users_total: number;
  confirmed_users: number;
  provider_email: number;
  provider_google: number;
  provider_other: number;
  last_sync_at_pt: string | null;
};

function normalizeDate(value: unknown) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function isMissingReportingViewError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error.code === "42P01" || error.code === "3F000"));
}

function sumMetric(rows: MetricDaily[], metricKey: string, source?: Source | null) {
  return rows
    .filter((row) => row.metric_key === metricKey)
    .filter((row) => (source ? row.source_id === source.id : true))
    .reduce((sum, row) => sum + row.metric_value, 0);
}

function latestMetric(rows: MetricDaily[], metricKey: string, source?: Source | null) {
  return rows
    .filter((row) => row.metric_key === metricKey)
    .filter((row) => (source ? row.source_id === source.id : true))
    .sort((a, b) => `${a.date}:${a.updated_at}`.localeCompare(`${b.date}:${b.updated_at}`))
    .at(-1)?.metric_value ?? 0;
}

function topMetric(rows: MetricDaily[], metricKey: string, dimensionKey: string, fallback: string) {
  const totals = rows
    .filter((row) => row.metric_key === metricKey)
    .reduce<Record<string, number>>((acc, row) => {
      const value = typeof row.dimensions[dimensionKey] === "string" ? row.dimensions[dimensionKey] as string : fallback;
      acc[value] = (acc[value] ?? 0) + row.metric_value;
      return acc;
    }, {});
  const [label, value] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] ?? [];
  return label ? `${label} (${value})` : null;
}

function topEvent(events: WebEvent[], selector: (event: WebEvent) => string | null | undefined, fallback: string) {
  const totals = events.reduce<Record<string, number>>((acc, event) => {
    const value = selector(event) || fallback;
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  const [label, value] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] ?? [];
  return label ? `${label} (${value})` : null;
}

function providerSum(rows: MetricDaily[], provider: "email" | "google" | "other") {
  return rows
    .filter((row) => row.metric_key === "signups_by_provider")
    .reduce((sum, row) => {
      const rowProvider = typeof row.dimensions.provider === "string" ? row.dimensions.provider : "email";
      if (provider === "other") return rowProvider !== "email" && rowProvider !== "google" ? sum + row.metric_value : sum;
      return rowProvider === provider ? sum + row.metric_value : sum;
    }, 0);
}

function normalizeWebsite(row: WebsiteDailyReportRow): WebsiteDailyReportRow {
  return {
    ...row,
    date_pt: normalizeDate(row.date_pt),
    unique_visitors: Number(row.unique_visitors ?? 0),
    page_views: Number(row.page_views ?? 0),
    sessions: Number(row.sessions ?? 0),
    custom_events: Number(row.custom_events ?? 0),
  };
}

function normalizeSupabase(row: SupabaseDailyReportRow): SupabaseDailyReportRow {
  return {
    ...row,
    date_pt: normalizeDate(row.date_pt),
    new_signups: Number(row.new_signups ?? 0),
    users_total: Number(row.users_total ?? 0),
    confirmed_users: Number(row.confirmed_users ?? 0),
    provider_email: Number(row.provider_email ?? 0),
    provider_google: Number(row.provider_google ?? 0),
    provider_other: Number(row.provider_other ?? 0),
  };
}

export async function listWebsiteDailyReportingRows(options: { startDate?: string; endDate?: string; limit?: number; dataSpaceId?: string; dataSpaceSlug?: string } = {}) {
  const resolvedDataSpace = options.dataSpaceId
    ? null
    : await getDataSpaceBySlug(options.dataSpaceSlug ?? "moonarq");
  const dataSpaceId = options.dataSpaceId ?? resolvedDataSpace?.id;
  const dataSpaceSlug = options.dataSpaceSlug;
  const source = resolvePrimaryWebsiteSource(await listSources({ dataSpaceId }));
  if (!source) return [];
  if (isRuntimeDatabaseConfigured()) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (options.startDate) {
      values.push(options.startDate);
      where.push(`date_pt >= $${values.length}`);
    }
    if (options.endDate) {
      values.push(options.endDate);
      where.push(`date_pt <= $${values.length}`);
    }
    if (dataSpaceId) {
      values.push(dataSpaceId);
      where.push(`data_space_id = $${values.length}`);
    } else if (dataSpaceSlug) {
      values.push(dataSpaceSlug);
      where.push(`data_space_slug = $${values.length}`);
    }
    values.push(source.id);
    where.push(`source_id = $${values.length}`);
    values.push(options.limit ?? 90);
    try {
      const viewName = dataSpaceId || dataSpaceSlug ? "reporting.platform_website_daily" : "reporting.moonarq_website_daily";
      const rows = await queryRows<WebsiteDailyReportRow>(
        `select * from ${viewName} ${where.length ? `where ${where.join(" and ")}` : ""} order by date_pt desc limit $${values.length}`,
        values,
      );
      return rows.map(normalizeWebsite);
    } catch (error) {
      if (isMissingReportingViewError(error)) return [];
      throw error;
    }
  }

  const metrics = await listMetrics({ sourceId: source.id, sourceTypeKey: "website", startDate: options.startDate, endDate: options.endDate, dataSpaceId });
  const dates = [...new Set(metrics.map((metric) => metric.date))].sort().reverse().slice(0, options.limit ?? 90);
  return Promise.all(dates.map(async (date) => {
    const dayMetrics = metrics.filter((metric) => metric.date === date);
    const events = await findWebEvents({ sourceId: source.id, startOccurredAt: startOfAppDateUtc(date), endOccurredAt: endOfAppDateUtc(date), limit: 2000, dataSpaceId });
    return normalizeWebsite({
      date_pt: date,
      source_id: source.id,
      source_name: source.display_name,
      source_mode: "Website Tracker",
      unique_visitors: sumMetric(dayMetrics, "unique_visitors", source),
      page_views: sumMetric(dayMetrics, "page_views", source),
      sessions: sumMetric(dayMetrics, "sessions", source),
      custom_events: sumMetric(dayMetrics, "custom_events", source),
      top_page: topMetric(dayMetrics, "events_by_path", "path", "/"),
      top_referrer: topMetric(dayMetrics, "events_by_referrer", "referrer", "direct"),
      top_country: topEvent(events, (event) => event.country, "Unknown"),
      top_device: topEvent(events, (event) => event.device_type, "Unknown"),
      last_event_at_pt: events[0]?.occurred_at ? formatAppDateTime(events[0].occurred_at) : null,
      last_sync_at_pt: source.last_success_at ? formatAppDateTime(source.last_success_at) : null,
    });
  }));
}

export async function listSupabaseDailyReportingRows(options: { startDate?: string; endDate?: string; limit?: number; dataSpaceId?: string; dataSpaceSlug?: string } = {}) {
  if (isRuntimeDatabaseConfigured()) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (options.startDate) {
      values.push(options.startDate);
      where.push(`date_pt >= $${values.length}`);
    }
    if (options.endDate) {
      values.push(options.endDate);
      where.push(`date_pt <= $${values.length}`);
    }
    if (options.dataSpaceId) {
      values.push(options.dataSpaceId);
      where.push(`data_space_id = $${values.length}`);
    } else if (options.dataSpaceSlug) {
      values.push(options.dataSpaceSlug);
      where.push(`data_space_slug = $${values.length}`);
    }
    values.push(options.limit ?? 90);
    try {
      const viewName = options.dataSpaceId || options.dataSpaceSlug ? "reporting.platform_supabase_daily" : "reporting.moonarq_supabase_daily";
      const rows = await queryRows<SupabaseDailyReportRow>(
        `select * from ${viewName} ${where.length ? `where ${where.join(" and ")}` : ""} order by date_pt desc limit $${values.length}`,
        values,
      );
      return rows.map(normalizeSupabase);
    } catch (error) {
      if (isMissingReportingViewError(error)) return [];
      throw error;
    }
  }

  const source = (await listSources({ dataSpaceId: options.dataSpaceId })).find((item) => item.source_type_key === "supabase") ?? null;
  const metrics = await listMetrics({ sourceId: source?.id, sourceTypeKey: "supabase", startDate: options.startDate, endDate: options.endDate, dataSpaceId: options.dataSpaceId });
  const snapshots = await listMetrics({ sourceId: source?.id, sourceTypeKey: "supabase", metricKeys: ["users_total", "confirmed_users"], dataSpaceId: options.dataSpaceId });
  const dates = [...new Set(metrics.map((metric) => metric.date))].sort().reverse().slice(0, options.limit ?? 90);
  return dates.map((date) => {
    const dayMetrics = metrics.filter((metric) => metric.date === date);
    const priorSnapshots = snapshots.filter((metric) => metric.date <= date);
    return normalizeSupabase({
      date_pt: date,
      source_id: source?.id ?? null,
      source_name: source?.display_name ?? "MoonArq Supabase",
      new_signups: sumMetric(dayMetrics, "signups", source),
      users_total: latestMetric(priorSnapshots, "users_total", source) || latestMetric(snapshots, "users_total", source),
      confirmed_users: latestMetric(priorSnapshots, "confirmed_users", source) || latestMetric(snapshots, "confirmed_users", source),
      provider_email: providerSum(dayMetrics, "email"),
      provider_google: providerSum(dayMetrics, "google"),
      provider_other: providerSum(dayMetrics, "other"),
      last_sync_at_pt: source?.last_success_at ? formatAppDateTime(source.last_success_at) : null,
    });
  });
}

export async function getWebsiteDailyReportingRow(datePt: string, options: { dataSpaceId?: string; dataSpaceSlug?: string } = {}) {
  return (await listWebsiteDailyReportingRows({ startDate: datePt, endDate: datePt, limit: 1, ...options }))[0] ?? null;
}

export async function getSupabaseDailyReportingRow(datePt: string, options: { dataSpaceId?: string; dataSpaceSlug?: string } = {}) {
  const row = (await listSupabaseDailyReportingRows({ startDate: datePt, endDate: datePt, limit: 1, ...options }))[0];
  if (row) return row;
  const latest = (await listSupabaseDailyReportingRows({ limit: 1, ...options }))[0];
  return latest ? { ...latest, date_pt: datePt, new_signups: 0, provider_email: 0, provider_google: 0, provider_other: 0 } : null;
}
