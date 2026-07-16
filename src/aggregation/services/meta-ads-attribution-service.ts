import { getDateRange, type DateRangeKey } from "@/aggregation/services/summary-service";
import { isWebsiteSourceKey } from "@/collection/tracking/website-sources";
import { MOONARQ_FIRST_STORY_CAMPAIGN_NAME, MOONARQ_FIRST_STORY_UTM_TAGS } from "@/collection/connectors/meta-ads/constants";
import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { JsonRecord, MetricDaily, RawIngestion, Source, WebEvent } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { countWebPageViewsByUtm } from "@/storage/repositories/events-repository";
import { listMetrics } from "@/storage/repositories/metrics-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { endOfAppDateUtc, startOfAppDateUtc } from "@/storage/runtime/app-time";

export type PaidMetricState = "ready" | "stale" | "no_delivery" | "not_reported" | "pending" | "unavailable";
export type PaidMetricSource = "meta" | "utm" | "shopify" | "derived";

export type PaidMetricValue = {
  value: number | null;
  unit: string;
  state: PaidMetricState;
  source: PaidMetricSource;
  reason?: string;
};

export type CampaignUtm = {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string | null;
};

export type InstagramPaidAdsFunnel = {
  impressions: PaidMetricValue;
  paidReach: PaidMetricValue;
  frequency: PaidMetricValue;
  allClicks: PaidMetricValue;
  linkClicks: PaidMetricValue;
  outboundClicks: PaidMetricValue;
  landingPageViews: PaidMetricValue;
  utmPageViews: PaidMetricValue;
  utmVisitors: PaidMetricValue;
  allCtr: PaidMetricValue;
  linkCtr: PaidMetricValue;
  outboundCtr: PaidMetricValue;
  cpc: PaidMetricValue;
  cpm: PaidMetricValue;
  costPerLandingPageView: PaidMetricValue;
  costPerUtmVisitor: PaidMetricValue;
  viewContent: PaidMetricValue;
  addToCart: PaidMetricValue;
  initiateCheckout: PaidMetricValue;
  metaPurchases: PaidMetricValue;
  outboundToLandingRate: PaidMetricValue;
  landingToContentRate: PaidMetricValue;
  contentToCartRate: PaidMetricValue;
  cartToCheckoutRate: PaidMetricValue;
  checkoutToMetaPurchaseRate: PaidMetricValue;
  metaLandingPurchaseRate: PaidMetricValue;
  utmCaptureRate: PaidMetricValue;
  periodBlendedOrderRate: PaidMetricValue;
  purchaseConversionRate: PaidMetricValue;
  costPerViewContent: PaidMetricValue;
  costPerAddToCart: PaidMetricValue;
  costPerCheckout: PaidMetricValue;
  metaCostPerPurchase: PaidMetricValue;
  costPerShopifyOrder: PaidMetricValue;
  averageOrderValue: PaidMetricValue;
  video25: PaidMetricValue;
  video50: PaidMetricValue;
  video75: PaidMetricValue;
  video95: PaidMetricValue;
  video100: PaidMetricValue;
  video25Rate: PaidMetricValue;
  video25To50Retention: PaidMetricValue;
  video50To75Retention: PaidMetricValue;
  video75To100Retention: PaidMetricValue;
  videoCompletionRate: PaidMetricValue;
  thruPlay: PaidMetricValue;
  thruPlayRate: PaidMetricValue;
  costPerVideo25: PaidMetricValue;
  costPerVideoComplete: PaidMetricValue;
  costPerThruPlay: PaidMetricValue;
};

export type AidmaStage = {
  key: "attention" | "interest" | "desire" | "memory" | "action";
  label: string;
  proxyLabel: string;
  count: PaidMetricValue;
  rateLabel: string;
  rate: PaidMetricValue;
  supportLabel: string;
  support: PaidMetricValue;
  costLabel: string;
  cost: PaidMetricValue;
  sourceLabel: string;
  caveat: string | null;
};

export type InstagramPaidAdsSummary = {
  state: "not_connected" | "needs_account" | "first_sync" | "no_delivery" | "ready" | "stale" | "error";
  metaAdsSourceId: string | null;
  campaign: {
    campaignId: string | null;
    campaignName: string;
    adSetName: string | null;
    adId: string | null;
    adName: string | null;
    deliveryStatus: string | null;
    attributionSetting: string | null;
    evidenceAt: string | null;
    creativeUtmStatus: "exact" | "missing" | "mismatch" | "unknown";
    objective: string | null;
    optimizationGoal: string | null;
    budgetKind: "daily" | "lifetime" | null;
    budgetSource: "campaign" | "ad_set" | null;
    budgetMinorUnits: number | null;
    budgetRemainingMinorUnits: number | null;
    startsAt: string | null;
    endsAt: string | null;
    qualityRanking: string | null;
    engagementRateRanking: string | null;
    conversionRateRanking: string | null;
    utm: CampaignUtm;
  };
  outcomes: {
    spend: PaidMetricValue;
    attributedOrders: PaidMetricValue;
    attributedNetRevenue: PaidMetricValue;
    shopifyRoas: PaidMetricValue;
    metaPurchaseValue: PaidMetricValue;
    metaRoas: PaidMetricValue;
    adSpendReturn: PaidMetricValue;
    netPaymentAfterAdSpend: PaidMetricValue;
    revenuePerUtmVisitor: PaidMetricValue;
    revenuePerThousandImpressions: PaidMetricValue;
    profitRoi: PaidMetricValue;
  };
  aidma: { stages: AidmaStage[] };
  memory: {
    postSaves: PaidMetricValue;
    postReactions: PaidMetricValue;
    comments: PaidMetricValue;
    postEngagements: PaidMetricValue;
    saveRate: PaidMetricValue;
    postEngagementRate: PaidMetricValue;
    costPerSave: PaidMetricValue;
    eligibleReturnDevices1d: PaidMetricValue;
    returningDevices1d: PaidMetricValue;
    deviceReturnRate1d: PaidMetricValue;
    eligibleReturnDevices7d: PaidMetricValue;
    returningDevices7d: PaidMetricValue;
    deviceReturnRate7d: PaidMetricValue;
    firstTouchOrders: PaidMetricValue;
    firstTouchRevenue: PaidMetricValue;
    firstTouchOnlyOrders: PaidMetricValue;
    bothFirstAndLastOrders: PaidMetricValue;
    delayedFirstTouchOrders: PaidMetricValue;
    delayedFirstTouchShare: PaidMetricValue;
    averageDaysToConversion: PaidMetricValue;
    newCustomerLastTouchOrders: PaidMetricValue;
    returningCustomerLastTouchOrders: PaidMetricValue;
    newCustomerShare: PaidMetricValue;
  };
  economics: {
    attributedGrossSales: PaidMetricValue;
    attributedDiscounts: PaidMetricValue;
    attributedCurrentTotal: PaidMetricValue;
    attributedRefunds: PaidMetricValue;
    discountRate: PaidMetricValue;
    refundRate: PaidMetricValue;
    firstTouchRoas: PaidMetricValue;
    newCustomerCacProxy: PaidMetricValue;
  };
  reconciliation: {
    metaVsShopifyPurchaseDelta: PaidMetricValue;
    metaVsShopifyRevenueDelta: PaidMetricValue;
    landingTrackingGap: PaidMetricValue;
    landingTrackingRatio: PaidMetricValue;
  };
  pacing: {
    budget: PaidMetricValue;
    budgetRemaining: PaidMetricValue;
    budgetUsed: PaidMetricValue;
    scheduleElapsed: PaidMetricValue;
    expectedSpendToDate: PaidMetricValue;
    pacingIndex: PaidMetricValue;
    projectedFinalSpend: PaidMetricValue;
    daysRemaining: PaidMetricValue;
    averageDailySpend: PaidMetricValue;
    coverageComplete: boolean;
    reason: string | null;
  };
  funnel: InstagramPaidAdsFunnel;
  daily: Array<{ date: string; spend: number; metaPurchaseValue: number | null; shopifyNetRevenue: number | null }>;
  coverage: {
    meta: boolean;
    utm: boolean;
    shopify: boolean;
    shopifyJourneyReady: boolean;
    currencyAligned: boolean | null;
  };
  observed: {
    utmPageViews: number;
    utmVisitors: number;
  };
  currency: string;
  shopifyCurrency: string | null;
  lastSyncedAt: string | null;
  shopifyLastSyncedAt: string | null;
  error: string | null;
};

export const MOONARQ_FIRST_STORY_UTM: CampaignUtm = {
  source: MOONARQ_FIRST_STORY_UTM_TAGS.utm_source,
  medium: MOONARQ_FIRST_STORY_UTM_TAGS.utm_medium,
  campaign: MOONARQ_FIRST_STORY_UTM_TAGS.utm_campaign,
  content: MOONARQ_FIRST_STORY_UTM_TAGS.utm_content,
  term: MOONARQ_FIRST_STORY_UTM_TAGS.utm_term,
};
export { MOONARQ_FIRST_STORY_CAMPAIGN_NAME };

type MetaAdsSnapshotEvidence = {
  fetchedAt: string;
  currency: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adSetName: string | null;
  adId: string | null;
  adName: string | null;
  deliveryStatus: string | null;
  creativeUtmStatus: "exact" | "missing" | "mismatch" | "unknown";
  objective: string | null;
  optimizationGoal: string | null;
  budgetKind: "daily" | "lifetime" | null;
  budgetSource: "campaign" | "ad_set" | null;
  budgetMinorUnits: number | null;
  budgetRemainingMinorUnits: number | null;
  startsAt: string | null;
  endsAt: string | null;
};

