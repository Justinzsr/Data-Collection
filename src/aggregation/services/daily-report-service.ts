import { randomUUID } from "node:crypto";
import { getSupabaseDailyReportingRow, getWebsiteDailyReportingRow, type SupabaseDailyReportRow, type WebsiteDailyReportRow } from "@/aggregation/services/reporting-service";
import { isRuntimeDatabaseConfigured, queryRows, withDatabaseTransaction } from "@/storage/db/client";
import type { DailyReportMetric, DailyReportRun, DailyReportSection, JsonRecord } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listConnectorEvents } from "@/storage/repositories/events-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { addDaysToDateKey, appDateTimeParts, dateKeyInAppTimeZone, formatAppDate, formatAppDateTime, startOfAppDateUtc } from "@/storage/runtime/app-time";

export type DailyReport = {
  run: DailyReportRun;
  sections: DailyReportSection[];
  metrics: DailyReportMetric[];
  website: WebsiteDailyReportRow | null;
  supabase: SupabaseDailyReportRow | null;
};

type SectionInput = Omit<DailyReportSection, "id" | "report_run_id">;
type MetricInput = Omit<DailyReportMetric, "id" | "report_run_id">;

export function isReportingMigrationMissingError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error.code === "42P01" || error.code === "3F000"));
}

export async function isDailyReportStorageReady() {
  if (!isRuntimeDatabaseConfigured()) return true;
  try {
    const rows = await queryRows<{ ready: boolean }>("select to_regclass('public.daily_report_runs') is not null as ready");
    return Boolean(rows[0]?.ready);
  } catch (error) {
    if (isReportingMigrationMissingError(error)) return false;
    throw error;
  }
}

