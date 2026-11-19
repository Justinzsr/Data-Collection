import "server-only";

import { createHash } from "node:crypto";
import type { AdsCampaignHistorySnapshot, AdsHistoryPlatform, AdsHistoryTotals } from "@/aggregation/services/ads-campaign-history-types";
import { isLocalOverviewFixtureEnabled } from "@/aggregation/services/platform-overview-fixtures";
import type { JsonRecord, MetricDaily, Source, SyncRun } from "@/storage/db/schema";
import { listMetrics } from "@/storage/repositories/metrics-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { listSyncRuns } from "@/storage/repositories/sync-runs-repository";

type Dependencies = {
  now?: Date;
  loadSources?: typeof listSources;
  loadMetrics?: typeof listMetrics;
  loadSyncRuns?: typeof listSyncRuns;
};
type Scope = { accountId: string; currency: string | null; timeZone: string; cursor: JsonRecord; run: SyncRun | null };
type Campaign = AdsCampaignHistorySnapshot["campaigns"][number];
type Report = { marker: MetricDaily; hash: string; startDate: string; endDate: string; campaigns: Campaign[] };
const FIELDS = ["spend", "impressions", "clicks"] as const;
const EMPTY: AdsHistoryTotals = { spend: null, impressions: null, clicks: null };

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function currency(value: unknown) {
  const result = text(value)?.toUpperCase();
  return result && /^[A-Z]{3}$/u.test(result) ? result : null;
}
function timeZone(value: unknown) {
  const result = text(value);
  if (!result) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: result }).format(new Date(0)); return result; } catch { return null; }
}
function account(value: unknown, platform: AdsHistoryPlatform) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (platform === "meta_ads") return /^(?:act_)?\d+$/u.test(value) ? value.replace(/^act_/u, "") : null;
  return /^adacct_[A-Za-z0-9]+$/u.test(value) ? value : null;
}
function value(row: MetricDaily | undefined, field: typeof FIELDS[number], unit: string | null) {
  if (!row || typeof row.metric_value !== "number" || !Number.isFinite(row.metric_value) || row.metric_value < 0) return null;
  if (field === "spend") return unit && row.unit.toUpperCase() === unit ? row.metric_value : null;
  return row.unit === "count" && Number.isSafeInteger(row.metric_value) ? row.metric_value : null;
}
function localDate(now: Date, zone: string) {
  const parts = new Map(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}
function bounds(platform: AdsHistoryPlatform, collectedDate: string) {
  const end = new Date(`${collectedDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  if (platform === "chatgpt_ads") start.setUTCDate(start.getUTCDate() - 364);
  else {
    const boundary = (reference: Date) => {
      const month = reference.getUTCFullYear() * 12 + reference.getUTCMonth() - 37;
      const year = Math.floor(month / 12), index = ((month % 12) + 12) % 12;
      const result = new Date(Date.UTC(year, index, Math.min(reference.getUTCDate(), new Date(Date.UTC(year, index + 1, 0)).getUTCDate())));
      result.setUTCDate(result.getUTCDate() + 1);
      return result.getTime();
    };
    start.setTime(Math.max(boundary(end), boundary(new Date(`${collectedDate}T00:00:00.000Z`))));
  }
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
function recent(left: MetricDaily, right: MetricDaily) {
  return left.updated_at > right.updated_at || (left.updated_at === right.updated_at && left.id > right.id);
}
function sum(rows: AdsHistoryTotals[], field: typeof FIELDS[number]) {
  if (!rows.length || rows.some((row) => row[field] === null)) return null;
  const result = rows.reduce((total, row) => total + row[field]!, 0);
  return Number.isFinite(result) && (field === "spend" || Number.isSafeInteger(result)) ? result : null;
}
function totals(rows: AdsHistoryTotals[]): AdsHistoryTotals {
  return { spend: sum(rows, "spend"), impressions: sum(rows, "impressions"), clicks: sum(rows, "clicks") };
}
function safeName(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 512) : fallback;
}
function base(platform: AdsHistoryPlatform): AdsCampaignHistorySnapshot {
  return {
    platform, state: "unavailable", sourceId: null, accountName: null, currency: null, timeZone: null,
    clickLabel: platform === "meta_ads" ? "All clicks" : "Ad clicks",
    coverage: { basis: "collected_history", startDate: null, endDate: null, note: "Earlier platform reports may not have been collected." },
    totals: { ...EMPTY }, campaigns: [], updatedAt: null, note: "No verified campaign history has been reported yet.",
  };
}

function resolveScope(source: Source, runs: SyncRun[], now: Date): Scope | null {
  const run = runs.filter((item) => item.source_id === source.id && item.source_type_key === source.source_type_key && item.status === "success"
    && item.finished_at && Number.isFinite(Date.parse(item.finished_at)) && Date.parse(item.finished_at) <= now.getTime() + 300_000)
    .sort((left, right) => right.finished_at!.localeCompare(left.finished_at!))[0] ?? null;
  const cursor = run?.cursor_after ?? {};
  const cursorAccount = account(cursor.accountId, source.source_type_key as AdsHistoryPlatform);
  const external = account(source.external_account_id, source.source_type_key as AdsHistoryPlatform);
  if ((source.external_account_id && !external) || (cursor.accountId !== undefined && !cursorAccount) || (external && cursorAccount && external !== cursorAccount)) return null;
  const accountId = external ?? cursorAccount;
  const zones = [source.metadata.account_timezone, cursor.timeZone ?? cursor.accountTimeZone].filter((item) => item !== undefined && item !== null);
  const currencies = [source.metadata.account_currency, cursor.currency].filter((item) => item !== undefined && item !== null);
  const zoneValues = zones.map(timeZone), currencyValues = currencies.map(currency);
  if (!accountId || !zoneValues.length || zoneValues.some((item) => !item || item !== zoneValues[0])
    || currencyValues.some((item) => !item || item !== currencyValues[0])) return null;
  return { accountId, currency: currencyValues[0] ?? null, timeZone: zoneValues[0]!, cursor, run };
}

function matches(row: MetricDaily, source: Source, scope: Scope, platform: AdsHistoryPlatform) {
  return row.source_id === source.id && row.source_type_key === platform
    && account(row.dimensions.account_id, platform) === scope.accountId
    && row.dimensions.account_timezone === scope.timeZone
    && currency(row.dimensions.account_currency) === scope.currency;
}

function parseReport(marker: MetricDaily, rows: MetricDaily[], source: Source, scope: Scope, platform: AdsHistoryPlatform, today: string): Report | null {
  const dimensions = marker.dimensions;
  const hash = text(dimensions.report_hash), startDate = dimensions.report_start, endDate = dimensions.report_end;
  if (!scope.currency || !matches(marker, source, scope, platform) || marker.unit !== "count"
    || !Number.isSafeInteger(marker.metric_value) || marker.metric_value < 0 || !date(marker.date) || marker.date > today
    || !hash || hash !== dimensions.report_hash || !/^[a-f0-9]{64}$/u.test(hash) || !date(startDate) || !date(endDate)) return null;
  const expected = bounds(platform, marker.date);
  if (startDate !== expected.startDate || endDate !== expected.endDate) return null;
  const batch = rows.filter((row) => row.source_id === source.id && row.source_type_key === platform
    && row.date === marker.date && row.dimensions.report_hash === hash && row.metric_key !== `${platform}_history_campaign_count`);
  const byCampaign = new Map<string, { name: string; metrics: Partial<Record<typeof FIELDS[number], MetricDaily>> }>();
  for (const row of batch) {
    const field = FIELDS.find((item) => row.metric_key === `${platform}_history_${item}`);
    const id = text(row.dimensions.campaign_id), name = row.dimensions.campaign_name;
    if (!field || row.dimensions.rollup !== "campaign_history_total" || !matches(row, source, scope, platform)
      || row.dimensions.report_start !== startDate || row.dimensions.report_end !== endDate
      || !id || id !== row.dimensions.campaign_id || typeof name !== "string" || value(row, field, scope.currency) === null) return null;
    const previous = byCampaign.get(id) ?? { name, metrics: {} };
    if (previous.name !== name || (previous.metrics[field] && previous.metrics[field]!.metric_value !== row.metric_value)) return null;
    previous.metrics[field] = row;
    byCampaign.set(id, previous);
  }
  if (byCampaign.size !== marker.metric_value) return null;
  const normalized = [...byCampaign.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, item]) => ({
    campaignId: id, campaignName: item.name,
    spend: value(item.metrics.spend, "spend", scope.currency), impressions: value(item.metrics.impressions, "impressions", scope.currency), clicks: value(item.metrics.clicks, "clicks", scope.currency),
  }));
  if (normalized.some((item) => FIELDS.some((field) => item[field] === null))) return null;
  const content = { platform, accountId: scope.accountId, currency: scope.currency, timeZone: scope.timeZone, startDate, endDate, rows: normalized };
  if (createHash("sha256").update(JSON.stringify(content)).digest("hex") !== hash) return null;
  return { marker, hash, startDate, endDate, campaigns: normalized.map((item) => ({
    key: item.campaignId, name: safeName(item.campaignName, "Unnamed campaign"), startDate, endDate,
    spend: item.spend, impressions: item.impressions, clicks: item.clicks,
  })) };
}

function collected(rows: MetricDaily[], source: Source, scope: Scope, platform: AdsHistoryPlatform, today: string) {
  const canonical = rows.filter((row) => row.source_id === source.id && row.source_type_key === platform
    && row.dimensions.rollup === (platform === "meta_ads" ? "ad_daily" : "account_daily")
    && FIELDS.some((field) => row.metric_key === `${platform}_${field}`) && date(row.date) && row.date <= today
    && account(row.dimensions.account_id, platform) === scope.accountId && row.dimensions.account_timezone === scope.timeZone);
  let reportedCurrency = scope.currency;
  if (!reportedCurrency && platform === "meta_ads" && canonical.length) {
    const reported = canonical.map((row) => currency(row.dimensions.account_currency));
    if (reported.every((item) => item && item === reported[0])
      && canonical.filter((row) => row.metric_key === `${platform}_spend`).every((row) => row.unit.toUpperCase() === reported[0])) reportedCurrency = reported[0];
  }
  if (!reportedCurrency) return null;
  const latest = new Map<string, MetricDaily>();
  for (const row of canonical) {
    if (currency(row.dimensions.account_currency) !== reportedCurrency) continue;
    const ad = platform === "meta_ads" ? text(row.dimensions.ad_id) : "account";
    if (!ad) continue;
    const key = `${row.date}:${ad}:${row.metric_key}`;
    const previous = latest.get(key);
    if (!previous || recent(row, previous)) latest.set(key, row);
  }
  const groups = new Map<string, { date: string; campaigns: Set<string>; name: string; metrics: Partial<Record<typeof FIELDS[number], MetricDaily>> }>();
  for (const row of latest.values()) {
    const ad = platform === "meta_ads" ? String(row.dimensions.ad_id) : "account";
    const key = `${row.date}:${ad}`, field = FIELDS.find((item) => row.metric_key === `${platform}_${item}`)!;
    const previous = groups.get(key) ?? { date: row.date, campaigns: new Set<string>(), name: "Unnamed campaign", metrics: {} };
    const campaignId = text(row.dimensions.campaign_id);
    if (campaignId) previous.campaigns.add(campaignId);
    previous.name = safeName(row.dimensions.campaign_name, previous.name);
    previous.metrics[field] = row;
    groups.set(key, previous);
  }
  const items = [...groups.values()].map((group) => ({ ...group,
    spend: value(group.metrics.spend, "spend", reportedCurrency), impressions: value(group.metrics.impressions, "impressions", reportedCurrency), clicks: value(group.metrics.clicks, "clicks", reportedCurrency),
  }));
  if (!items.length) return null;
  const campaignGroups = new Map<string, typeof items>();
  let ambiguousCampaign = false;
  if (platform === "meta_ads") for (const item of items) {
    if (item.campaigns.size !== 1) { ambiguousCampaign = true; continue; }
    const id = [...item.campaigns][0];
    campaignGroups.set(id, [...(campaignGroups.get(id) ?? []), item]);
  }
  const campaigns = [...campaignGroups.entries()].map(([key, group]) => ({ key, name: group.at(-1)!.name,
    startDate: group.map((item) => item.date).sort()[0], endDate: group.map((item) => item.date).sort().at(-1)!, ...totals(group) }));
  return {
    currency: reportedCurrency, totals: ambiguousCampaign ? { ...EMPTY } : totals(items), campaigns,
    startDate: items.map((item) => item.date).sort()[0], endDate: items.map((item) => item.date).sort().at(-1)!,
    updatedAt: [...latest.values()].map((item) => item.updated_at).filter((item) => Number.isFinite(Date.parse(item))).sort().at(-1) ?? null,
  };
}

/** Optional server-only section: never call advertising APIs or expose storage/loader errors to the page. */
export async function getAdsCampaignHistory(input: { dataSpaceId: string; platform: AdsHistoryPlatform; fixture?: boolean }, dependencies: Dependencies = {}): Promise<AdsCampaignHistorySnapshot> {
  const snapshot = base(input.platform), now = dependencies.now ?? new Date();
  if (input.fixture && isLocalOverviewFixtureEnabled()) return fixture(input.platform, now);
  try {
    const sources = (await (dependencies.loadSources ?? listSources)({ dataSpaceId: input.dataSpaceId }))
      .filter((source) => source.data_space_id === input.dataSpaceId && source.source_type_key === input.platform);
    if (sources.length > 1) return { ...snapshot, state: "ambiguous", note: "Choose one advertising source before comparing historical account totals." };
    const source = sources[0];
    if (!source) return snapshot;
    snapshot.sourceId = source.id;
    snapshot.accountName = safeName(source.account_name ?? source.display_name, "Advertising account");
    const runs = await (dependencies.loadSyncRuns ?? listSyncRuns)(1, "success", { dataSpaceId: input.dataSpaceId, sourceId: source.id });
    const scope = resolveScope(source, runs, now);
    if (!scope) return { ...snapshot, note: "The source account, currency, or time zone has not been verified consistently." };
    snapshot.currency = scope.currency; snapshot.timeZone = scope.timeZone;
    const keys = [`${input.platform}_history_campaign_count`, ...FIELDS.flatMap((field) => [`${input.platform}_history_${field}`, `${input.platform}_${field}`])];
    const rows = await (dependencies.loadMetrics ?? listMetrics)({ dataSpaceId: input.dataSpaceId, sourceId: source.id, sourceTypeKey: input.platform, metricKeys: keys });
    const today = localDate(now, scope.timeZone);
    const markers = rows.filter((row) => row.source_id === source.id && row.source_type_key === input.platform
      && row.metric_key === `${input.platform}_history_campaign_count` && row.dimensions.rollup === "campaign_history_report"
      && matches(row, source, scope, input.platform)).sort((a, b) => b.date.localeCompare(a.date) || b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
    let report: Report | null = null;
    let discarded = false;
    for (const marker of markers) {
      report = parseReport(marker, rows.filter((row) => row.metric_key.startsWith(`${input.platform}_history_`)), source, scope, input.platform, today);
      if (report) break;
      discarded = true;
    }
    const cadence = Math.max(120, source.sync_frequency_minutes * 2) * 60_000;
    const fresh = scope.run?.finished_at && now.getTime() - Date.parse(scope.run.finished_at) <= cadence;
    const sourceCurrent = !["disabled", "error", "needs_credentials"].includes(source.status) && fresh;
    if (report) {
      const current = sourceCurrent && !discarded && scope.cursor.historyStatus === "available"
        && scope.cursor.historyReportHash === report.hash && scope.cursor.historyReportStart === report.startDate && scope.cursor.historyReportEnd === report.endDate
        && typeof scope.cursor.fetchedAt === "string" && Number.isFinite(Date.parse(scope.cursor.fetchedAt))
        && localDate(new Date(scope.cursor.fetchedAt), scope.timeZone) === report.marker.date;
      return { ...snapshot, state: current ? "ready" : "stale", coverage: { basis: "official_available_history", startDate: report.startDate, endDate: report.endDate,
        note: `${input.platform === "meta_ads" ? "Up to 37 months" : "365 completed account days"} of official available reporting history; this is not an account-lifetime guarantee.` },
        campaigns: report.campaigns, totals: totals(report.campaigns), updatedAt: report.marker.updated_at,
        note: current ? report.campaigns.length ? "Latest complete campaign report. Account totals and campaign totals are kept separate from daily reports." : "No campaign totals were returned. Missing amounts remain unknown."
          : "An earlier complete campaign report is shown. The latest history request is unavailable, incomplete, or no longer current." };
    }
    const fallback = collected(rows, source, scope, input.platform, today);
    if (!fallback) return { ...snapshot, note: "No complete history report or compatible collected daily facts are available yet." };
    return { ...snapshot, state: sourceCurrent ? "partial" : "stale", currency: fallback.currency,
      coverage: { basis: "collected_history", startDate: fallback.startDate, endDate: fallback.endDate,
        note: "Sum of compatible daily facts already collected. Earlier reports and days without facts may be missing; this is not platform lifetime spend." },
      totals: fallback.totals, campaigns: fallback.campaigns, updatedAt: fallback.updatedAt,
      note: input.platform === "chatgpt_ads" ? "These are account-level daily totals. They cannot be assigned to individual campaigns."
        : "Campaign totals use each reported ad and account day once. Missing or invalid amounts stay unknown." };
  } catch {
    return { ...snapshot, state: "unavailable", totals: { ...EMPTY }, campaigns: [], note: "Campaign history is temporarily unavailable. Existing platform reports remain separate." };
  }
}

function fixture(platform: AdsHistoryPlatform, now: Date): AdsCampaignHistorySnapshot {
  const period = bounds(platform, localDate(now, "America/Los_Angeles"));
  const examples = platform === "meta_ads" ? [
    { key: "sample-a", name: "Example seasonal stories", spend: 24.88, impressions: 1320, clicks: 88 },
    { key: "sample-b", name: "Example campaign with a deliberately long descriptive name for checking responsive campaign history layouts", spend: 215.27, impressions: 4305, clicks: 177 },
    { key: "sample-c", name: "Example collection launch", spend: 100, impressions: 2000, clicks: 100 },
  ] : [{ key: "sample-chatgpt", name: "Example conversation campaign", spend: 0, impressions: 0, clicks: 0 }];
  return { ...base(platform), state: "ready", accountName: "Example advertising account", currency: "USD", timeZone: "America/Los_Angeles",
    coverage: { basis: "official_available_history", ...period, note: "Sample data for a local preview. No advertising account is represented." },
    campaigns: examples.map((item) => ({ ...item, ...period })), totals: totals(examples), updatedAt: now.toISOString(), note: "Sample data. Campaign history is independent of the selected date range." };
}
