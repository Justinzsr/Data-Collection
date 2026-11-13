import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  aggregateChatgptAdsMetrics,
  getChatgptAdsFunnelSnapshot,
} from "@/aggregation/services/chatgpt-ads-funnel-service";
import { getWebsiteCommerceFunnelV2Snapshot } from "@/aggregation/services/website-commerce-funnel-v2-service";
import type { WebsiteCommerceFunnelV2Snapshot } from "@/aggregation/services/website-commerce-funnel-v2-types";
import type { JsonRecord, MetricDaily, Source, SyncRun } from "@/storage/db/schema";
import { createWebsiteFunnelOverview } from "../presentation/website-funnel-overview-fixture";

const NOW = new Date("2026-08-07T18:00:00.000Z");
const UPDATED = "2026-08-07T17:30:00.000Z";
const INPUT = { dataSpaceId: "space-ads", range: "7d" as const };
const METRIC_SCOPE = { sourceId: "ads-source", accountId: "ads-account", currency: "USD", timeZone: "America/Los_Angeles", startDate: "2026-08-01", endDate: "2026-08-07" };
let unavailableCommerce: WebsiteCommerceFunnelV2Snapshot;

beforeAll(async () => {
  unavailableCommerce = await getWebsiteCommerceFunnelV2Snapshot(
    { dataSpaceId: INPUT.dataSpaceId },
    { env: { NODE_ENV: "test" }, now: NOW },
  );
});

function source(patch: Partial<Source> = {}): Source {
  return {
    id: "ads-source", data_space_id: INPUT.dataSpaceId, source_type_key: "chatgpt_ads",
    display_name: "ChatGPT Ads", input_url: null, normalized_url: null,
    external_account_id: "ads-account", account_name: "Example account", status: "healthy",
    sync_mode: "hourly", sync_frequency_minutes: 60, supports_webhook: false,
    webhook_url: null, webhook_secret_hint: null, last_manual_sync_at: null,
    last_cron_sync_at: null, last_webhook_sync_at: null, last_success_at: UPDATED,
    last_error_at: null, last_error: null, next_sync_at: null,
    metadata: { account_currency: "USD", account_timezone: "America/Los_Angeles" },
    created_at: UPDATED, updated_at: UPDATED, ...patch,
  };
}

function run(cursor: JsonRecord = {}, patch: Partial<SyncRun> = {}): SyncRun {
  return {
    id: "ads-sync", source_id: "ads-source", source_type_key: "chatgpt_ads", trigger: "cron", status: "success",
    idempotency_key: null, lock_key: null, started_at: "2026-08-07T17:29:00.000Z", finished_at: UPDATED,
    duration_ms: 60_000, records_fetched: 1, records_inserted: 1, records_updated: 0, metrics_upserted: 3,
    error_message: null, error_stack: null, cursor_before: null,
    cursor_after: { accountId: "ads-account", currency: "USD", timeZone: "America/Los_Angeles", startDate: "2026-08-01", endDate: "2026-08-07", fetchedAt: UPDATED, ...cursor },
    metadata: {}, created_at: UPDATED, ...patch,
  };
}

function metric(key: string, value: number, patch: Partial<MetricDaily> = {}): MetricDaily {
  const dimensions: JsonRecord = { rollup: "account_daily", account_id: "ads-account", account_currency: "USD", account_timezone: "America/Los_Angeles" };
  if (["conversions", "click_through_conversions", "view_through_conversions", "purchase_value"].includes(key)) {
    Object.assign(dimensions, { attribution_time_basis: "ad_event_time", attribution_window_days: 30, view_through_attribution_window_days: 1 });
    if (key === "purchase_value") dimensions.purchase_scope = "attributed_order_created_goal_and_non_goal";
    else dimensions.conversion_scope = "campaign_goals";
  }
  return {
    id: `row-${key}`, date: "2026-08-07", source_id: "ads-source", source_type_key: "chatgpt_ads",
    metric_key: `chatgpt_ads_${key}`, metric_value: value,
    unit: key === "spend" || key === "purchase_value" ? "USD" : "count",
    dimensions,
    dimensions_hash: `hash-${key}`, created_at: UPDATED, updated_at: UPDATED, ...patch,
  };
}

function measuredCommerce(): WebsiteCommerceFunnelV2Snapshot {
  const snapshot = structuredClone(unavailableCommerce);
  const counts = [100, 50, 20, 10, 3];
  snapshot.funnel = snapshot.funnel.map((stage, index) => ({
    ...stage, count: counts[index], state: "healthy", fromPrevious: index ? counts[index] / counts[index - 1] * 100 : null,
  }));
  snapshot.commerce.linkedOrderRatePercent = { value: 30, state: "healthy", authority: "derived", note: "Exact linked orders / eligible checkout events." };
  return snapshot;
}

