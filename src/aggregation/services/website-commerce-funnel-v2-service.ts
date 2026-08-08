import "server-only";

import { getWebsiteFunnelOverview } from "@/aggregation/services/website-funnel-service";
import type {
  WebsiteCommerceCoverageState,
  WebsiteCommerceFunnelStage,
  WebsiteCommerceFunnelV2Snapshot,
  WebsiteCommerceFreshnessState,
  WebsiteCommerceMeasurementState,
  WebsiteCommerceMetric,
  WebsiteCommerceMoneyGroup,
  WebsiteCommerceRangeKey,
  WebsiteCommerceSegment,
  WebsiteCommerceSourceReadiness,
} from "@/aggregation/services/website-commerce-funnel-v2-types";
import { WEBSITE_COMMERCE_FUNNEL_V2_DEFINITION } from "@/aggregation/services/website-commerce-funnel-v2-types";
import type { MetricDaily, Source, SyncRun } from "@/storage/db/schema";
import { getCommerceFunnelV2ReportAggregate } from "@/storage/repositories/commerce-funnel-v2-report-repository";
import { listMetrics } from "@/storage/repositories/metrics-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { listSyncRuns } from "@/storage/repositories/sync-runs-repository";
import { SHOPIFY_COMMERCE_FACTS_V2_FLAG } from "@/storage/runtime/commerce-feature-flags";

export const WEBSITE_COMMERCE_FUNNEL_V2_UI_FLAG = "ENABLE_MOONARQ_COMMERCE_FUNNEL_V2";
export { SHOPIFY_COMMERCE_FACTS_V2_FLAG };

const META_METRIC_KEYS = [
  "meta_ads_impressions",
  "meta_ads_inline_link_clicks",
  "meta_ads_purchases",
  "meta_ads_spend",
] as const;

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const WEBSITE_STALE_AFTER_MS = 24 * 60 * 60_000;
const MIN_SYNC_FRESHNESS_MS = 2 * 60 * 60_000;

export type CommerceBridgeAggregate = {
  state: "ready" | "migration_unavailable" | "unavailable";
  reason: string;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
  businessVisits: number | null;
  businessIntents: number | null;
  businessCarts: number | null;
  excludedBotSessions: number | null;
  excludedNonProductionSessions: number | null;
  eligibleCheckoutEvents: number | null;
  eligibleShopifyOrders: number | null;
  linkedOrdersPlaced: number | null;
  activeLinkedOrders: number | null;
  cancelledLinkedOrders: number | null;
  bridgeMatchedOrders: number | null;
  bridgeMissingOrders: number | null;
  bridgeInvalidOrders: number | null;
  bridgeAmbiguousOrders: number | null;
  consentBlockedOrders: number | null;
  reversedTimestampOrders: number | null;
  preCoverageOrders: number | null;
  linkedOrderLines: number | null;
  eligibleOrderLines: number | null;
  money: WebsiteCommerceMoneyGroup[];
};

export type CommerceBridgeAggregateInput = {
  dataSpaceId: string;
  websiteSourceId: string;
  shopifySourceId: string;
  startAt: string;
  endExclusive: string;
  segment: WebsiteCommerceSegment;
};

type ServiceDependencies = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  loadSources?: typeof listSources;
  loadWebsiteOverview?: typeof getWebsiteFunnelOverview;
  loadMetaMetrics?: typeof listMetrics;
  loadMetaSyncRuns?: typeof listSyncRuns;
  loadCommerceBridge?: (input: CommerceBridgeAggregateInput) => Promise<CommerceBridgeAggregate>;
};

export type WebsiteCommerceFunnelV2Input = {
  dataSpaceId: string;
  range?: WebsiteCommerceRangeKey;
  segment?: WebsiteCommerceSegment;
};

type MetaAggregate = {
  impressions: number | null;
  linkClicks: number | null;
  platformPurchases: number | null;
  spend: Array<{ currency: string; value: string }>;
  hasRows: boolean;
  hasAllMetrics: boolean;
};

type MetaWindowEvidence = {
  coverage: WebsiteCommerceCoverageState;
  asOf: string | null;
};

const META_SYNC_MATCH_TOLERANCE_MS = 5 * 60_000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const PACIFIC_TIME_ZONE = "America/Los_Angeles";

function explicitTrue(env: NodeJS.ProcessEnv, key: string) {
  return env[key]?.trim() === "true";
}