function n(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function section(section_key: string, title: string, summary: string, sort_order: number, metadata: JsonRecord = {}): SectionInput {
  return { section_key, title, summary, sort_order, metadata };
}

function metric(section_key: string, metric_key: string, label: string, value: number | null, text_value: string | null, unit: string | null, sort_order: number): MetricInput {
  return { section_key, metric_key, label, value, text_value, unit, sort_order, metadata: {} };
}

async function buildReport(reportDatePt: string) {
  const [website, supabase, sources, events] = await Promise.all([
    getWebsiteDailyReportingRow(reportDatePt),
    getSupabaseDailyReportingRow(reportDatePt),
    listSources(),
    listConnectorEvents(50),
  ]);
  const activeSources = sources.filter((source) => source.status !== "disabled");
  const errors = events.filter((event) => event.severity === "error").length;
  const healthStatus = errors > 0 ? "warning" : "healthy";
  const pageViews = n(website?.page_views);
  const visitors = n(website?.unique_visitors);
  const newSignups = n(supabase?.new_signups);
  const usersTotal = n(supabase?.users_total);
  const summary = `Yesterday MoonArq recorded ${pageViews.toLocaleString("en-US")} website views, ${visitors.toLocaleString("en-US")} unique visitors, ${newSignups.toLocaleString("en-US")} new signups, and ${usersTotal.toLocaleString("en-US")} total Supabase users.`;
  const sections = [
    section("executive_summary", "Executive Summary", summary, 10),
    section("website_vercel", "MoonArq Website / Vercel", website ? `${website.source_mode} reported ${pageViews.toLocaleString("en-US")} page views. Top page: ${website.top_page ?? "not enough data yet"}.` : "No website reporting data landed for this Pacific day yet.", 20),
    section("supabase", "MoonArq Supabase", supabase ? `${newSignups.toLocaleString("en-US")} new signups; latest snapshot shows ${usersTotal.toLocaleString("en-US")} total users.` : "No Supabase reporting data landed for this Pacific day yet.", 30),
    section("source_health", "Sources Health", `${activeSources.length} active source(s), ${errors} recent error event(s), status ${healthStatus}.`, 40),
    section("future_platforms", "Future Platforms", "TikTok, Instagram, and Shopify remain intentionally unconnected in this MVP.", 50),
  ];
  const metrics = [
    metric("executive_summary", "summary", "Summary", null, summary, null, 10),
    metric("executive_summary", "health_status", "Health status", null, healthStatus, "status", 20),
    metric("website_vercel", "page_views", "Page views", pageViews, null, "count", 10),
    metric("website_vercel", "unique_visitors", "Unique visitors", visitors, null, "count", 20),
    metric("website_vercel", "sessions", "Sessions", n(website?.sessions), null, "count", 30),
    metric("website_vercel", "custom_events", "Custom events", n(website?.custom_events), null, "count", 40),
    metric("website_vercel", "top_page", "Top page", null, website?.top_page ?? "No page data", "text", 50),
    metric("website_vercel", "top_referrer", "Top referrer", null, website?.top_referrer ?? "No referrer data", "text", 60),
    metric("website_vercel", "top_country", "Top country", null, website?.top_country ?? "No country data", "text", 70),
    metric("website_vercel", "top_device", "Top device", null, website?.top_device ?? "No device data", "text", 80),
    metric("supabase", "new_signups", "New signups", newSignups, null, "count", 10),
    metric("supabase", "users_total", "Users total", usersTotal, null, "count", 20),
    metric("supabase", "confirmed_users", "Confirmed users", n(supabase?.confirmed_users), null, "count", 30),
    metric("supabase", "provider_email", "Email provider signups", n(supabase?.provider_email), null, "count", 40),
    metric("supabase", "provider_google", "Google provider signups", n(supabase?.provider_google), null, "count", 50),
    metric("supabase", "provider_other", "Other provider signups", n(supabase?.provider_other), null, "count", 60),
    metric("source_health", "source_count", "Active sources", activeSources.length, null, "count", 10),
    metric("source_health", "sync_errors", "Sync errors", errors, null, "count", 20),
    metric("source_health", "latest_website_sync", "Latest website sync", null, website?.last_sync_at_pt ?? "Not synced", "text", 30),
    metric("source_health", "latest_supabase_sync", "Latest Supabase sync", null, supabase?.last_sync_at_pt ?? "Not synced", "text", 40),
    metric("future_platforms", "tiktok", "TikTok", null, "Not connected", "status", 10),
    metric("future_platforms", "instagram", "Instagram", null, "Not connected", "status", 20),
    metric("future_platforms", "shopify", "Shopify", null, "Not connected", "status", 30),
  ];
  return { website, supabase, sourceCount: activeSources.length, healthStatus, summary, sections, metrics };
}

function normalizeRun(row: DailyReportRun): DailyReportRun {
  return { ...row, report_date: String(row.report_date).slice(0, 10), source_count: Number(row.source_count ?? 0) };
}

function normalizeMetric(row: DailyReportMetric): DailyReportMetric {
  return { ...row, value: row.value === null ? null : Number(row.value), sort_order: Number(row.sort_order ?? 0) };
}

export async function getDailyReport(reportDatePt: string): Promise<DailyReport | null> {
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const run = store.dailyReportRuns.find((item) => item.report_date === reportDatePt);
    if (!run) return null;
    return {
      run,
      sections: store.dailyReportSections.filter((item) => item.report_run_id === run.id).sort((a, b) => a.sort_order - b.sort_order),
      metrics: store.dailyReportMetrics.filter((item) => item.report_run_id === run.id).sort((a, b) => a.sort_order - b.sort_order),
      website: await getWebsiteDailyReportingRow(reportDatePt),
      supabase: await getSupabaseDailyReportingRow(reportDatePt),
    };
  }
  if (!(await isDailyReportStorageReady())) return null;
  const runs = await queryRows<DailyReportRun>("select * from daily_report_runs where report_date = $1 limit 1", [reportDatePt]);
  if (!runs[0]) return null;
  const [sections, metrics, website, supabase] = await Promise.all([
    queryRows<DailyReportSection>("select * from daily_report_sections where report_run_id = $1 order by sort_order asc", [runs[0].id]),
    queryRows<DailyReportMetric>("select * from daily_report_metrics where report_run_id = $1 order by section_key asc, sort_order asc", [runs[0].id]),
    getWebsiteDailyReportingRow(reportDatePt),
    getSupabaseDailyReportingRow(reportDatePt),
  ]);
  return { run: normalizeRun(runs[0]), sections, metrics: metrics.map(normalizeMetric), website, supabase };
}

export async function listDailyReports(limit = 30) {
  if (!isRuntimeDatabaseConfigured()) return getDemoStore().dailyReportRuns.sort((a, b) => b.report_date.localeCompare(a.report_date)).slice(0, limit);
  if (!(await isDailyReportStorageReady())) return [];
  return (await queryRows<DailyReportRun>("select * from daily_report_runs order by report_date desc limit $1", [limit])).map(normalizeRun);
}

