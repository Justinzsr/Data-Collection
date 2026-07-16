import { beforeEach, describe, expect, it } from "vitest";
import {
  buildInstagramPaidAdsSummary,
  extractWebEventUtm,
  getInstagramPaidAdsSummary,
  MOONARQ_FIRST_STORY_UTM,
} from "@/aggregation/services/meta-ads-attribution-service";
import type { JsonRecord, MetricDaily, Source, SourceTypeKey, WebEvent } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";

function source(sourceTypeKey: SourceTypeKey, patch: Partial<Source> = {}): Source {
  const defaultMetadata: JsonRecord = sourceTypeKey === "meta_ads" ? { oauth_connected: true } : {};
  return {
    id: `${sourceTypeKey}-source`,
    data_space_id: "space",
    source_type_key: sourceTypeKey,
    display_name: sourceTypeKey,
    input_url: null,
    normalized_url: null,
    external_account_id: sourceTypeKey === "meta_ads" ? "act_2865948327088647" : null,
    account_name: null,
    status: "healthy",
    sync_mode: "hourly",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: "2026-07-15T20:00:00.000Z",
    last_error_at: null,
    last_error: null,
    next_sync_at: null,
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
    ...patch,
    metadata: { ...defaultMetadata, ...(patch.metadata ?? {}) },
  };
}

function metricRow(sourceTypeKey: SourceTypeKey, metricKey: string, metricValue: number, dimensions: JsonRecord = {}, unit = "count"): MetricDaily {
  return {
    id: `${metricKey}-${Math.random()}`,
    date: "2026-07-15",
    source_id: `${sourceTypeKey}-source`,
    source_type_key: sourceTypeKey,
    metric_key: metricKey,
    metric_value: metricValue,
    unit,
    dimensions: {
      ...MOONARQ_FIRST_STORY_UTM,
      ...(sourceTypeKey === "meta_ads" ? { account_id: "2865948327088647" } : {}),
      ...dimensions,
    },
    dimensions_hash: "hash",
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
  };
}

function event(id: string, anonymousId: string, properties: JsonRecord, url = "https://www.moonarqstudio.com/core-collection"): WebEvent {
  return {
    id,
    source_id: "website-source",
    public_tracking_key: null,
    anonymous_id: anonymousId,
    session_id: "vercel-session-unavailable",
    user_id: null,
    event_name: "page_view",
    path: "/core-collection",
    url,
    referrer: null,
    user_agent: null,
    ip_hash: null,
    country: null,
    device_type: null,
    properties,
    occurred_at: "2026-07-15T20:00:00.000Z",
    created_at: "2026-07-15T20:00:01.000Z",
  };
}

