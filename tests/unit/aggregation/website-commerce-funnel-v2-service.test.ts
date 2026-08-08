import { describe, expect, it, vi } from "vitest";
import {
  getWebsiteCommerceFunnelV2Snapshot,
  SHOPIFY_COMMERCE_FACTS_V2_FLAG,
  WEBSITE_COMMERCE_FUNNEL_V2_UI_FLAG,
  type CommerceBridgeAggregate,
} from "@/aggregation/services/website-commerce-funnel-v2-service";
import type { MetricDaily, Source, SourceTypeKey, SyncRun } from "@/storage/db/schema";
import { createWebsiteFunnelOverview } from "../presentation/website-funnel-overview-fixture";

const NOW = new Date("2026-08-07T18:00:00.000Z");
const ENABLED_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  [WEBSITE_COMMERCE_FUNNEL_V2_UI_FLAG]: "true",
  [SHOPIFY_COMMERCE_FACTS_V2_FLAG]: "true",
};

function source(
  sourceTypeKey: SourceTypeKey,
  id: string,
  patch: Partial<Source> = {},
): Source {
  return {
    id,
    data_space_id: "data-space-moonarq",
    source_type_key: sourceTypeKey,
    display_name: `${sourceTypeKey} source`,
    input_url: null,
    normalized_url: null,
    external_account_id: sourceTypeKey === "meta_ads" ? "act_123456789" : null,
    account_name: null,
    status: "healthy",
    sync_mode: sourceTypeKey === "website" ? "webhook" : "hourly",
    sync_frequency_minutes: 60,
    supports_webhook: sourceTypeKey === "website",
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: "2026-08-07T17:30:00.000Z",
    last_error_at: null,
    last_error: null,
    next_sync_at: "2026-08-07T19:00:00.000Z",
    metadata: sourceTypeKey === "meta_ads"
      ? {
          selected_ad_account_id: "act_123456789",
          account_timezone: "America/Los_Angeles",
        }
      : {},
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-08-07T17:30:00.000Z",
    ...patch,
  };
}

function websiteOverview() {
  const overview = createWebsiteFunnelOverview();
  overview.range = {
    ...overview.range,
    startDate: "2026-07-09",
    endDate: "2026-08-07",
    startAt: "2026-07-09T07:00:00.000Z",
    endExclusive: NOW.toISOString(),
  };
  overview.coverage = {
    firstOccurredAt: "2026-07-01T16:00:00.000Z",
    latestReceivedAt: "2026-08-07T17:59:00.000Z",
    startsDuringSelection: false,
  };
  return overview;
}

function commerceAggregate(patch: Partial<CommerceBridgeAggregate> = {}): CommerceBridgeAggregate {
  return {
    state: "ready",
    reason: "Ready.",
    coverageStartAt: "2026-07-01T00:00:00.000Z",
    coverageEndAt: "2026-08-07T17:29:00.000Z",
    businessVisits: 100,
    businessIntents: 50,
    businessCarts: 20,
    excludedBotSessions: 5,
    excludedNonProductionSessions: 3,
    eligibleCheckoutEvents: 12,
    eligibleShopifyOrders: 8,
    linkedOrdersPlaced: 6,
    activeLinkedOrders: 5,
    cancelledLinkedOrders: 1,
    bridgeMatchedOrders: 6,
    bridgeMissingOrders: 1,
    bridgeInvalidOrders: 1,
    bridgeAmbiguousOrders: 0,
    consentBlockedOrders: 1,
    reversedTimestampOrders: 0,
    preCoverageOrders: 2,
    linkedOrderLines: 4,
    eligibleOrderLines: 5,
    money: [
      {
        currency: "USD",
        orders: 6,
        grossSales: "840.25",
        currentTotal: "810.25",
        netPayment: "780.25",
        refunds: "30",
        state: "healthy",
      },
    ],
    ...patch,
  };
}