const META_METRIC_KEYS = [
  "meta_ads_spend",
  "meta_ads_impressions",
  "meta_ads_reach",
  "meta_ads_clicks",
  "meta_ads_outbound_clicks",
  "meta_ads_inline_link_clicks",
  "meta_ads_landing_page_views",
  "meta_ads_view_content",
  "meta_ads_add_to_cart",
  "meta_ads_initiate_checkout",
  "meta_ads_purchases",
  "meta_ads_purchase_value",
  "meta_ads_post_saves",
  "meta_ads_post_reactions",
  "meta_ads_comments",
  "meta_ads_post_engagements",
  "meta_ads_video_p25",
  "meta_ads_video_p50",
  "meta_ads_video_p75",
  "meta_ads_video_p95",
  "meta_ads_video_p100",
  "meta_ads_video_thruplay",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function utmFromRecord(value: unknown): Partial<CampaignUtm> | null {
  if (!isRecord(value)) return null;
  const source = stringValue(value.source ?? value.utm_source);
  const medium = stringValue(value.medium ?? value.utm_medium);
  const campaign = stringValue(value.campaign ?? value.utm_campaign);
  const content = stringValue(value.content ?? value.utm_content);
  const term = stringValue(value.term ?? value.utm_term);
  return source || medium || campaign || content || term ? { source: source ?? undefined, medium: medium ?? undefined, campaign: campaign ?? undefined, content: content ?? undefined, term } : null;
}

function utmFromQueryString(value: string | null | undefined): Partial<CampaignUtm> | null {
  if (!value?.trim()) return null;
  let candidate = value.trim();
  try {
    const decoded = JSON.parse(candidate) as unknown;
    const fromObject = utmFromRecord(decoded);
    if (fromObject) return fromObject;
    if (typeof decoded === "string") candidate = decoded;
  } catch {
    // Plain URL query strings are expected here too.
  }
  const params = new URLSearchParams(candidate.startsWith("?") ? candidate.slice(1) : candidate);
  return utmFromRecord({
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    content: params.get("utm_content"),
    term: params.get("utm_term"),
  });
}

export function extractWebEventUtm(event: Pick<WebEvent, "url" | "properties">): Partial<CampaignUtm> | null {
  const attribution = isRecord(event.properties.attribution) ? event.properties.attribution : null;
  const normalized = attribution ? utmFromRecord(attribution.utm) : null;
  if (normalized) return normalized;

  const vercel = isRecord(event.properties.vercel) ? event.properties.vercel : null;
  const legacy = vercel ? vercel.query_params : null;
  if (typeof legacy === "string") {
    const parsed = utmFromQueryString(legacy);
    if (parsed) return parsed;
  } else {
    const parsed = utmFromRecord(legacy);
    if (parsed) return parsed;
  }

  try {
    const url = new URL(event.url);
    return utmFromQueryString(url.search);
  } catch {
    return null;
  }
}

function campaignMatches(actual: Partial<CampaignUtm> | null, expected: CampaignUtm) {
  if (!actual) return false;
  return actual.source?.toLowerCase() === expected.source.toLowerCase()
    && actual.medium?.toLowerCase() === expected.medium.toLowerCase()
    && actual.campaign === expected.campaign
    && actual.content === expected.content
    && (expected.term === null || actual.term === expected.term);
}

function dimensionsMatch(row: MetricDaily, expected: CampaignUtm) {
  return campaignMatches(utmFromRecord(row.dimensions), expected);
}

function rowsFor(rows: MetricDaily[], metricKey: string, expected: CampaignUtm) {
  return rows.filter((row) => row.metric_key === metricKey && dimensionsMatch(row, expected));
}

function sum(rows: MetricDaily[], metricKey: string, expected: CampaignUtm) {
  return rowsFor(rows, metricKey, expected).reduce((total, row) => total + row.metric_value, 0);
}

function metric(value: number | null, unit: string, state: PaidMetricState, source: PaidMetricSource, reason?: string): PaidMetricValue {
  return { value, unit, state, source, ...(reason ? { reason } : {}) };
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function currencyMinorUnitDivisor(currency: string) {
  try {
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() })
      .resolvedOptions().maximumFractionDigits ?? 2;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

function numericDimension(row: MetricDaily, key: string) {
  const value = Number(row.dimensions[key]);
  return Number.isFinite(value) ? value : null;
}

function orderId(row: MetricDaily) {
  return stringValue(row.dimensions.order_id) ?? row.id;
}

function distinctOrderRows(rows: MetricDaily[]) {
  const byOrder = new Map<string, MetricDaily>();
  for (const row of rows) {
    const key = orderId(row);
    const current = byOrder.get(key);
    if (!current || `${row.updated_at}:${row.id}` > `${current.updated_at}:${current.id}`) byOrder.set(key, row);
  }
  return [...byOrder.values()];
}

function normalizedMetaAccountId(value: unknown) {
  return stringValue(value)?.replace(/^act_/u, "") ?? null;
}

function selectedMetaAccountId(source: Source | null) {
  return normalizedMetaAccountId(
    source?.external_account_id ?? source?.metadata.selected_ad_account_id,
  );
}

function metaRowMatchesAccount(row: MetricDaily, accountId: string | null) {
  return Boolean(accountId && normalizedMetaAccountId(row.dimensions.account_id) === accountId);
}

function metaSyncIsStale(source: Source | null, now: Date) {
  if (!source?.last_success_at || !source.next_sync_at) return false;
  const frequencyMs = Math.max(1, source.sync_frequency_minutes) * 60_000;
  const minimumGraceMs = 3 * 60 * 60_000;
  const nextSyncAt = Date.parse(source.next_sync_at);
  if (!Number.isFinite(nextSyncAt)) return false;
  const staleAt = nextSyncAt + Math.max(frequencyMs * 2, minimumGraceMs);
  return now.getTime() > staleAt;
}

function metaMetricState(input: { connected: boolean; synced: boolean; delivered: boolean; hasRows: boolean; stale: boolean }): PaidMetricState {
  if (!input.connected) return input.hasRows ? "stale" : "pending";
  if (!input.synced) return "pending";
  if (input.stale) return "stale";
  if (!input.delivered) return "no_delivery";
  return input.hasRows ? "ready" : "not_reported";
}

function sourceUtm(source: Source | null): CampaignUtm {
  const configured = source && isRecord(source.metadata.tracked_utm) ? utmFromRecord(source.metadata.tracked_utm) : null;
  return {
    source: configured?.source ?? MOONARQ_FIRST_STORY_UTM.source,
    medium: configured?.medium ?? MOONARQ_FIRST_STORY_UTM.medium,
    campaign: configured?.campaign ?? MOONARQ_FIRST_STORY_UTM.campaign,
    content: configured?.content ?? MOONARQ_FIRST_STORY_UTM.content,
    term: configured?.term ?? null,
  };
}

function linkedMetaSource(sources: Source[], instagramSourceId?: string | null) {
  const metaSources = sources.filter((source) => source.source_type_key === "meta_ads");
  if (instagramSourceId) {
    return metaSources.find((source) => source.metadata.linked_instagram_source_id === instagramSourceId) ?? null;
  }
  return metaSources.length === 1 ? metaSources[0] : null;
}

function campaignDetails(rows: MetricDaily[], expected: CampaignUtm, source: Source | null, snapshot: MetaAdsSnapshotEvidence | null) {
  const row = rows
    .filter((candidate) => dimensionsMatch(candidate, expected))
    .sort((left, right) => `${left.date}:${left.updated_at}`.localeCompare(`${right.date}:${right.updated_at}`))
    .at(-1);
  return {
    campaignId: stringValue(row?.dimensions.campaign_id) ?? snapshot?.campaignId ?? stringValue(source?.metadata.campaign_id),
    campaignName: stringValue(row?.dimensions.campaign_name) ?? snapshot?.campaignName ?? stringValue(source?.metadata.campaign_name) ?? MOONARQ_FIRST_STORY_CAMPAIGN_NAME,
    adSetName: stringValue(row?.dimensions.adset_name) ?? snapshot?.adSetName ?? stringValue(source?.metadata.adset_name),
    adId: stringValue(row?.dimensions.ad_id) ?? snapshot?.adId ?? stringValue(source?.metadata.ad_id),
    adName: stringValue(row?.dimensions.ad_name) ?? snapshot?.adName ?? stringValue(source?.metadata.ad_name),
    deliveryStatus: snapshot?.deliveryStatus ?? stringValue(row?.dimensions.delivery_status) ?? stringValue(row?.dimensions.ad_status) ?? stringValue(source?.metadata.delivery_status),
    attributionSetting: stringValue(row?.dimensions.attribution_setting) ?? stringValue(source?.metadata.attribution_setting),
    evidenceAt: snapshot?.fetchedAt ?? row?.updated_at ?? null,
    creativeUtmStatus: snapshot?.creativeUtmStatus ?? "unknown",
    objective: snapshot?.objective ?? stringValue(row?.dimensions.campaign_objective),
    optimizationGoal: snapshot?.optimizationGoal ?? stringValue(row?.dimensions.optimization_goal),
    budgetKind: snapshot?.budgetKind ?? null,
    budgetSource: snapshot?.budgetSource ?? null,
    budgetMinorUnits: snapshot?.budgetMinorUnits ?? null,
    budgetRemainingMinorUnits: snapshot?.budgetRemainingMinorUnits ?? null,
    startsAt: snapshot?.startsAt ?? null,
    endsAt: snapshot?.endsAt ?? null,
    qualityRanking: stringValue(row?.dimensions.quality_ranking),
    engagementRateRanking: stringValue(row?.dimensions.engagement_rate_ranking),
    conversionRateRanking: stringValue(row?.dimensions.conversion_rate_ranking),
  };
}

function metaSnapshotFromRows(rows: RawIngestion[], expected: CampaignUtm, accountId: string | null): MetaAdsSnapshotEvidence | null {
  const snapshots = rows
    .filter((row) => {
      if (row.source_type_key !== "meta_ads" || row.payload.kind !== "meta_ads_sync_snapshot") return false;
      const account = isRecord(row.payload.account) ? row.payload.account : null;
      return normalizedMetaAccountId(account?.id ?? account?.account_id) === accountId;
    })
    .sort((left, right) => right.fetched_at.localeCompare(left.fetched_at));
  const latest = snapshots[0];
  if (!latest || !isRecord(latest.payload.account)) return null;
  let evidenceRow = latest;
  let selected: JsonRecord | undefined;
  for (const snapshot of snapshots) {
    if (!Array.isArray(snapshot.payload.ads)) continue;
    selected = snapshot.payload.ads.filter(isRecord).find((ad) => {
      const creative = isRecord(ad.creative) ? ad.creative : null;
      const creativeUtm = utmFromQueryString(stringValue(creative?.url_tags));
      const campaign = isRecord(ad.campaign) ? ad.campaign : null;
      return campaignMatches(creativeUtm, expected) || stringValue(campaign?.name) === MOONARQ_FIRST_STORY_CAMPAIGN_NAME;
    });
    if (selected) {
      evidenceRow = snapshot;
      break;
    }
  }
  const campaign = selected && isRecord(selected.campaign) ? selected.campaign : null;
  const adset = selected && isRecord(selected.adset) ? selected.adset : null;
  const creative = selected && isRecord(selected.creative) ? selected.creative : null;
  const creativeUrlTags = stringValue(creative?.url_tags);
  const creativeUtm = utmFromQueryString(creativeUrlTags);
  const creativeUtmStatus = !selected
    ? "unknown"
    : !creativeUrlTags || !creativeUtm
      ? "missing"
      : campaignMatches(creativeUtm, expected)
        ? "exact"
        : "mismatch";
  const budget = [
    { value: numberValue(adset?.daily_budget), kind: "daily" as const, source: "ad_set" as const },
    { value: numberValue(adset?.lifetime_budget), kind: "lifetime" as const, source: "ad_set" as const },
    { value: numberValue(campaign?.daily_budget), kind: "daily" as const, source: "campaign" as const },
    { value: numberValue(campaign?.lifetime_budget), kind: "lifetime" as const, source: "campaign" as const },
  ].find((candidate) => candidate.value !== null) ?? null;
  const budgetRemainingMinorUnits = numberValue(
    budget?.source === "ad_set" ? adset?.budget_remaining : campaign?.budget_remaining,
  );
  return {
    fetchedAt: evidenceRow.fetched_at,
    currency: stringValue(latest.payload.account.currency)?.toLowerCase() ?? null,
    campaignId: stringValue(campaign?.id),
    campaignName: stringValue(campaign?.name),
    adSetName: stringValue(adset?.name),
    adId: stringValue(selected?.id),
    adName: stringValue(selected?.name),
    deliveryStatus: stringValue(selected?.effective_status) ?? stringValue(selected?.status) ?? stringValue(campaign?.effective_status) ?? stringValue(campaign?.status),
    creativeUtmStatus,
    objective: stringValue(campaign?.objective),
    optimizationGoal: stringValue(adset?.optimization_goal),
    budgetKind: budget?.kind ?? null,
    budgetSource: budget?.source ?? null,
    budgetMinorUnits: budget?.value ?? null,
    budgetRemainingMinorUnits,
    startsAt: stringValue(adset?.start_time),
    endsAt: stringValue(adset?.end_time),
  };
}

async function latestMetaSnapshot(metaSource: Source | null, expected: CampaignUtm) {
  if (!metaSource) return null;
  const accountId = selectedMetaAccountId(metaSource);
  if (!accountId) return null;
  if (!isRuntimeDatabaseConfigured()) {
    return metaSnapshotFromRows(getDemoStore().rawIngestions.filter((row) => row.source_id === metaSource.id), expected, accountId);
  }
  const rows = await queryRows<RawIngestion>(
    `select * from raw_ingestions where source_id = $1 and source_type_key = 'meta_ads' order by fetched_at desc limit 3`,
    [metaSource.id],
  );
  return metaSnapshotFromRows(rows, expected, accountId);
}

function dateKeyInTimeZone(value: string, timeZone: string | null) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (!timeZone) return date.toISOString().slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function latestShopifyAttributionCapability(rows: RawIngestion[], rangeStartDate?: string, rangeEndDate?: string) {
  const latest = rows
    .filter((row) => row.source_type_key === "shopify" && row.payload.kind === "shopify_orders_snapshot")
    .sort((left, right) => right.fetched_at.localeCompare(left.fetched_at))[0];
  const shop = latest && isRecord(latest.payload.shop) ? latest.payload.shop : null;
  const timeZone = stringValue(shop?.ianaTimezone);
  const orders = latest && Array.isArray(latest.payload.orders)
    ? latest.payload.orders.filter(isRecord)
    : null;
  const relevantOrders = orders?.filter((order) => {
    if (order.test === true) return false;
    if (!rangeStartDate || !rangeEndDate) return true;
    const createdAt = stringValue(order.createdAt);
    const dateKey = createdAt ? dateKeyInTimeZone(createdAt, timeZone) : null;
    // A malformed/missing order timestamp must not make attribution look complete.
    return !dateKey || (dateKey >= rangeStartDate && dateKey <= rangeEndDate);
  }) ?? [];
  const pendingJourneyOrders = relevantOrders.filter((order) => {
    const journey = order.customerJourneySummary;
    // A null summary means Shopify has no attributable online journey for the
    // order. A present summary with ready=false is still being prepared and can
    // later add UTM-attributed orders, so the aggregate must remain provisional.
    if (journey === null) return false;
    return !isRecord(journey) || journey.ready !== true;
  }).length;
  const schemaReady = latest?.payload.attributionVersion === "customer-journey-v1";
  return {
    ready: schemaReady && orders !== null && pendingJourneyOrders === 0,
    currency: stringValue(shop?.currencyCode)?.toLowerCase() ?? null,
    pendingJourneyOrders,
  };
}

async function shopifyAttributionCapability(shopifySource: Source | null, rangeStartDate: string, rangeEndDate: string) {
  if (!shopifySource) return { ready: false, currency: null, pendingJourneyOrders: 0 };
  if (!isRuntimeDatabaseConfigured()) {
    return latestShopifyAttributionCapability(
      getDemoStore().rawIngestions.filter((row) => row.source_id === shopifySource.id),
      rangeStartDate,
      rangeEndDate,
    );
  }
  const rows = await queryRows<RawIngestion>(
    `select * from raw_ingestions where source_id = $1 and source_type_key = 'shopify' order by fetched_at desc limit 3`,
    [shopifySource.id],
  );
  return latestShopifyAttributionCapability(rows, rangeStartDate, rangeEndDate);
}

export function buildInstagramPaidAdsSummary(input: {
  metaSource: Source | null;
  shopifySource: Source | null;
  metaRows: MetricDaily[];
  shopifyRows: MetricDaily[];
  websiteEvents: WebEvent[];
  shopifyJourneyReady: boolean;
  shopifyJourneyPendingOrders?: number;
  websiteTrackingReady?: boolean;
  websiteEventCounts?: {
    pageViews: number;
    visitors: number;
    eligibleReturnDevices1d?: number;
    returningDevices1d?: number;
    eligibleReturnDevices7d?: number;
    returningDevices7d?: number;
  };
  metaSnapshot?: MetaAdsSnapshotEvidence | null;
  shopifyCurrency?: string | null;
  rangeStartDate?: string;
  rangeEndDate?: string;
  now?: Date;
}): InstagramPaidAdsSummary {
  const { metaSource, shopifySource, metaRows, shopifyRows, websiteEvents } = input;
  const now = input.now ?? new Date();
  const utm = sourceUtm(metaSource);
  const metaAccountId = selectedMetaAccountId(metaSource);
  const currentMetaRows = metaRows.filter((row) => metaRowMatchesAccount(row, metaAccountId));
  const exactEvents = websiteEvents.filter((event) => event.event_name === "page_view" && campaignMatches(extractWebEventUtm(event), utm));
  const observed = input.websiteEventCounts ?? {
    pageViews: exactEvents.length,
    visitors: new Set(exactEvents.map((event) => event.anonymous_id).filter(Boolean)).size,
  };
  const returnEvidence = input.websiteEventCounts ? {
    eligible1d: input.websiteEventCounts.eligibleReturnDevices1d ?? null,
    returning1d: input.websiteEventCounts.returningDevices1d ?? null,
    eligible7d: input.websiteEventCounts.eligibleReturnDevices7d ?? null,
    returning7d: input.websiteEventCounts.returningDevices7d ?? null,
  } : { eligible1d: null, returning1d: null, eligible7d: null, returning7d: null };
  const visitors = observed.visitors;
  const websiteTrackingReady = input.websiteTrackingReady ?? true;
  const metaAuthorized = Boolean(
    metaSource
    && metaSource.metadata.oauth_connected === true
    && metaSource.status !== "needs_credentials"
    && metaSource.status !== "disabled",
  );
  const metaAccountSelected = Boolean(
    metaSource?.external_account_id || stringValue(metaSource?.metadata.selected_ad_account_id),
  );
  const metaConnected = metaAuthorized && metaAccountSelected;
  const metaSynced = Boolean(metaSource?.last_success_at);
  const metaFreshnessStale = metaSynced && metaSyncIsStale(metaSource, now);
  const impressions = sum(currentMetaRows, "meta_ads_impressions", utm);
  const metaSpendRows = rowsFor(currentMetaRows, "meta_ads_spend", utm);
  const spend = metaSpendRows.reduce((total, row) => total + row.metric_value, 0);
  const delivered = spend > 0 || impressions > 0;
  const metaHasAnyRows = currentMetaRows.some((row) => dimensionsMatch(row, utm));
  const metaOperational = metaConnected && metaSource?.status !== "error";
  const metaState = metaMetricState({ connected: metaOperational, synced: metaSynced, delivered, hasRows: metaHasAnyRows, stale: metaFreshnessStale });
  const metaStateReason = !metaAuthorized
    ? "Connect Meta Ads with read-only ads_read access."
    : !metaAccountSelected
      ? "Select the Meta ad account to monitor."
      : !metaSynced
        ? "Run the first Meta Ads sync."
        : metaFreshnessStale
          ? "The latest Meta Ads sync is overdue. Run Sync before treating these values as current."
          : !delivered
            ? "No matching ad delivery was reported in this date range."
            : undefined;
  const shopifyRowsForModel = (metricKey: string, model: "first_visit" | "last_visit") => distinctOrderRows(
    rowsFor(shopifyRows, metricKey, utm).filter((row) => row.dimensions.attribution_model === model),
  );
  const revenueRows = shopifyRowsForModel("shopify_attributed_net_revenue", "last_visit");
  const orderRows = shopifyRowsForModel("shopify_attributed_orders", "last_visit");
  const firstTouchRevenueRows = shopifyRowsForModel("shopify_attributed_net_revenue", "first_visit");
  const firstTouchOrderRows = shopifyRowsForModel("shopify_attributed_orders", "first_visit");
  const revenue = revenueRows.reduce((total, row) => total + row.metric_value, 0);
  const orders = orderRows.reduce((total, row) => total + row.metric_value, 0);
  const firstTouchRevenue = firstTouchRevenueRows.reduce((total, row) => total + row.metric_value, 0);
  const firstTouchOrders = firstTouchOrderRows.reduce((total, row) => total + row.metric_value, 0);
  const firstTouchOrderIds = new Set(firstTouchOrderRows.map(orderId));
  const lastTouchOrderIds = new Set(orderRows.map(orderId));
  const bothFirstAndLastOrders = [...firstTouchOrderIds].filter((id) => lastTouchOrderIds.has(id)).length;
  const firstTouchOnlyOrders = [...firstTouchOrderIds].filter((id) => !lastTouchOrderIds.has(id)).length;
  const knownDelayRows = firstTouchOrderRows.filter((row) => numericDimension(row, "days_to_conversion") !== null);
  const delayedFirstTouchOrders = knownDelayRows.filter((row) => (numericDimension(row, "days_to_conversion") ?? 0) > 0).length;
  const totalKnownDaysToConversion = knownDelayRows.reduce((total, row) => total + (numericDimension(row, "days_to_conversion") ?? 0), 0);
  const knownCustomerIndexRows = orderRows.filter((row) => numericDimension(row, "customer_order_index") !== null);
  const newCustomerLastTouchOrders = knownCustomerIndexRows.filter((row) => numericDimension(row, "customer_order_index") === 1).length;
  const returningCustomerLastTouchOrders = knownCustomerIndexRows.filter((row) => (numericDimension(row, "customer_order_index") ?? 0) > 1).length;
  const attributedGrossSales = shopifyRowsForModel("shopify_attributed_gross_sales", "last_visit").reduce((total, row) => total + row.metric_value, 0);
  const attributedDiscounts = shopifyRowsForModel("shopify_attributed_discounts", "last_visit").reduce((total, row) => total + row.metric_value, 0);
  const attributedCurrentTotal = shopifyRowsForModel("shopify_attributed_current_total", "last_visit").reduce((total, row) => total + row.metric_value, 0);
  const attributedRefunds = shopifyRowsForModel("shopify_attributed_refunds", "last_visit").reduce((total, row) => total + row.metric_value, 0);
  const spendCurrency = metaSpendRows.at(-1)?.unit.toLowerCase() ?? null;
  const configuredMetaCurrency = (stringValue(metaSource?.metadata.account_currency) ?? input.metaSnapshot?.currency)?.toLowerCase() ?? null;
  const metaCurrencyEvidence = [spendCurrency, configuredMetaCurrency].find((value) => value && /^[a-z]{3}$/u.test(value)) ?? null;
  const metaCurrency = metaCurrencyEvidence ?? "currency";
  const shopifyCurrencyCandidate = revenueRows.at(-1)?.unit.toLowerCase() ?? stringValue(input.shopifyCurrency)?.toLowerCase() ?? null;
  const shopifyCurrency = shopifyCurrencyCandidate && /^[a-z]{3}$/u.test(shopifyCurrencyCandidate) ? shopifyCurrencyCandidate : null;
  const currencyAligned = metaCurrencyEvidence && shopifyCurrency ? shopifyCurrency === metaCurrencyEvidence : null;
  const currenciesCompatible = currencyAligned === true;
  const shopifyReady = Boolean(
    shopifySource
    && shopifySource.status !== "disabled"
    && shopifySource.status !== "error"
    && shopifySource.status !== "needs_credentials"
    && input.shopifyJourneyReady,
  );
  const shopifyFreshnessStale = Boolean(shopifyReady && shopifySource?.last_success_at && metaSyncIsStale(shopifySource, now));
  const shopifyState: PaidMetricState = !shopifySource || shopifySource.status === "error" || shopifySource.status === "disabled"
    ? "unavailable"
    : shopifyReady
      ? shopifyFreshnessStale ? "stale" : "ready"
      : "pending";
  const shopifyStateReason = !shopifySource
    ? "Connect the Shopify source for order and revenue attribution."
    : shopifySource.status === "error"
      ? "Repair the Shopify source before using order attribution."
      : !input.shopifyJourneyReady
        ? input.shopifyJourneyPendingOrders && input.shopifyJourneyPendingOrders > 0
          ? `Shopify is still preparing customer journey attribution for ${input.shopifyJourneyPendingOrders} order(s). Sync again before treating attributed orders or revenue as complete.`
          : "Run a new Shopify sync to load customer journey attribution."
        : shopifyFreshnessStale
          ? "The latest Shopify sync is overdue. Run Sync before treating attributed orders as current."
        : undefined;
  const currencyMismatchReason = currencyAligned === false
    ? `Meta spend is ${metaCurrencyEvidence?.toUpperCase()} while Shopify revenue is ${shopifyCurrency?.toUpperCase()}; conversion is required before calculating return.`
    : !metaCurrencyEvidence
      ? "Meta did not report a valid spend currency, so cross-source return metrics are unavailable."
      : !shopifyCurrency
        ? "Shopify did not report a valid revenue currency, so cross-source return metrics are unavailable."
        : undefined;
  const metaPurchaseValue = sum(currentMetaRows, "meta_ads_purchase_value", utm);
  const metaPurchases = sum(currentMetaRows, "meta_ads_purchases", utm);
  const postSaves = sum(currentMetaRows, "meta_ads_post_saves", utm);
  const postReactions = sum(currentMetaRows, "meta_ads_post_reactions", utm);
  const comments = sum(currentMetaRows, "meta_ads_comments", utm);
  const postEngagements = sum(currentMetaRows, "meta_ads_post_engagements", utm);
  const outboundClicks = sum(currentMetaRows, "meta_ads_outbound_clicks", utm);
  const linkClicks = sum(currentMetaRows, "meta_ads_inline_link_clicks", utm);
  const allClicks = sum(currentMetaRows, "meta_ads_clicks", utm);
  const paidReach = sum(currentMetaRows, "meta_ads_reach", utm);
  const landingPageViews = sum(currentMetaRows, "meta_ads_landing_page_views", utm);
  const viewContent = sum(currentMetaRows, "meta_ads_view_content", utm);
  const addToCart = sum(currentMetaRows, "meta_ads_add_to_cart", utm);
  const initiateCheckout = sum(currentMetaRows, "meta_ads_initiate_checkout", utm);
  const video25 = sum(currentMetaRows, "meta_ads_video_p25", utm);
  const video50 = sum(currentMetaRows, "meta_ads_video_p50", utm);
  const video75 = sum(currentMetaRows, "meta_ads_video_p75", utm);
  const video95 = sum(currentMetaRows, "meta_ads_video_p95", utm);
  const video100 = sum(currentMetaRows, "meta_ads_video_p100", utm);
  const thruPlay = sum(currentMetaRows, "meta_ads_video_thruplay", utm);
  const details = campaignDetails(currentMetaRows, utm, metaSource, input.metaSnapshot ?? null);

  const dailyMap = new Map<string, { date: string; spend: number; metaPurchaseValue: number | null; shopifyNetRevenue: number | null }>();
  for (const row of [...currentMetaRows, ...shopifyRows].filter((candidate) => dimensionsMatch(candidate, utm))) {
    const current = dailyMap.get(row.date) ?? { date: row.date, spend: 0, metaPurchaseValue: null, shopifyNetRevenue: null };
    if (row.metric_key === "meta_ads_spend") current.spend += row.metric_value;
    if (row.metric_key === "meta_ads_purchase_value") current.metaPurchaseValue = (current.metaPurchaseValue ?? 0) + row.metric_value;
    if (row.metric_key === "shopify_attributed_net_revenue" && row.dimensions.attribution_model === "last_visit") {
      current.shopifyNetRevenue = (current.shopifyNetRevenue ?? 0) + row.metric_value;
    }
    dailyMap.set(row.date, current);
  }

  const budget = details.budgetMinorUnits === null
    ? null
    : details.budgetMinorUnits / currencyMinorUnitDivisor(metaCurrency);
  const reportedBudgetRemaining = details.budgetRemainingMinorUnits === null
    ? null
    : details.budgetRemainingMinorUnits / currencyMinorUnitDivisor(metaCurrency);
  const campaignStartMs = details.startsAt ? Date.parse(details.startsAt) : Number.NaN;
  const campaignEndMs = details.endsAt ? Date.parse(details.endsAt) : Number.NaN;
  const hasSchedule = Number.isFinite(campaignStartMs) && Number.isFinite(campaignEndMs) && campaignEndMs > campaignStartMs;
  const campaignStartDate = details.startsAt?.slice(0, 10) ?? null;
  const rangeCoversCampaignStart = Boolean(input.rangeStartDate && campaignStartDate && input.rangeStartDate <= campaignStartDate);
  const lifetimePacingReady = details.budgetKind === "lifetime" && budget !== null && budget > 0 && hasSchedule && rangeCoversCampaignStart;
  const elapsedFraction = hasSchedule
    ? Math.min(1, Math.max(0, (now.getTime() - campaignStartMs) / (campaignEndMs - campaignStartMs)))
    : null;
  const expectedSpendToDate = lifetimePacingReady && elapsedFraction !== null ? budget * elapsedFraction : null;
  const activeUntilMs = hasSchedule ? Math.min(Math.max(now.getTime(), campaignStartMs), campaignEndMs) : Number.NaN;
  const activeDays = hasSchedule && activeUntilMs > campaignStartMs
    ? Math.max(1, Math.ceil((activeUntilMs - campaignStartMs) / 86_400_000))
    : null;
  const pacingReason = details.budgetMinorUnits === null
    ? "Meta did not report a campaign or ad-set budget."
    : details.budgetKind !== "lifetime"
      ? "Daily budget is a recurring cap; lifetime remaining and final-spend projection are not comparable."
      : !hasSchedule
        ? "A start and end time are required for lifetime-budget pacing."
        : !rangeCoversCampaignStart
          ? "The selected range does not include campaign start, so cumulative lifetime pacing would be incomplete."
          : elapsedFraction === 0
            ? "The campaign has not started yet."
            : null;

  const state: InstagramPaidAdsSummary["state"] = !metaSource || !metaAuthorized
    ? "not_connected"
    : !metaAccountSelected
      ? "needs_account"
      : metaSource.status === "error"
        ? "error"
        : !metaSource.last_success_at
          ? "first_sync"
          : metaFreshnessStale || metaSource.status === "warning"
            ? "stale"
            : !delivered
              ? "no_delivery"
              : "ready";

  const derivedState: PaidMetricState = metaState;
  const readyAgainstMetaState = (denominatorReady: boolean): PaidMetricState => denominatorReady
    ? derivedState === "ready" ? "ready" : derivedState
    : derivedState === "ready" || derivedState === "stale"
      ? "not_reported"
      : derivedState;
  const metaSpendRatioState = readyAgainstMetaState(spend > 0);
  const hasMetaSpendEvidence = metaSpendRows.length > 0;
  const metaSpendEvidenceReady = hasMetaSpendEvidence && (metaState === "ready" || metaState === "stale");
  const metaSpendEvidenceState: PaidMetricState = hasMetaSpendEvidence
    ? metaState
    : metaState === "ready" || metaState === "stale" ? "not_reported" : metaState;
  const crossSourceMoneyState: PaidMetricState = !shopifyReady
    ? shopifyState
    : metaSpendEvidenceState !== "ready" && metaSpendEvidenceState !== "stale"
      ? metaSpendEvidenceState
      : !currenciesCompatible
        ? "unavailable"
        : metaSpendEvidenceState === "stale" || shopifyState === "stale" ? "stale" : "ready";
  const shopifyReturnState: PaidMetricState = crossSourceMoneyState === "ready" || crossSourceMoneyState === "stale"
    ? spend > 0 ? crossSourceMoneyState : "not_reported"
    : crossSourceMoneyState;
  const crossSourceMoneyReason = !shopifyReady
    ? shopifyStateReason
    : !metaSpendEvidenceReady
      ? metaStateReason ?? "No Meta spend evidence was reported for this campaign and date range."
      : !currenciesCompatible
        ? currencyMismatchReason
        : metaStateReason ?? shopifyStateReason;
  const websiteState: PaidMetricState = websiteTrackingReady ? "ready" : "unavailable";
  const crossSourceState = (denominatorReady: boolean, includeShopify = false): PaidMetricState => {
    if (!websiteTrackingReady) return "unavailable";
    if (includeShopify && !shopifyReady) return shopifyState;
    if (metaState === "stale" || (includeShopify && shopifyState === "stale")) return "stale";
    if (metaState !== "ready") return metaState;
    return denominatorReady ? "ready" : "not_reported";
  };
  const metaRateMetric = (numerator: number, denominator: number, reason: string) => metric(
    denominator > 0 ? ratio(numerator * 100, denominator) : null,
    "percent",
    readyAgainstMetaState(denominator > 0),
    "derived",
    denominator > 0 ? metaStateReason : reason,
  );
  const metaCostMetric = (denominator: number, reason: string) => metric(
    denominator > 0 ? ratio(spend, denominator) : null,
    metaCurrency,
    readyAgainstMetaState(denominator > 0),
    "derived",
    denominator > 0 ? metaStateReason : reason,
  );
  const shopifyPeriodRate = metric(
    shopifyReady && websiteTrackingReady && visitors > 0 ? ratio(orders * 100, visitors) : null,
    "percent",
    !websiteTrackingReady
      ? "unavailable"
      : visitors > 0 && shopifyReady
        ? shopifyState
        : shopifyState === "ready" || shopifyState === "stale"
          ? "not_reported"
          : shopifyState,
    "derived",
    !websiteTrackingReady
      ? "Connect first-party website tracking."
      : visitors === 0 && shopifyReady
        ? "No exact UTM visitors were observed in this period."
        : "Orders use Shopify order dates while visitors use visit dates; this is a blended period rate, not a cohort CVR.",
  );

  const funnel: InstagramPaidAdsFunnel = {
    impressions: metric(metaConnected || metaHasAnyRows ? impressions : null, "count", metaState, "meta", metaStateReason),
    paidReach: metric(metaConnected || metaHasAnyRows ? paidReach : null, "count", metaState, "meta", metaStateReason),
    frequency: metric(
      delivered ? ratio(impressions, paidReach) : null,
      "ratio",
      readyAgainstMetaState(paidReach > 0),
      "derived",
      paidReach > 0 ? "Weighted from ad-day reach; this is not unique reach for the whole selected range." : "No ad-day reach denominator was reported.",
    ),
    allClicks: metric(metaConnected || metaHasAnyRows ? allClicks : null, "count", metaState, "meta", metaStateReason),
    linkClicks: metric(metaConnected || metaHasAnyRows ? linkClicks : null, "count", metaState, "meta", metaStateReason),
    outboundClicks: metric(metaConnected || metaHasAnyRows ? outboundClicks : null, "count", metaState, "meta", metaStateReason),
    landingPageViews: metric(metaConnected || metaHasAnyRows ? landingPageViews : null, "count", metaState, "meta", metaStateReason),
    utmPageViews: metric(websiteTrackingReady ? observed.pageViews : null, "count", websiteState, "utm", websiteTrackingReady ? undefined : "Connect first-party website tracking."),
    utmVisitors: metric(websiteTrackingReady ? visitors : null, "count", websiteState, "utm", websiteTrackingReady ? undefined : "Connect first-party website tracking."),
    allCtr: metaRateMetric(allClicks, impressions, "No impression denominator was reported."),
    linkCtr: metaRateMetric(linkClicks, impressions, "No impression denominator was reported."),
    outboundCtr: metaRateMetric(outboundClicks, impressions, "No impression denominator was reported."),
    cpc: metaCostMetric(outboundClicks, "No outbound-click denominator was reported."),
    cpm: metric(
      impressions > 0 ? ratio(spend * 1_000, impressions) : null,
      metaCurrency,
      readyAgainstMetaState(impressions > 0),
      "derived",
      impressions > 0 ? metaStateReason : "No impression denominator was reported.",
    ),
    costPerLandingPageView: metaCostMetric(landingPageViews, "No Meta landing-page-view denominator was reported."),
    costPerUtmVisitor: metric(
      websiteTrackingReady && visitors > 0 ? ratio(spend, visitors) : null,
      metaCurrency,
      crossSourceState(visitors > 0),
      "derived",
      !websiteTrackingReady ? "Connect first-party website tracking." : visitors > 0 ? "Cross-source diagnostic using Meta spend and exact first-party UTM devices." : "No exact UTM visitor denominator was observed.",
    ),
    viewContent: metric(metaConnected || metaHasAnyRows ? viewContent : null, "count", metaState, "meta", metaStateReason),
    addToCart: metric(metaConnected || metaHasAnyRows ? addToCart : null, "count", metaState, "meta", metaStateReason),
    initiateCheckout: metric(metaConnected || metaHasAnyRows ? initiateCheckout : null, "count", metaState, "meta", metaStateReason),
    metaPurchases: metric(metaConnected || metaHasAnyRows ? metaPurchases : null, "count", metaState, "meta", metaStateReason),
    outboundToLandingRate: metaRateMetric(landingPageViews, outboundClicks, "No outbound-click denominator was reported."),
    landingToContentRate: metaRateMetric(viewContent, landingPageViews, "No Meta landing-page-view denominator was reported."),
    contentToCartRate: metaRateMetric(addToCart, viewContent, "No Meta content-view denominator was reported."),
    cartToCheckoutRate: metaRateMetric(initiateCheckout, addToCart, "No Meta add-to-cart denominator was reported."),
    checkoutToMetaPurchaseRate: metaRateMetric(metaPurchases, initiateCheckout, "No Meta checkout denominator was reported."),
    metaLandingPurchaseRate: metaRateMetric(metaPurchases, landingPageViews, "No Meta landing-page-view denominator was reported."),
    utmCaptureRate: metric(
      websiteTrackingReady && landingPageViews > 0 ? ratio(visitors * 100, landingPageViews) : null,
      "percent",
      crossSourceState(landingPageViews > 0),
      "derived",
      !websiteTrackingReady ? "Connect first-party website tracking." : landingPageViews > 0 ? "Tracking coverage diagnostic; attribution windows and device identity can make this exceed 100%." : "No Meta landing-page-view denominator was reported.",
    ),
    periodBlendedOrderRate: shopifyPeriodRate,
    purchaseConversionRate: shopifyPeriodRate,
    costPerViewContent: metaCostMetric(viewContent, "No Meta content-view denominator was reported."),
    costPerAddToCart: metaCostMetric(addToCart, "No Meta add-to-cart denominator was reported."),
    costPerCheckout: metaCostMetric(initiateCheckout, "No Meta checkout denominator was reported."),
    metaCostPerPurchase: metaCostMetric(metaPurchases, "No Meta-attributed purchase denominator was reported."),
    costPerShopifyOrder: metric(
      shopifyReady && metaSpendEvidenceReady && currenciesCompatible && orders > 0 ? ratio(spend, orders) : null,
      metaCurrency,
      orders > 0
        ? crossSourceMoneyState
        : shopifyState === "ready" || shopifyState === "stale" ? "not_reported" : shopifyState,
      "derived",
      orders === 0 && shopifyReady ? "No Shopify last-visit UTM orders were matched." : crossSourceMoneyReason,
    ),
    averageOrderValue: metric(
      shopifyReady && orders > 0 ? ratio(revenue, orders) : null,
      shopifyCurrency ?? metaCurrency,
      orders > 0 ? shopifyState : shopifyState === "ready" || shopifyState === "stale" ? "not_reported" : shopifyState,
      "derived",
      orders === 0 && shopifyReady ? "No Shopify last-visit UTM orders were matched." : shopifyStateReason,
    ),
    video25: metric(metaConnected || metaHasAnyRows ? video25 : null, "count", metaState, "meta", metaStateReason),
    video50: metric(metaConnected || metaHasAnyRows ? video50 : null, "count", metaState, "meta", metaStateReason),
    video75: metric(metaConnected || metaHasAnyRows ? video75 : null, "count", metaState, "meta", metaStateReason),
    video95: metric(metaConnected || metaHasAnyRows ? video95 : null, "count", metaState, "meta", metaStateReason),
    video100: metric(metaConnected || metaHasAnyRows ? video100 : null, "count", metaState, "meta", metaStateReason),
    video25Rate: metaRateMetric(video25, impressions, "No impression denominator was reported."),
    video25To50Retention: metaRateMetric(video50, video25, "No 25% video-view denominator was reported."),
    video50To75Retention: metaRateMetric(video75, video50, "No 50% video-view denominator was reported."),
    video75To100Retention: metaRateMetric(video100, video75, "No 75% video-view denominator was reported."),
    videoCompletionRate: metaRateMetric(video100, video25, "No 25% video-view denominator was reported."),
    thruPlay: metric(metaConnected || metaHasAnyRows ? thruPlay : null, "count", metaState, "meta", metaStateReason),
    thruPlayRate: metaRateMetric(thruPlay, impressions, "No impression denominator was reported."),
    costPerVideo25: metaCostMetric(video25, "No 25% video-view denominator was reported."),
    costPerVideoComplete: metaCostMetric(video100, "No completed-video-view denominator was reported."),
    costPerThruPlay: metaCostMetric(thruPlay, "No ThruPlay denominator was reported."),
  };

  const moneyUnit = shopifyCurrency ?? metaCurrency;
  const knownDelayState: PaidMetricState = knownDelayRows.length > 0
    ? shopifyState
    : shopifyState === "ready" || shopifyState === "stale" ? "not_reported" : shopifyState;
  const knownCustomerState: PaidMetricState = knownCustomerIndexRows.length > 0
    ? shopifyState
    : shopifyState === "ready" || shopifyState === "stale" ? "not_reported" : shopifyState;
  const deviceReturnState = (eligible: number | null): PaidMetricState => !websiteTrackingReady
    ? "unavailable"
    : eligible !== null && eligible > 0 ? "ready" : "not_reported";
  const deviceReturnReason = (eligible: number | null, horizon: "1-day" | "7-day") => !websiteTrackingReady
    ? "Connect first-party website tracking."
    : eligible === null
      ? "Return-device evidence was not loaded for this view."
      : eligible === 0
        ? `No exact UTM device has completed the ${horizon} observation window yet.`
        : `Same-device, cross-day return within the ${horizon} window; cookies and cross-device behavior can undercount people.`;
  const memory: InstagramPaidAdsSummary["memory"] = {
    postSaves: metric(metaConnected || metaHasAnyRows ? postSaves : null, "count", metaState, "meta", metaStateReason),
    postReactions: metric(metaConnected || metaHasAnyRows ? postReactions : null, "count", metaState, "meta", metaStateReason),
    comments: metric(metaConnected || metaHasAnyRows ? comments : null, "count", metaState, "meta", metaStateReason),
    postEngagements: metric(metaConnected || metaHasAnyRows ? postEngagements : null, "count", metaState, "meta", metaStateReason),
    saveRate: metaRateMetric(postSaves, impressions, "No impression denominator was reported."),
    postEngagementRate: metaRateMetric(postEngagements, impressions, "No impression denominator was reported."),
    costPerSave: metaCostMetric(postSaves, "No Meta post-save denominator was reported."),
    eligibleReturnDevices1d: metric(returnEvidence.eligible1d, "count", deviceReturnState(returnEvidence.eligible1d), "utm", deviceReturnReason(returnEvidence.eligible1d, "1-day")),
    returningDevices1d: metric(returnEvidence.returning1d, "count", deviceReturnState(returnEvidence.eligible1d), "utm", deviceReturnReason(returnEvidence.eligible1d, "1-day")),
    deviceReturnRate1d: metric(returnEvidence.eligible1d && returnEvidence.returning1d !== null ? ratio(returnEvidence.returning1d * 100, returnEvidence.eligible1d) : null, "percent", deviceReturnState(returnEvidence.eligible1d), "derived", deviceReturnReason(returnEvidence.eligible1d, "1-day")),
    eligibleReturnDevices7d: metric(returnEvidence.eligible7d, "count", deviceReturnState(returnEvidence.eligible7d), "utm", deviceReturnReason(returnEvidence.eligible7d, "7-day")),
    returningDevices7d: metric(returnEvidence.returning7d, "count", deviceReturnState(returnEvidence.eligible7d), "utm", deviceReturnReason(returnEvidence.eligible7d, "7-day")),
    deviceReturnRate7d: metric(returnEvidence.eligible7d && returnEvidence.returning7d !== null ? ratio(returnEvidence.returning7d * 100, returnEvidence.eligible7d) : null, "percent", deviceReturnState(returnEvidence.eligible7d), "derived", deviceReturnReason(returnEvidence.eligible7d, "7-day")),
    firstTouchOrders: metric(shopifyReady ? firstTouchOrders : null, "count", shopifyState, "shopify", shopifyStateReason),
    firstTouchRevenue: metric(shopifyReady ? firstTouchRevenue : null, moneyUnit, shopifyState, "shopify", shopifyStateReason),
    firstTouchOnlyOrders: metric(shopifyReady ? firstTouchOnlyOrders : null, "count", shopifyState, "shopify", "First-visit UTM matches without the same exact last-visit UTM; this is not proof of another channel assist."),
    bothFirstAndLastOrders: metric(shopifyReady ? bothFirstAndLastOrders : null, "count", shopifyState, "shopify", "Distinct orders whose Shopify first and last visits both match the exact UTM tuple."),
    delayedFirstTouchOrders: metric(shopifyReady ? delayedFirstTouchOrders : null, "count", knownDelayState, "shopify", knownDelayRows.length > 0 ? "Delayed means Shopify reports more than zero days from first visit to conversion." : "No Shopify order has a known days-to-conversion value for this UTM."),
    delayedFirstTouchShare: metric(
      knownDelayRows.length > 0 ? ratio(delayedFirstTouchOrders * 100, knownDelayRows.length) : null,
      "percent",
      knownDelayState,
      "derived",
      knownDelayRows.length > 0 ? "Delayed first-touch orders divided by exact first-touch orders with known conversion days." : "No known days-to-conversion denominator was reported.",
    ),
    averageDaysToConversion: metric(
      knownDelayRows.length > 0 ? totalKnownDaysToConversion / knownDelayRows.length : null,
      "days",
      knownDelayState,
      "derived",
      knownDelayRows.length > 0 ? "Average Shopify days from first visit to order for exact first-touch UTM matches." : "No known days-to-conversion values were reported.",
    ),
    newCustomerLastTouchOrders: metric(shopifyReady ? newCustomerLastTouchOrders : null, "count", knownCustomerState, "shopify", "Shopify customer order index equals 1; this is an order-history signal, not lifetime value."),
    returningCustomerLastTouchOrders: metric(shopifyReady ? returningCustomerLastTouchOrders : null, "count", knownCustomerState, "shopify", "Shopify customer order index is greater than 1."),
    newCustomerShare: metric(
      knownCustomerIndexRows.length > 0 ? ratio(newCustomerLastTouchOrders * 100, knownCustomerIndexRows.length) : null,
      "percent",
      knownCustomerState,
      "derived",
      knownCustomerIndexRows.length > 0 ? "New-customer last-touch orders divided by exact UTM orders with a known customer order index." : "No known customer-order-index denominator was reported.",
    ),
  };

  const economicsRowsReady = orders === 0 || shopifyRowsForModel("shopify_attributed_gross_sales", "last_visit").length > 0;
  const economicsState: PaidMetricState = !shopifyReady
    ? shopifyState
    : economicsRowsReady ? shopifyState : "pending";
  const economicsReason = economicsRowsReady ? shopifyStateReason : "Run a new Shopify sync to populate attributed gross sales, discounts, totals, and refunds.";
  const economics: InstagramPaidAdsSummary["economics"] = {
    attributedGrossSales: metric(economicsRowsReady ? attributedGrossSales : null, moneyUnit, economicsState, "shopify", economicsReason),
    attributedDiscounts: metric(economicsRowsReady ? attributedDiscounts : null, moneyUnit, economicsState, "shopify", economicsReason),
    attributedCurrentTotal: metric(economicsRowsReady ? attributedCurrentTotal : null, moneyUnit, economicsState, "shopify", economicsReason),
    attributedRefunds: metric(economicsRowsReady ? attributedRefunds : null, moneyUnit, economicsState, "shopify", economicsReason),
    discountRate: metric(
      economicsRowsReady && attributedGrossSales > 0 ? ratio(attributedDiscounts * 100, attributedGrossSales) : null,
      "percent",
      economicsRowsReady && attributedGrossSales > 0 ? economicsState : economicsState === "ready" || economicsState === "stale" ? "not_reported" : economicsState,
      "derived",
      attributedGrossSales > 0 ? economicsReason : "No attributed gross-sales denominator was reported.",
    ),
    refundRate: metric(
      economicsRowsReady && attributedGrossSales > 0 ? ratio(attributedRefunds * 100, attributedGrossSales) : null,
      "percent",
      economicsRowsReady && attributedGrossSales > 0 ? economicsState : economicsState === "ready" || economicsState === "stale" ? "not_reported" : economicsState,
      "derived",
      attributedGrossSales > 0 ? economicsReason : "No attributed gross-sales denominator was reported.",
    ),
    firstTouchRoas: metric(
      shopifyReady && metaSpendEvidenceReady && currenciesCompatible && spend > 0 ? ratio(firstTouchRevenue, spend) : null,
      "ratio",
      spend > 0 && shopifyReady ? shopifyReturnState : crossSourceMoneyState === "ready" || crossSourceMoneyState === "stale" ? "not_reported" : crossSourceMoneyState,
      "derived",
      crossSourceMoneyReason ?? "Shopify exact first-visit UTM net payment divided by Meta spend; keep separate from last-touch ROAS.",
    ),
    newCustomerCacProxy: metric(
      shopifyReady && metaSpendEvidenceReady && currenciesCompatible && newCustomerLastTouchOrders > 0 ? ratio(spend, newCustomerLastTouchOrders) : null,
      metaCurrency,
      newCustomerLastTouchOrders > 0
        ? crossSourceMoneyState
        : knownCustomerState === "ready" || knownCustomerState === "stale" ? "not_reported" : knownCustomerState,
      "derived",
      newCustomerLastTouchOrders > 0
        ? crossSourceMoneyReason ?? "Meta spend divided by Shopify new-customer last-touch orders; this is a paid-attribution CAC proxy."
        : "No new-customer last-touch order denominator was reported.",
    ),
  };

  const reconciliation: InstagramPaidAdsSummary["reconciliation"] = {
    metaVsShopifyPurchaseDelta: metric(
      shopifyReady && metaHasAnyRows ? metaPurchases - orders : null,
      "count",
      shopifyReady && metaHasAnyRows ? metaState === "stale" || shopifyState === "stale" ? "stale" : metaState : shopifyState,
      "derived",
      "Meta account-window purchases minus Shopify exact last-visit UTM orders; a difference is expected and is not automatically a data error.",
    ),
    metaVsShopifyRevenueDelta: metric(
      shopifyReady && metaSpendEvidenceReady && metaHasAnyRows && currenciesCompatible ? metaPurchaseValue - revenue : null,
      metaCurrency,
      shopifyReady && metaHasAnyRows ? crossSourceMoneyState : shopifyState,
      "derived",
      crossSourceMoneyReason ?? "Meta account-window purchase value minus Shopify exact last-visit net payment.",
    ),
    landingTrackingGap: metric(
      websiteTrackingReady && metaHasAnyRows ? landingPageViews - visitors : null,
      "count",
      crossSourceState(true),
      "derived",
      "Meta landing-page views minus first-party exact UTM devices; identity and attribution windows differ.",
    ),
    landingTrackingRatio: funnel.utmCaptureRate,
  };

  const campaignMetadataState: PaidMetricState = !metaConnected
    ? metaHasAnyRows ? "stale" : "pending"
    : !metaSynced
      ? "pending"
      : metaFreshnessStale || metaSource?.status === "warning"
        ? "stale"
        : metaSource?.status === "error"
          ? "unavailable"
          : "ready";
  const pacingState: PaidMetricState = lifetimePacingReady
    ? campaignMetadataState
    : campaignMetadataState === "ready" || campaignMetadataState === "stale" ? "not_reported" : campaignMetadataState;
  const budgetState: PaidMetricState = budget !== null
    ? campaignMetadataState
    : campaignMetadataState === "ready" || campaignMetadataState === "stale" ? "not_reported" : campaignMetadataState;
  const fallbackRemaining = lifetimePacingReady && budget !== null ? budget - spend : null;
  const budgetRemaining = reportedBudgetRemaining ?? fallbackRemaining;
  const pacing: InstagramPaidAdsSummary["pacing"] = {
    budget: metric(budget, metaCurrency, budgetState, "meta", budget === null ? pacingReason ?? undefined : `${details.budgetKind ?? "unknown"} budget from ${details.budgetSource ?? "Meta"}.`),
    budgetRemaining: metric(budgetRemaining, metaCurrency, budgetRemaining !== null ? campaignMetadataState : pacingState, reportedBudgetRemaining !== null ? "meta" : "derived", budgetRemaining !== null ? "Meta-reported remaining budget when available; otherwise lifetime budget minus covered spend." : pacingReason ?? undefined),
    budgetUsed: metric(lifetimePacingReady && budget ? ratio(spend * 100, budget) : null, "percent", pacingState, "derived", pacingReason ?? "Covered Meta spend divided by lifetime budget."),
    scheduleElapsed: metric(lifetimePacingReady && elapsedFraction !== null ? elapsedFraction * 100 : null, "percent", pacingState, "derived", pacingReason ?? "Elapsed campaign schedule through the current time."),
    expectedSpendToDate: metric(expectedSpendToDate, metaCurrency, pacingState, "derived", pacingReason ?? "Linear lifetime-budget benchmark, not Meta's delivery forecast."),
    pacingIndex: metric(expectedSpendToDate && expectedSpendToDate > 0 ? ratio(spend, expectedSpendToDate) : null, "ratio", expectedSpendToDate && expectedSpendToDate > 0 ? pacingState : pacingState === "ready" || pacingState === "stale" ? "not_reported" : pacingState, "derived", pacingReason ?? "Covered spend divided by linear expected spend to date; 1.00× is on pace."),
    projectedFinalSpend: metric(lifetimePacingReady && elapsedFraction && elapsedFraction > 0 ? spend / elapsedFraction : null, metaCurrency, lifetimePacingReady && elapsedFraction && elapsedFraction > 0 ? pacingState : pacingState === "ready" || pacingState === "stale" ? "not_reported" : pacingState, "derived", pacingReason ?? "Simple projection from cumulative spend and elapsed schedule; early delivery can be volatile."),
    daysRemaining: metric(hasSchedule ? Math.max(0, (campaignEndMs - now.getTime()) / 86_400_000) : null, "days", hasSchedule ? campaignMetadataState : pacingState, "derived", hasSchedule ? "Calendar days until the scheduled end time." : pacingReason ?? undefined),
    averageDailySpend: metric(
      lifetimePacingReady && activeDays ? spend / activeDays : null,
      metaCurrency,
      lifetimePacingReady && activeDays ? pacingState : pacingState === "ready" || pacingState === "stale" ? "not_reported" : pacingState,
      "derived",
      lifetimePacingReady && activeDays ? "Covered cumulative spend divided by elapsed calendar days since campaign start." : pacingReason ?? undefined,
    ),
    coverageComplete: lifetimePacingReady,
    reason: pacingReason,
  };

  const outcomes: InstagramPaidAdsSummary["outcomes"] = {
    spend: metric(metaConnected || metaHasAnyRows ? spend : null, metaCurrency, metaState, "meta", metaStateReason),
    attributedOrders: metric(shopifyReady ? orders : null, "count", shopifyState, "shopify", shopifyStateReason),
    attributedNetRevenue: metric(shopifyReady ? revenue : null, moneyUnit, shopifyState, "shopify", shopifyStateReason),
    shopifyRoas: metric(shopifyReady && metaSpendEvidenceReady && currenciesCompatible ? ratio(revenue, spend) : null, "ratio", shopifyReturnState, "derived", crossSourceMoneyReason),
    metaPurchaseValue: metric(metaHasAnyRows ? metaPurchaseValue : null, metaCurrency, metaState, "meta", metaStateReason),
    metaRoas: metric(metaHasAnyRows ? ratio(metaPurchaseValue, spend) : null, "ratio", metaSpendRatioState, "derived", spend > 0 ? metaStateReason : "No Meta spend denominator was reported."),
    adSpendReturn: metric(shopifyReady && metaSpendEvidenceReady && spend > 0 && currenciesCompatible ? ((revenue - spend) / spend) * 100 : null, "percent", shopifyReturnState, "derived", crossSourceMoneyReason),
    netPaymentAfterAdSpend: metric(
      shopifyReady && metaSpendEvidenceReady && currenciesCompatible ? revenue - spend : null,
      moneyUnit,
      crossSourceMoneyState,
      "derived",
      crossSourceMoneyReason ?? "Shopify last-touch net payment minus Meta spend, before COGS, shipping, tax policy, and payment fees.",
    ),
    revenuePerUtmVisitor: metric(shopifyReady && websiteTrackingReady && visitors > 0 ? ratio(revenue, visitors) : null, moneyUnit, !websiteTrackingReady ? "unavailable" : visitors > 0 ? shopifyState : shopifyState === "ready" || shopifyState === "stale" ? "not_reported" : shopifyState, "derived", visitors > 0 ? "Shopify last-touch net payment divided by exact first-party UTM devices in the selected period." : "No exact UTM visitor denominator was observed."),
    revenuePerThousandImpressions: metric(shopifyReady && impressions > 0 ? ratio(revenue * 1_000, impressions) : null, moneyUnit, shopifyReady && impressions > 0 ? metaState === "stale" || shopifyState === "stale" ? "stale" : metaState : shopifyState, "derived", impressions > 0 ? "Shopify last-touch net payment per thousand Meta impressions; a cross-source period diagnostic." : "No impression denominator was reported."),
    profitRoi: metric(null, "percent", "unavailable", "derived", "Add COGS, shipping, payment fees, tax policy, and repeat-revenue cohorts to calculate true profit ROI."),
  };

  const aidma: InstagramPaidAdsSummary["aidma"] = {
    stages: [
      { key: "attention", label: "Attention", proxyLabel: "Paid exposure", count: funnel.impressions, rateLabel: "25% video / impressions", rate: funnel.video25Rate, supportLabel: "Ad-day reach sum", support: funnel.paidReach, costLabel: "CPM", cost: funnel.cpm, sourceLabel: "Meta Ads · ad-day", caveat: "Reach is summed across ads and days; it is not unique range reach." },
      { key: "interest", label: "Interest", proxyLabel: "Outbound response", count: funnel.outboundClicks, rateLabel: "Outbound CTR", rate: funnel.outboundCtr, supportLabel: "Meta landing views", support: funnel.landingPageViews, costLabel: "Cost / outbound click", cost: funnel.cpc, sourceLabel: "Meta Ads · account window", caveat: null },
      { key: "desire", label: "Desire", proxyLabel: "Shopping intent", count: funnel.addToCart, rateLabel: "Content → cart", rate: funnel.contentToCartRate, supportLabel: "Checkout starts", support: funnel.initiateCheckout, costLabel: "Cost / add to cart", cost: funnel.costPerAddToCart, sourceLabel: "Meta Ads · attributed actions", caveat: "Actions follow the selected Meta attribution window and are not person-level funnel steps." },
      { key: "memory", label: "Memory", proxyLabel: "Behavioral return proxies", count: memory.delayedFirstTouchOrders, rateLabel: "Delayed order share", rate: memory.delayedFirstTouchShare, supportLabel: "7-day device return", support: memory.deviceReturnRate7d, costLabel: "Cohort cost", cost: metric(null, metaCurrency, "unavailable", "derived", "Spend cannot be cohort-aligned to delayed Shopify first-touch orders with the current aggregate data."), sourceLabel: "Shopify + first-party UTM", caveat: "Delayed orders and same-device returns are behavioral proxies, not a direct measurement of human memory; cookies and cross-device use can undercount." },
      { key: "action", label: "Action", proxyLabel: "Commerce truth", count: outcomes.attributedOrders, rateLabel: "Period blended order rate", rate: funnel.periodBlendedOrderRate, supportLabel: "Shopify net payment", support: outcomes.attributedNetRevenue, costLabel: "Cost / Shopify order", cost: funnel.costPerShopifyOrder, sourceLabel: "Shopify last visit + UTM", caveat: "Orders use order date and visitors use visit date; this is not a cohort conversion rate." },
    ],
  };
  return {
    state,
    metaAdsSourceId: metaSource?.id ?? null,
    campaign: { ...details, utm },
    outcomes,
    aidma,
    memory,
    economics,
    reconciliation,
    pacing,
    funnel,
    daily: [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
    coverage: {
      meta: metaConnected,
      utm: observed.pageViews > 0,
      shopify: Boolean(shopifySource && shopifySource.status !== "disabled"),
      shopifyJourneyReady: shopifyReady,
      currencyAligned,
    },
    observed: { utmPageViews: observed.pageViews, utmVisitors: visitors },
    currency: metaCurrency,
    shopifyCurrency,
    lastSyncedAt: metaSource?.last_success_at ?? input.metaSnapshot?.fetchedAt ?? null,
    shopifyLastSyncedAt: shopifySource?.last_success_at ?? null,
    error: metaSource?.last_error
      ?? (metaFreshnessStale ? "The latest Meta Ads sync is overdue; run Sync to refresh this account." : null)
      ?? (metaSource?.status === "warning" ? "Meta Ads source is in a warning state; review the source before relying on the latest sync." : null),
  };
}

export async function getInstagramPaidAdsSummary(options: {
  dataSpaceId?: string;
  instagramSourceId?: string | null;
  rangeKey?: DateRangeKey;
} = {}): Promise<InstagramPaidAdsSummary> {
  const range = getDateRange(options.rangeKey ?? "30d");
  const sources = await listSources({ dataSpaceId: options.dataSpaceId });
  const metaSource = linkedMetaSource(sources, options.instagramSourceId);
  const shopifySources = sources.filter((source) => source.source_type_key === "shopify" && source.status !== "disabled");
  const linkedShopifySourceId = metaSource ? stringValue(metaSource.metadata.linked_shopify_source_id) : null;
  const shopifySource = (linkedShopifySourceId
    ? shopifySources.find((source) => source.id === linkedShopifySourceId)
    : shopifySources.length === 1 ? shopifySources[0] : null) ?? null;
  const websiteSources = sources.filter((source) => isWebsiteSourceKey(source.source_type_key) && source.status !== "disabled");
  const linkedWebsiteSourceId = metaSource ? stringValue(metaSource.metadata.linked_website_source_id) : null;
  const websiteSource = (linkedWebsiteSourceId
    ? websiteSources.find((source) => source.id === linkedWebsiteSourceId)
    : websiteSources.length === 1 ? websiteSources[0] : null) ?? null;
  const expectedUtm = sourceUtm(metaSource);
  const [metaRows, shopifyRows, websiteEventCounts, shopifyCapability, metaSnapshot] = await Promise.all([
    metaSource
      ? listMetrics({ sourceId: metaSource.id, metricKeys: [...META_METRIC_KEYS], startDate: range.startDate, endDate: range.endDate, dataSpaceId: options.dataSpaceId })
      : Promise.resolve([]),
    shopifySource
      ? listMetrics({
          sourceId: shopifySource.id,
          metricKeys: [
            "shopify_attributed_orders",
            "shopify_attributed_net_revenue",
            "shopify_attributed_gross_sales",
            "shopify_attributed_discounts",
            "shopify_attributed_current_total",
            "shopify_attributed_refunds",
          ],
          startDate: range.startDate,
          endDate: range.endDate,
          dataSpaceId: options.dataSpaceId,
        })
      : Promise.resolve([]),
    websiteSource
      ? countWebPageViewsByUtm({
          sourceId: websiteSource.id,
          startOccurredAt: startOfAppDateUtc(range.startDate),
          endOccurredAt: endOfAppDateUtc(range.endDate),
          utm: expectedUtm,
          dataSpaceId: options.dataSpaceId,
        })
      : Promise.resolve({ pageViews: 0, visitors: 0 }),
    shopifyAttributionCapability(shopifySource, range.startDate, range.endDate),
    latestMetaSnapshot(metaSource, expectedUtm),
  ]);
  return buildInstagramPaidAdsSummary({
    metaSource,
    shopifySource,
    metaRows,
    shopifyRows,
    websiteEvents: [],
    websiteEventCounts,
    websiteTrackingReady: Boolean(
      websiteSource
      && websiteSource.status !== "disabled"
      && websiteSource.status !== "error"
      && websiteSource.status !== "needs_credentials",
    ),
    shopifyJourneyReady: shopifyCapability.ready,
    shopifyJourneyPendingOrders: shopifyCapability.pendingJourneyOrders,
    shopifyCurrency: shopifyCapability.currency,
    metaSnapshot,
    rangeStartDate: range.startDate,
    rangeEndDate: range.endDate,
  });
}