function dependencies() {
  const website = createWebsiteFunnelOverview();
  website.coverage.startsDuringSelection = false;
  return {
    now: NOW,
    loadSources: vi.fn(async () => [source()]),
    loadMetrics: vi.fn(async () => [metric("spend", 5), metric("clicks", 10), metric("impressions", 100)]),
    loadSyncRuns: vi.fn(async () => [run()]),
    loadWebsite: vi.fn(async () => website),
    loadCommerce: vi.fn(async () => measuredCommerce()),
  };
}

describe("ChatGPT Ads account metric aggregation", () => {
  it("keeps unreported facts and daily gaps unknown, while preserving explicit measured zero", () => {
    const missing = aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows: [] });
    expect(missing.hasRows).toBe(false);
    expect(Object.values(missing.totals).every((value) => value === null)).toBe(true);
    expect(missing.daily).toHaveLength(7);
    expect(missing.daily.every((day) => day.spend === null && day.clicks === null && day.conversions === null)).toBe(true);

    const measured = aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows: [metric("spend", 0), metric("clicks", 0), metric("impressions", 0)] });
    expect(measured.totals).toMatchObject({ spend: 0, clicks: 0, impressions: 0, conversions: null, ctrPercent: null, cpc: null });
  });

  it("excludes other sources, account identities, platform types, campaign rollups and invalid facts", () => {
    const rows = [
      metric("clicks", 4),
      metric("clicks", 100, { source_id: "different-source" }),
      metric("clicks", 100, { source_type_key: "meta_ads" }),
      metric("clicks", 100, { dimensions: { rollup: "account_daily", account_id: "other-account" } }),
      metric("clicks", 100, { dimensions: { rollup: "campaign_daily", account_id: "ads-account" } }),
      metric("clicks", 100, { date: "2026-07-31" }),
      metric("clicks", -1),
      metric("clicks", Number.NaN),
    ];
    expect(aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows }).totals.clicks).toBe(4);
  });

  it("does not treat an unknown metric as measured account coverage", () => {
    const result = aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows: [metric("unsupported", 999)] });
    expect(result.hasRows).toBe(false);
    expect(result.totals.spend).toBeNull();
  });

  it("rejects incompatible account calendars, currencies and attribution scopes before choosing the latest fact", () => {
    const baseline = [
      metric("spend", 5), metric("impressions", 100), metric("clicks", 10),
      metric("conversions", 0.4), metric("click_through_conversions", 0.3),
      metric("view_through_conversions", 0.1), metric("purchase_value", 20),
    ];
    const incompatible: Array<{ key: string; dimensions: JsonRecord }> = [
      { key: "spend", dimensions: { account_currency: "EUR" } },
      { key: "clicks", dimensions: { account_timezone: "UTC" } },
      { key: "conversions", dimensions: { attribution_time_basis: "conversion_time" } },
      { key: "click_through_conversions", dimensions: { attribution_window_days: 7 } },
      { key: "view_through_conversions", dimensions: { view_through_attribution_window_days: 7 } },
      { key: "conversions", dimensions: { conversion_scope: "all_events" } },
      { key: "purchase_value", dimensions: { purchase_scope: "campaign_goals" } },
    ];
    for (const [index, candidate] of incompatible.entries()) {
      const original = metric(candidate.key, 999);
      const invalid = {
        ...original,
        id: `newer-incompatible-${index}`,
        updated_at: "2026-08-07T17:45:00.000Z",
        dimensions: { ...original.dimensions, ...candidate.dimensions },
      };
      const result = aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows: [...baseline, invalid] });
      expect(result.totals, JSON.stringify(candidate)).toMatchObject({
        spend: 5, impressions: 100, clicks: 10, conversions: 0.4,
        clickThroughConversions: 0.3, viewThroughConversions: 0.1, purchaseValue: 20,
        ctrPercent: 10, cpc: 0.5, cpm: 50, postClickCvrPercent: 3, platformRoas: 4,
      });
    }
    const wrongUnit = aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows: [metric("spend", 5, { unit: "EUR" })] });
    expect(wrongUnit.totals.spend).toBeNull();
    expect(wrongUnit.hasRows).toBe(false);
  });

  it("uses the newest account/day fact once, with stable tie handling instead of summing snapshots", () => {
    const rows = [
      metric("clicks", 10, { id: "a", updated_at: "2026-08-07T16:00:00.000Z" }),
      metric("clicks", 20, { id: "b" }),
      metric("clicks", 30, { id: "c" }),
    ];
    const result = aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows });
    expect(result.totals.clicks).toBe(30);
    expect(result.daily.at(-1)?.clicks).toBe(30);
  });

  it("derives weighted rates from matching daily facts and excludes view-through credit from post-click CVR", () => {
    const facts = [
      ["2026-08-06", { spend: 5, clicks: 10, impressions: 100, conversions: 3, click_through_conversions: 1, view_through_conversions: 2, purchase_value: 50 }],
      ["2026-08-07", { spend: 45, clicks: 9, impressions: 900, conversions: 8, click_through_conversions: 3, view_through_conversions: 5, purchase_value: 150 }],
    ] as const;
    const rows = facts.flatMap(([date, values]) => Object.entries(values).map(([key, value]) => metric(key, value, { date })));
    const result = aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows });
    expect(result.totals).toMatchObject({ spend: 50, clicks: 19, impressions: 1_000, conversions: 11, clickThroughConversions: 4, viewThroughConversions: 7, ctrPercent: 1.9, cpm: 50, platformRoas: 4 });
    expect(result.totals.cpc).toBeCloseTo(50 / 19);
    expect(result.totals.postClickCvrPercent).toBeCloseTo(4 / 19 * 100);
  });

  it("withholds a ratio when numerator and denominator cover different reported days", () => {
    const result = aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows: [
      metric("impressions", 100, { date: "2026-08-06" }), metric("clicks", 10, { date: "2026-08-06" }),
      metric("impressions", 900), metric("click_through_conversions", 2),
    ] });
    expect(result.totals).toMatchObject({ impressions: 1_000, clicks: 10, ctrPercent: null, postClickCvrPercent: null });
  });

  it("does not add money from mixed currencies or calculate cross-currency cost and return ratios", () => {
    const result = aggregateChatgptAdsMetrics({ ...METRIC_SCOPE, rows: [
      metric("spend", 20), metric("spend", 30, { date: "2026-08-06", unit: "EUR" }),
      metric("purchase_value", 100), metric("clicks", 10),
    ] });
    expect(result.currency).toBeNull();
    expect(result.totals).toMatchObject({ spend: null, purchaseValue: null, clicks: 10, cpc: null, platformRoas: null });
  });
});