describe("Meta Ads and UTM attribution service", () => {
  beforeEach(() => resetDemoStore());

  it("reads normalized and legacy Vercel UTM evidence", () => {
    expect(extractWebEventUtm(event("normalized", "a", {
      attribution: { utm: MOONARQ_FIRST_STORY_UTM },
    }))).toMatchObject(MOONARQ_FIRST_STORY_UTM);

    expect(extractWebEventUtm(event("legacy", "b", {
      vercel: {
        query_params: JSON.stringify({
          utm_source: "instagram",
          utm_medium: "paid_social",
          utm_campaign: "bracelet_grid_jul2026",
          utm_content: "story_v1",
        }),
      },
    }))).toMatchObject(MOONARQ_FIRST_STORY_UTM);
  });

  it("keeps Meta-reported and Shopify-matched outcomes separate", () => {
    const metaSource = source("meta_ads", {
      metadata: {
        linked_instagram_source_id: "instagram-source",
        tracked_utm: MOONARQ_FIRST_STORY_UTM,
      },
    });
    const shopifySource = source("shopify");
    const utmEvent = event("one", "visitor-1", { attribution: { utm: MOONARQ_FIRST_STORY_UTM } });
    const duplicateVisitor = event("two", "visitor-1", { attribution: { utm: MOONARQ_FIRST_STORY_UTM } });
    const wrongContent = event("wrong", "visitor-2", {
      attribution: { utm: { ...MOONARQ_FIRST_STORY_UTM, content: "feed_v1" } },
    });
    const metaRows = [
      metricRow("meta_ads", "meta_ads_spend", 25, { campaign_name: "First Story" }, "usd"),
      metricRow("meta_ads", "meta_ads_impressions", 1_000),
      metricRow("meta_ads", "meta_ads_reach", 800),
      metricRow("meta_ads", "meta_ads_outbound_clicks", 50),
      metricRow("meta_ads", "meta_ads_landing_page_views", 40),
      metricRow("meta_ads", "meta_ads_purchases", 3),
      metricRow("meta_ads", "meta_ads_purchase_value", 180, {}, "usd"),
    ];
    const shopifyRows = [
      metricRow("shopify", "shopify_attributed_orders", 2, { attribution_model: "last_visit" }),
      metricRow("shopify", "shopify_attributed_net_revenue", 120, { attribution_model: "last_visit" }, "usd"),
      metricRow("shopify", "shopify_attributed_orders", 9, { attribution_model: "first_visit" }),
      metricRow("shopify", "shopify_attributed_net_revenue", 999, { attribution_model: "first_visit" }, "usd"),
    ];

    const result = buildInstagramPaidAdsSummary({
      metaSource,
      shopifySource,
      metaRows,
      shopifyRows,
      websiteEvents: [utmEvent, duplicateVisitor, wrongContent],
      shopifyJourneyReady: true,
    });

    expect(result.state).toBe("ready");
    expect(result.observed).toEqual({ utmPageViews: 2, utmVisitors: 1 });
    expect(result.outcomes.attributedOrders.value).toBe(2);
    expect(result.outcomes.attributedNetRevenue.value).toBe(120);
    expect(result.outcomes.shopifyRoas.value).toBe(4.8);
    expect(result.outcomes.metaPurchaseValue.value).toBe(180);
    expect(result.outcomes.metaRoas.value).toBe(7.2);
    expect(result.outcomes.adSpendReturn.value).toBe(380);
    expect(result.outcomes.profitRoi).toMatchObject({ value: null, state: "unavailable" });
  });

  it("does not turn scheduled or not-yet-delivered ratios into zero", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: source("shopify"),
      metaRows: [],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
    });

    expect(result.state).toBe("no_delivery");
    expect(result.outcomes.spend).toMatchObject({ value: 0, state: "no_delivery" });
    expect(result.outcomes.shopifyRoas).toMatchObject({ value: null, state: "pending" });
    expect(result.funnel.cpc).toMatchObject({ value: null, state: "no_delivery" });
    expect(result.funnel.purchaseConversionRate).toMatchObject({ value: null, state: "pending" });
  });

  it("keeps denominator-dependent metrics undefined when attribution is ready but has no visits or orders", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: source("shopify"),
      metaRows: [],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: true,
    });

    expect(result.funnel.purchaseConversionRate).toMatchObject({ value: null, state: "not_reported" });
    expect(result.funnel.averageOrderValue).toMatchObject({ value: null, state: "not_reported" });
  });

  it("does not report Ads as connected before an available ad account is selected", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads", {
        external_account_id: null,
        status: "warning",
        metadata: { candidate_ad_accounts: [{ id: "act_1" }, { id: "act_2" }] },
      }),
      shopifySource: null,
      metaRows: [],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
    });

    expect(result.coverage.meta).toBe(false);
    expect(result.outcomes.spend).toMatchObject({ value: null, state: "pending" });
  });

  it("keeps cross-currency Shopify return metrics unavailable", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: source("shopify"),
      metaRows: [metricRow("meta_ads", "meta_ads_spend", 25, {}, "usd"), metricRow("meta_ads", "meta_ads_impressions", 500)],
      shopifyRows: [
        metricRow("shopify", "shopify_attributed_orders", 1, { attribution_model: "last_visit" }),
        metricRow("shopify", "shopify_attributed_net_revenue", 100, { attribution_model: "last_visit" }, "cad"),
      ],
      websiteEvents: [],
      shopifyJourneyReady: true,
    });

    expect(result.coverage.currencyAligned).toBe(false);
    expect(result.outcomes.shopifyRoas).toMatchObject({ value: null, state: "unavailable" });
    expect(result.outcomes.adSpendReturn.reason).toContain("USD");
    expect(result.outcomes.adSpendReturn.reason).toContain("CAD");
  });

  it("never shows another Meta ad account's cached rows as the selected account", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: null,
      metaRows: [
        metricRow("meta_ads", "meta_ads_spend", 99, { account_id: "9999999999999999" }, "usd"),
        metricRow("meta_ads", "meta_ads_impressions", 1_000, { account_id: "9999999999999999" }),
      ],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
    });

    expect(result.state).toBe("no_delivery");
    expect(result.outcomes.spend).toMatchObject({ value: 0, state: "no_delivery" });
    expect(result.daily).toEqual([]);
  });

  it("distinguishes an authorized source awaiting its first sync", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads", { last_success_at: null }),
      shopifySource: null,
      metaRows: [],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
    });

    expect(result.state).toBe("first_sync");
    expect(result.outcomes.spend).toMatchObject({ value: 0, state: "pending" });
    expect(result.outcomes.spend.reason).toBe("Run the first Meta Ads sync.");
  });

  it("does not subtract an assumed zero ad spend before Meta has spend evidence", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads", {
        last_success_at: null,
        metadata: { account_currency: "USD" },
      }),
      shopifySource: source("shopify"),
      metaRows: [],
      shopifyRows: [
        metricRow("shopify", "shopify_attributed_orders", 1, { attribution_model: "last_visit", order_id: "order-1" }),
        metricRow("shopify", "shopify_attributed_net_revenue", 100, { attribution_model: "last_visit", order_id: "order-1" }, "usd"),
      ],
      websiteEvents: [],
      shopifyJourneyReady: true,
      shopifyCurrency: "usd",
    });

    expect(result.outcomes.attributedNetRevenue).toMatchObject({ value: 100, state: "ready" });
    expect(result.outcomes.netPaymentAfterAdSpend).toMatchObject({ value: null, state: "pending" });
    expect(result.outcomes.netPaymentAfterAdSpend.reason).toBe("Run the first Meta Ads sync.");
  });

  it("keeps zero outbound clicks as a valid zero CTR but not a valid CPC", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: null,
      metaRows: [
        metricRow("meta_ads", "meta_ads_spend", 5, {}, "usd"),
        metricRow("meta_ads", "meta_ads_impressions", 100),
        metricRow("meta_ads", "meta_ads_reach", 80),
        metricRow("meta_ads", "meta_ads_outbound_clicks", 0),
      ],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
    });

    expect(result.funnel.outboundCtr).toMatchObject({ value: 0, state: "ready" });
    expect(result.funnel.cpc).toMatchObject({ value: null, state: "not_reported" });
  });

  it("does not label denominator-free efficiency metrics as ready", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: null,
      metaRows: [
        metricRow("meta_ads", "meta_ads_spend", 0, {}, "usd"),
        metricRow("meta_ads", "meta_ads_impressions", 100),
        metricRow("meta_ads", "meta_ads_reach", 0),
        metricRow("meta_ads", "meta_ads_video_p25", 0),
      ],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
    });

    expect(result.outcomes.metaRoas).toMatchObject({ value: null, state: "not_reported" });
    expect(result.funnel.frequency).toMatchObject({ value: null, state: "not_reported" });
    expect(result.funnel.videoCompletionRate).toMatchObject({ value: null, state: "not_reported" });
  });

  it("marks cached Meta metrics stale when the OAuth source is no longer readable", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads", { status: "disabled" }),
      shopifySource: null,
      metaRows: [
        metricRow("meta_ads", "meta_ads_spend", 10, {}, "usd"),
        metricRow("meta_ads", "meta_ads_impressions", 100),
        metricRow("meta_ads", "meta_ads_purchase_value", 20, {}, "usd"),
      ],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
    });

    expect(result.state).toBe("not_connected");
    expect(result.outcomes.spend).toMatchObject({ value: 10, state: "stale" });
    expect(result.outcomes.metaRoas).toMatchObject({ value: 2, state: "stale" });
    expect(result.funnel.cpm).toMatchObject({ value: 100, state: "stale" });
  });

  it("marks an overdue hourly Meta sync stale", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads", {
        last_success_at: "2026-07-15T18:00:00.000Z",
        next_sync_at: "2026-07-15T19:00:00.000Z",
      }),
      shopifySource: null,
      metaRows: [
        metricRow("meta_ads", "meta_ads_spend", 10, {}, "usd"),
        metricRow("meta_ads", "meta_ads_impressions", 100),
      ],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
      now: new Date("2026-07-15T23:01:00.000Z"),
    });

    expect(result.state).toBe("stale");
    expect(result.outcomes.spend).toMatchObject({ value: 10, state: "stale" });
    expect(result.outcomes.spend.reason).toContain("overdue");
  });

  it("waits for real Meta currency evidence before comparing currencies", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: source("shopify"),
      metaRows: [],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: true,
      shopifyCurrency: "cad",
    });

    expect(result.coverage.currencyAligned).toBeNull();
  });

  it("blocks cross-source return math when delivered Meta rows have no valid currency evidence", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: source("shopify"),
      metaRows: [
        metricRow("meta_ads", "meta_ads_spend", 25, {}, "currency"),
        metricRow("meta_ads", "meta_ads_impressions", 500),
      ],
      shopifyRows: [
        metricRow("shopify", "shopify_attributed_orders", 1, { attribution_model: "last_visit", order_id: "order-1" }),
        metricRow("shopify", "shopify_attributed_net_revenue", 100, { attribution_model: "last_visit", order_id: "order-1" }, "usd"),
      ],
      websiteEvents: [],
      shopifyJourneyReady: true,
      shopifyCurrency: "usd",
    });

    expect(result.currency).toBe("currency");
    expect(result.coverage.currencyAligned).toBeNull();
    expect(result.outcomes.shopifyRoas).toMatchObject({ value: null, state: "unavailable" });
    expect(result.outcomes.netPaymentAfterAdSpend).toMatchObject({ value: null, state: "unavailable" });
    expect(result.outcomes.netPaymentAfterAdSpend.reason).toContain("valid spend currency");
  });

  it("prefers current snapshot delivery status and exposes creative preflight evidence", () => {
    const oldRow = metricRow("meta_ads", "meta_ads_spend", 5, {
      campaign_name: "First Story",
      delivery_status: "ACTIVE",
    }, "usd");
    oldRow.updated_at = "2026-07-14T00:00:00.000Z";
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: null,
      metaRows: [oldRow, metricRow("meta_ads", "meta_ads_impressions", 100)],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
      metaSnapshot: {
        fetchedAt: "2026-07-15T22:00:00.000Z",
        currency: "usd",
        campaignId: "campaign-1",
        campaignName: "First Story",
        adSetName: "Story audience",
        adId: "ad-1",
        adName: "Story V1",
        deliveryStatus: "PAUSED",
        creativeUtmStatus: "exact",
        objective: "OUTCOME_TRAFFIC",
        optimizationGoal: "LANDING_PAGE_VIEWS",
        budgetKind: "lifetime",
        budgetSource: "ad_set",
        budgetMinorUnits: 2500,
        budgetRemainingMinorUnits: 2500,
        startsAt: "2026-07-15T08:00:00-07:00",
        endsAt: "2026-07-20T08:00:00-07:00",
      },
    });

    expect(result.campaign).toMatchObject({
      deliveryStatus: "PAUSED",
      creativeUtmStatus: "exact",
      objective: "OUTCOME_TRAFFIC",
      optimizationGoal: "LANDING_PAGE_VIEWS",
      budgetMinorUnits: 2500,
      evidenceAt: "2026-07-15T22:00:00.000Z",
    });
  });

  it("never falls back to an unrelated singleton Meta source when Instagram is explicitly scoped", async () => {
    getDemoStore().sources.push(source("meta_ads", {
      id: "unrelated-meta-source",
      metadata: { oauth_connected: true, linked_instagram_source_id: "another-instagram-source" },
    }));

    const result = await getInstagramPaidAdsSummary({
      dataSpaceId: "space",
      instagramSourceId: "requested-instagram-source",
      rangeKey: "30d",
    });

    expect(result.metaAdsSourceId).toBeNull();
    expect(result.state).toBe("not_connected");
  });

  it("keeps Shopify outcomes provisional while an in-range customer journey is still preparing", async () => {
    const previousDemoNow = process.env.DEMO_NOW;
    process.env.DEMO_NOW = "2026-07-15T20:00:00.000Z";
    try {
      const metaSource = source("meta_ads", {
        metadata: {
          linked_instagram_source_id: "instagram-source",
          linked_shopify_source_id: "shopify-source",
          tracked_utm: MOONARQ_FIRST_STORY_UTM,
          account_currency: "USD",
        },
      });
      const shopifySource = source("shopify");
      getDemoStore().sources.push(metaSource, shopifySource);
      getDemoStore().rawIngestions.push({
        id: "pending-shopify-journey",
        source_id: shopifySource.id,
        source_type_key: "shopify",
        external_id: "shopify:pending-journey",
        fetched_at: "2026-07-15T20:00:00.000Z",
        payload: {
          kind: "shopify_orders_snapshot",
          attributionVersion: "customer-journey-v1",
          shop: { currencyCode: "USD", ianaTimezone: "America/Los_Angeles" },
          orders: [{
            id: "gid://shopify/Order/1",
            createdAt: "2026-07-15T18:00:00.000Z",
            test: false,
            customerJourneySummary: { ready: false },
          }],
        },
        payload_hash: "pending-shopify-journey-hash",
        status: "stored",
        cursor: null,
        created_at: "2026-07-15T20:00:00.000Z",
      });

      const result = await getInstagramPaidAdsSummary({
        dataSpaceId: "space",
        instagramSourceId: "instagram-source",
        rangeKey: "today",
      });

      expect(result.coverage.shopifyJourneyReady).toBe(false);
      expect(result.outcomes.attributedOrders).toMatchObject({ value: null, state: "pending" });
      expect(result.outcomes.attributedNetRevenue).toMatchObject({ value: null, state: "pending" });
      expect(result.outcomes.attributedOrders.reason).toContain("1 order(s)");
    } finally {
      if (previousDemoNow === undefined) delete process.env.DEMO_NOW;
      else process.env.DEMO_NOW = previousDemoNow;
    }
  });

  it("excludes the wrong campaign and content from all three sources", () => {
    const wrong = { ...MOONARQ_FIRST_STORY_UTM, campaign: "another_campaign", content: "feed_v1" };
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads", { metadata: { tracked_utm: MOONARQ_FIRST_STORY_UTM } }),
      shopifySource: source("shopify"),
      metaRows: [metricRow("meta_ads", "meta_ads_spend", 99, wrong, "usd")],
      shopifyRows: [metricRow("shopify", "shopify_attributed_orders", 4, { ...wrong, attribution_model: "last_visit" })],
      websiteEvents: [event("wrong", "visitor", { attribution: { utm: wrong } })],
      shopifyJourneyReady: true,
    });

    expect(result.outcomes.spend.value).toBe(0);
    expect(result.outcomes.attributedOrders.value).toBe(0);
    expect(result.observed.utmPageViews).toBe(0);
  });

  it("builds a source-explicit five-stage AIDMA readout with strict rates, distinct Shopify orders, economics, and reconciliation", () => {
    const orderMetric = (
      metricKey: string,
      metricValue: number,
      orderId: string,
      attributionModel: "first_visit" | "last_visit",
      dimensions: JsonRecord = {},
      unit = "count",
    ) => metricRow("shopify", metricKey, metricValue, {
      attribution_model: attributionModel,
      order_id: orderId,
      ...dimensions,
    }, unit);
    const metaRows = [
      metricRow("meta_ads", "meta_ads_spend", 10, {}, "usd"),
      metricRow("meta_ads", "meta_ads_impressions", 1_000),
      metricRow("meta_ads", "meta_ads_reach", 800),
      metricRow("meta_ads", "meta_ads_clicks", 100),
      metricRow("meta_ads", "meta_ads_inline_link_clicks", 80),
      metricRow("meta_ads", "meta_ads_outbound_clicks", 50),
      metricRow("meta_ads", "meta_ads_landing_page_views", 40),
      metricRow("meta_ads", "meta_ads_view_content", 30),
      metricRow("meta_ads", "meta_ads_add_to_cart", 12),
      metricRow("meta_ads", "meta_ads_initiate_checkout", 6),
      metricRow("meta_ads", "meta_ads_purchases", 3),
      metricRow("meta_ads", "meta_ads_purchase_value", 90, {}, "usd"),
      metricRow("meta_ads", "meta_ads_video_p25", 500),
      metricRow("meta_ads", "meta_ads_video_p50", 400),
      metricRow("meta_ads", "meta_ads_video_p75", 300),
      metricRow("meta_ads", "meta_ads_video_p95", 250),
      metricRow("meta_ads", "meta_ads_video_p100", 200),
      metricRow("meta_ads", "meta_ads_video_thruplay", 220),
    ];
    const shopifyRows = [
      orderMetric("shopify_attributed_orders", 1, "order-a", "last_visit", { customer_order_index: 1 }),
      orderMetric("shopify_attributed_orders", 1, "order-a", "last_visit", { customer_order_index: 1 }),
      orderMetric("shopify_attributed_orders", 1, "order-b", "last_visit", { customer_order_index: 1 }),
      orderMetric("shopify_attributed_orders", 1, "order-c", "last_visit", { customer_order_index: 2 }),
      orderMetric("shopify_attributed_net_revenue", 40, "order-a", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_net_revenue", 30, "order-b", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_net_revenue", 20, "order-c", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_orders", 1, "order-a", "first_visit", { days_to_conversion: 0 }),
      orderMetric("shopify_attributed_orders", 1, "order-d", "first_visit", { days_to_conversion: 2 }),
      orderMetric("shopify_attributed_orders", 1, "order-e", "first_visit", { days_to_conversion: 4 }),
      orderMetric("shopify_attributed_net_revenue", 40, "order-a", "first_visit", {}, "usd"),
      orderMetric("shopify_attributed_net_revenue", 30, "order-d", "first_visit", {}, "usd"),
      orderMetric("shopify_attributed_net_revenue", 20, "order-e", "first_visit", {}, "usd"),
      orderMetric("shopify_attributed_gross_sales", 50, "order-a", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_gross_sales", 40, "order-b", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_gross_sales", 30, "order-c", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_discounts", 5, "order-a", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_discounts", 3, "order-b", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_discounts", 2, "order-c", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_current_total", 40, "order-a", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_current_total", 35, "order-b", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_current_total", 25, "order-c", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_refunds", 5, "order-a", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_refunds", 3, "order-b", "last_visit", {}, "usd"),
      orderMetric("shopify_attributed_refunds", 2, "order-c", "last_visit", {}, "usd"),
    ];

    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads", { metadata: { tracked_utm: MOONARQ_FIRST_STORY_UTM } }),
      shopifySource: source("shopify"),
      metaRows,
      shopifyRows,
      websiteEvents: [],
      websiteEventCounts: { pageViews: 30, visitors: 20 },
      shopifyJourneyReady: true,
      rangeStartDate: "2026-07-15",
      rangeEndDate: "2026-07-17",
      now: new Date("2026-07-17T15:00:00.000Z"),
      metaSnapshot: {
        fetchedAt: "2026-07-17T15:00:00.000Z",
        currency: "usd",
        campaignId: "campaign-1",
        campaignName: "First Story",
        adSetName: "Story audience",
        adId: "ad-1",
        adName: "Story V1",
        deliveryStatus: "ACTIVE",
        creativeUtmStatus: "exact",
        objective: "OUTCOME_SALES",
        optimizationGoal: "OFFSITE_CONVERSIONS",
        budgetKind: "lifetime",
        budgetSource: "ad_set",
        budgetMinorUnits: 2_500,
        budgetRemainingMinorUnits: 1_500,
        startsAt: "2026-07-15T08:00:00-07:00",
        endsAt: "2026-07-20T08:00:00-07:00",
      },
    });

    expect(result.state).toBe("ready");
    expect(result.aidma.stages.map((stage) => stage.key)).toEqual(["attention", "interest", "desire", "memory", "action"]);
    expect(result.aidma.stages.map((stage) => stage.count.value)).toEqual([1_000, 50, 12, 2, 3]);
    expect(result.aidma.stages.find((stage) => stage.key === "memory")?.caveat).toContain("not a direct measurement");
    expect(result.aidma.stages.find((stage) => stage.key === "action")?.caveat).toContain("not a cohort conversion rate");

    expect(result.funnel).toMatchObject({
      allCtr: { value: 10, state: "ready" },
      linkCtr: { value: 8, state: "ready" },
      outboundCtr: { value: 5, state: "ready" },
      outboundToLandingRate: { value: 80, state: "ready" },
      landingToContentRate: { value: 75, state: "ready" },
      contentToCartRate: { value: 40, state: "ready" },
      cartToCheckoutRate: { value: 50, state: "ready" },
      checkoutToMetaPurchaseRate: { value: 50, state: "ready" },
      metaLandingPurchaseRate: { value: 7.5, state: "ready" },
      video25Rate: { value: 50, state: "ready" },
      video25To50Retention: { value: 80, state: "ready" },
      video50To75Retention: { value: 75, state: "ready" },
      video75To100Retention: { state: "ready" },
      videoCompletionRate: { value: 40, state: "ready" },
      thruPlayRate: { value: 22, state: "ready" },
      cpc: { value: 0.2, state: "ready" },
      costPerLandingPageView: { value: 0.25, state: "ready" },
    });
    expect(result.funnel.video75To100Retention.value).toBeCloseTo(66.666667, 5);
    expect(result.funnel.costPerViewContent.value).toBeCloseTo(1 / 3, 6);
    expect(result.funnel.costPerAddToCart.value).toBeCloseTo(5 / 6, 6);
    expect(result.funnel.costPerCheckout.value).toBeCloseTo(5 / 3, 6);
    expect(result.funnel.costPerVideo25.value).toBe(0.02);
    expect(result.funnel.costPerVideoComplete.value).toBe(0.05);
    expect(result.funnel.costPerThruPlay.value).toBeCloseTo(1 / 22, 6);

    expect(result.outcomes).toMatchObject({
      attributedOrders: { value: 3, state: "ready" },
      attributedNetRevenue: { value: 90, unit: "usd", state: "ready" },
      shopifyRoas: { value: 9, state: "ready" },
      netPaymentAfterAdSpend: { value: 80, state: "ready" },
      revenuePerUtmVisitor: { value: 4.5, state: "ready" },
      revenuePerThousandImpressions: { value: 90, state: "ready" },
    });
    expect(result.memory).toMatchObject({
      firstTouchOrders: { value: 3, state: "ready" },
      firstTouchRevenue: { value: 90, state: "ready" },
      firstTouchOnlyOrders: { value: 2, state: "ready" },
      bothFirstAndLastOrders: { value: 1, state: "ready" },
      delayedFirstTouchOrders: { value: 2, state: "ready" },
      averageDaysToConversion: { value: 2, state: "ready" },
      newCustomerLastTouchOrders: { value: 2, state: "ready" },
      returningCustomerLastTouchOrders: { value: 1, state: "ready" },
    });
    expect(result.memory.delayedFirstTouchShare.value).toBeCloseTo(66.666667, 5);
    expect(result.memory.newCustomerShare.value).toBeCloseTo(66.666667, 5);
    expect(result.economics).toMatchObject({
      attributedGrossSales: { value: 120, state: "ready" },
      attributedDiscounts: { value: 10, state: "ready" },
      attributedCurrentTotal: { value: 100, state: "ready" },
      attributedRefunds: { value: 10, state: "ready" },
      firstTouchRoas: { value: 9, state: "ready" },
      newCustomerCacProxy: { value: 5, state: "ready" },
    });
    expect(result.economics.discountRate.value).toBeCloseTo(8.333333, 5);
    expect(result.economics.refundRate.value).toBeCloseTo(8.333333, 5);
    expect(result.reconciliation).toMatchObject({
      metaVsShopifyPurchaseDelta: { value: 0, state: "ready" },
      metaVsShopifyRevenueDelta: { value: 0, state: "ready" },
      landingTrackingGap: { value: 20, state: "ready" },
      landingTrackingRatio: { value: 50, state: "ready" },
    });
    expect(result.funnel.periodBlendedOrderRate).toMatchObject({ value: 15, state: "ready" });
    expect(result.funnel.periodBlendedOrderRate.reason).toContain("not a cohort CVR");
    expect(result.pacing).toMatchObject({
      coverageComplete: true,
      budget: { value: 25, state: "ready" },
      budgetRemaining: { value: 15, state: "ready" },
      budgetUsed: { value: 40, state: "ready" },
      scheduleElapsed: { value: 40, state: "ready" },
      expectedSpendToDate: { value: 10, state: "ready" },
      pacingIndex: { value: 1, state: "ready" },
      projectedFinalSpend: { value: 25, state: "ready" },
      averageDailySpend: { value: 5, state: "ready" },
      daysRemaining: { value: 3, state: "ready" },
    });
  });

  it("preserves rates above 100 percent as attribution diagnostics instead of clamping them", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: null,
      metaRows: [
        metricRow("meta_ads", "meta_ads_spend", 5, {}, "usd"),
        metricRow("meta_ads", "meta_ads_impressions", 100),
        metricRow("meta_ads", "meta_ads_outbound_clicks", 10),
        metricRow("meta_ads", "meta_ads_landing_page_views", 15),
        metricRow("meta_ads", "meta_ads_view_content", 20),
        metricRow("meta_ads", "meta_ads_add_to_cart", 25),
        metricRow("meta_ads", "meta_ads_initiate_checkout", 30),
        metricRow("meta_ads", "meta_ads_purchases", 40),
      ],
      shopifyRows: [],
      websiteEvents: [],
      websiteEventCounts: { pageViews: 25, visitors: 20 },
      shopifyJourneyReady: false,
    });

    expect(result.funnel.outboundToLandingRate.value).toBe(150);
    expect(result.funnel.landingToContentRate.value).toBeCloseTo(133.333333, 5);
    expect(result.funnel.contentToCartRate.value).toBe(125);
    expect(result.funnel.cartToCheckoutRate.value).toBe(120);
    expect(result.funnel.checkoutToMetaPurchaseRate.value).toBeCloseTo(133.333333, 5);
    expect(result.funnel.metaLandingPurchaseRate.value).toBeCloseTo(266.666667, 5);
    expect(result.funnel.utmCaptureRate.value).toBeCloseTo(133.333333, 5);
    expect(result.funnel.utmCaptureRate.reason).toContain("exceed 100%");
  });

  it("calculates lifetime pacing only when the selected range covers campaign start", () => {
    const baseInput = {
      metaSource: source("meta_ads"),
      shopifySource: null,
      metaRows: [
        metricRow("meta_ads", "meta_ads_spend", 10, {}, "usd"),
        metricRow("meta_ads", "meta_ads_impressions", 100),
      ],
      shopifyRows: [],
      websiteEvents: [],
      shopifyJourneyReady: false,
      now: new Date("2026-07-17T15:00:00.000Z"),
      rangeEndDate: "2026-07-17",
      metaSnapshot: {
        fetchedAt: "2026-07-17T15:00:00.000Z",
        currency: "usd",
        campaignId: "campaign-1",
        campaignName: "First Story",
        adSetName: "Story audience",
        adId: "ad-1",
        adName: "Story V1",
        deliveryStatus: "ACTIVE",
        creativeUtmStatus: "exact" as const,
        objective: "OUTCOME_SALES",
        optimizationGoal: "OFFSITE_CONVERSIONS",
        budgetKind: "lifetime" as const,
        budgetSource: "ad_set" as const,
        budgetMinorUnits: 2_500,
        budgetRemainingMinorUnits: 1_500,
        startsAt: "2026-07-15T08:00:00-07:00",
        endsAt: "2026-07-20T08:00:00-07:00",
      },
    };
    const complete = buildInstagramPaidAdsSummary({ ...baseInput, rangeStartDate: "2026-07-15" });
    const incomplete = buildInstagramPaidAdsSummary({ ...baseInput, rangeStartDate: "2026-07-16" });

    expect(complete.pacing).toMatchObject({
      coverageComplete: true,
      budgetUsed: { value: 40, state: "ready" },
      pacingIndex: { value: 1, state: "ready" },
      projectedFinalSpend: { value: 25, state: "ready" },
    });
    expect(incomplete.pacing.coverageComplete).toBe(false);
    expect(incomplete.pacing.reason).toContain("does not include campaign start");
    expect(incomplete.pacing.budgetUsed).toMatchObject({ value: null, state: "not_reported" });
    expect(incomplete.pacing.pacingIndex).toMatchObject({ value: null, state: "not_reported" });
    expect(incomplete.pacing.projectedFinalSpend).toMatchObject({ value: null, state: "not_reported" });
    expect(incomplete.pacing.averageDailySpend).toMatchObject({ value: null, state: "not_reported" });
  });

  it("blocks every cross-currency return and reconciliation metric while preserving source-native revenue", () => {
    const result = buildInstagramPaidAdsSummary({
      metaSource: source("meta_ads"),
      shopifySource: source("shopify"),
      metaRows: [
        metricRow("meta_ads", "meta_ads_spend", 25, {}, "usd"),
        metricRow("meta_ads", "meta_ads_impressions", 500),
        metricRow("meta_ads", "meta_ads_purchases", 2),
        metricRow("meta_ads", "meta_ads_purchase_value", 80, {}, "usd"),
      ],
      shopifyRows: [
        metricRow("shopify", "shopify_attributed_orders", 1, { attribution_model: "last_visit", order_id: "order-1", customer_order_index: 1 }),
        metricRow("shopify", "shopify_attributed_net_revenue", 100, { attribution_model: "last_visit", order_id: "order-1" }, "cad"),
        metricRow("shopify", "shopify_attributed_orders", 1, { attribution_model: "first_visit", order_id: "order-1", days_to_conversion: 1 }),
        metricRow("shopify", "shopify_attributed_net_revenue", 100, { attribution_model: "first_visit", order_id: "order-1" }, "cad"),
      ],
      websiteEvents: [],
      websiteEventCounts: { pageViews: 2, visitors: 1 },
      shopifyJourneyReady: true,
    });

    expect(result.coverage.currencyAligned).toBe(false);
    expect(result.outcomes.attributedNetRevenue).toMatchObject({ value: 100, unit: "cad", state: "ready" });
    expect(result.outcomes.shopifyRoas).toMatchObject({ value: null, state: "unavailable" });
    expect(result.outcomes.adSpendReturn).toMatchObject({ value: null, state: "unavailable" });
    expect(result.outcomes.netPaymentAfterAdSpend).toMatchObject({ value: null, state: "unavailable" });
    expect(result.funnel.costPerShopifyOrder).toMatchObject({ value: null, state: "unavailable" });
    expect(result.economics.firstTouchRoas).toMatchObject({ value: null, state: "unavailable" });
    expect(result.economics.newCustomerCacProxy).toMatchObject({ value: null, state: "unavailable" });
    expect(result.reconciliation.metaVsShopifyRevenueDelta).toMatchObject({ value: null, state: "unavailable" });
    expect(result.reconciliation.metaVsShopifyRevenueDelta.reason).toContain("USD");
    expect(result.reconciliation.metaVsShopifyRevenueDelta.reason).toContain("CAD");
  });
});
