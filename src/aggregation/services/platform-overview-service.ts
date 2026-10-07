import {
  metaRowMatchesAccount,
  metaSyncIsStale,
  selectedMetaAccountId,
} from "@/aggregation/services/meta-ads-attribution-service";
import { isLocalOverviewFixtureEnabled, paidAdsFixture } from "@/aggregation/services/platform-overview-fixtures";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import { getWebsiteFunnelOverview, type WebsiteFunnelDemoState } from "@/aggregation/services/website-funnel-service";
import type { WebsiteFunnelOverview } from "@/aggregation/services/website-funnel-types";
import { ETSY_METRIC_KEYS } from "@/collection/connectors/etsy/constants";
import {
  coveredDateRuns,
  isReportWeek,
  latestPublishedReportWeek,
  WHATNOT_DAILY_METRIC_KEYS,
  WHATNOT_SHOW_METRIC_KEYS,
} from "@/collection/connectors/whatnot/weekly-report";
import { resolvePrimaryWebsiteSource } from "@/collection/tracking/website-sources";
import type { DataSpace, MetricDaily, Source, SourceTypeKey } from "@/storage/db/schema";
import { listMetrics } from "@/storage/repositories/metrics-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { addDaysToDateKey, APP_TIME_ZONE, getAppDateRange, isAppDateKey } from "@/storage/runtime/app-time";
import { getDemoNow } from "@/storage/seed/demo-data";

/*
 * Overview aggregation: one compact card per platform plus the paid-ads monitor.
 * Every value here is read from stored, idempotently synced rows; nothing calls a
 * platform API. Definitions for the derived values live in
 * docs/platform-overview.md.
 */

export type OverviewDelta =
  | { kind: "percent" | "absolute" | "points"; value: number; basis: string }
  | {
      kind: "none";
      /** "incomplete": the period has days without data (a report not imported), so it is not compared. */
      reason: "partial_day" | "no_baseline" | "from_zero" | "unavailable" | "incomplete";
      basis?: string;
    };

export type OverviewMetric = {
  key: string;
  label: string;
  /** null means unavailable — rendered as an em dash, never as zero. */
  value: number | null;
  /** "count", "percent", "ratio", or a lowercase ISO currency code. */
  unit: string;
  delta: OverviewDelta;
  /** true when up is good, false when down is good (costs), null for neutral values such as spend. */
  higherIsBetter: boolean | null;
};

export type OverviewPoint = { date: string; value: number };

export type OverviewRange = {
  key: DateRangeKey;
  label: string;
  days: number;
  startDate: string;
  endDate: string;
  /**
   * Complete-day windows for period-over-period change. Today is still in
   * progress, so it is left out of both sides; null for the Today range.
   */
  comparison: {
    currentStart: string;
    currentEnd: string;
    previousStart: string;
    previousEnd: string;
    basis: string;
  } | null;
  /** Sparklines always cover at least seven days so a Today view still shows a trend. */
  sparkline: { startDate: string; endDate: string; label: string };
};

export type OverviewPlatformKey = "website" | "shopify" | "etsy" | "whatnot" | "instagram" | "tiktok" | "supabase";

/** For platforms whose data arrives as periodic reports rather than live syncs. */
export type ReportCoverage = {
  /** Pacific dates fully covered by imported reports, as runs of consecutive dates. */
  coveredRuns: Array<{ from: string; through: string }>;
  /** First and last Pacific dates fully covered by imported reports. */
  coveredFrom: string | null;
  coveredThrough: string | null;
  /** Reports between the first and latest import that were never imported, oldest first. */
  missingWeeks: string[];
  /** Reports the platform has published since the latest import, oldest first. */
  pendingWeeks: string[];
  /** The platform has published a newer report than the latest one imported. */
  newReportAvailable: boolean;
};

export type OverviewPlatformCard = {
  key: OverviewPlatformKey;
  iconKey: SourceTypeKey;
  title: string;
  account: string | null;
  /** Server-only: used to derive connection health; never sent to the client. */
  source: Source | null;
  primary: OverviewMetric;
  secondary: OverviewMetric[];
  sparkline: { label: string; points: OverviewPoint[] };
  updatedAt: string | null;
  /** When set, the values are withheld and this explains why. */
  unavailableReason: string | null;
  /** Report-based platforms: which days the imported reports cover. */
  coverage?: ReportCoverage | null;
};

export type PaidAdsTotals = {
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  outboundClicks: number;
  landingPageViews: number;
  purchases: number;
  purchaseValue: number;
};

export type PaidAdsRates = {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  roas: number | null;
  costPerPurchase: number | null;
};

export type PaidAdsDailyPoint = PaidAdsTotals & { date: string };

export type PaidAdsCampaignRow = {
  key: string;
  name: string;
  status: string | null;
  objective: string | null;
  totals: PaidAdsTotals;
  rates: PaidAdsRates;
  deliveringToday: boolean;
};

export type PaidAdsState =
  | "not_connected"
  | "needs_reconnect"
  | "needs_account"
  | "first_sync"
  | "live"
  | "stale"
  | "error";

export type PaidAdsOverview = {
  state: PaidAdsState;
  stateMessage: string | null;
  /** Server-only. */
  source: Source | null;
  /** The Instagram source a Meta Ads OAuth connection starts from. */
  instagramSourceId: string | null;
  accountName: string | null;
  accountId: string | null;
  currency: string;
  timeZone: string;
  /** Today so far in the ad account's time zone; null until a sync has run today. */
  today: { date: string; totals: PaidAdsTotals | null; rates: PaidAdsRates | null; delivering: boolean | null };
  /** Yesterday's full day; null until a sync has run since it ended. */
  yesterday: { date: string; totals: PaidAdsTotals | null; rates: PaidAdsRates | null };
  /** The selected range on the ad account's calendar. */
  period: {
    totals: PaidAdsTotals;
    rates: PaidAdsRates;
    metrics: OverviewMetric[];
    /** False before any data, and for a Today range before the day's first sync; values and campaigns are then unknown. */
    known: boolean;
  };
  daily: PaidAdsDailyPoint[];
  campaigns: PaidAdsCampaignRow[];
  activeCampaigns: number;
  updatedAt: string | null;
  nextSyncAt: string | null;
  syncFrequencyMinutes: number | null;
};

export type PlatformOverview = {
  range: OverviewRange;
  paidAds: PaidAdsOverview | null;
  cards: OverviewPlatformCard[];
  sources: Source[];
  websiteOverview: WebsiteFunnelOverview | null;
};