function metricRow(
  metricKey: string,
  metricValue: number,
  unit: string,
): MetricDaily {
  return {
    id: `metric-${metricKey}`,
    date: "2026-08-07",
    source_id: "meta-source",
    source_type_key: "meta_ads",
    metric_key: metricKey,
    metric_value: metricValue,
    unit,
    dimensions: { ad_id: "not-exposed-by-service" },
    dimensions_hash: "fixture",
    created_at: "2026-08-07T17:30:00.000Z",
    updated_at: "2026-08-07T17:30:00.000Z",
  };
}

function metaSyncRun(patch: Partial<SyncRun> = {}): SyncRun {
  return {
    id: "meta-sync-run",
    source_id: "meta-source",
    source_type_key: "meta_ads",
    trigger: "cron",
    status: "success",
    idempotency_key: null,
    lock_key: null,
    started_at: "2026-08-07T17:28:00.000Z",
    finished_at: "2026-08-07T17:30:00.000Z",
    duration_ms: 120_000,
    records_fetched: 4,
    records_inserted: 1,
    records_updated: 0,
    metrics_upserted: 4,
    error_message: null,
    error_stack: null,
    cursor_before: null,
    cursor_after: {
      accountId: "act_123456789",
      accountTimeZone: "America/Los_Angeles",
      startDate: "2026-07-09",
      endDate: "2026-08-07",
      fetchedAt: "2026-08-07T17:29:00.000Z",
    },
    metadata: {},
    created_at: "2026-08-07T17:28:00.000Z",
    ...patch,
  };
}

function oneDayWebsiteOverview() {
  const overview = websiteOverview();
  overview.range = {
    ...overview.range,
    key: "today",
    label: "Today",
    startDate: "2026-08-07",
    endDate: "2026-08-07",
    startAt: "2026-08-07T07:00:00.000Z",
    endExclusive: NOW.toISOString(),
  };
  return overview;
}

function dependencies(patch: Record<string, unknown> = {}) {
  return {
    env: ENABLED_ENV,
    now: NOW,
    loadSources: vi.fn(async () => [
      source("website", "website-source"),
      source("shopify", "shopify-source"),
      source("meta_ads", "meta-source"),
    ]),
    loadWebsiteOverview: vi.fn(async () => websiteOverview()),
    loadCommerceBridge: vi.fn(async () => commerceAggregate()),
    loadMetaMetrics: vi.fn(async () => [
      metricRow("meta_ads_impressions", 1000, "count"),
      metricRow("meta_ads_inline_link_clicks", 40, "count"),
      metricRow("meta_ads_purchases", 3, "count"),
      metricRow("meta_ads_spend", 125.5, "usd"),
    ]),
    loadMetaSyncRuns: vi.fn(async () => [metaSyncRun()]),
    ...patch,
  };
}

