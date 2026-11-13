import "server-only";

import { getWebsiteCommerceFunnelV2Snapshot } from "@/aggregation/services/website-commerce-funnel-v2-service";
import type { WebsiteCommerceFunnelStage } from "@/aggregation/services/website-commerce-funnel-v2-types";
import { getWebsiteFunnelOverview } from "@/aggregation/services/website-funnel-service";
import type { WebsiteFunnelRangeKey, WebsiteFunnelSegment } from "@/aggregation/services/website-funnel-types";
import type { ChatgptAdsFunnelSnapshot, ChatgptAdsTotals } from "@/aggregation/services/chatgpt-ads-funnel-types";
import { isLocalOverviewFixtureEnabled } from "@/aggregation/services/platform-overview-fixtures";
import type { MetricDaily } from "@/storage/db/schema";
import { listMetrics } from "@/storage/repositories/metrics-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { listSyncRuns } from "@/storage/repositories/sync-runs-repository";
import { addDaysToDateKey, getAppDateRange } from "@/storage/runtime/app-time";

const FACT_KEYS = {
  spend: "chatgpt_ads_spend", impressions: "chatgpt_ads_impressions", clicks: "chatgpt_ads_clicks",
  conversions: "chatgpt_ads_conversions", clickThroughConversions: "chatgpt_ads_click_through_conversions",
  viewThroughConversions: "chatgpt_ads_view_through_conversions", purchaseValue: "chatgpt_ads_purchase_value",
} as const;
const LABELS = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };
const FACT_KEY_SET = new Set<string>(Object.values(FACT_KEYS));
const ATTRIBUTED_KEYS = new Set<string>([FACT_KEYS.conversions, FACT_KEYS.clickThroughConversions, FACT_KEYS.viewThroughConversions, FACT_KEYS.purchaseValue]);