const RANGE_DAYS: Record<DateRangeKey, number> = { today: 1, "7d": 7, "30d": 30 };
const RANGE_LABELS: Record<DateRangeKey, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDateLabel(dateKey: string) {
  const [, month = "1", day = "1"] = dateKey.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)}`;
}

export function overviewRange(key: DateRangeKey, now: Date = getDemoNow()): OverviewRange {
  const { startDate, endDate } = getAppDateRange(key, now);
  const days = RANGE_DAYS[key];
  const sparklineStart = days >= 7 ? startDate : addDaysToDateKey(endDate, -6);
  return {
    key,
    label: RANGE_LABELS[key],
    days,
    startDate,
    endDate,
    comparison: days === 1
      ? null
      : {
          currentStart: startDate,
          currentEnd: addDaysToDateKey(endDate, -1),
          previousStart: addDaysToDateKey(startDate, -days),
          previousEnd: addDaysToDateKey(endDate, -1 - days),
          basis: `vs previous ${days} days`,
        },
    sparkline: {
      startDate: sparklineStart,
      endDate,
      label: days >= 7 ? RANGE_LABELS[key] : "Last 7 days",
    },
  };
}

function dayDifference(fromDateKey: string, toDateKey: string) {
  return Math.round((Date.parse(`${toDateKey}T00:00:00.000Z`) - Date.parse(`${fromDateKey}T00:00:00.000Z`)) / 86_400_000);
}

/** The same range on another calendar whose today is `endDate`, such as an ad account's. Labels are unchanged. */
export function overviewRangeEndingOn(range: OverviewRange, endDate: string): OverviewRange {
  const offset = dayDifference(range.endDate, endDate);
  if (offset === 0) return range;
  const shift = (dateKey: string) => addDaysToDateKey(dateKey, offset);
  return {
    ...range,
    startDate: shift(range.startDate),
    endDate,
    comparison: range.comparison
      ? {
          ...range.comparison,
          currentStart: shift(range.comparison.currentStart),
          currentEnd: shift(range.comparison.currentEnd),
          previousStart: shift(range.comparison.previousStart),
          previousEnd: shift(range.comparison.previousEnd),
        }
      : null,
    sparkline: { ...range.sparkline, startDate: shift(range.sparkline.startDate), endDate: shift(range.sparkline.endDate) },
  };
}

export function enumerateDateKeys(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDaysToDateKey(date, 1)) dates.push(date);
  return dates;
}

/** Relative change; a zero baseline has no meaningful percentage. */
export function percentChange(current: number, previous: number, basis: string): OverviewDelta {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { kind: "none", reason: "unavailable" };
  if (previous === 0) {
    return current === 0 ? { kind: "percent", value: 0, basis } : { kind: "none", reason: "from_zero", basis };
  }
  return { kind: "percent", value: ((current - previous) / Math.abs(previous)) * 100, basis };
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function nullableChange(
  current: number | null,
  previous: number | null,
  kind: "percent" | "points",
  basis: string,
): OverviewDelta {
  if (current === null || previous === null) return { kind: "none", reason: "no_baseline", basis };
  if (kind === "points") return { kind: "points", value: current - previous, basis };
  return percentChange(current, previous, basis);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Latest row wins when a day was synced more than once. */
function newestFirst(left: MetricDaily, right: MetricDaily) {
  return `${right.date}:${right.updated_at}`.localeCompare(`${left.date}:${left.updated_at}`);
}

// ---------------------------------------------------------------------------
// Summed daily metrics (orders, signups, sessions, …)

/** Sums one metric per date. When `rollup` is given, only rows with that rollup count. */
export function dailySums(rows: MetricDaily[], metricKey: string, sourceId: string, rollup?: string) {
  const sums = new Map<string, number>();
  for (const row of rows) {
    if (row.metric_key !== metricKey || row.source_id !== sourceId) continue;
    if (rollup && row.dimensions.rollup !== rollup) continue;
    sums.set(row.date, (sums.get(row.date) ?? 0) + row.metric_value);
  }
  return sums;
}

function windowSum(sums: Map<string, number>, startDate: string, endDate: string) {
  let total = 0;
  for (const [date, value] of sums) if (date >= startDate && date <= endDate) total += value;
  return total;
}

function zeroFilled(sums: Map<string, number>, startDate: string, endDate: string): OverviewPoint[] {
  return enumerateDateKeys(startDate, endDate).map((date) => ({ date, value: sums.get(date) ?? 0 }));
}

function summedMetric(input: {
  key: string;
  label: string;
  unit: string;
  sums: Map<string, number>;
  range: OverviewRange;
  hasData: boolean;
  higherIsBetter: boolean | null;
}): OverviewMetric {
  const { range, sums } = input;
  if (!input.hasData) {
    return { key: input.key, label: input.label, value: null, unit: input.unit, delta: { kind: "none", reason: "unavailable" }, higherIsBetter: input.higherIsBetter };
  }
  const value = windowSum(sums, range.startDate, range.endDate);
  const delta: OverviewDelta = range.comparison
    ? percentChange(
        windowSum(sums, range.comparison.currentStart, range.comparison.currentEnd),
        windowSum(sums, range.comparison.previousStart, range.comparison.previousEnd),
        range.comparison.basis,
      )
    : { kind: "none", reason: "partial_day" };
  return { key: input.key, label: input.label, value, unit: input.unit, delta, higherIsBetter: input.higherIsBetter };
}

// ---------------------------------------------------------------------------
// Snapshot metrics (followers, totals across recent posts, …)

/**
 * One value per date for a snapshot metric. Rows carrying the expected rollup are
 * preferred; rows without any rollup (older syncs and demo data) are the fallback.
 */
export function snapshotPoints(rows: MetricDaily[], metricKey: string, sourceId: string, rollup: string): OverviewPoint[] {
  const matches = rows.filter((row) => row.metric_key === metricKey && row.source_id === sourceId);
  const withRollup = matches.filter((row) => row.dimensions.rollup === rollup);
  const candidates = withRollup.length > 0 ? withRollup : matches.filter((row) => row.dimensions.rollup === undefined);
  const byDate = new Map<string, MetricDaily>();
  for (const row of [...candidates].sort(newestFirst)) if (!byDate.has(row.date)) byDate.set(row.date, row);
  return [...byDate.values()]
    .map((row) => ({ date: row.date, value: row.metric_value }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function pointAtOrBefore(points: OverviewPoint[], date: string) {
  let found: OverviewPoint | null = null;
  for (const point of points) {
    if (point.date > date) break;
    found = point;
  }
  return found;
}

/**
 * The latest snapshot in the range against the value just before it began. When
 * history starts inside the range, the first snapshot is the baseline instead.
 */
export function snapshotMetric(input: {
  key: string;
  label: string;
  unit: string;
  points: OverviewPoint[];
  range: OverviewRange;
  change: "absolute" | "percent" | "points";
  higherIsBetter: boolean | null;
}): OverviewMetric {
  const { range, points } = input;
  const base = { key: input.key, label: input.label, unit: input.unit, higherIsBetter: input.higherIsBetter };
  const current = pointAtOrBefore(points, range.endDate);
  if (!current) return { ...base, value: null, delta: { kind: "none", reason: "unavailable" } };
  const dayBefore = addDaysToDateKey(range.startDate, -1);
  const baseline = pointAtOrBefore(points, dayBefore)
    ?? points.find((point) => point.date >= range.startDate && point.date <= range.endDate)
    ?? null;
  if (!baseline || baseline.date === current.date) {
    return { ...base, value: current.value, delta: { kind: "none", reason: "no_baseline" } };
  }
  // A snapshot from before the range is the level the range started at, carried forward.
  const basis = baseline.date <= dayBefore
    ? range.days === 1 ? "since yesterday" : `over ${range.days} days`
    : `since ${shortDateLabel(baseline.date)}`;
  const delta: OverviewDelta = input.change === "percent"
    ? percentChange(current.value, baseline.value, basis)
    : { kind: input.change, value: current.value - baseline.value, basis };
  return { ...base, value: current.value, delta };
}

/** Daily series carrying the last known snapshot forward across days without a sync. */
export function forwardFilled(points: OverviewPoint[], startDate: string, endDate: string): OverviewPoint[] {
  const seed = pointAtOrBefore(points, startDate);
  const byDate = new Map(points.map((point) => [point.date, point.value]));
  let last = seed?.value ?? null;
  const series: OverviewPoint[] = [];
  for (const date of enumerateDateKeys(startDate, endDate)) {
    last = byDate.get(date) ?? last;
    if (last !== null) series.push({ date, value: last });
  }
  return series;
}

// ---------------------------------------------------------------------------
// Meta Ads

const META_TOTAL_FIELDS = {
  meta_ads_spend: "spend",
  meta_ads_impressions: "impressions",
  meta_ads_clicks: "clicks",
  meta_ads_inline_link_clicks: "linkClicks",
  meta_ads_outbound_clicks: "outboundClicks",
  meta_ads_landing_page_views: "landingPageViews",
  meta_ads_purchases: "purchases",
  meta_ads_purchase_value: "purchaseValue",
} as const satisfies Record<string, keyof PaidAdsTotals>;

type MetaTotalKey = keyof typeof META_TOTAL_FIELDS;
export const META_ADS_OVERVIEW_METRIC_KEYS = Object.keys(META_TOTAL_FIELDS) as MetaTotalKey[];

export function emptyPaidAdsTotals(): PaidAdsTotals {
  return { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, outboundClicks: 0, landingPageViews: 0, purchases: 0, purchaseValue: 0 };
}

function addTotals(target: PaidAdsTotals, source: PaidAdsTotals) {
  for (const field of Object.keys(target) as Array<keyof PaidAdsTotals>) target[field] += source[field];
  return target;
}

export function paidAdsRates(totals: PaidAdsTotals): PaidAdsRates {
  const ctr = ratio(totals.linkClicks * 100, totals.impressions);
  const cpm = ratio(totals.spend * 1_000, totals.impressions);
  return {
    ctr,
    cpc: ratio(totals.spend, totals.linkClicks),
    cpm,
    roas: totals.purchaseValue > 0 || totals.purchases > 0 ? ratio(totals.purchaseValue, totals.spend) : null,
    costPerPurchase: ratio(totals.spend, totals.purchases),
  };
}

function isMetaTotalKey(value: string): value is MetaTotalKey {
  return Object.hasOwn(META_TOTAL_FIELDS, value);
}

/** Ad-level daily rows for the monitored account only; other rollups never double count. */
export function accountAdRows(rows: MetricDaily[], accountId: string | null) {
  return rows.filter((row) => {
    if (!isMetaTotalKey(row.metric_key)) return false;
    const rollup = row.dimensions.rollup;
    if (rollup !== undefined && rollup !== "ad_daily") return false;
    return metaRowMatchesAccount(row, accountId);
  });
}

export function paidAdsTotalsByDate(rows: MetricDaily[]) {
  const byDate = new Map<string, PaidAdsTotals>();
  for (const row of rows) {
    if (!isMetaTotalKey(row.metric_key)) continue;
    const totals = byDate.get(row.date) ?? emptyPaidAdsTotals();
    totals[META_TOTAL_FIELDS[row.metric_key]] += row.metric_value;
    byDate.set(row.date, totals);
  }
  return byDate;
}

function totalsBetween(byDate: Map<string, PaidAdsTotals>, startDate: string, endDate: string) {
  const totals = emptyPaidAdsTotals();
  for (const [date, value] of byDate) if (date >= startDate && date <= endDate) addTotals(totals, value);
  return totals;
}

function campaignKey(row: MetricDaily) {
  return textValue(row.dimensions.campaign_id) ?? textValue(row.dimensions.campaign_name) ?? "unknown";
}

export function paidAdsCampaigns(rows: MetricDaily[], range: { startDate: string; endDate: string }, today: string): PaidAdsCampaignRow[] {
  const groups = new Map<string, { rows: MetricDaily[]; latest: MetricDaily }>();
  for (const row of rows) {
    const key = campaignKey(row);
    const group = groups.get(key);
    if (!group) groups.set(key, { rows: [row], latest: row });
    else {
      group.rows.push(row);
      if (newestFirst(row, group.latest) < 0) group.latest = row;
    }
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const inRange = group.rows.filter((row) => row.date >= range.startDate && row.date <= range.endDate);
      const totals = totalsBetween(paidAdsTotalsByDate(inRange), range.startDate, range.endDate);
      const todayTotals = totalsBetween(paidAdsTotalsByDate(group.rows), today, today);
      return {
        key,
        name: textValue(group.latest.dimensions.campaign_name) ?? "Unnamed campaign",
        status: textValue(group.latest.dimensions.campaign_status),
        objective: textValue(group.latest.dimensions.campaign_objective),
        totals,
        rates: paidAdsRates(totals),
        deliveringToday: todayTotals.impressions > 0 || todayTotals.spend > 0,
      };
    })
    .filter((campaign) => campaign.totals.impressions > 0 || campaign.totals.spend > 0)
    .sort((left, right) => right.totals.spend - left.totals.spend || right.totals.impressions - left.totals.impressions || left.name.localeCompare(right.name));
}

function dateKeyInTimeZone(now: Date, timeZone: string) {
  const format = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
  };
  try {
    return format(timeZone);
  } catch {
    // An unknown time zone name falls back to Pacific Time.
    return format(APP_TIME_ZONE);
  }
}

function isExpired(value: unknown, now: Date) {
  const expiresAt = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

/** Errors Meta and TikTok return for a lapsed or revoked authorization; only reconnecting fixes them. */
const AUTHORIZATION_ERROR =
  /token expired|reconnect|validating access token|invalid oauth access token|session has (?:expired|been invalidated)|access[_ ]token[_ ]invalid|OAuthException/iu;

export function isAuthorizationError(message: string | null | undefined) {
  return AUTHORIZATION_ERROR.test(message ?? "");
}

/** Campaign statuses are counted over the window every Meta Ads sync rewrites, whatever range is selected. */
const ACTIVE_CAMPAIGN_WINDOW_DAYS = 30;

export function paidAdsState(source: Source | null, now: Date): { state: PaidAdsState; message: string | null } {
  if (!source || source.status === "disabled") {
    return { state: "not_connected", message: "Connect Meta Ads to monitor spend and delivery here." };
  }
  if (source.metadata.oauth_connected !== true || source.status === "needs_credentials") {
    return { state: "not_connected", message: "Connect Meta Ads with read-only ads_read access." };
  }
  if (isExpired(source.metadata.token_expires_at, now) || (source.status === "error" && isAuthorizationError(source.last_error))) {
    return { state: "needs_reconnect", message: "Meta Ads authorization expired. Reconnect to resume syncing." };
  }
  if (!selectedMetaAccountId(source)) {
    return { state: "needs_account", message: "Choose the Meta ad account to monitor." };
  }
  if (source.status === "error") {
    return { state: "error", message: source.last_error ?? "The latest Meta Ads sync failed." };
  }
  if (!source.last_success_at) {
    return { state: "first_sync", message: "Run the first sync to load ad delivery." };
  }
  if (source.status === "warning" || metaSyncIsStale(source, now)) {
    return { state: "stale", message: "The latest sync is overdue. Refresh before relying on these numbers." };
  }
  return { state: "live", message: null };
}

function paidAdsPeriodMetrics(
  byDate: Map<string, PaidAdsTotals>,
  range: OverviewRange,
  currency: string,
  hasData: boolean,
): OverviewMetric[] {
  const totals = totalsBetween(byDate, range.startDate, range.endDate);
  const rates = paidAdsRates(totals);
  const comparison = range.comparison;
  const currentTotals = comparison ? totalsBetween(byDate, comparison.currentStart, comparison.currentEnd) : null;
  const previousTotals = comparison ? totalsBetween(byDate, comparison.previousStart, comparison.previousEnd) : null;
  const currentRates = currentTotals ? paidAdsRates(currentTotals) : null;
  const previousRates = previousTotals ? paidAdsRates(previousTotals) : null;

  // Unknown values have no change either: never "No change" next to an em dash.
  const unknown: OverviewDelta = { kind: "none", reason: "unavailable" };
  const count = (key: keyof PaidAdsTotals): OverviewDelta => !hasData
    ? unknown
    : comparison && currentTotals && previousTotals
      ? percentChange(currentTotals[key], previousTotals[key], comparison.basis)
      : { kind: "none", reason: "partial_day" };
  const rate = (key: keyof PaidAdsRates, kind: "percent" | "points"): OverviewDelta => !hasData
    ? unknown
    : comparison && currentRates && previousRates
      ? nullableChange(currentRates[key], previousRates[key], kind, comparison.basis)
      : { kind: "none", reason: "partial_day" };
  const value = (input: number | null) => (hasData ? input : null);

  return [
    { key: "spend", label: "Spend", value: value(totals.spend), unit: currency, delta: count("spend"), higherIsBetter: null },
    { key: "impressions", label: "Impressions", value: value(totals.impressions), unit: "count", delta: count("impressions"), higherIsBetter: true },
    { key: "link_clicks", label: "Link clicks", value: value(totals.linkClicks), unit: "count", delta: count("linkClicks"), higherIsBetter: true },
    { key: "ctr", label: "CTR (link)", value: value(rates.ctr), unit: "percent", delta: rate("ctr", "points"), higherIsBetter: true },
    { key: "cpc", label: "CPC (link)", value: value(rates.cpc), unit: currency, delta: rate("cpc", "percent"), higherIsBetter: false },
    { key: "cpm", label: "CPM", value: value(rates.cpm), unit: currency, delta: rate("cpm", "percent"), higherIsBetter: false },
    { key: "landing_page_views", label: "Landing page views", value: value(totals.landingPageViews), unit: "count", delta: count("landingPageViews"), higherIsBetter: true },
    { key: "purchases", label: "Purchases", value: value(totals.purchases), unit: "count", delta: count("purchases"), higherIsBetter: true },
    { key: "purchase_value", label: "Purchase value", value: value(totals.purchaseValue), unit: currency, delta: count("purchaseValue"), higherIsBetter: true },
    { key: "roas", label: "ROAS", value: value(rates.roas), unit: "ratio", delta: rate("roas", "percent"), higherIsBetter: true },
    { key: "cost_per_purchase", label: "Cost per purchase", value: value(rates.costPerPurchase), unit: currency, delta: rate("costPerPurchase", "percent"), higherIsBetter: false },
  ];
}

export function buildPaidAdsOverview(input: {
  source: Source | null;
  instagramSourceId: string | null;
  rows: MetricDaily[];
  range: OverviewRange;
  now: Date;
}): PaidAdsOverview {
  const { source, range, now } = input;
  const { state, message } = paidAdsState(source, now);
  const accountId = selectedMetaAccountId(source);
  const rows = accountAdRows(input.rows, accountId).filter((row) => row.source_id === source?.id);
  const newest = [...rows].sort(newestFirst)[0] ?? null;
  const timeZone = textValue(newest?.dimensions.account_timezone)
    ?? textValue(source?.metadata.account_timezone)
    ?? APP_TIME_ZONE;
  const spendUnit = rows.find((row) => row.metric_key === "meta_ads_spend")?.unit.toLowerCase() ?? null;
  const configuredCurrency = textValue(newest?.dimensions.account_currency) ?? textValue(source?.metadata.account_currency);
  const currency = [spendUnit, configuredCurrency?.toLowerCase() ?? null].find((value) => value && /^[a-z]{3}$/u.test(value)) ?? "currency";
  const byDate = paidAdsTotalsByDate(rows);
  const todayDate = dateKeyInTimeZone(now, timeZone);
  const yesterdayDate = addDaysToDateKey(todayDate, -1);
  // Rows are keyed by the ad account's dates, so periods, charts, and campaigns use its calendar too.
  const accountRange = overviewRangeEndingOn(range, todayDate);
  // Today and yesterday are only known once a sync has run today; before that they are unknown, not zero.
  const lastSuccess = source?.last_success_at ? new Date(source.last_success_at) : null;
  const syncedToday = Boolean(lastSuccess && Number.isFinite(lastSuccess.getTime()) && dateKeyInTimeZone(lastSuccess, timeZone) >= todayDate);
  const todayTotals = syncedToday ? totalsBetween(byDate, todayDate, todayDate) : null;
  const yesterdayTotals = syncedToday ? totalsBetween(byDate, yesterdayDate, yesterdayDate) : null;
  const hasData = rows.length > 0 || state === "live" || state === "stale";
  // A Today range is unknown until the day's first sync; longer ranges show the days already synced.
  const periodKnown = hasData && (accountRange.days > 1 || syncedToday);
  const periodTotals = totalsBetween(byDate, accountRange.startDate, accountRange.endDate);
  const activeSince = addDaysToDateKey(todayDate, -(ACTIVE_CAMPAIGN_WINDOW_DAYS - 1));
  const latestStatus = new Map<string, string | null>();
  for (const row of rows.filter((candidate) => candidate.date >= activeSince && candidate.date <= todayDate).sort(newestFirst)) {
    const key = campaignKey(row);
    if (!latestStatus.has(key)) latestStatus.set(key, textValue(row.dimensions.campaign_status));
  }

  return {
    state,
    stateMessage: message,
    source,
    instagramSourceId: input.instagramSourceId,
    accountName: textValue(newest?.dimensions.account_name) ?? textValue(source?.metadata.ad_account_name) ?? source?.account_name ?? null,
    accountId,
    currency,
    timeZone,
    today: {
      date: todayDate,
      totals: todayTotals,
      rates: todayTotals ? paidAdsRates(todayTotals) : null,
      delivering: todayTotals ? todayTotals.impressions > 0 || todayTotals.spend > 0 : null,
    },
    yesterday: { date: yesterdayDate, totals: yesterdayTotals, rates: yesterdayTotals ? paidAdsRates(yesterdayTotals) : null },
    period: {
      totals: periodTotals,
      rates: paidAdsRates(periodTotals),
      metrics: paidAdsPeriodMetrics(byDate, accountRange, currency, periodKnown),
      known: periodKnown,
    },
    daily: enumerateDateKeys(accountRange.sparkline.startDate, accountRange.sparkline.endDate).map((date) => ({
      date,
      ...(byDate.get(date) ?? emptyPaidAdsTotals()),
    })),
    campaigns: periodKnown ? paidAdsCampaigns(rows, accountRange, todayDate) : [],
    activeCampaigns: [...latestStatus.values()].filter((status) => status === "ACTIVE").length,
    updatedAt: source?.last_success_at ?? null,
    nextSyncAt: source?.next_sync_at ?? null,
    syncFrequencyMinutes: source?.sync_frequency_minutes ?? null,
  };
}

// ---------------------------------------------------------------------------
// Platform cards

function sourceRank(source: Source) {
  if (source.status === "healthy" && source.metadata.oauth_connected === true) return 0;
  if (source.status === "healthy") return 1;
  if (source.status === "warning" || source.status === "error") return 2;
  if (source.status === "needs_credentials") return 3;
  return 4;
}

/** The source a platform card represents: the healthiest, most recently synced one. */
export function primarySource(sources: Source[], sourceTypeKey: SourceTypeKey) {
  return sources
    .filter((source) => source.source_type_key === sourceTypeKey && source.status !== "disabled")
    .sort((left, right) =>
      sourceRank(left) - sourceRank(right)
      || (right.last_success_at ?? "").localeCompare(left.last_success_at ?? "")
      || left.display_name.localeCompare(right.display_name))[0] ?? null;
}

function lastSyncedAt(source: Source | null) {
  if (!source) return null;
  return source.last_success_at ?? source.last_webhook_sync_at ?? null;
}

function unavailableMetric(key: string, label: string, unit: string, higherIsBetter: boolean | null): OverviewMetric {
  return { key, label, value: null, unit, delta: { kind: "none", reason: "unavailable" }, higherIsBetter };
}

function socialHandle(source: Source | null, metadataKey: string) {
  const handle = textValue(source?.metadata[metadataKey]) ?? textValue(source?.account_name);
  if (!handle) return null;
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function websiteFunnelCard(source: Source | null, overview: WebsiteFunnelOverview, sessions: OverviewPoint[], range: OverviewRange): OverviewPlatformCard {
  const unavailable = overview.dataState === "pre_coverage" || overview.dataState === "source_unavailable";
  const comparisonOn = overview.comparison.mode === "previous" && overview.comparison.available;
  const basis = range.key === "today" ? "vs yesterday, same time" : `vs previous ${range.days} days`;
  const stage = (key: "visit" | "begin_checkout", label: string, metricKey: string): OverviewMetric => {
    const found = overview.stages.find((candidate) => candidate.key === key);
    if (unavailable || !found || !found.measured) return unavailableMetric(metricKey, label, "count", true);
    const delta: OverviewDelta = !comparisonOn
      ? { kind: "none", reason: "no_baseline" }
      : found.deltaPercent !== null
        ? { kind: "percent", value: found.deltaPercent, basis }
        : found.previousSessions === null
          ? { kind: "none", reason: "no_baseline", basis }
          : percentChange(found.sessions, found.previousSessions, basis);
    return { key: metricKey, label, value: found.sessions, unit: "count", delta, higherIsBetter: true };
  };
  return {
    key: "website",
    iconKey: "website",
    title: "Website",
    account: source?.account_name ?? textValue(source?.normalized_url)?.replace(/^https?:\/\//u, "") ?? null,
    source,
    primary: stage("visit", "Sessions", "sessions"),
    secondary: [
      unavailable
        ? unavailableMetric("visitors", "Visitors", "count", true)
        // Distinct visitors are counted once per period, so there is no like-for-like previous value.
        : { key: "visitors", label: "Visitors", value: overview.uniqueVisitors, unit: "count", delta: { kind: "none", reason: "unavailable" }, higherIsBetter: true },
      stage("begin_checkout", "Checkout starts", "checkout_starts"),
    ],
    sparkline: { label: `Daily sessions, ${range.sparkline.label.toLowerCase()}`, points: sessions },
    updatedAt: overview.coverage.latestReceivedAt ?? lastSyncedAt(source),
    unavailableReason: !source
      ? "Add the first-party Website Tracker to measure visits."
      : unavailable
        ? "No tracked Website events in this period yet."
        : null,
  };
}

function websiteMetricsCard(source: Source | null, rows: MetricDaily[], range: OverviewRange): OverviewPlatformCard {
  const sourceId = source?.id ?? "";
  const pageViews = dailySums(rows, "page_views", sourceId);
  const sessions = dailySums(rows, "sessions", sourceId);
  const events = dailySums(rows, "custom_events", sourceId);
  return {
    key: "website",
    iconKey: "website",
    title: "Website",
    account: source?.account_name ?? null,
    source,
    primary: summedMetric({ key: "page_views", label: "Page views", unit: "count", sums: pageViews, range, hasData: pageViews.size > 0, higherIsBetter: true }),
    secondary: [
      summedMetric({ key: "sessions", label: "Sessions", unit: "count", sums: sessions, range, hasData: sessions.size > 0, higherIsBetter: true }),
      summedMetric({ key: "custom_events", label: "Events", unit: "count", sums: events, range, hasData: events.size > 0, higherIsBetter: true }),
    ],
    sparkline: { label: `Daily page views, ${range.sparkline.label.toLowerCase()}`, points: zeroFilled(pageViews, range.sparkline.startDate, range.sparkline.endDate) },
    updatedAt: lastSyncedAt(source),
    unavailableReason: source ? null : "Add a Website source to measure visits.",
  };
}

/** Shopify values are withheld until the source is live and has synced successfully. */
export function shopifyUnavailableReason(source: Source | null) {
  if (!source) return "Connect Shopify to see orders and revenue.";
  if (source.status === "needs_credentials") return "Finish the read-only Shopify setup to load orders.";
  if (source.status === "demo" || source.status === "disabled") return "Shopify is not live yet.";
  if (source.status === "error" || source.last_error) return "The latest Shopify sync failed, so values are withheld.";
  if (source.status === "warning" || !source.last_success_at) return "Shopify is awaiting its first successful sync.";
  return null;
}

function shopifyCard(source: Source | null, rows: MetricDaily[], range: OverviewRange): OverviewPlatformCard {
  const sourceId = source?.id ?? "";
  const unavailableReason = shopifyUnavailableReason(source);
  const net = dailySums(rows, "net_payment", sourceId, "daily_order_summary");
  const orders = dailySums(rows, "orders", sourceId, "daily_order_summary");
  const currency = rows.find((row) => row.source_id === sourceId && row.metric_key === "net_payment")?.unit.toLowerCase() ?? "usd";
  const ready = unavailableReason === null;
  const primary = ready
    ? summedMetric({ key: "net_payment", label: "Net payment", unit: currency, sums: net, range, hasData: true, higherIsBetter: true })
    : unavailableMetric("net_payment", "Net payment", currency, true);
  const orderMetric = ready
    ? summedMetric({ key: "orders", label: "Orders", unit: "count", sums: orders, range, hasData: true, higherIsBetter: true })
    : unavailableMetric("orders", "Orders", "count", true);
  const aov = (start: string, end: string) => ratio(windowSum(net, start, end), windowSum(orders, start, end));
  const aovMetric: OverviewMetric = ready
    ? {
        key: "average_order_value",
        label: "Avg. order value",
        value: aov(range.startDate, range.endDate),
        unit: currency,
        delta: range.comparison
          ? nullableChange(aov(range.comparison.currentStart, range.comparison.currentEnd), aov(range.comparison.previousStart, range.comparison.previousEnd), "percent", range.comparison.basis)
          : { kind: "none", reason: "partial_day" },
        higherIsBetter: true,
      }
    : unavailableMetric("average_order_value", "Avg. order value", currency, true);
  return {
    key: "shopify",
    iconKey: "shopify",
    title: "Shopify",
    account: source?.account_name ?? null,
    source,
    primary,
    secondary: [orderMetric, aovMetric],
    sparkline: { label: `Daily net payment, ${range.sparkline.label.toLowerCase()}`, points: ready ? zeroFilled(net, range.sparkline.startDate, range.sparkline.endDate) : [] },
    updatedAt: lastSyncedAt(source),
    unavailableReason,
  };
}

function socialCard(input: {
  key: "instagram" | "tiktok";
  source: Source | null;
  rows: MetricDaily[];
  range: OverviewRange;
}): OverviewPlatformCard {
  const { key, source, rows, range } = input;
  const sourceId = source?.id ?? "";
  const instagram = key === "instagram";
  const followerPoints = snapshotPoints(rows, instagram ? "instagram_followers" : "tiktok_followers", sourceId, instagram ? "snapshot" : "account_snapshot");
  const reachPoints = snapshotPoints(rows, instagram ? "instagram_media_reach" : "tiktok_video_views", sourceId, instagram ? "media_sync_total" : "video_sync_total");
  const engagementPoints = snapshotPoints(rows, instagram ? "instagram_engagement_rate" : "tiktok_engagement_rate", sourceId, instagram ? "media_sync_total" : "video_sync_total");
  const followers = snapshotMetric({ key: "followers", label: "Followers", unit: "count", points: followerPoints, range, change: "absolute", higherIsBetter: true });
  const reach = snapshotMetric({
    key: instagram ? "media_reach" : "video_views",
    label: instagram ? "Post reach" : "Video views",
    unit: "count",
    points: reachPoints,
    range,
    change: "percent",
    higherIsBetter: true,
  });
  const engagement = snapshotMetric({ key: "engagement_rate", label: "Engagement", unit: "percent", points: engagementPoints, range, change: "points", higherIsBetter: true });
  return {
    key,
    iconKey: key,
    title: instagram ? "Instagram" : "TikTok",
    account: socialHandle(source, instagram ? "instagram_username" : "tiktok_username"),
    source,
    primary: followers,
    secondary: [reach, engagement],
    // The trend always mirrors the headline number above it.
    sparkline: { label: `Followers, ${range.sparkline.label.toLowerCase()}`, points: forwardFilled(followerPoints, range.sparkline.startDate, range.sparkline.endDate) },
    updatedAt: lastSyncedAt(source),
    unavailableReason: source ? null : `Connect ${instagram ? "Instagram" : "TikTok"} to follow audience growth.`,
  };
}

function supabaseCard(source: Source | null, sumRows: MetricDaily[], snapshotRows: MetricDaily[], range: OverviewRange): OverviewPlatformCard {
  const sourceId = source?.id ?? "";
  const signups = dailySums(sumRows, "signups", sourceId);
  const usersPoints = snapshotPoints(snapshotRows, "users_total", sourceId, "snapshot");
  const confirmedPoints = snapshotPoints(snapshotRows, "confirmed_users", sourceId, "snapshot");
  // The connector only writes days that had signups, so a source that synced during the range and has no rows had none.
  const lastSuccess = source?.last_success_at ? new Date(source.last_success_at) : null;
  const lastSuccessDate = lastSuccess && Number.isFinite(lastSuccess.getTime()) ? dateKeyInTimeZone(lastSuccess, APP_TIME_ZONE) : null;
  const hasSignupData = signups.size > 0 || (lastSuccessDate !== null && lastSuccessDate >= range.startDate);
  return {
    key: "supabase",
    iconKey: "supabase",
    title: "Supabase",
    account: source?.account_name ?? null,
    source,
    primary: summedMetric({ key: "signups", label: "New signups", unit: "count", sums: signups, range, hasData: hasSignupData, higherIsBetter: true }),
    secondary: [
      snapshotMetric({ key: "users_total", label: "Total users", unit: "count", points: usersPoints, range, change: "absolute", higherIsBetter: true }),
      snapshotMetric({ key: "confirmed_users", label: "Confirmed", unit: "count", points: confirmedPoints, range, change: "absolute", higherIsBetter: true }),
    ],
    sparkline: { label: `Daily signups, ${range.sparkline.label.toLowerCase()}`, points: hasSignupData ? zeroFilled(signups, range.sparkline.startDate, range.sparkline.endDate) : [] },
    updatedAt: lastSyncedAt(source),
    unavailableReason: source ? null : "Connect Supabase to follow signups.",
  };
}

// ---------------------------------------------------------------------------
// Whatnot (weekly report imports)

const WHATNOT_ROLLUP = "weekly_report";

type CoveredRun = ReportCoverage["coveredRuns"][number];

/** Mondays (UTC) of the report weeks imported for a source. */
export function whatnotReportWeeks(rows: MetricDaily[], sourceId: string) {
  const weeks = new Set<string>();
  for (const row of rows) {
    if (row.source_id !== sourceId || row.dimensions.rollup !== WHATNOT_ROLLUP) continue;
    if (isReportWeek(row.dimensions.report_week)) weeks.add(row.dimensions.report_week);
  }
  return [...weeks].sort();
}

/**
 * Which Pacific days the imported weekly reports cover completely, which weeks
 * between the first and latest import are missing, and which newer reports
 * Whatnot has published since. A report runs Monday 00:00 to Sunday 23:59 UTC, so
 * on its own it completes Monday through Saturday in Los Angeles, and a Sunday
 * counts once the reports on both sides of it are imported.
 */
export function whatnotCoverage(reportWeeks: string[], now: Date): ReportCoverage {
  const weeks = [...new Set(reportWeeks.filter(isReportWeek))].sort();
  const coveredRuns = coveredDateRuns(weeks);
  const imported = new Set(weeks);
  const first = weeks[0] ?? null;
  const latest = weeks.at(-1) ?? null;
  const missingWeeks: string[] = [];
  if (first && latest) {
    for (let week = addDaysToDateKey(first, 7); week < latest; week = addDaysToDateKey(week, 7)) {
      if (!imported.has(week)) missingWeeks.push(week);
    }
  }
  const pendingWeeks: string[] = [];
  if (latest) {
    const published = latestPublishedReportWeek(now);
    for (let week = addDaysToDateKey(latest, 7); week <= published; week = addDaysToDateKey(week, 7)) pendingWeeks.push(week);
  }
  return {
    coveredRuns,
    coveredFrom: coveredRuns[0]?.from ?? null,
    coveredThrough: coveredRuns.at(-1)?.through ?? null,
    missingWeeks,
    pendingWeeks,
    newReportAvailable: pendingWeeks.length > 0,
  };
}

export function isCoveredDate(runs: CoveredRun[], date: string) {
  return runs.some((run) => date >= run.from && date <= run.through);
}

function fullyCovered(runs: CoveredRun[], startDate: string, endDate: string) {
  for (let date = startDate; date <= endDate; date = addDaysToDateKey(date, 1)) {
    if (!isCoveredDate(runs, date)) return false;
  }
  return true;
}

/** Missing weeks whose days fall in a window: Monday to Saturday, plus the Sundays on either side they share. */
function missingWeeksIn(coverage: ReportCoverage, startDate: string, endDate: string) {
  return coverage.missingWeeks.filter((week) => addDaysToDateKey(week, -1) <= endDate && addDaysToDateKey(week, 6) >= startDate);
}

function minDate(left: string, right: string) {
  return left <= right ? left : right;
}

function maxDate(left: string, right: string) {
  return left >= right ? left : right;
}

/**
 * The range clipped to the days the imported reports cover, and the same days one
 * period earlier for the change. Values add up covered days only; a window with a
 * missing week inside is incomplete, and a comparison needs both windows fully
 * covered. Null when no imported report covers the range.
 */
export function coveredWindows(range: OverviewRange, coverage: ReportCoverage) {
  if (!coverage.coveredFrom || !coverage.coveredThrough) return null;
  const start = maxDate(range.startDate, coverage.coveredFrom);
  const end = minDate(range.endDate, coverage.coveredThrough);
  if (start > end) return null;
  const base = {
    start,
    end,
    coveredRuns: coverage.coveredRuns,
    missingWeeks: missingWeeksIn(coverage, start, end),
    complete: fullyCovered(coverage.coveredRuns, start, end),
  };
  const comparison = range.comparison;
  if (!comparison) return { ...base, comparison: null };
  const currentEnd = minDate(comparison.currentEnd, end);
  if (start > currentEnd) return { ...base, comparison: null };
  const previousStart = addDaysToDateKey(start, -range.days);
  const previousEnd = addDaysToDateKey(currentEnd, -range.days);
  return {
    ...base,
    comparison: {
      currentStart: start,
      currentEnd,
      previousStart,
      previousEnd,
      basis: comparison.basis,
      currentComplete: fullyCovered(coverage.coveredRuns, start, currentEnd),
      previousComplete: fullyCovered(coverage.coveredRuns, previousStart, previousEnd),
    },
  };
}

type CoveredWindows = NonNullable<ReturnType<typeof coveredWindows>>;

/** "Sep 21 – Sep 27": the Monday-to-Sunday (UTC) span of a report week. */
export function reportWeekSpanLabel(reportWeek: string) {
  return `${shortDateLabel(reportWeek)} – ${shortDateLabel(addDaysToDateKey(reportWeek, 6))}`;
}

function missingWeeksBasis(weeks: string[]) {
  if (weeks.length === 1) return `The week of ${reportWeekSpanLabel(weeks[0])} is not imported`;
  return `${weeks.length} weeks in this period are not imported`;
}

/** Sum over the covered days of a window; days without a complete report never count, not even as zero. */
function coveredSum(sums: Map<string, number>, runs: CoveredRun[], startDate: string, endDate: string) {
  let total = 0;
  for (const [date, value] of sums) {
    if (date >= startDate && date <= endDate && isCoveredDate(runs, date)) total += value;
  }
  return total;
}

/** Why a change cannot be shown, or null when both windows are fully covered. */
function coverageDeltaBlock(windows: CoveredWindows): OverviewDelta | null {
  const comparison = windows.comparison;
  if (!comparison) return { kind: "none", reason: "unavailable" };
  if (!comparison.currentComplete) return { kind: "none", reason: "incomplete", basis: missingWeeksBasis(windows.missingWeeks) };
  if (!comparison.previousComplete) {
    return { kind: "none", reason: "no_baseline", basis: "The same days one period earlier are not fully imported" };
  }
  return null;
}

function coveredSummedMetric(input: {
  key: string;
  label: string;
  unit: string;
  sums: Map<string, number>;
  windows: CoveredWindows | null;
  higherIsBetter: boolean | null;
}): OverviewMetric {
  const { windows, sums } = input;
  if (!windows) return unavailableMetric(input.key, input.label, input.unit, input.higherIsBetter);
  const comparison = windows.comparison;
  const delta: OverviewDelta = coverageDeltaBlock(windows) ?? (comparison
    ? percentChange(
        coveredSum(sums, windows.coveredRuns, comparison.currentStart, comparison.currentEnd),
        coveredSum(sums, windows.coveredRuns, comparison.previousStart, comparison.previousEnd),
        comparison.basis,
      )
    : { kind: "none", reason: "unavailable" });
  return {
    key: input.key,
    label: input.label,
    value: coveredSum(sums, windows.coveredRuns, windows.start, windows.end),
    unit: input.unit,
    delta,
    higherIsBetter: input.higherIsBetter,
  };
}

function coveredRatioMetric(input: {
  key: string;
  label: string;
  unit: string;
  numerator: Map<string, number>;
  denominator: Map<string, number>;
  windows: CoveredWindows | null;
  higherIsBetter: boolean | null;
}): OverviewMetric {
  const { windows } = input;
  if (!windows) return unavailableMetric(input.key, input.label, input.unit, input.higherIsBetter);
  const value = (startDate: string, endDate: string) => ratio(
    coveredSum(input.numerator, windows.coveredRuns, startDate, endDate),
    coveredSum(input.denominator, windows.coveredRuns, startDate, endDate),
  );
  const comparison = windows.comparison;
  const delta: OverviewDelta = coverageDeltaBlock(windows) ?? (comparison
    ? nullableChange(
        value(comparison.currentStart, comparison.currentEnd),
        value(comparison.previousStart, comparison.previousEnd),
        "percent",
        comparison.basis,
      )
    : { kind: "none", reason: "unavailable" });
  return {
    key: input.key,
    label: input.label,
    value: value(windows.start, windows.end),
    unit: input.unit,
    delta,
    higherIsBetter: input.higherIsBetter,
  };
}

/** The currency of the newest real sale; zero rows (such as a week recorded as having no sales) never decide it. */
function whatnotCurrency(rows: MetricDaily[], sourceId: string) {
  const sales = rows.filter((row) => row.source_id === sourceId && row.metric_key === "whatnot_sales");
  const newest = [...sales].sort((left, right) => right.date.localeCompare(left.date));
  const unit = (newest.find((row) => row.metric_value !== 0) ?? newest[0])?.unit.toLowerCase() ?? null;
  return unit && /^[a-z]{3}$/u.test(unit) ? unit : "usd";
}

function whatnotSums(rows: MetricDaily[], sourceId: string) {
  return {
    sales: dailySums(rows, "whatnot_sales", sourceId, WHATNOT_ROLLUP),
    orders: dailySums(rows, "whatnot_orders", sourceId, WHATNOT_ROLLUP),
    items: dailySums(rows, "whatnot_items_sold", sourceId, WHATNOT_ROLLUP),
    net: dailySums(rows, "whatnot_net_earnings", sourceId, WHATNOT_ROLLUP),
    fees: dailySums(rows, "whatnot_fees", sourceId, WHATNOT_ROLLUP),
    refunds: dailySums(rows, "whatnot_refunds", sourceId, WHATNOT_ROLLUP),
    tips: dailySums(rows, "whatnot_tips", sourceId, WHATNOT_ROLLUP),
  };
}

/**
 * One value per day from the first to the last covered day in the chart window.
 * Days inside a missing week are null, so they read as "not imported", never as zero.
 */
function coveredDailySeries(sums: Map<string, number>, range: OverviewRange, coverage: ReportCoverage) {
  if (!coverage.coveredFrom || !coverage.coveredThrough) return [];
  const start = maxDate(range.sparkline.startDate, coverage.coveredFrom);
  const end = minDate(range.sparkline.endDate, coverage.coveredThrough);
  if (start > end) return [];
  return enumerateDateKeys(start, end).map((date) => ({
    date,
    value: isCoveredDate(coverage.coveredRuns, date) ? sums.get(date) ?? 0 : null,
  }));
}

/** The card's trend: the most recent unbroken stretch of covered days, so a line never bridges a missing week. */
function latestCoveredStretch(sums: Map<string, number>, range: OverviewRange, coverage: ReportCoverage): OverviewPoint[] {
  const series = coveredDailySeries(sums, range, coverage);
  const points: OverviewPoint[] = [];
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const point = series[index];
    if (point.value === null) break;
    points.unshift({ date: point.date, value: point.value });
  }
  return points;
}

export function whatnotCard(input: {
  source: Source | null;
  rows: MetricDaily[];
  reportWeeks: string[];
  range: OverviewRange;
  now: Date;
}): OverviewPlatformCard {
  const { source, rows, range } = input;
  const sourceId = source?.id ?? "";
  const coverage = whatnotCoverage(input.reportWeeks, input.now);
  const windows = coveredWindows(range, coverage);
  const sums = whatnotSums(rows, sourceId);
  const currency = whatnotCurrency(rows, sourceId);
  return {
    key: "whatnot",
    iconKey: "whatnot",
    title: "Whatnot",
    account: source?.account_name ?? null,
    source,
    primary: coveredSummedMetric({ key: "sales", label: "Completed sales", unit: currency, sums: sums.sales, windows, higherIsBetter: true }),
    secondary: [
      coveredSummedMetric({ key: "orders", label: "Orders", unit: "count", sums: sums.orders, windows, higherIsBetter: true }),
      coveredSummedMetric({ key: "net_earnings", label: "Net earnings", unit: currency, sums: sums.net, windows, higherIsBetter: true }),
    ],
    sparkline: { label: `Daily completed sales, ${range.sparkline.label.toLowerCase()}`, points: latestCoveredStretch(sums.sales, range, coverage) },
    updatedAt: lastSyncedAt(source),
    unavailableReason: !source
      ? "Add Whatnot, then import its weekly orders report."
      : coverage.coveredRuns.length === 0
        ? "Import your first Whatnot weekly orders report."
        : null,
    coverage,
  };
}

export type WhatnotShowRow = {
  id: string;
  title: string | null;
  /** The Pacific day the show ran: its earliest order. */
  date: string;
  sales: number;
  orders: number;
  items: number;
};

export type WhatnotWeekStatus = "imported" | "no_sales" | "missing" | "ready";

/** One report week on the Whatnot page: imported, recorded as having no sales, missing between imports, or published and not imported yet. */
export type WhatnotWeekRow = { reportWeek: string; status: WhatnotWeekStatus };

/**
 * Every report week from the newest Whatnot has published back to the first one
 * imported, newest first. A week the seller recorded as having no sales carries
 * that marker on its rows.
 */
export function whatnotWeekRows(weekRows: MetricDaily[], sourceId: string, coverage: ReportCoverage): WhatnotWeekRow[] {
  const imported = new Map<string, WhatnotWeekStatus>();
  for (const row of weekRows) {
    if (row.source_id !== sourceId || row.dimensions.rollup !== WHATNOT_ROLLUP || !isReportWeek(row.dimensions.report_week)) continue;
    imported.set(row.dimensions.report_week, row.dimensions.recorded_as === "no_sales" ? "no_sales" : "imported");
  }
  const missing = new Set(coverage.missingWeeks);
  const weeks = [...new Set([...imported.keys(), ...missing, ...coverage.pendingWeeks])].sort().reverse();
  return weeks.map((reportWeek) => ({
    reportWeek,
    status: imported.get(reportWeek) ?? (missing.has(reportWeek) ? "missing" : "ready"),
  }));
}

export type WhatnotDetail = {
  range: OverviewRange;
  source: Source | null;
  card: OverviewPlatformCard;
  coverage: ReportCoverage;
  /** Report weeks with their status, newest first. */
  weeks: WhatnotWeekRow[];
  /** The covered part of the selected range, or null when no imported report covers it. */
  period: { start: string; end: string; missingWeeks: string[] } | null;
  currency: string;
  metrics: OverviewMetric[];
  /** Null on days inside a missing week. */
  daily: Array<{ date: string; sales: number | null; orders: number | null }>;
  shows: WhatnotShowRow[];
  /** Imported report weeks, newest first. */
  reportWeeks: string[];
};

/**
 * Completed sales by show in the covered part of the range; sales outside a show
 * are one marketplace row. A show's orders complete over the days after it ran,
 * and each report week stores its share, so rows are summed per Livestream ID.
 */
export function whatnotShows(rows: MetricDaily[], sourceId: string, windows: CoveredWindows | null): WhatnotShowRow[] {
  if (!windows) return [];
  const shows = new Map<string, WhatnotShowRow>();
  /** The report week each show's title came from: the newest report names the show, in case it was renamed. */
  const titleWeeks = new Map<string, string>();
  for (const row of rows) {
    if (row.source_id !== sourceId || row.dimensions.rollup !== "show") continue;
    if (row.date < windows.start || row.date > windows.end || !isCoveredDate(windows.coveredRuns, row.date)) continue;
    const id = textValue(row.dimensions.livestream_id) ?? "marketplace";
    const showDate = isAppDateKey(row.dimensions.show_date) ? row.dimensions.show_date : row.date;
    const week = textValue(row.dimensions.report_week) ?? "";
    const show = shows.get(id) ?? { id, title: null, date: showDate, sales: 0, orders: 0, items: 0 };
    const title = textValue(row.dimensions.livestream_title);
    if (title && week >= (titleWeeks.get(id) ?? "")) {
      show.title = title;
      titleWeeks.set(id, week);
    }
    if (showDate < show.date) show.date = showDate;
    if (row.metric_key === "whatnot_show_sales") show.sales += row.metric_value;
    if (row.metric_key === "whatnot_show_orders") show.orders += row.metric_value;
    if (row.metric_key === "whatnot_show_items") show.items += row.metric_value;
    shows.set(id, show);
  }
  return [...shows.values()]
    .map((show) => ({ ...show, sales: Math.round(show.sales * 100) / 100 }))
    .filter((show) => show.sales !== 0 || show.orders > 0)
    .sort((left, right) => right.sales - left.sales || right.orders - left.orders || left.date.localeCompare(right.date));
}

export const WHATNOT_METRIC_KEYS: string[] = [...WHATNOT_DAILY_METRIC_KEYS, ...WHATNOT_SHOW_METRIC_KEYS];

export async function getWhatnotDetail(input: {
  dataSpace: Pick<DataSpace, "id" | "slug">;
  rangeKey: DateRangeKey;
  now?: Date;
}): Promise<WhatnotDetail> {
  const now = input.now ?? getDemoNow();
  const range = overviewRange(input.rangeKey, now);
  const sources = await listSources({ dataSpaceId: input.dataSpace.id });
  const source = primarySource(sources, "whatnot");
  const sourceId = source?.id ?? "";
  const [weekRows, rows] = source
    ? await Promise.all([
        listMetrics({ sourceId: source.id, metricKeys: ["whatnot_net_earnings"], dataSpaceId: input.dataSpace.id }),
        listMetrics({
          sourceId: source.id,
          metricKeys: WHATNOT_METRIC_KEYS,
          startDate: [range.comparison?.previousStart, range.sparkline.startDate].filter((value): value is string => Boolean(value)).sort()[0],
          endDate: range.endDate,
          dataSpaceId: input.dataSpace.id,
        }),
      ])
    : [[], []];
  const reportWeeks = whatnotReportWeeks(weekRows, sourceId);
  const coverage = whatnotCoverage(reportWeeks, now);
  const windows = coveredWindows(range, coverage);
  const sums = whatnotSums(rows, sourceId);
  const currency = whatnotCurrency(rows, sourceId);
  const card = whatnotCard({ source, rows, reportWeeks, range, now });
  const metric = (key: string, label: string, unit: string, values: Map<string, number>, higherIsBetter: boolean | null) =>
    coveredSummedMetric({ key, label, unit, sums: values, windows, higherIsBetter });
  return {
    range,
    source,
    card,
    coverage,
    weeks: whatnotWeekRows(weekRows, sourceId, coverage),
    period: windows ? { start: windows.start, end: windows.end, missingWeeks: windows.missingWeeks } : null,
    currency,
    metrics: [
      metric("sales", "Completed sales", currency, sums.sales, true),
      metric("orders", "Orders", "count", sums.orders, true),
      metric("items_sold", "Items sold", "count", sums.items, true),
      coveredRatioMetric({ key: "average_order_value", label: "Avg. order value", unit: currency, numerator: sums.sales, denominator: sums.orders, windows, higherIsBetter: true }),
      metric("net_earnings", "Net earnings", currency, sums.net, true),
      metric("fees", "Fees", currency, sums.fees, false),
      metric("refunds", "Refunds", currency, sums.refunds, false),
      metric("tips", "Tips", currency, sums.tips, true),
    ],
    daily: coveredDailySeries(sums.sales, range, coverage).map((point) => ({
      date: point.date,
      sales: point.value,
      orders: point.value === null ? null : sums.orders.get(point.date) ?? 0,
    })),
    shows: whatnotShows(rows, sourceId, windows),
    reportWeeks: [...reportWeeks].reverse(),
  };
}

// ---------------------------------------------------------------------------
// Etsy (Open API v3 receipts)

function etsyUnavailableReason(source: Source | null) {
  if (!source) return "Add Etsy, then connect your shop.";
  if (source.metadata.oauth_connected !== true) return "Connect Etsy to see orders and sales.";
  if (!source.last_success_at) return "Waiting for the first Etsy sync.";
  return null;
}

/** The currency of the newest real sale, else the shop's, so zero days never decide it. */
function etsyCurrency(rows: MetricDaily[], source: Source | null) {
  const sales = rows
    .filter((row) => row.source_id === source?.id && row.metric_key === "etsy_sales" && row.metric_value !== 0)
    .sort((left, right) => right.date.localeCompare(left.date));
  const unit = sales[0]?.unit.toLowerCase() ?? textValue(source?.metadata.etsy_currency)?.toLowerCase() ?? null;
  return unit && /^[a-z]{3}$/u.test(unit) ? unit : "usd";
}

/** The shop's active listings at the latest sync; a level, so it shows no period change. */
function etsyActiveListings(rows: MetricDaily[], sourceId: string): OverviewMetric {
  const latest = rows
    .filter((row) => row.source_id === sourceId && row.metric_key === "etsy_active_listings")
    .sort(newestFirst)[0];
  return {
    key: "active_listings",
    label: "Active listings",
    value: latest?.metric_value ?? null,
    unit: "count",
    delta: { kind: "none", reason: "unavailable" },
    higherIsBetter: true,
  };
}

function etsySums(rows: MetricDaily[], sourceId: string) {
  return {
    sales: dailySums(rows, "etsy_sales", sourceId, "daily"),
    orders: dailySums(rows, "etsy_orders", sourceId, "daily"),
    units: dailySums(rows, "etsy_units_sold", sourceId, "daily"),
    refunds: dailySums(rows, "etsy_refunds", sourceId, "daily"),
  };
}

export function etsyCard(source: Source | null, rows: MetricDaily[], range: OverviewRange): OverviewPlatformCard {
  const sourceId = source?.id ?? "";
  const unavailableReason = etsyUnavailableReason(source);
  const ready = unavailableReason === null;
  const sums = etsySums(rows, sourceId);
  const currency = etsyCurrency(rows, source);
  return {
    key: "etsy",
    iconKey: "etsy",
    title: "Etsy",
    account: source?.account_name ?? null,
    source,
    primary: ready
      ? summedMetric({ key: "sales", label: "Sales", unit: currency, sums: sums.sales, range, hasData: true, higherIsBetter: true })
      : unavailableMetric("sales", "Sales", currency, true),
    secondary: [
      ready
        ? summedMetric({ key: "orders", label: "Orders", unit: "count", sums: sums.orders, range, hasData: true, higherIsBetter: true })
        : unavailableMetric("orders", "Orders", "count", true),
      ready ? etsyActiveListings(rows, sourceId) : unavailableMetric("active_listings", "Active listings", "count", true),
    ],
    sparkline: { label: `Daily sales, ${range.sparkline.label.toLowerCase()}`, points: ready ? zeroFilled(sums.sales, range.sparkline.startDate, range.sparkline.endDate) : [] },
    updatedAt: lastSyncedAt(source),
    unavailableReason,
  };
}

export type EtsyDetail = {
  range: OverviewRange;
  source: Source | null;
  card: OverviewPlatformCard;
  currency: string;
  metrics: OverviewMetric[];
  dailySales: OverviewPoint[];
  dailyOrders: OverviewPoint[];
};

export async function getEtsyDetail(input: {
  dataSpace: Pick<DataSpace, "id" | "slug">;
  rangeKey: DateRangeKey;
  now?: Date;
}): Promise<EtsyDetail> {
  const now = input.now ?? getDemoNow();
  const range = overviewRange(input.rangeKey, now);
  const sources = await listSources({ dataSpaceId: input.dataSpace.id });
  const source = primarySource(sources, "etsy");
  const queryStart = [range.comparison?.previousStart, range.sparkline.startDate].filter((value): value is string => Boolean(value)).sort()[0];
  const rows = source
    ? await listMetrics({ sourceId: source.id, metricKeys: ETSY_METRIC_KEYS, startDate: queryStart, endDate: range.endDate, dataSpaceId: input.dataSpace.id })
    : [];
  const sourceId = source?.id ?? "";
  const card = etsyCard(source, rows, range);
  const ready = card.unavailableReason === null;
  const sums = etsySums(rows, sourceId);
  const currency = etsyCurrency(rows, source);
  const summed = (key: string, label: string, unit: string, values: Map<string, number>, higherIsBetter: boolean | null) => ready
    ? summedMetric({ key, label, unit, sums: values, range, hasData: true, higherIsBetter })
    : unavailableMetric(key, label, unit, higherIsBetter);
  const aov = (start: string, end: string) => ratio(windowSum(sums.sales, start, end), windowSum(sums.orders, start, end));
  const aovMetric: OverviewMetric = ready
    ? {
        key: "average_order_value",
        label: "Avg. order value",
        value: aov(range.startDate, range.endDate),
        unit: currency,
        delta: range.comparison
          ? nullableChange(aov(range.comparison.currentStart, range.comparison.currentEnd), aov(range.comparison.previousStart, range.comparison.previousEnd), "percent", range.comparison.basis)
          : { kind: "none", reason: "partial_day" },
        higherIsBetter: true,
      }
    : unavailableMetric("average_order_value", "Avg. order value", currency, true);
  return {
    range,
    source,
    card,
    currency,
    metrics: [
      summed("sales", "Sales", currency, sums.sales, true),
      summed("orders", "Orders", "count", sums.orders, true),
      summed("units_sold", "Units sold", "count", sums.units, true),
      aovMetric,
      summed("refunds", "Refunds", currency, sums.refunds, false),
      ready ? etsyActiveListings(rows, sourceId) : unavailableMetric("active_listings", "Active listings", "count", true),
    ],
    dailySales: ready ? zeroFilled(sums.sales, range.sparkline.startDate, range.sparkline.endDate) : [],
    dailyOrders: ready ? zeroFilled(sums.orders, range.sparkline.startDate, range.sparkline.endDate) : [],
  };
}

const SUMMED_KEYS = ["orders", "net_payment", "signups", "page_views", "sessions", "custom_events", ...ETSY_METRIC_KEYS];
const SNAPSHOT_KEYS = [
  "instagram_followers",
  "instagram_media_reach",
  "instagram_engagement_rate",
  "tiktok_followers",
  "tiktok_video_views",
  "tiktok_engagement_rate",
  "users_total",
  "confirmed_users",
];

/** MoonArq always shows its core platforms (with a setup prompt when missing); other spaces show what they have. */
const PLATFORM_ORDER: OverviewPlatformKey[] = ["website", "shopify", "etsy", "whatnot", "instagram", "tiktok", "supabase"];
/** Shown only once a source exists, even in MoonArq. */
const OPTIONAL_PLATFORMS = new Set<OverviewPlatformKey>(["etsy", "whatnot"]);

export function buildPlatformCards(input: {
  dataSpaceSlug: string;
  sources: Source[];
  sumRows: MetricDaily[];
  snapshotRows: MetricDaily[];
  range: OverviewRange;
  websiteOverview: WebsiteFunnelOverview | null;
  whatnot?: { rows: MetricDaily[]; reportWeeks: string[]; now: Date };
}): OverviewPlatformCard[] {
  const { sources, sumRows, snapshotRows, range } = input;
  const isMoonArq = input.dataSpaceSlug === "moonarq";
  const websiteSource = resolvePrimaryWebsiteSource(sources);
  const cards: OverviewPlatformCard[] = [];
  for (const key of PLATFORM_ORDER) {
    if (key === "website") {
      if (!websiteSource && !isMoonArq) continue;
      const sessions = zeroFilled(dailySums(sumRows, "sessions", websiteSource?.id ?? ""), range.sparkline.startDate, range.sparkline.endDate);
      cards.push(input.websiteOverview
        ? websiteFunnelCard(websiteSource, input.websiteOverview, sessions, range)
        : websiteMetricsCard(websiteSource, sumRows, range));
      continue;
    }
    const source = primarySource(sources, key);
    if (!source && (!isMoonArq || OPTIONAL_PLATFORMS.has(key))) continue;
    if (key === "shopify") cards.push(shopifyCard(source, sumRows, range));
    else if (key === "etsy") cards.push(etsyCard(source, sumRows, range));
    else if (key === "whatnot") {
      cards.push(whatnotCard({
        source,
        rows: input.whatnot?.rows ?? [],
        reportWeeks: input.whatnot?.reportWeeks ?? [],
        range,
        now: input.whatnot?.now ?? getDemoNow(),
      }));
    } else if (key === "supabase") cards.push(supabaseCard(source, sumRows, snapshotRows, range));
    else cards.push(socialCard({ key, source, rows: snapshotRows, range }));
  }
  return cards;
}

function linkedInstagramSourceId(metaSource: Source | null, sources: Source[]) {
  const linked = textValue(metaSource?.metadata.linked_instagram_source_id);
  if (linked && sources.some((source) => source.id === linked)) return linked;
  return primarySource(sources, "instagram")?.id ?? null;
}

export async function getPaidAdsOverview(input: {
  dataSpace: Pick<DataSpace, "id" | "slug">;
  range: OverviewRange;
  sources?: Source[];
  now?: Date;
  /** Local previews only: deterministic delivery data (ignored unless fixtures are enabled). */
  fixture?: boolean;
}): Promise<PaidAdsOverview | null> {
  const sources = input.sources ?? await listSources({ dataSpaceId: input.dataSpace.id });
  const now = input.now ?? getDemoNow();
  if (input.fixture && input.dataSpace.slug === "moonarq" && isLocalOverviewFixtureEnabled()) {
    const fixture = paidAdsFixture({ dataSpaceId: input.dataSpace.id, now });
    return buildPaidAdsOverview({
      source: fixture.source,
      instagramSourceId: primarySource(sources, "instagram")?.id ?? null,
      rows: fixture.rows,
      range: input.range,
      now,
    });
  }
  const metaSource = primarySource(sources, "meta_ads");
  // The Meta Ads OAuth flow starts from the MoonArq Instagram source, so other spaces only show an existing connection.
  if (!metaSource && input.dataSpace.slug !== "moonarq") return null;
  const { range } = input;
  const startDate = [
    range.comparison?.previousStart,
    range.sparkline.startDate,
    addDaysToDateKey(range.startDate, -1),
    addDaysToDateKey(range.endDate, -(ACTIVE_CAMPAIGN_WINDOW_DAYS - 1)),
  ]
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const rows = metaSource
    ? await listMetrics({
        sourceId: metaSource.id,
        metricKeys: [...META_ADS_OVERVIEW_METRIC_KEYS],
        // One extra day on each side covers an account time zone ahead of or behind Pacific Time.
        startDate: addDaysToDateKey(startDate, -1),
        endDate: addDaysToDateKey(range.endDate, 1),
        dataSpaceId: input.dataSpace.id,
      })
    : [];
  return buildPaidAdsOverview({
    source: metaSource,
    instagramSourceId: linkedInstagramSourceId(metaSource, sources),
    rows,
    range,
    now,
  });
}

export async function getPlatformOverview(input: {
  dataSpace: Pick<DataSpace, "id" | "slug">;
  rangeKey: DateRangeKey;
  demoState?: WebsiteFunnelDemoState;
  /** Local previews only: show deterministic Meta Ads delivery. */
  adsFixture?: boolean;
  now?: Date;
}): Promise<PlatformOverview> {
  const now = input.now ?? getDemoNow();
  const range = overviewRange(input.rangeKey, now);
  const sources = await listSources({ dataSpaceId: input.dataSpace.id });
  const queryStart = [range.comparison?.previousStart, range.sparkline.startDate].filter((value): value is string => Boolean(value)).sort()[0];
  const whatnotSource = primarySource(sources, "whatnot");
  const [sumRows, snapshotRows, websiteOverview, paidAds, whatnotRows, whatnotWeekRows] = await Promise.all([
    listMetrics({ metricKeys: SUMMED_KEYS, startDate: queryStart, endDate: range.endDate, dataSpaceId: input.dataSpace.id }),
    listMetrics({ metricKeys: SNAPSHOT_KEYS, endDate: range.endDate, dataSpaceId: input.dataSpace.id }),
    input.dataSpace.slug === "moonarq"
      ? getWebsiteFunnelOverview({ dataSpaceId: input.dataSpace.id, range: input.rangeKey, demoState: input.demoState, now })
      : Promise.resolve(null),
    getPaidAdsOverview({ dataSpace: input.dataSpace, range, sources, now, fixture: input.adsFixture }),
    whatnotSource
      ? listMetrics({ sourceId: whatnotSource.id, metricKeys: [...WHATNOT_DAILY_METRIC_KEYS], startDate: queryStart, endDate: range.endDate, dataSpaceId: input.dataSpace.id })
      : Promise.resolve([]),
    // One small series, all time, to know which report weeks were imported.
    whatnotSource
      ? listMetrics({ sourceId: whatnotSource.id, metricKeys: ["whatnot_net_earnings"], dataSpaceId: input.dataSpace.id })
      : Promise.resolve([]),
  ]);
  return {
    range,
    paidAds,
    cards: buildPlatformCards({
      dataSpaceSlug: input.dataSpace.slug,
      sources,
      sumRows,
      snapshotRows,
      range,
      websiteOverview,
      whatnot: { rows: whatnotRows, reportWeeks: whatnotReportWeeks(whatnotWeekRows, whatnotSource?.id ?? ""), now },
    }),
    sources,
    websiteOverview,
  };
}

// ---------------------------------------------------------------------------
// Single-platform detail

export type PlatformDetail = {
  range: OverviewRange;
  card: OverviewPlatformCard;
  sources: Source[];
  /** Daily series for the detail chart: the card's trend over at least seven days. */
  series: OverviewPoint[];
  /** Shopify only: daily orders over the same window. */
  ordersSeries: OverviewPoint[];
  /** Shopify only: ordered units per product in the selected range. */
  topProducts: Array<{ name: string; units: number }>;
  /** Supabase only: signups per auth provider in the selected range. */
  providers: Array<{ provider: string; signups: number }>;
};

export function rankedTotals(rows: MetricDaily[], metricKey: string, sourceId: string, dimension: string, range: { startDate: string; endDate: string }) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.metric_key !== metricKey || row.source_id !== sourceId || row.date < range.startDate || row.date > range.endDate) continue;
    const name = textValue(row.dimensions[dimension]) ?? "Unknown";
    totals.set(name, (totals.get(name) ?? 0) + row.metric_value);
  }
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));
}

export async function getPlatformDetail(input: {
  dataSpace: Pick<DataSpace, "id" | "slug">;
  rangeKey: DateRangeKey;
  /** Website, Etsy, and Whatnot have their own detail services. */
  key: Exclude<OverviewPlatformKey, "website" | "etsy" | "whatnot">;
  now?: Date;
}): Promise<PlatformDetail> {
  const now = input.now ?? getDemoNow();
  const range = overviewRange(input.rangeKey, now);
  const sources = await listSources({ dataSpaceId: input.dataSpace.id });
  const source = primarySource(sources, input.key);
  const queryStart = [range.comparison?.previousStart, range.sparkline.startDate].filter((value): value is string => Boolean(value)).sort()[0];
  const sumKeys = input.key === "shopify"
    ? ["orders", "net_payment", "top_products"]
    : input.key === "supabase" ? ["signups", "signups_by_provider"] : [];
  const [sumRows, snapshotRows] = source
    ? await Promise.all([
        sumKeys.length > 0
          ? listMetrics({ sourceId: source.id, metricKeys: sumKeys, startDate: queryStart, endDate: range.endDate, dataSpaceId: input.dataSpace.id })
          : Promise.resolve([] as MetricDaily[]),
        input.key === "shopify"
          ? Promise.resolve([] as MetricDaily[])
          : listMetrics({ sourceId: source.id, metricKeys: SNAPSHOT_KEYS, endDate: range.endDate, dataSpaceId: input.dataSpace.id }),
      ])
    : [[] as MetricDaily[], [] as MetricDaily[]];
  const card = input.key === "shopify"
    ? shopifyCard(source, sumRows, range)
    : input.key === "supabase"
      ? supabaseCard(source, sumRows, snapshotRows, range)
      : socialCard({ key: input.key, source, rows: snapshotRows, range });
  const sourceId = source?.id ?? "";
  const shopifyReady = input.key === "shopify" && card.unavailableReason === null;
  return {
    range,
    card,
    sources,
    series: card.sparkline.points,
    ordersSeries: shopifyReady
      ? zeroFilled(dailySums(sumRows, "orders", sourceId, "daily_order_summary"), range.sparkline.startDate, range.sparkline.endDate)
      : [],
    topProducts: shopifyReady
      ? rankedTotals(sumRows, "top_products", sourceId, "product_name", range).slice(0, 8).map((item) => ({ name: item.name, units: item.value }))
      : [],
    providers: input.key === "supabase"
      ? rankedTotals(sumRows, "signups_by_provider", sourceId, "provider", range).map((item) => ({ provider: item.name, signups: item.value }))
      : [],
  };
}