describe("Website commerce funnel V2 service", () => {
  it("defaults off and performs no source, Website, Meta, or commerce reads", async () => {
    const loadSources = vi.fn();
    const loadWebsiteOverview = vi.fn();
    const loadCommerceBridge = vi.fn();
    const loadMetaMetrics = vi.fn();
    const loadMetaSyncRuns = vi.fn();

    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      {
        env: { NODE_ENV: "test" },
        now: NOW,
        loadSources,
        loadWebsiteOverview,
        loadCommerceBridge,
        loadMetaMetrics,
        loadMetaSyncRuns,
      },
    );

    expect(snapshot).toMatchObject({
      state: "not_measured",
      reasonCode: "feature_disabled",
      commerce: { money: [] },
    });
    expect(snapshot.funnel.every((stage) => stage.count === null)).toBe(true);
    expect(loadSources).not.toHaveBeenCalled();
    expect(loadWebsiteOverview).not.toHaveBeenCalled();
    expect(loadCommerceBridge).not.toHaveBeenCalled();
    expect(loadMetaMetrics).not.toHaveBeenCalled();
    expect(loadMetaSyncRuns).not.toHaveBeenCalled();
  });

  it("builds a healthy aggregate-only snapshot without returning source, event, order, or link identities", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "30d", segment: "all" },
      dependencies(),
    );

    expect(snapshot.state).toBe("healthy");
    expect(snapshot.reasonCode).toBe("ready");
    expect(snapshot.funnel.map((stage) => stage.count)).toEqual([100, 50, 20, 12, 6]);
    expect(snapshot.funnel.map((stage) => stage.fromPrevious)).toEqual([null, 50, 40, 60, 50]);
    expect(snapshot.commerce.linkedOrderRatePercent.value).toBe(50);
    expect(snapshot.commerce.linkCoveragePercent.value).toBe(75);
    expect(snapshot.sources.shopify.asOf).toBe("2026-08-07T17:29:00.000Z");
    expect(snapshot.commerce.money).toEqual([
      expect.objectContaining({
        currency: "USD",
        netPayment: "780.25",
        refunds: "30",
        state: "healthy",
      }),
    ]);
    expect(snapshot.meta).toMatchObject({
      impressions: { value: 1000, state: "healthy", authority: "meta" },
      linkClicks: { value: 40 },
      platformPurchases: { value: 3 },
      spend: [{ currency: "USD", value: "125.5", state: "healthy" }],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /website-source|shopify-source|meta-source|not-exposed-by-service|event_id|order_id|session_id|anonymous_id|_hash/i,
    );
  });

  it("preserves authoritative measured zero while leaving denominator-free rates unavailable", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      dependencies({
        loadCommerceBridge: vi.fn(async () => commerceAggregate({
          eligibleCheckoutEvents: 0,
          eligibleShopifyOrders: 0,
          linkedOrdersPlaced: 0,
          activeLinkedOrders: 0,
          cancelledLinkedOrders: 0,
          bridgeMatchedOrders: 0,
          linkedOrderLines: 0,
          eligibleOrderLines: 0,
          money: [],
        })),
      }),
    );

    expect(snapshot.commerce.linkedOrdersPlaced).toMatchObject({ value: 0, state: "healthy" });
    expect(snapshot.diagnostics.eligibleShopifyOrders).toMatchObject({ value: 0, state: "healthy" });
    expect(snapshot.commerce.linkedOrderRatePercent).toMatchObject({ value: null, state: "healthy" });
    expect(snapshot.commerce.linkCoveragePercent).toMatchObject({ value: null, state: "healthy" });
  });

  it("marks incomplete fact coverage partial and does not promote diagnostic values to healthy", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      dependencies({
        loadCommerceBridge: vi.fn(async () => commerceAggregate({
          coverageStartAt: "2026-07-20T00:00:00.000Z",
        })),
      }),
    );

    expect(snapshot.state).toBe("partial");
    expect(snapshot.sources.shopify.coverage).toBe("partial");
    expect(snapshot.commerce.linkedOrdersPlaced).toMatchObject({ value: 6, state: "partial" });
    expect(snapshot.funnel.at(-1)).toMatchObject({ count: 6, state: "partial" });
    expect(snapshot.funnel.at(-1)?.fromPrevious).toBeNull();
    expect(snapshot.commerce.linkedOrderRatePercent).toMatchObject({ value: null, state: "partial" });
    expect(snapshot.commerce.linkCoveragePercent).toMatchObject({ value: null, state: "partial" });
    expect(snapshot.builder.itemLinkCoveragePercent).toMatchObject({ value: null, state: "partial" });
  });

  it("derives every exact-bridge stage and rate from combined Website and Shopify coverage", async () => {
    const partialWebsite = websiteOverview();
    partialWebsite.coverage.startsDuringSelection = true;
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      dependencies({ loadWebsiteOverview: vi.fn(async () => partialWebsite) }),
    );

    expect(snapshot.sources.website.coverage).toBe("partial");
    expect(snapshot.sources.shopify.coverage).toBe("complete");
    expect(snapshot.funnel.map((stage) => stage.state)).toEqual([
      "partial",
      "partial",
      "partial",
      "partial",
      "partial",
    ]);
    expect(snapshot.funnel.map((stage) => stage.count)).toEqual([100, 50, 20, 12, 6]);
    expect(snapshot.funnel.map((stage) => stage.fromPrevious)).toEqual([null, null, null, null, null]);
    expect(snapshot.commerce.linkedOrdersPlaced).toMatchObject({ value: 6, state: "partial" });
    expect(snapshot.commerce.linkedOrderRatePercent.value).toBeNull();
    expect(snapshot.commerce.linkCoveragePercent.value).toBeNull();
    expect(snapshot.commerce.money).toEqual([expect.objectContaining({ state: "partial" })]);
  });

  it("keeps the core bridge partial when Meta has no measured rows instead of reporting Meta zeros", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      dependencies({ loadMetaMetrics: vi.fn(async () => []) }),
    );

    expect(snapshot.state).toBe("partial");
    expect(snapshot.commerce.linkedOrdersPlaced.value).toBe(6);
    expect(snapshot.meta.impressions).toMatchObject({ value: null, state: "not_measured" });
    expect(snapshot.meta.linkClicks.value).toBeNull();
    expect(snapshot.meta.platformPurchases.value).toBeNull();
    expect(snapshot.meta.spend).toEqual([]);
  });

  it("keeps incomplete Meta metric families partial and marks each missing value not measured", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      dependencies({
        loadMetaMetrics: vi.fn(async () => [
          metricRow("meta_ads_impressions", 1000, "count"),
          metricRow("meta_ads_spend", 125.5, "usd"),
        ]),
      }),
    );

    expect(snapshot.state).toBe("partial");
    expect(snapshot.sources.meta).toMatchObject({ state: "healthy", coverage: "complete" });
    expect(snapshot.meta.impressions).toMatchObject({ value: 1000, state: "partial" });
    expect(snapshot.meta.linkClicks).toMatchObject({ value: null, state: "not_measured" });
    expect(snapshot.meta.platformPurchases).toMatchObject({ value: null, state: "not_measured" });
  });

  it("does not infer Meta range completeness from metric-family presence without persisted cursor evidence", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "30d" },
      dependencies({ loadMetaSyncRuns: vi.fn(async () => []) }),
    );

    expect(snapshot.sources.meta).toMatchObject({
      state: "not_measured",
      coverage: "unavailable",
      freshness: "unavailable",
    });
    expect(snapshot.meta.impressions).toMatchObject({ value: null, state: "not_measured" });
    expect(snapshot.meta.linkClicks.value).toBeNull();
    expect(snapshot.meta.platformPurchases.value).toBeNull();
    expect(snapshot.meta.spend).toEqual([]);
  });

  it("fails Meta coverage closed when the persisted cursor account does not match source metadata", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "30d" },
      dependencies({
        loadMetaSyncRuns: vi.fn(async () => [metaSyncRun({
          cursor_after: {
            accountId: "act_999999999",
            accountTimeZone: "America/Los_Angeles",
            startDate: "2026-07-09",
            endDate: "2026-08-07",
            fetchedAt: "2026-08-07T17:29:00.000Z",
          },
        })]),
      }),
    );

    expect(snapshot.sources.meta).toMatchObject({
      state: "not_measured",
      coverage: "unavailable",
    });
    expect(snapshot.meta.impressions).toMatchObject({ value: null, state: "not_measured" });
  });

  it("fails Meta coverage closed when source account timezone evidence is missing", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "30d" },
      dependencies({
        loadSources: vi.fn(async () => [
          source("website", "website-source"),
          source("shopify", "shopify-source"),
          source("meta_ads", "meta-source", {
            metadata: { selected_ad_account_id: "act_123456789" },
          }),
        ]),
      }),
    );

    expect(snapshot.sources.meta).toMatchObject({
      state: "not_measured",
      coverage: "unavailable",
    });
    expect(snapshot.meta.impressions).toMatchObject({ value: null, state: "not_measured" });
    expect(snapshot.meta.spend).toEqual([]);
  });

  it("fails Meta coverage closed when cursor timezone does not match source metadata", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "30d" },
      dependencies({
        loadMetaSyncRuns: vi.fn(async () => [metaSyncRun({
          cursor_after: {
            accountId: "act_123456789",
            accountTimeZone: "America/New_York",
            startDate: "2026-07-09",
            endDate: "2026-08-07",
            fetchedAt: "2026-08-07T17:29:00.000Z",
          },
        })]),
      }),
    );

    expect(snapshot.sources.meta).toMatchObject({
      state: "not_measured",
      coverage: "unavailable",
    });
    expect(snapshot.meta.impressions).toMatchObject({ value: null, state: "not_measured" });
    expect(snapshot.meta.spend).toEqual([]);
  });

  it("withholds Meta values when the account-local cursor timezone does not match Pacific boundaries", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "30d" },
      dependencies({
        loadSources: vi.fn(async () => [
          source("website", "website-source"),
          source("shopify", "shopify-source"),
          source("meta_ads", "meta-source", {
            metadata: {
              selected_ad_account_id: "act_123456789",
              account_timezone: "America/New_York",
            },
          }),
        ]),
        loadMetaSyncRuns: vi.fn(async () => [metaSyncRun({
          cursor_after: {
            accountId: "act_123456789",
            accountTimeZone: "America/New_York",
            startDate: "2026-07-09",
            endDate: "2026-08-07",
            fetchedAt: "2026-08-07T17:29:00.000Z",
          },
        })]),
      }),
    );

    expect(snapshot.sources.meta).toMatchObject({ state: "partial", coverage: "partial" });
    expect(snapshot.meta.impressions).toMatchObject({ value: null, state: "partial" });
    expect(snapshot.meta.linkClicks.value).toBeNull();
    expect(snapshot.meta.platformPurchases.value).toBeNull();
    expect(snapshot.meta.spend).toEqual([]);
  });

  it("accepts an IANA alias that resolves to Pacific account boundaries", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "30d" },
      dependencies({
        loadSources: vi.fn(async () => [
          source("website", "website-source"),
          source("shopify", "shopify-source"),
          source("meta_ads", "meta-source", {
            metadata: {
              selected_ad_account_id: "act_123456789",
              account_timezone: "US/Pacific",
            },
          }),
        ]),
      }),
    );

    expect(snapshot.sources.meta).toMatchObject({ state: "healthy", coverage: "complete" });
    expect(snapshot.meta.impressions).toMatchObject({ value: 1000, state: "healthy" });
  });

  it("treats a persisted one-day Meta window as complete for today but partial for 30 days", async () => {
    const oneDayRuns = vi.fn(async () => [metaSyncRun({
      cursor_after: {
        accountId: "act_123456789",
        accountTimeZone: "America/Los_Angeles",
        startDate: "2026-08-07",
        endDate: "2026-08-07",
        fetchedAt: "2026-08-07T17:29:00.000Z",
      },
    })]);
    const today = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "today" },
      dependencies({
        loadWebsiteOverview: vi.fn(async () => oneDayWebsiteOverview()),
        loadMetaSyncRuns: oneDayRuns,
      }),
    );
    const thirtyDays = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "30d" },
      dependencies({ loadMetaSyncRuns: oneDayRuns }),
    );

    expect(today.sources.meta).toMatchObject({ state: "healthy", coverage: "complete" });
    expect(today.meta.impressions).toMatchObject({ value: 1000, state: "healthy" });
    expect(thirtyDays.sources.meta).toMatchObject({ state: "partial", coverage: "partial" });
    expect(thirtyDays.meta.impressions).toMatchObject({ value: null, state: "partial" });
    expect(thirtyDays.meta.spend).toEqual([]);
    expect(thirtyDays.state).toBe("partial");
  });

  it("uses the latest successful Meta cursor when lookback shrinks instead of stale older coverage", async () => {
    const olderThirtyDayRun = metaSyncRun({
      id: "older-thirty-day-run",
      finished_at: "2026-08-07T16:00:00.000Z",
      cursor_after: {
        accountId: "act_123456789",
        accountTimeZone: "America/Los_Angeles",
        startDate: "2026-07-09",
        endDate: "2026-08-07",
        fetchedAt: "2026-08-07T15:59:00.000Z",
      },
    });
    const latestOneDayRun = metaSyncRun({
      id: "latest-one-day-run",
      cursor_after: {
        accountId: "act_123456789",
        accountTimeZone: "America/Los_Angeles",
        startDate: "2026-08-07",
        endDate: "2026-08-07",
        fetchedAt: "2026-08-07T17:29:00.000Z",
      },
    });
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq", range: "30d" },
      dependencies({
        loadMetaSyncRuns: vi.fn(async () => [olderThirtyDayRun, latestOneDayRun]),
      }),
    );

    expect(snapshot.sources.meta).toMatchObject({ state: "partial", coverage: "partial" });
    expect(snapshot.meta.impressions).toMatchObject({ value: null, state: "partial" });
    expect(snapshot.meta.spend).toEqual([]);
    expect(snapshot.state).toBe("partial");
  });

  it("withholds commerce values when Shopify has no verified freshness boundary", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      dependencies({
        loadSources: vi.fn(async () => [
          source("website", "website-source"),
          source("shopify", "shopify-source", { last_success_at: null }),
          source("meta_ads", "meta-source"),
        ]),
      }),
    );

    expect(snapshot.state).toBe("not_measured");
    expect(snapshot.sources.shopify).toMatchObject({
      state: "not_measured",
      freshness: "unavailable",
    });
    expect(snapshot.funnel.at(-1)).toMatchObject({ count: null, state: "not_measured" });
    expect(snapshot.commerce.linkedOrdersPlaced).toMatchObject({
      value: null,
      state: "not_measured",
    });
    expect(snapshot.commerce.linkedOrderRatePercent.value).toBeNull();
    expect(snapshot.diagnostics.eligibleShopifyOrders.value).toBeNull();
  });

  it("uses the Shopify snapshot cursor time instead of the later operational completion time", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      dependencies({
        loadSources: vi.fn(async () => [
          source("website", "website-source"),
          source("shopify", "shopify-source", {
            last_success_at: "2026-08-07T17:35:00.000Z",
          }),
          source("meta_ads", "meta-source"),
        ]),
        loadCommerceBridge: vi.fn(async () => commerceAggregate({
          coverageEndAt: "2026-08-07T17:29:00.000Z",
        })),
      }),
    );

    expect(snapshot.sources.shopify).toMatchObject({
      state: "healthy",
      coverage: "complete",
      asOf: "2026-08-07T17:29:00.000Z",
    });
    expect(snapshot.funnel.at(-1)).toMatchObject({ count: 6, state: "healthy" });
  });

  it("withholds commerce values without a verified Shopify snapshot cursor boundary", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      dependencies({
        loadCommerceBridge: vi.fn(async () => commerceAggregate({ coverageEndAt: null })),
      }),
    );

    expect(snapshot.sources.shopify).toMatchObject({
      state: "not_measured",
      freshness: "unavailable",
      coverage: "unavailable",
      asOf: null,
    });
    expect(snapshot.funnel.every((stage) => stage.count === null)).toBe(true);
    expect(snapshot.commerce.linkedOrdersPlaced.value).toBeNull();
    expect(snapshot.commerce.money).toEqual([]);
  });

  it("fails closed when the aggregate reader or migration is unavailable and sanitizes its reason", async () => {
    const snapshot = await getWebsiteCommerceFunnelV2Snapshot(
      { dataSpaceId: "data-space-moonarq" },
      dependencies({
        loadCommerceBridge: vi.fn(async () => commerceAggregate({
          state: "migration_unavailable",
          reason: "relation missing; token=do-not-leak",
          coverageStartAt: null,
          coverageEndAt: null,
        })),
      }),
    );

    expect(snapshot).toMatchObject({ state: "not_measured", reasonCode: "migration_unavailable" });
    expect(snapshot.funnel.every((stage) => stage.count === null)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("do-not-leak");
  });
});