function validTimestamp(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function safeCount(value: number | null) {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function metric(
  value: number | null,
  state: WebsiteCommerceMeasurementState,
  authority: WebsiteCommerceMetric["authority"],
  note: string,
): WebsiteCommerceMetric {
  return {
    value: state === "not_measured" ? null : safeCount(value),
    state,
    authority,
    note,
  };
}

function percentMetric(
  numerator: number | null,
  denominator: number | null,
  state: WebsiteCommerceMeasurementState,
  note: string,
): WebsiteCommerceMetric {
  const safeNumerator = safeCount(numerator);
  const safeDenominator = safeCount(denominator);
  return {
    value: state === "healthy"
      && safeNumerator !== null
      && safeDenominator !== null
      && safeDenominator > 0
      ? Math.round((safeNumerator / safeDenominator) * 10_000) / 100
      : null,
    state,
    authority: "derived",
    note,
  };
}

function unavailableSource(
  label: WebsiteCommerceSourceReadiness["label"],
  cadence: WebsiteCommerceSourceReadiness["cadence"],
  authority: string,
  note: string,
): WebsiteCommerceSourceReadiness {
  return {
    label,
    authority,
    cadence,
    state: "not_measured",
    freshness: "unavailable",
    coverage: "unavailable",
    asOf: null,
    note,
  };
}

function emptySnapshot(
  input: WebsiteCommerceFunnelV2Input,
  generatedAt: string,
  reasonCode: WebsiteCommerceFunnelV2Snapshot["reasonCode"],
  reason: string,
): WebsiteCommerceFunnelV2Snapshot {
  const stage = (
    key: WebsiteCommerceFunnelStage["key"],
    label: string,
    authority: WebsiteCommerceFunnelStage["authority"],
  ): WebsiteCommerceFunnelStage => ({
    key,
    label,
    authority,
    count: null,
    state: "not_measured",
    fromPrevious: null,
    note: reason,
  });
  const unavailable = (authority: WebsiteCommerceMetric["authority"]): WebsiteCommerceMetric => ({
    value: null,
    state: "not_measured",
    authority,
    note: reason,
  });

  return {
    schemaVersion: 1,
    definitionVersion: WEBSITE_COMMERCE_FUNNEL_V2_DEFINITION,
    generatedAt,
    state: "not_measured",
    reasonCode,
    reason,
    range: {
      key: input.range ?? "30d",
      label: input.range === "today" ? "Today" : input.range === "7d" ? "Last 7 days" : "Last 30 days",
      startAt: null,
      endExclusive: null,
      timeZone: "America/Los_Angeles",
      segment: input.segment ?? "all",
    },
    sources: {
      website: unavailableSource("Website Tracker", "realtime", "First-party session and behavior truth", reason),
      shopify: unavailableSource("Shopify", "hourly", "Order, payment, and refund truth", reason),
      meta: unavailableSource("Meta Ads", "hourly", "Delivery, spend, and platform-attribution truth", reason),
    },
    funnel: [
      stage("visit", "Visit", "website"),
      stage("product_intent", "Product intent", "website"),
      stage("add_to_cart", "Add to cart", "website"),
      stage("begin_checkout", "Checkout started", "website"),
      stage("shopify_order", "Linked Shopify order", "shopify"),
    ],
    commerce: {
      eligibleCheckoutEvents: unavailable("website"),
      linkedOrdersPlaced: unavailable("shopify"),
      activeLinkedOrders: unavailable("shopify"),
      cancelledLinkedOrders: unavailable("shopify"),
      linkedOrderRatePercent: unavailable("derived"),
      linkCoveragePercent: unavailable("derived"),
      money: [],
    },
    builder: {
      linkedOrderLines: unavailable("shopify"),
      itemLinkCoveragePercent: unavailable("derived"),
    },
    diagnostics: {
      excludedBotSessions: unavailable("website"),
      excludedNonProductionSessions: unavailable("website"),
      eligibleShopifyOrders: unavailable("shopify"),
      bridgeMatchedOrders: unavailable("shopify"),
      bridgeMissingOrders: unavailable("shopify"),
      bridgeInvalidOrders: unavailable("shopify"),
      bridgeAmbiguousOrders: unavailable("shopify"),
      consentBlockedOrders: unavailable("derived"),
      reversedTimestampOrders: unavailable("derived"),
      preCoverageOrders: unavailable("shopify"),
    },
    meta: {
      impressions: unavailable("meta"),
      linkClicks: unavailable("meta"),
      platformPurchases: unavailable("meta"),
      spend: [],
      note: "Meta platform attribution is intentionally separate from the deterministic Website-to-Shopify bridge.",
    },
    caveats: [
      "Shopify remains authoritative for orders and monetary values.",
      "Meta platform attribution is not a person-level Website or Shopify identity join.",
      "Missing rows, sources, migrations, or coverage are never presented as zero.",
    ],
  };
}

function exactSource(sources: Source[], type: Source["source_type_key"]) {
  const candidates = sources.filter(
    (source) => source.source_type_key === type && source.status !== "disabled",
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function synchronizedAtFreshness(
  source: Source | null,
  synchronizedAt: string | null,
  now: Date,
): WebsiteCommerceFreshnessState {
  if (!source) return "unavailable";
  const syncedAt = validTimestamp(synchronizedAt);
  if (syncedAt === null) return "unavailable";
  const threshold = Math.max(
    MIN_SYNC_FRESHNESS_MS,
    Math.max(1, source.sync_frequency_minutes) * 2 * 60_000,
  );
  return now.getTime() - syncedAt <= threshold ? "fresh" : "stale";
}

function syncedFreshness(source: Source | null, now: Date): WebsiteCommerceFreshnessState {
  return synchronizedAtFreshness(source, source?.last_success_at ?? null, now);
}

function combinedFreshness(
  left: WebsiteCommerceFreshnessState,
  right: WebsiteCommerceFreshnessState,
): WebsiteCommerceFreshnessState {
  if (left === "unavailable" || right === "unavailable") return "unavailable";
  if (left === "stale" || right === "stale") return "stale";
  return "fresh";
}

function websiteFreshness(latestReceivedAt: string | null, now: Date): WebsiteCommerceFreshnessState {
  const latest = validTimestamp(latestReceivedAt);
  if (latest === null) return "unavailable";
  return now.getTime() - latest <= WEBSITE_STALE_AFTER_MS ? "fresh" : "stale";
}

function sourceState(source: Source | null, freshness: WebsiteCommerceFreshnessState) {
  if (!source || freshness === "unavailable") return "not_measured" as const;
  if (source.status !== "healthy" || freshness === "stale") return "partial" as const;
  return "healthy" as const;
}

function websiteCoverage(
  dataState: Awaited<ReturnType<typeof getWebsiteFunnelOverview>>["dataState"],
  startsDuringSelection: boolean,
  firstOccurredAt: string | null,
): WebsiteCommerceCoverageState {
  if (dataState === "source_unavailable" || !firstOccurredAt) return "unavailable";
  if (dataState === "pre_coverage") return "pre_coverage";
  if (startsDuringSelection) return "partial";
  return "complete";
}

function commerceCoverage(
  aggregate: CommerceBridgeAggregate,
  startAt: string,
  endExclusive: string,
  synchronizedThrough: string | null,
  now: Date,
): WebsiteCommerceCoverageState {
  const coverageStart = validTimestamp(aggregate.coverageStartAt);
  const coverageEnd = validTimestamp(aggregate.coverageEndAt);
  const rangeStart = validTimestamp(startAt);
  const rangeEnd = Math.min(
    validTimestamp(endExclusive) ?? Number.POSITIVE_INFINITY,
    validTimestamp(synchronizedThrough) ?? Number.POSITIVE_INFINITY,
    now.getTime(),
  );
  if (coverageStart === null || coverageEnd === null || rangeStart === null) return "unavailable";
  if (coverageStart >= rangeEnd) return "pre_coverage";
  if (coverageStart > rangeStart || coverageEnd < rangeEnd) return "partial";
  return "complete";
}

function sumMetaMetric(rows: MetricDaily[], key: (typeof META_METRIC_KEYS)[number]) {
  const matches = rows.filter((row) => row.metric_key === key);
  if (matches.length === 0) return null;
  const total = matches.reduce((sum, row) => sum + row.metric_value, 0);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

function decimalString(value: number) {
  if (!Number.isFinite(value) || value < 0) return null;
  return value.toFixed(6).replace(/\.?0+$/u, "");
}

function aggregateMeta(rows: MetricDaily[]): MetaAggregate {
  const spendByCurrency = new Map<string, number>();
  for (const row of rows.filter((candidate) => candidate.metric_key === "meta_ads_spend")) {
    const currency = row.unit.toUpperCase();
    if (!CURRENCY_PATTERN.test(currency) || !Number.isFinite(row.metric_value) || row.metric_value < 0) continue;
    spendByCurrency.set(currency, (spendByCurrency.get(currency) ?? 0) + row.metric_value);
  }
  const impressions = sumMetaMetric(rows, "meta_ads_impressions");
  const linkClicks = sumMetaMetric(rows, "meta_ads_inline_link_clicks");
  const platformPurchases = sumMetaMetric(rows, "meta_ads_purchases");
  const spend = [...spendByCurrency]
      .map(([currency, value]) => ({ currency, value: decimalString(value) }))
      .filter((entry): entry is { currency: string; value: string } => entry.value !== null)
      .sort((left, right) => left.currency.localeCompare(right.currency));
  return {
    impressions,
    linkClicks,
    platformPurchases,
    spend,
    hasRows: rows.length > 0,
    hasAllMetrics: impressions !== null
      && linkClicks !== null
      && platformPurchases !== null
      && spend.length > 0,
  };
}

function normalizedMetaAccountId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^act_/u, "");
  return /^\d+$/u.test(normalized) ? normalized : null;
}

function selectedMetaAccountId(source: Source | null) {
  if (!source) return null;
  const candidates = [
    source.external_account_id,
    source.metadata.selected_ad_account_id,
  ].filter((value) => value !== null && value !== undefined);
  if (candidates.length === 0) return null;
  const normalized = candidates.map(normalizedMetaAccountId);
  if (normalized.some((value) => value === null)) return null;
  const unique = new Set(normalized as string[]);
  return unique.size === 1 ? [...unique][0] : null;
}

function resolvedTimeZone(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() })
      .resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

function selectedMetaAccountTimeZone(source: Source | null) {
  return source ? resolvedTimeZone(source.metadata.account_timezone) : null;
}

function isPacificBoundaryCompatible(timeZone: string) {
  return timeZone === resolvedTimeZone(PACIFIC_TIME_ZONE);
}

function validDateKey(value: unknown) {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function latestSuccessfulMetaRun(runs: SyncRun[], sourceId: string) {
  return runs
    .filter((run) => (
      run.source_id === sourceId
      && run.source_type_key === "meta_ads"
      && run.status === "success"
      && validTimestamp(run.finished_at) !== null
    ))
    .sort((left, right) => (
      (validTimestamp(right.finished_at) ?? 0) - (validTimestamp(left.finished_at) ?? 0)
    ))[0] ?? null;
}

function metaWindowEvidence(
  source: Source | null,
  runs: SyncRun[],
  selectedStartDate: string,
  selectedEndDate: string,
): MetaWindowEvidence {
  const sourceAccountId = selectedMetaAccountId(source);
  const accountTimeZone = selectedMetaAccountTimeZone(source);
  const run = source ? latestSuccessfulMetaRun(runs, source.id) : null;
  if (!source || !sourceAccountId || !accountTimeZone || !run || !isJsonObject(run.cursor_after)) {
    return { coverage: "unavailable", asOf: null };
  }

  const cursorAccountId = normalizedMetaAccountId(run.cursor_after.accountId);
  const cursorAccountTimeZone = resolvedTimeZone(run.cursor_after.accountTimeZone);
  const windowStartDate = validDateKey(run.cursor_after.startDate);
  const windowEndDate = validDateKey(run.cursor_after.endDate);
  const fetchedAt = typeof run.cursor_after.fetchedAt === "string"
    ? run.cursor_after.fetchedAt
    : null;
  const fetchedAtMs = validTimestamp(fetchedAt);
  const finishedAtMs = validTimestamp(run.finished_at);
  const sourceSuccessMs = validTimestamp(source.last_success_at);
  const selectedStart = validDateKey(selectedStartDate);
  const selectedEnd = validDateKey(selectedEndDate);

  if (
    cursorAccountId !== sourceAccountId
    || cursorAccountTimeZone !== accountTimeZone
    || !windowStartDate
    || !windowEndDate
    || windowStartDate > windowEndDate
    || fetchedAtMs === null
    || finishedAtMs === null
    || sourceSuccessMs === null
    || !selectedStart
    || !selectedEnd
    || fetchedAtMs > finishedAtMs + META_SYNC_MATCH_TOLERANCE_MS
    || Math.abs(sourceSuccessMs - finishedAtMs) > META_SYNC_MATCH_TOLERANCE_MS
  ) {
    return { coverage: "unavailable", asOf: null };
  }

  // Meta cursor dates are ad-account-local calendar dates. They can only prove
  // this dashboard's Pacific date boundaries when the persisted account zone
  // resolves to the same IANA zone. A valid non-Pacific cursor remains useful
  // freshness evidence, but it must never authorize Pacific-range values.
  if (!isPacificBoundaryCompatible(accountTimeZone)) {
    return { coverage: "partial", asOf: fetchedAt };
  }

  const coverage: WebsiteCommerceCoverageState = windowStartDate <= selectedStart
    && windowEndDate >= selectedEnd
    ? "complete"
    : windowEndDate < selectedStart || windowStartDate > selectedEnd
      ? "unavailable"
      : "partial";
  return { coverage, asOf: fetchedAt };
}

function normalizeMoney(
  groups: WebsiteCommerceMoneyGroup[],
  state: WebsiteCommerceMeasurementState,
) {
  const seen = new Set<string>();
  const safe: WebsiteCommerceMoneyGroup[] = [];
  for (const group of groups) {
    if (
      !CURRENCY_PATTERN.test(group.currency)
      || seen.has(group.currency)
      || safeCount(group.orders) === null
      || ![group.grossSales, group.currentTotal, group.netPayment, group.refunds].every(
        (value) => DECIMAL_PATTERN.test(value),
      )
    ) continue;
    seen.add(group.currency);
    safe.push({ ...group, state });
  }
  return safe.sort((left, right) => left.currency.localeCompare(right.currency));
}

async function defaultCommerceBridgeReader(
  input: CommerceBridgeAggregateInput,
): Promise<CommerceBridgeAggregate> {
  return getCommerceFunnelV2ReportAggregate(input);
}

function stageState(
  coverage: WebsiteCommerceCoverageState,
  freshness: WebsiteCommerceFreshnessState,
) {
  if (
    coverage === "unavailable"
    || coverage === "pre_coverage"
    || freshness === "unavailable"
  ) return "not_measured" as const;
  if (coverage === "partial" || freshness === "stale") return "partial" as const;
  return "healthy" as const;
}

export async function getWebsiteCommerceFunnelV2Snapshot(
  input: WebsiteCommerceFunnelV2Input,
  dependencies: ServiceDependencies = {},
): Promise<WebsiteCommerceFunnelV2Snapshot> {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ? new Date(dependencies.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new RangeError("V2 snapshot time must be valid.");
  const generatedAt = now.toISOString();

  if (!explicitTrue(env, WEBSITE_COMMERCE_FUNNEL_V2_UI_FLAG)) {
    return emptySnapshot(
      input,
      generatedAt,
      "feature_disabled",
      "The V2 commerce funnel is disabled until its release gates are complete.",
    );
  }
  if (!explicitTrue(env, SHOPIFY_COMMERCE_FACTS_V2_FLAG)) {
    return emptySnapshot(
      input,
      generatedAt,
      "facts_disabled",
      "Shopify commerce facts are disabled, so order linkage is not measured.",
    );
  }

  const range = input.range ?? "30d";
  const segment = input.segment ?? "all";
  const loadSources = dependencies.loadSources ?? listSources;
  const loadWebsiteOverview = dependencies.loadWebsiteOverview ?? getWebsiteFunnelOverview;
  const loadMetaMetrics = dependencies.loadMetaMetrics ?? listMetrics;
  const loadMetaSyncRuns = dependencies.loadMetaSyncRuns ?? listSyncRuns;
  const loadCommerceBridge = dependencies.loadCommerceBridge ?? defaultCommerceBridgeReader;

  const [sources, website] = await Promise.all([
    loadSources({ dataSpaceId: input.dataSpaceId }),
    loadWebsiteOverview({
      dataSpaceId: input.dataSpaceId,
      range,
      segment,
      comparison: "off",
      now,
    }),
  ]);
  const websiteSource = exactSource(sources, "website");
  const shopifySource = exactSource(sources, "shopify");
  const metaSource = exactSource(sources, "meta_ads");
  if (
    !websiteSource
    || !shopifySource
    || website.source.state !== "ready"
    || website.source.candidateCount !== 1
  ) {
    const snapshot = emptySnapshot(
      input,
      generatedAt,
      "source_unavailable",
      "V2 requires exactly one healthy authoritative Website source and one Shopify source in this data space.",
    );
    snapshot.range = {
      key: range,
      label: website.range.label,
      startAt: website.range.startAt,
      endExclusive: website.range.endExclusive,
      timeZone: "America/Los_Angeles",
      segment,
    };
    return snapshot;
  }

  const [commerce, metaRows, metaSyncRuns] = await Promise.all([
    loadCommerceBridge({
      dataSpaceId: input.dataSpaceId,
      websiteSourceId: websiteSource.id,
      shopifySourceId: shopifySource.id,
      startAt: website.range.startAt,
      endExclusive: website.range.endExclusive,
      segment,
    }),
    metaSource
      ? loadMetaMetrics({
          dataSpaceId: input.dataSpaceId,
          sourceId: metaSource.id,
          sourceTypeKey: "meta_ads",
          metricKeys: [...META_METRIC_KEYS],
          startDate: website.range.startDate,
          endDate: website.range.endDate,
        }).catch(() => null)
      : Promise.resolve(null),
    metaSource
      ? loadMetaSyncRuns(100, "success", { dataSpaceId: input.dataSpaceId }).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (commerce.state !== "ready") {
    const reasonCode = commerce.state === "migration_unavailable"
      ? "migration_unavailable"
      : "coverage_incomplete";
    const safeReason = commerce.state === "migration_unavailable"
      ? "The commerce bridge migration is unavailable, so order linkage is not measured."
      : "The aggregate-only commerce bridge reader or its verified coverage is unavailable.";
    const snapshot = emptySnapshot(input, generatedAt, reasonCode, safeReason);
    snapshot.range = {
      key: range,
      label: website.range.label,
      startAt: website.range.startAt,
      endExclusive: website.range.endExclusive,
      timeZone: "America/Los_Angeles",
      segment,
    };
    return snapshot;
  }

  const websiteFresh = websiteFreshness(website.coverage.latestReceivedAt, now);
  const shopifyFresh = syncedFreshness(shopifySource, now);
  const metaWindow = metaWindowEvidence(
    metaSource,
    metaSyncRuns ?? [],
    website.range.startDate,
    website.range.endDate,
  );
  const metaFresh = combinedFreshness(
    syncedFreshness(metaSource, now),
    synchronizedAtFreshness(metaSource, metaWindow.asOf, now),
  );
  const websiteCoverageState = websiteCoverage(
    website.dataState,
    website.coverage.startsDuringSelection,
    website.coverage.firstOccurredAt,
  );
  const commerceCoverageState = commerceCoverage(
    commerce,
    website.range.startAt,
    website.range.endExclusive,
    commerce.coverageEndAt,
    now,
  );
  const shopifySnapshotFresh = synchronizedAtFreshness(
    shopifySource,
    commerce.coverageEndAt,
    now,
  );
  const shopifyEvidenceFresh = combinedFreshness(shopifyFresh, shopifySnapshotFresh);
  const websiteMetricState = stageState(websiteCoverageState, websiteFresh);
  const commerceMetricState = stageState(commerceCoverageState, shopifyEvidenceFresh);
  const bridgeMetricState: WebsiteCommerceMeasurementState = websiteMetricState === "not_measured"
    || commerceMetricState === "not_measured"
    ? "not_measured"
    : websiteMetricState === "partial" || commerceMetricState === "partial"
      ? "partial"
      : "healthy";
  const metaAggregate = aggregateMeta(metaRows ?? []);
  const metaSourceState = sourceState(metaSource, metaFresh);
  const metaMetricState: WebsiteCommerceMeasurementState = !metaSource
    || !metaRows
    || !metaSyncRuns
    || !metaAggregate.hasRows
    || metaSourceState === "not_measured"
    || metaWindow.coverage === "unavailable"
    || metaWindow.coverage === "pre_coverage"
    ? "not_measured"
    : metaSourceState === "healthy"
      && metaWindow.coverage === "complete"
      && metaAggregate.hasAllMetrics
      ? "healthy"
      : "partial";

  const sourceReadiness = (
    source: Source,
    label: WebsiteCommerceSourceReadiness["label"],
    cadence: WebsiteCommerceSourceReadiness["cadence"],
    authority: string,
    freshness: WebsiteCommerceFreshnessState,
    coverage: WebsiteCommerceCoverageState,
    asOf: string | null,
  ): WebsiteCommerceSourceReadiness => {
    const operationalState = sourceState(source, freshness);
    return {
      label,
      authority,
      cadence,
      state: operationalState === "not_measured"
        || coverage === "unavailable"
        || coverage === "pre_coverage"
        ? "not_measured"
        : operationalState === "healthy" && coverage === "complete"
          ? "healthy"
          : "partial",
      freshness,
      coverage,
      asOf,
      note: freshness === "stale"
        ? `${label} evidence is older than its expected cadence.`
        : freshness === "unavailable"
          ? `${label} has no verified freshness boundary.`
          : coverage === "complete"
            ? `${label} covers the selected interval.`
            : `${label} coverage is incomplete for the selected interval.`,
    };
  };

  const metaCoverageState = metaWindow.coverage;
  const sourcesReadiness = {
    website: sourceReadiness(
      websiteSource,
      "Website Tracker",
      "realtime",
      "First-party session and behavior truth",
      websiteFresh,
      websiteCoverageState,
      website.coverage.latestReceivedAt,
    ),
    shopify: sourceReadiness(
      shopifySource,
      "Shopify",
      "hourly",
      "Order, payment, and refund truth",
      shopifyEvidenceFresh,
      commerceCoverageState,
      commerce.coverageEndAt,
    ),
    meta: metaSource
      ? sourceReadiness(
          metaSource,
          "Meta Ads",
          "hourly",
          "Delivery, spend, and platform-attribution truth",
          metaFresh,
          metaCoverageState,
          metaWindow.asOf,
        )
      : unavailableSource(
          "Meta Ads",
          "hourly",
          "Delivery, spend, and platform-attribution truth",
          "Exactly one Meta Ads source is required for the paid-delivery layer.",
        ),
  };

  const linkedOrders = safeCount(commerce.linkedOrdersPlaced);
  const eligibleCheckouts = safeCount(commerce.eligibleCheckoutEvents);
  const eligibleOrders = safeCount(commerce.eligibleShopifyOrders);
  const bridgeMatched = safeCount(commerce.bridgeMatchedOrders);
  const linkedLines = safeCount(commerce.linkedOrderLines);
  const eligibleLines = safeCount(commerce.eligibleOrderLines);
  const businessStageCounts = [
    { key: "visit", label: "Visit", count: safeCount(commerce.businessVisits) },
    { key: "product_intent", label: "Product intent", count: safeCount(commerce.businessIntents) },
    { key: "add_to_cart", label: "Add to cart", count: safeCount(commerce.businessCarts) },
    { key: "begin_checkout", label: "Checkout started", count: eligibleCheckouts },
  ] as const;
  const firstFourStages = businessStageCounts.map((stage, index): WebsiteCommerceFunnelStage => {
    const previousCount = index === 0 ? null : businessStageCounts[index - 1].count;
    const measuredState: WebsiteCommerceMeasurementState = stage.count === null
      ? "not_measured"
      : bridgeMetricState;
    return {
      key: stage.key,
      label: stage.label,
      authority: "website",
      count: measuredState === "not_measured" ? null : stage.count,
      state: measuredState,
      fromPrevious: index === 0
        ? null
        : percentMetric(
            stage.count,
            previousCount,
            measuredState,
            "Business-session stage conversion inside verified Website and Shopify overlap.",
          ).value,
      note: "Strict production, non-bot business sessions inside the verified Website and Shopify overlap.",
    };
  });

  const funnel: WebsiteCommerceFunnelStage[] = [
    ...firstFourStages,
    {
      key: "shopify_order",
      label: "Linked Shopify order",
      authority: "shopify",
      count: bridgeMetricState === "not_measured" ? null : linkedOrders,
      state: linkedOrders === null ? "not_measured" : bridgeMetricState,
      fromPrevious: percentMetric(
        linkedOrders,
        eligibleCheckouts,
        bridgeMetricState,
        "Exact linked Shopify orders divided by eligible covered Website checkout sessions.",
      ).value,
      note: "Exact consent-gated checkout-event bridge; no Email, customer ID, UTM, or time-only matching.",
    },
  ];

  const coreState = bridgeMetricState;
  const overallState: WebsiteCommerceMeasurementState = coreState === "healthy" && metaMetricState === "healthy"
    ? "healthy"
    : coreState === "not_measured"
      ? "not_measured"
      : "partial";
  const reasonCode: WebsiteCommerceFunnelV2Snapshot["reasonCode"] = overallState === "healthy"
    ? "ready"
    : [websiteFresh, shopifyEvidenceFresh, metaFresh].includes("stale")
      ? "source_stale"
      : "coverage_incomplete";
  const reason = overallState === "healthy"
    ? "The deterministic Website-to-Shopify bridge and the separate Meta reporting layer are healthy for this interval."
    : coreState === "not_measured"
      ? "The deterministic Website-to-Shopify bridge is not measurable for this interval."
      : "Measured values are available, but at least one source or coverage boundary remains partial.";

  const metaRangeMeasured = metaWindow.coverage === "complete"
    && metaFresh === "fresh"
    && metaSource?.status === "healthy";
  const metaMetric = (value: number | null, note: string): WebsiteCommerceMetric => ({
    value: metaRangeMeasured ? value : null,
    state: value === null ? "not_measured" : metaMetricState,
    authority: "meta",
    note,
  });

  return {
    schemaVersion: 1,
    definitionVersion: WEBSITE_COMMERCE_FUNNEL_V2_DEFINITION,
    generatedAt,
    state: overallState,
    reasonCode,
    reason,
    range: {
      key: range,
      label: website.range.label,
      startAt: website.range.startAt,
      endExclusive: website.range.endExclusive,
      timeZone: "America/Los_Angeles",
      segment,
    },
    sources: sourcesReadiness,
    funnel,
    commerce: {
      eligibleCheckoutEvents: metric(
        eligibleCheckouts,
        bridgeMetricState,
        "website",
        "Consent-granted checkout events eligible for an exact order bridge.",
      ),
      linkedOrdersPlaced: metric(
        linkedOrders,
        bridgeMetricState,
        "shopify",
        "Distinct non-test Shopify orders with an exact eligible checkout match.",
      ),
      activeLinkedOrders: metric(
        commerce.activeLinkedOrders,
        bridgeMetricState,
        "shopify",
        "Linked orders whose cancelled_at remains empty.",
      ),
      cancelledLinkedOrders: metric(
        commerce.cancelledLinkedOrders,
        bridgeMetricState,
        "shopify",
        "Linked orders later marked cancelled by Shopify.",
      ),
      linkedOrderRatePercent: percentMetric(
        linkedOrders,
        eligibleCheckouts,
        bridgeMetricState,
        "Linked Shopify orders divided by eligible first-party checkout events.",
      ),
      linkCoveragePercent: percentMetric(
        bridgeMatched,
        eligibleOrders,
        bridgeMetricState,
        "Orders with one valid bridge divided by eligible Shopify orders in verified coverage.",
      ),
      money: bridgeMetricState === "not_measured"
        ? []
        : normalizeMoney(commerce.money, bridgeMetricState),
    },
    builder: {
      linkedOrderLines: metric(
        linkedLines,
        bridgeMetricState,
        "shopify",
        "Order lines with an exact reviewed item-instance bridge.",
      ),
      itemLinkCoveragePercent: percentMetric(
        linkedLines,
        eligibleLines,
        bridgeMetricState,
        "Exactly linked Build Your Own order lines divided by eligible lines.",
      ),
    },
    diagnostics: {
      excludedBotSessions: metric(
        commerce.excludedBotSessions,
        bridgeMetricState,
        "website",
        "Known bot sessions excluded from the V2 business population.",
      ),
      excludedNonProductionSessions: metric(
        commerce.excludedNonProductionSessions,
        bridgeMetricState,
        "website",
        "Synthetic, local, test, legacy-unmarked, or mixed-marker sessions excluded from V2.",
      ),
      eligibleShopifyOrders: metric(eligibleOrders, bridgeMetricState, "shopify", "Non-test Shopify orders in verified Website and Shopify overlap."),
      bridgeMatchedOrders: metric(bridgeMatched, bridgeMetricState, "shopify", "Orders carrying one valid allowlisted checkout bridge."),
      bridgeMissingOrders: metric(commerce.bridgeMissingOrders, bridgeMetricState, "shopify", "Orders without the allowlisted checkout bridge."),
      bridgeInvalidOrders: metric(commerce.bridgeInvalidOrders, bridgeMetricState, "shopify", "Orders with a malformed bridge value."),
      bridgeAmbiguousOrders: metric(commerce.bridgeAmbiguousOrders, bridgeMetricState, "shopify", "Orders with duplicate bridge attributes."),
      consentBlockedOrders: metric(commerce.consentBlockedOrders, bridgeMetricState, "derived", "Bridge candidates rejected because analytics consent was not granted."),
      reversedTimestampOrders: metric(commerce.reversedTimestampOrders, bridgeMetricState, "derived", "Exact IDs rejected because the order predates checkout."),
      preCoverageOrders: metric(commerce.preCoverageOrders, bridgeMetricState, "shopify", "Orders before the verified producer rollout boundary."),
    },
    meta: {
      impressions: metaMetric(metaAggregate.impressions, "Meta-reported ad-day impressions."),
      linkClicks: metaMetric(metaAggregate.linkClicks, "Meta-reported inline link clicks."),
      platformPurchases: metaMetric(metaAggregate.platformPurchases, "Meta platform-attributed purchases; never substituted for Shopify orders."),
      spend: !metaRangeMeasured
        ? []
        : metaAggregate.spend.map((group) => ({ ...group, state: metaMetricState })),
      note: "Meta delivery and platform attribution remain separate from the exact first-party Website-to-Shopify bridge; no person-level view-through join is claimed.",
    },
    caveats: [
      "Website stages use strict production, non-bot business sessions inside the verified Website and Shopify overlap.",
      "Shopify owns order state, payment, and refund truth; monetary currencies are never blended.",
      "Meta platform attribution is shown separately and does not overwrite Shopify outcomes.",
      "Missing rows, sources, migrations, or coverage are never presented as zero.",
    ],
  };
}