describe("ChatGPT Ads to website and Shopify funnel", () => {
  it("always asks both first-party and deterministic order readers for the ChatGPT paid cohort", async () => {
    const deps = dependencies();
    const result = await getChatgptAdsFunnelSnapshot(INPUT, deps);
    expect(deps.loadWebsite).toHaveBeenCalledWith(expect.objectContaining({ dataSpaceId: INPUT.dataSpaceId, range: "7d", utmSource: "chatgpt", utmMedium: "paid", comparison: "off" }));
    expect(deps.loadCommerce).toHaveBeenCalledWith(expect.objectContaining({ dataSpaceId: INPUT.dataSpaceId, range: "7d", utmSource: "chatgpt", utmMedium: "paid" }), expect.objectContaining({ now: NOW, loadWebsiteOverview: expect.any(Function) }));
    expect(result.connection.state).toBe("live");
    expect(result.website.stages.map((stage) => stage.count)).toEqual([100, 50, 20, 10, 3]);
    expect(result.website.visitToOrderRatePercent).toBe(3);
    expect(result.website.checkoutToOrderRatePercent).toBe(30);
  });

  it("reuses the same cohort report for deterministic commerce instead of querying it twice", async () => {
    const deps = dependencies();
    const loadCommerce = vi.fn<typeof getWebsiteCommerceFunnelV2Snapshot>(async (_input, dependencies) => {
      const website = await dependencies!.loadWebsiteOverview!({ dataSpaceId: INPUT.dataSpaceId });
      expect(website).toBe(await deps.loadWebsite.mock.results[0].value);
      return measuredCommerce();
    });
    await getChatgptAdsFunnelSnapshot(INPUT, { ...deps, loadCommerce });
    expect(deps.loadWebsite).toHaveBeenCalledTimes(1);
    expect(loadCommerce).toHaveBeenCalledTimes(1);
  });

  it("does not turn a missing Shopify measurement into zero orders or reuse platform conversions as orders", async () => {
    const deps = dependencies();
    deps.loadMetrics.mockResolvedValue([metric("conversions", 12), metric("clicks", 20)]);
    deps.loadCommerce.mockResolvedValue(structuredClone(unavailableCommerce));
    const result = await getChatgptAdsFunnelSnapshot(INPUT, deps);
    expect(result.delivery.totals.conversions).toBe(12);
    expect(result.website.stages.find((stage) => stage.key === "shopify_order")).toMatchObject({ count: null, state: "not_measured" });
    expect(result.website.visitToOrderRatePercent).toBeNull();
    expect(result.website.checkoutToOrderRatePercent).toBeNull();
  });

  it("withholds delivery until an account identity and valid time zone are verified by a successful sync", async () => {
    const deps = dependencies();
    deps.loadSyncRuns.mockResolvedValue([run({ timeZone: "Not/A_Time_Zone" })]);
    const result = await getChatgptAdsFunnelSnapshot(INPUT, deps);
    expect(deps.loadMetrics).not.toHaveBeenCalled();
    expect(result.delivery.coverage).toBe("unavailable");
    expect(result.delivery.totals.spend).toBeNull();
  });

  it("does not mix sources when more than one ChatGPT Ads account is connected", async () => {
    const deps = dependencies();
    deps.loadSources.mockResolvedValue([source(), source({ id: "second-source", external_account_id: "second-account" })]);
    const result = await getChatgptAdsFunnelSnapshot(INPUT, deps);
    expect(result.connection.state).toBe("ambiguous");
    expect(deps.loadMetrics).not.toHaveBeenCalled();
    expect(result.delivery.totals.clicks).toBeNull();
  });
});