type Dependencies = {
  now?: Date;
  loadSources?: typeof listSources;
  loadMetrics?: typeof listMetrics;
  loadSyncRuns?: typeof listSyncRuns;
  loadWebsite?: typeof getWebsiteFunnelOverview;
  loadCommerce?: typeof getWebsiteCommerceFunnelV2Snapshot;
};

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function ratio(numerator: number | null, denominator: number | null, multiplier = 1) {
  return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator * multiplier : null;
}
function dates(from: string, through: string) {
  const result: string[] = [];
  for (let date = from; date <= through; date = addDaysToDateKey(date, 1)) result.push(date);
  return result;
}
function localDate(now: Date, timeZone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function validTimeZone(value: unknown) {
  const zone = text(value);
  if (!zone) return null;
  try { localDate(new Date(0), zone); return zone; } catch { return null; }
}

/** Account-level facts only: exclude other sources, ad/campaign rollups, duplicate snapshots and invalid amounts. */
export function aggregateChatgptAdsMetrics(input: { rows: MetricDaily[]; sourceId: string; startDate: string; endDate: string; accountId?: string | null; currency?: string | null; timeZone?: string | null }) {
  const selected = input.rows.filter((row) => row.source_id === input.sourceId && row.source_type_key === "chatgpt_ads"
    && FACT_KEY_SET.has(row.metric_key)
    && row.dimensions.rollup === "account_daily" && row.date >= input.startDate && row.date <= input.endDate
    && number(row.metric_value) !== null && (!input.accountId || row.dimensions.account_id === input.accountId)
    && (!input.timeZone || row.dimensions.account_timezone === input.timeZone)
    && (!input.currency || row.dimensions.account_currency === input.currency)
    && (!ATTRIBUTED_KEYS.has(row.metric_key)
      || (row.dimensions.attribution_time_basis === "ad_event_time" && row.dimensions.attribution_window_days === 30 && row.dimensions.view_through_attribution_window_days === 1
        && (row.metric_key === FACT_KEYS.purchaseValue ? row.dimensions.purchase_scope === "attributed_order_created_goal_and_non_goal" : row.dimensions.conversion_scope === "campaign_goals"))));
  const currencies = new Set(selected.filter((row) => row.metric_key === FACT_KEYS.spend || row.metric_key === FACT_KEYS.purchaseValue).map((row) => row.unit.toUpperCase()));
  const onlyCurrency = currencies.size === 1 ? [...currencies][0] : null;
  const currency = onlyCurrency && /^[A-Z]{3}$/u.test(onlyCurrency) && (!input.currency || input.currency === onlyCurrency)
    ? onlyCurrency : input.currency && currencies.size === 0 && /^[A-Z]{3}$/u.test(input.currency) ? input.currency : null;
  const values = new Map<string, MetricDaily>();
  for (const row of selected) {
    if ((row.metric_key === FACT_KEYS.spend || row.metric_key === FACT_KEYS.purchaseValue) && row.unit.toUpperCase() !== currency) continue;
    const identity = `${row.date}:${row.metric_key}`;
    const previous = values.get(identity);
    if (!previous || row.updated_at > previous.updated_at || (row.updated_at === previous.updated_at && row.id > previous.id)) values.set(identity, row);
  }
  const sum = (key: string) => {
    const matching = [...values.values()].filter((row) => row.metric_key === key);
    return matching.length ? matching.reduce((total, row) => total + row.metric_value, 0) : null;
  };
  const facts = Object.fromEntries(Object.entries(FACT_KEYS).map(([key, metricKey]) => [key, sum(metricKey)])) as Pick<ChatgptAdsTotals, keyof typeof FACT_KEYS>;
  // Never average daily percentages or divide goals including view-through credit by clicks.
  const paired = (left: string, right: string) => {
    const leftDates = [...values.values()].filter((row) => row.metric_key === left).map((row) => row.date).sort();
    const rightDates = [...values.values()].filter((row) => row.metric_key === right).map((row) => row.date).sort();
    return leftDates.length > 0 && JSON.stringify(leftDates) === JSON.stringify(rightDates);
  };
  const totals: ChatgptAdsTotals = {
    ...facts,
    ctrPercent: paired(FACT_KEYS.clicks, FACT_KEYS.impressions) ? ratio(facts.clicks, facts.impressions, 100) : null,
    cpc: paired(FACT_KEYS.spend, FACT_KEYS.clicks) ? ratio(facts.spend, facts.clicks) : null,
    cpm: paired(FACT_KEYS.spend, FACT_KEYS.impressions) ? ratio(facts.spend, facts.impressions, 1_000) : null,
    postClickCvrPercent: paired(FACT_KEYS.clickThroughConversions, FACT_KEYS.clicks) ? ratio(facts.clickThroughConversions, facts.clicks, 100) : null,
    platformRoas: paired(FACT_KEYS.purchaseValue, FACT_KEYS.spend) ? ratio(facts.purchaseValue, facts.spend) : null,
  };
  return {
    currency, totals,
    daily: dates(input.startDate, input.endDate).map((date) => ({ date,
      spend: values.get(`${date}:${FACT_KEYS.spend}`)?.metric_value ?? null,
      clicks: values.get(`${date}:${FACT_KEYS.clicks}`)?.metric_value ?? null,
      conversions: values.get(`${date}:${FACT_KEYS.conversions}`)?.metric_value ?? null,
    })),
    hasRows: values.size > 0,
  };
}

export async function getChatgptAdsFunnelSnapshot(input: { dataSpaceId: string; range?: WebsiteFunnelRangeKey; segment?: WebsiteFunnelSegment; fixture?: boolean }, dependencies: Dependencies = {}): Promise<ChatgptAdsFunnelSnapshot> {
  const now = dependencies.now ?? new Date();
  const range = input.range ?? "30d";
  const loadSources = dependencies.loadSources ?? listSources;
  const sources = await loadSources({ dataSpaceId: input.dataSpaceId });
  const candidates = sources.filter((source) => source.source_type_key === "chatgpt_ads" && source.status !== "disabled");
  const source = candidates.length === 1 ? candidates[0] : null;
  const [runs, website, commerce] = await Promise.all([
    source ? (dependencies.loadSyncRuns ?? listSyncRuns)(1, "success", { dataSpaceId: input.dataSpaceId, sourceId: source.id }) : Promise.resolve([]),
    (dependencies.loadWebsite ?? getWebsiteFunnelOverview)({ dataSpaceId: input.dataSpaceId, range, segment: input.segment ?? "all", comparison: "off", utmSource: "chatgpt", utmMedium: "paid", now }),
    (dependencies.loadCommerce ?? getWebsiteCommerceFunnelV2Snapshot)({ dataSpaceId: input.dataSpaceId, range, segment: input.segment ?? "all", utmSource: "chatgpt", utmMedium: "paid" }, { now }),
  ]);
  const run = runs.filter((candidate) => candidate.source_id === source?.id && candidate.source_type_key === "chatgpt_ads" && candidate.status === "success" && candidate.finished_at)
    .sort((left, right) => (right.finished_at ?? "").localeCompare(left.finished_at ?? ""))[0];
  const cursor = run?.cursor_after ?? {};
  const timeZone = validTimeZone(cursor.timeZone);
  const accountId = text(cursor.accountId);
  const accountCurrency = text(cursor.currency)?.toUpperCase() ?? null;
  const lastSuccess = source?.last_success_at ? Date.parse(source.last_success_at) : NaN;
  const runTime = run?.finished_at ? Date.parse(run.finished_at) : NaN;
  const fetchedAt = text(cursor.fetchedAt) ? Date.parse(String(cursor.fetchedAt)) : NaN;
  const matchedRun = Boolean(source?.external_account_id && accountId === source.external_account_id
    && accountCurrency && accountCurrency === text(source.metadata.account_currency)?.toUpperCase()
    && timeZone && timeZone === validTimeZone(source.metadata.account_timezone)
    && Number.isFinite(lastSuccess) && Number.isFinite(runTime) && Number.isFinite(fetchedAt)
    && fetchedAt <= runTime + 5 * 60_000 && runTime <= now.getTime() + 5 * 60_000
    && Math.abs(lastSuccess - runTime) <= 5 * 60_000
    && /^\d{4}-\d{2}-\d{2}$/u.test(String(cursor.startDate)) && /^\d{4}-\d{2}-\d{2}$/u.test(String(cursor.endDate))
    && String(cursor.startDate) <= String(cursor.endDate));
  const endDate = timeZone ? localDate(now, timeZone) : getAppDateRange(range, now).endDate;
  const startDate = addDaysToDateKey(endDate, -(range === "today" ? 0 : range === "7d" ? 6 : 29));
  const rows = source && matchedRun && timeZone && accountId
    ? await (dependencies.loadMetrics ?? listMetrics)({ dataSpaceId: input.dataSpaceId, sourceId: source.id, sourceTypeKey: "chatgpt_ads", metricKeys: Object.values(FACT_KEYS), startDate, endDate })
    : [];
  const aggregate = aggregateChatgptAdsMetrics({ rows, sourceId: source?.id ?? "", startDate, endDate, accountId, currency: accountCurrency, timeZone });
  const fresh = matchedRun && now.getTime() - lastSuccess <= Math.max(2 * 60, (source?.sync_frequency_minutes ?? 60) * 2) * 60_000;
  const covered = matchedRun && text(cursor.startDate) !== null && text(cursor.endDate) !== null && String(cursor.startDate) <= startDate && String(cursor.endDate) >= endDate;
  const state: ChatgptAdsFunnelSnapshot["connection"]["state"] = candidates.length > 1 ? "ambiguous" : !source ? "not_connected"
    : source.status === "error" || source.status === "needs_credentials" ? "error" : !matchedRun ? "first_sync" : fresh ? "live" : "stale";
  const notes = {
    ambiguous: "Choose one ChatGPT Ads source for this data space before comparing account totals.",
    not_connected: "Connect the account's Ads API key to start collecting performance.",
    first_sync: "Performance appears after the first successful, verified account sync.",
    error: "The source needs attention. Previously collected values may be out of date.",
    live: "Official account reports. Recent spend and attributed conversions can be revised by OpenAI.",
    stale: "The last successful account sync is older than its expected cadence.",
  };
  const knownWebsite = website.source.state === "ready" && !["source_unavailable", "pre_coverage", "no_events"].includes(website.dataState);
  const firstPartyStages: WebsiteCommerceFunnelStage[] = website.stages.map((stage) => ({
    key: stage.key, label: stage.label, authority: "website", count: knownWebsite && stage.measured ? stage.sessions : null,
    state: knownWebsite && stage.measured ? website.coverage.startsDuringSelection ? "partial" : "healthy" : "not_measured",
    fromPrevious: knownWebsite && stage.measured ? stage.fromPrevious : null, note: stage.description,
  }));
  const exactStages = commerce.funnel;
  const useExact = exactStages.slice(0, 4).every((stage) => stage.state !== "not_measured");
  const orderStage = exactStages.find((stage) => stage.key === "shopify_order")!;
  const stages = useExact ? exactStages : [...firstPartyStages, orderStage];
  const visits = stages.find((stage) => stage.key === "visit");
  const orderState = orderStage.state;
  const snapshot: ChatgptAdsFunnelSnapshot = {
    range: { key: range, label: LABELS[range], startDate, endDate },
    connection: { state, sourceId: source?.id ?? null, accountName: source?.account_name ?? source?.display_name ?? null, updatedAt: run?.finished_at ?? null, note: notes[state] },
    delivery: { currency: aggregate.currency, timeZone, coverage: !aggregate.hasRows ? "unavailable" : covered ? "complete" : "partial", totals: aggregate.totals, daily: aggregate.daily,
      note: "Account-calendar reports; totals use reported days only. Goal conversions use a 30-day click and 1-day view window; they are separate from linked Shopify orders." },
    website: { stages, orderState,
      visitToOrderRatePercent: useExact && visits?.state === "healthy" && orderState === "healthy" ? ratio(orderStage.count, visits.count, 100) : null,
      checkoutToOrderRatePercent: commerce.commerce.linkedOrderRatePercent.value,
      note: "Only sessions whose first accepted visit has utm_source=chatgpt and utm_medium=paid enter this cohort. Shopify orders require the existing consent-gated exact checkout bridge." },
    fixture: false,
  };
  if (input.fixture && isLocalOverviewFixtureEnabled()) return chatgptAdsFixture(snapshot);
  return snapshot;
}

function chatgptAdsFixture(base: ChatgptAdsFunnelSnapshot): ChatgptAdsFunnelSnapshot {
  const daily = base.delivery.daily.map((point, index) => ({ date: point.date, spend: 8 + index % 5, clicks: 24 + index % 8, conversions: 0.5 + index % 3 }));
  const conversions = daily.reduce((sum, point) => sum + point.conversions, 0);
  const totals = { spend: daily.reduce((sum, point) => sum + point.spend, 0), impressions: daily.length * 800, clicks: daily.reduce((sum, point) => sum + point.clicks, 0), conversions, clickThroughConversions: conversions * 0.8, viewThroughConversions: conversions * 0.2, purchaseValue: conversions * 70 };
  const counts = [180, 92, 35, 18, 6];
  return { ...base, fixture: true,
    connection: { state: "live", sourceId: null, accountName: "Example ad account", updatedAt: new Date().toISOString(), note: "Synthetic local preview. No advertising account is connected." },
    delivery: { ...base.delivery, currency: "USD", timeZone: "America/Los_Angeles", coverage: "complete", daily,
      totals: { ...totals, ctrPercent: ratio(totals.clicks, totals.impressions, 100), cpc: ratio(totals.spend, totals.clicks), cpm: ratio(totals.spend, totals.impressions, 1_000), postClickCvrPercent: ratio(totals.clickThroughConversions, totals.clicks, 100), platformRoas: ratio(totals.purchaseValue, totals.spend) } },
    website: { ...base.website, stages: base.website.stages.map((stage, index) => ({ ...stage, count: counts[index], state: "healthy", fromPrevious: index > 0 ? counts[index] / counts[index - 1] * 100 : null })), orderState: "healthy", visitToOrderRatePercent: 6 / 180 * 100, checkoutToOrderRatePercent: 6 / 18 * 100 },
  };
}