export async function generateDailyReport(reportDatePt: string): Promise<DailyReport> {
  if (!(await isDailyReportStorageReady())) {
    throw new Error("Reporting migration is not applied yet. Run pnpm db:migrate before generating daily reports.");
  }
  const built = await buildReport(reportDatePt);
  const generatedAt = new Date().toISOString();
  const run: DailyReportRun = {
    id: randomUUID(),
    report_date: reportDatePt,
    report_date_pt: `${formatAppDate(startOfAppDateUtc(reportDatePt))} PT`,
    status: "generated",
    generated_at: generatedAt,
    generated_at_pt: formatAppDateTime(generatedAt),
    summary: built.summary,
    source_count: built.sourceCount,
    health_status: built.healthStatus,
    error_message: null,
    metadata: { report_date_pt: reportDatePt },
  };
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const existing = store.dailyReportRuns.find((item) => item.report_date === reportDatePt);
    const reportRun = existing ? { ...run, id: existing.id } : run;
    store.dailyReportRuns = [reportRun, ...store.dailyReportRuns.filter((item) => item.report_date !== reportDatePt)];
    store.dailyReportSections = store.dailyReportSections.filter((item) => item.report_run_id !== reportRun.id);
    store.dailyReportMetrics = store.dailyReportMetrics.filter((item) => item.report_run_id !== reportRun.id);
    const sections = built.sections.map((item) => ({ ...item, id: randomUUID(), report_run_id: reportRun.id }));
    const metrics = built.metrics.map((item) => ({ ...item, id: randomUUID(), report_run_id: reportRun.id }));
    store.dailyReportSections.push(...sections);
    store.dailyReportMetrics.push(...metrics);
    return { run: reportRun, sections, metrics, website: built.website, supabase: built.supabase };
  }
  return withDatabaseTransaction(async (client) => {
    const runs = await queryRows<DailyReportRun>(
      `insert into daily_report_runs (id, report_date, report_date_pt, status, generated_at, generated_at_pt, summary, source_count, health_status, error_message, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       on conflict (report_date) do update set report_date_pt=excluded.report_date_pt,status=excluded.status,generated_at=excluded.generated_at,generated_at_pt=excluded.generated_at_pt,summary=excluded.summary,source_count=excluded.source_count,health_status=excluded.health_status,error_message=excluded.error_message,metadata=excluded.metadata
       returning *`,
      [run.id, run.report_date, run.report_date_pt, run.status, run.generated_at, run.generated_at_pt, run.summary, run.source_count, run.health_status, run.error_message, JSON.stringify(run.metadata)],
      client,
    );
    const reportRun = normalizeRun(runs[0]);
    await client.query("delete from daily_report_sections where report_run_id = $1", [reportRun.id]);
    await client.query("delete from daily_report_metrics where report_run_id = $1", [reportRun.id]);
    const sections: DailyReportSection[] = [];
    for (const item of built.sections) {
      sections.push((await queryRows<DailyReportSection>("insert into daily_report_sections (id, report_run_id, section_key, title, summary, sort_order, metadata) values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning *", [randomUUID(), reportRun.id, item.section_key, item.title, item.summary, item.sort_order, JSON.stringify(item.metadata)], client))[0]);
    }
    const metrics: DailyReportMetric[] = [];
    for (const item of built.metrics) {
      metrics.push(normalizeMetric((await queryRows<DailyReportMetric>("insert into daily_report_metrics (id, report_run_id, section_key, metric_key, label, value, text_value, unit, sort_order, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning *", [randomUUID(), reportRun.id, item.section_key, item.metric_key, item.label, item.value, item.text_value, item.unit, item.sort_order, JSON.stringify(item.metadata)], client))[0]));
    }
    return { run: reportRun, sections, metrics, website: built.website, supabase: built.supabase };
  });
}

export async function ensureDailyReportForYesterday(now = new Date()) {
  const yesterday = addDaysToDateKey(dateKeyInAppTimeZone(now), -1);
  const existing = await getDailyReport(yesterday);
  if (existing) return { generated: false, report: existing };
  return { generated: true, report: await generateDailyReport(yesterday) };
}

export function shouldGenerateDailyReportNow(now = new Date()) {
  return appDateTimeParts(now).hour >= 7;
}

function escapeXml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function worksheet(name: string, rows: Array<Array<string | number | null>>) {
  return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${rows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="${typeof cell === "number" ? "Number" : "String"}">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet>`;
}

export function dailyReportToExcelXml(report: DailyReport) {
  const summaryRows: Array<Array<string | number | null>> = [["section", "metric", "value", "unit", "note"]];
  for (const item of report.metrics) summaryRows.push([item.section_key, item.label, item.value ?? item.text_value ?? "", item.unit ?? "", ""]);
  const websiteRows: Array<Array<string | number | null>> = [["date_pt", "page_views", "unique_visitors", "sessions", "custom_events", "top_page", "top_referrer", "top_country", "top_device", "last_event_at_pt"], [report.run.report_date, report.website?.page_views ?? 0, report.website?.unique_visitors ?? 0, report.website?.sessions ?? 0, report.website?.custom_events ?? 0, report.website?.top_page ?? "", report.website?.top_referrer ?? "", report.website?.top_country ?? "", report.website?.top_device ?? "", report.website?.last_event_at_pt ?? ""]];
  const supabaseRows: Array<Array<string | number | null>> = [["date_pt", "new_signups", "users_total", "confirmed_users", "provider_email", "provider_google", "provider_other", "last_sync_at_pt"], [report.run.report_date, report.supabase?.new_signups ?? 0, report.supabase?.users_total ?? 0, report.supabase?.confirmed_users ?? 0, report.supabase?.provider_email ?? 0, report.supabase?.provider_google ?? 0, report.supabase?.provider_other ?? 0, report.supabase?.last_sync_at_pt ?? ""]];
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${worksheet("Summary", summaryRows)}${worksheet("MoonArq_Website_Vercel", websiteRows)}${worksheet("MoonArq_Supabase", supabaseRows)}</Workbook>`;
}
