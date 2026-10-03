import { describe, expect, it } from "vitest";
import {
  buildPaidAdsOverview,
  buildPlatformCards,
  forwardFilled,
  isAuthorizationError,
  overviewRange,
  paidAdsRates,
  paidAdsState,
  percentChange,
  snapshotMetric,
  snapshotPoints,
  emptyPaidAdsTotals,
} from "@/aggregation/services/platform-overview-service";
import type { JsonRecord, MetricDaily, Source, SourceTypeKey } from "@/storage/db/schema";

// 09:00 in Los Angeles on 2026-04-22.
const NOW = new Date("2026-04-22T16:00:00.000Z");

function source(sourceTypeKey: SourceTypeKey, patch: Partial<Source> = {}): Source {
  return {
    id: `${sourceTypeKey}-source`,
    data_space_id: "space",
    source_type_key: sourceTypeKey,
    display_name: sourceTypeKey,
    input_url: null,
    normalized_url: null,
    external_account_id: null,
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
    last_success_at: "2026-04-22T15:40:00.000Z",
    last_error_at: null,
    last_error: null,
    next_sync_at: "2026-04-22T17:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-04-22T15:40:00.000Z",
    ...patch,
    metadata: { ...(patch.metadata ?? {}) },
  };
}

function metaSource(patch: Partial<Source> = {}) {
  return source("meta_ads", {
    external_account_id: "act_111",
    ...patch,
    metadata: { oauth_connected: true, token_expires_at: "2026-06-01T00:00:00.000Z", ...(patch.metadata ?? {}) },
  });
}

function row(input: {
  sourceTypeKey: SourceTypeKey;
  metricKey: string;
  date: string;
  value: number;
  unit?: string;
  dimensions?: JsonRecord;
  sourceId?: string;
  updatedAt?: string;
}): MetricDaily {
  return {
    id: `${input.metricKey}-${input.date}-${Math.random()}`,
    date: input.date,
    source_id: input.sourceId ?? `${input.sourceTypeKey}-source`,
    source_type_key: input.sourceTypeKey,
    metric_key: input.metricKey,
    metric_value: input.value,
    unit: input.unit ?? "count",
    dimensions: input.dimensions ?? {},
    dimensions_hash: "hash",
    created_at: input.updatedAt ?? "2026-04-22T15:40:00.000Z",
    updated_at: input.updatedAt ?? "2026-04-22T15:40:00.000Z",
  };
}

function adRow(metricKey: string, date: string, value: number, dimensions: JsonRecord = {}) {
  return row({
    sourceTypeKey: "meta_ads",
    metricKey,
    date,
    value,
    unit: metricKey === "meta_ads_spend" || metricKey === "meta_ads_purchase_value" ? "usd" : "count",
    dimensions: {
      rollup: "ad_daily",
      account_id: "111",
      account_timezone: "America/Los_Angeles",
      campaign_id: "c1",
      campaign_name: "Story",
      campaign_status: "ACTIVE",
      ...dimensions,
    },
  });
}

describe("overview ranges", () => {
  it("compares complete days with the same-length previous window", () => {
    const range = overviewRange("7d", NOW);
    expect(range).toMatchObject({ startDate: "2026-04-16", endDate: "2026-04-22", days: 7, label: "Last 7 days" });
    expect(range.comparison).toEqual({
      currentStart: "2026-04-16",
      currentEnd: "2026-04-21",
      previousStart: "2026-04-09",
      previousEnd: "2026-04-14",
      basis: "vs previous 7 days",
    });
    expect(range.sparkline).toEqual({ startDate: "2026-04-16", endDate: "2026-04-22", label: "Last 7 days" });
  });

  it("does not compare a day that is still in progress but keeps a seven-day trend", () => {
    const range = overviewRange("today", NOW);
    expect(range.comparison).toBeNull();
    expect(range.sparkline).toEqual({ startDate: "2026-04-16", endDate: "2026-04-22", label: "Last 7 days" });
  });
});

describe("change calculations", () => {
  it("never invents a percentage from a zero baseline", () => {
    expect(percentChange(5, 0, "basis")).toEqual({ kind: "none", reason: "from_zero", basis: "basis" });
    expect(percentChange(0, 0, "basis")).toEqual({ kind: "percent", value: 0, basis: "basis" });
    expect(percentChange(15, 10, "basis")).toEqual({ kind: "percent", value: 50, basis: "basis" });
    expect(percentChange(5, 10, "basis")).toEqual({ kind: "percent", value: -50, basis: "basis" });
  });

  it("measures snapshot growth from the value just before the range", () => {
    const range = overviewRange("7d", NOW);
    const points = [
      { date: "2026-04-10", value: 100 },
      { date: "2026-04-15", value: 120 },
      { date: "2026-04-21", value: 150 },
    ];
    const metric = snapshotMetric({ key: "followers", label: "Followers", unit: "count", points, range, change: "absolute", higherIsBetter: true });
    expect(metric.value).toBe(150);
    expect(metric.delta).toEqual({ kind: "absolute", value: 30, basis: "over 7 days" });
  });

  it("says since when when history starts inside the range, and nothing for a single snapshot", () => {
    const range = overviewRange("30d", NOW);
    const since = snapshotMetric({
      key: "followers",
      label: "Followers",
      unit: "count",
      points: [{ date: "2026-04-18", value: 10 }, { date: "2026-04-22", value: 14 }],
      range,
      change: "percent",
      higherIsBetter: true,
    });
    expect(since.delta).toEqual({ kind: "percent", value: 40, basis: "since Apr 18" });
    const single = snapshotMetric({ key: "followers", label: "Followers", unit: "count", points: [{ date: "2026-04-22", value: 14 }], range, change: "absolute", higherIsBetter: true });
    expect(single).toMatchObject({ value: 14, delta: { kind: "none", reason: "no_baseline" } });
    const empty = snapshotMetric({ key: "followers", label: "Followers", unit: "count", points: [], range, change: "absolute", higherIsBetter: true });
    expect(empty).toMatchObject({ value: null, delta: { kind: "none", reason: "unavailable" } });
  });

  it("prefers rollup snapshot rows, keeps the latest row per day, and carries values forward", () => {
    const rows = [
      row({ sourceTypeKey: "instagram", metricKey: "instagram_media_reach", date: "2026-04-20", value: 5, dimensions: { media_id: "1" } }),
      row({ sourceTypeKey: "instagram", metricKey: "instagram_media_reach", date: "2026-04-20", value: 900, dimensions: { rollup: "media_sync_total" }, updatedAt: "2026-04-20T10:00:00.000Z" }),
      row({ sourceTypeKey: "instagram", metricKey: "instagram_media_reach", date: "2026-04-20", value: 950, dimensions: { rollup: "media_sync_total" }, updatedAt: "2026-04-20T20:00:00.000Z" }),
    ];
    const points = snapshotPoints(rows, "instagram_media_reach", "instagram-source", "media_sync_total");
    expect(points).toEqual([{ date: "2026-04-20", value: 950 }]);
    expect(forwardFilled(points, "2026-04-19", "2026-04-22")).toEqual([
      { date: "2026-04-20", value: 950 },
      { date: "2026-04-21", value: 950 },
      { date: "2026-04-22", value: 950 },
    ]);
  });
});

describe("platform cards", () => {
  it("withholds Shopify values until the source has synced successfully", () => {
    const range = overviewRange("7d", NOW);
    const rows = [row({ sourceTypeKey: "shopify", metricKey: "net_payment", date: "2026-04-20", value: 99, unit: "usd", dimensions: { rollup: "daily_order_summary" } })];
    const [, shopify] = buildPlatformCards({
      dataSpaceSlug: "moonarq",
      sources: [source("shopify", { status: "warning", last_success_at: null })],
      sumRows: rows,
      snapshotRows: [],
      range,
      websiteOverview: null,
    });
    expect(shopify.key).toBe("shopify");
    expect(shopify.primary.value).toBeNull();
    expect(shopify.unavailableReason).toBe("Shopify is awaiting its first successful sync.");
    expect(shopify.sparkline.points).toEqual([]);
  });

  it("sums live Shopify days and compares complete days only", () => {
    const range = overviewRange("7d", NOW);
    const summary = { rollup: "daily_order_summary" };
    const rows = [
      // Previous complete days: 2026-04-09 … 2026-04-14.
      row({ sourceTypeKey: "shopify", metricKey: "net_payment", date: "2026-04-10", value: 100, unit: "usd", dimensions: summary }),
      row({ sourceTypeKey: "shopify", metricKey: "orders", date: "2026-04-10", value: 2, dimensions: summary }),
      // Current complete days: 2026-04-16 … 2026-04-21.
      row({ sourceTypeKey: "shopify", metricKey: "net_payment", date: "2026-04-18", value: 150, unit: "usd", dimensions: summary }),
      row({ sourceTypeKey: "shopify", metricKey: "orders", date: "2026-04-18", value: 3, dimensions: summary }),
      // Today counts toward the total but not toward the change.
      row({ sourceTypeKey: "shopify", metricKey: "net_payment", date: "2026-04-22", value: 50, unit: "usd", dimensions: summary }),
      row({ sourceTypeKey: "shopify", metricKey: "orders", date: "2026-04-22", value: 1, dimensions: summary }),
    ];
    const shopify = buildPlatformCards({
      dataSpaceSlug: "moonarq",
      sources: [source("shopify")],
      sumRows: rows,
      snapshotRows: [],
      range,
      websiteOverview: null,
    }).find((card) => card.key === "shopify")!;
    expect(shopify.unavailableReason).toBeNull();
    expect(shopify.primary).toMatchObject({ value: 200, unit: "usd", delta: { kind: "percent", value: 50 } });
    expect(shopify.secondary[0]).toMatchObject({ key: "orders", value: 4, delta: { kind: "percent", value: 50 } });
    expect(shopify.secondary[1]).toMatchObject({ key: "average_order_value", value: 50, delta: { kind: "percent", value: 0 } });
  });

  it("shows only platforms that exist outside MoonArq", () => {
    const cards = buildPlatformCards({
      dataSpaceSlug: "auto-lab",
      sources: [source("tiktok", { account_name: "carclips" })],
      sumRows: [],
      snapshotRows: [
        row({ sourceTypeKey: "tiktok", metricKey: "tiktok_followers", date: "2026-04-14", value: 40, dimensions: { rollup: "account_snapshot" } }),
        row({ sourceTypeKey: "tiktok", metricKey: "tiktok_followers", date: "2026-04-22", value: 52, dimensions: { rollup: "account_snapshot" } }),
      ],
      range: overviewRange("7d", NOW),
      websiteOverview: null,
    });
    expect(cards.map((card) => card.key)).toEqual(["tiktok"]);
    expect(cards[0].account).toBe("@carclips");
    expect(cards[0].primary).toMatchObject({ value: 52, delta: { kind: "absolute", value: 12, basis: "over 7 days" } });
  });
});

describe("paid ads overview", () => {
  it("moves through setup states before showing live delivery", () => {
    expect(paidAdsState(null, NOW).state).toBe("not_connected");
    expect(paidAdsState(metaSource({ metadata: { oauth_connected: false } }), NOW).state).toBe("not_connected");
    expect(paidAdsState(metaSource({ metadata: { token_expires_at: "2026-04-01T00:00:00.000Z" } }), NOW).state).toBe("needs_reconnect");
    expect(paidAdsState(metaSource({ status: "error", last_error: "Meta Ads OAuth token expired. Reconnect Meta Ads." }), NOW).state).toBe("needs_reconnect");
    expect(paidAdsState(metaSource({ external_account_id: null }), NOW).state).toBe("needs_account");
    expect(paidAdsState(metaSource({ last_success_at: null }), NOW).state).toBe("first_sync");
    expect(paidAdsState(metaSource({ next_sync_at: "2026-04-22T08:00:00.000Z" }), NOW).state).toBe("stale");
    expect(paidAdsState(metaSource(), NOW)).toEqual({ state: "live", message: null });
  });

  it("totals the selected account only and reads today in the account time zone", () => {
    const range = overviewRange("7d", NOW);
    const rows = [
      adRow("meta_ads_spend", "2026-04-22", 12.5),
      adRow("meta_ads_impressions", "2026-04-22", 1_000),
      adRow("meta_ads_inline_link_clicks", "2026-04-22", 20),
      adRow("meta_ads_spend", "2026-04-21", 40),
      adRow("meta_ads_impressions", "2026-04-21", 4_000),
      adRow("meta_ads_inline_link_clicks", "2026-04-21", 50),
      adRow("meta_ads_spend", "2026-04-12", 20),
      adRow("meta_ads_inline_link_clicks", "2026-04-12", 25),
      // Another ad account the connection can see: never counted.
      adRow("meta_ads_spend", "2026-04-22", 999, { account_id: "222" }),
    ];
    const ads = buildPaidAdsOverview({ source: metaSource(), instagramSourceId: "ig", rows, range, now: NOW });
    expect(ads.state).toBe("live");
    expect(ads.currency).toBe("usd");
    expect(ads.today).toMatchObject({ date: "2026-04-22", delivering: true, totals: { spend: 12.5, impressions: 1_000, linkClicks: 20 } });
    expect(ads.today.rates?.ctr).toBeCloseTo(2);
    expect(ads.yesterday.totals?.spend).toBe(40);
    const spend = ads.period.metrics.find((metric) => metric.key === "spend")!;
    expect(spend).toMatchObject({ value: 52.5, higherIsBetter: null, delta: { kind: "percent", value: 100 } });
    const clicks = ads.period.metrics.find((metric) => metric.key === "link_clicks")!;
    expect(clicks).toMatchObject({ value: 70, delta: { kind: "percent", value: 100 } });
    expect(ads.daily).toHaveLength(7);
    expect(ads.campaigns).toHaveLength(1);
    expect(ads.campaigns[0]).toMatchObject({ name: "Story", status: "ACTIVE", deliveringToday: true });
    expect(ads.activeCampaigns).toBe(1);
  });

  it("leaves ROAS unset without purchases and keeps values unknown before the first sync", () => {
    expect(paidAdsRates({ ...emptyPaidAdsTotals(), spend: 10, impressions: 100, linkClicks: 4 })).toEqual({
      ctr: 4,
      cpc: 2.5,
      cpm: 100,
      roas: null,
      costPerPurchase: null,
    });
    const ads = buildPaidAdsOverview({ source: metaSource({ last_success_at: null }), instagramSourceId: null, rows: [], range: overviewRange("30d", NOW), now: NOW });
    expect(ads.state).toBe("first_sync");
    expect(ads.period.metrics.every((metric) => metric.value === null)).toBe(true);
    expect(ads.today).toMatchObject({ totals: null, rates: null, delivering: null });
    expect(ads.yesterday).toMatchObject({ totals: null, rates: null });
  });

  it("follows the ad account's calendar when it is not on Pacific Time", () => {
    // 11:00 in Los Angeles on Apr 22 is 02:00 on Apr 23 in Shanghai.
    const now = new Date("2026-04-22T18:00:00.000Z");
    const shanghai = { account_timezone: "Asia/Shanghai" };
    const rows = [
      adRow("meta_ads_spend", "2026-04-23", 5, shanghai),
      adRow("meta_ads_spend", "2026-04-22", 30, shanghai),
      adRow("meta_ads_spend", "2026-04-17", 10, shanghai),
      // Inside the Pacific "last 7 days" but before the account's.
      adRow("meta_ads_spend", "2026-04-16", 100, shanghai),
    ];
    const ads = buildPaidAdsOverview({
      source: metaSource({ last_success_at: "2026-04-22T17:40:00.000Z" }),
      instagramSourceId: null,
      rows,
      range: overviewRange("7d", now),
      now,
    });
    expect(ads.timeZone).toBe("Asia/Shanghai");
    expect(ads.today).toMatchObject({ date: "2026-04-23", totals: { spend: 5 }, delivering: true });
    expect(ads.yesterday).toMatchObject({ date: "2026-04-22", totals: { spend: 30 } });
    expect(ads.period.totals.spend).toBe(45);
    expect(ads.daily.map((point) => point.date)).toEqual([
      "2026-04-17", "2026-04-18", "2026-04-19", "2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23",
    ]);
    // Complete days on the account's calendar: Apr 17–22 against Apr 10–15.
    const spend = ads.period.metrics.find((metric) => metric.key === "spend")!;
    expect(spend).toMatchObject({ value: 45, delta: { kind: "none", reason: "from_zero" } });
    expect(ads.campaigns[0].totals.spend).toBe(45);
  });

  it("keeps today and yesterday unknown until a sync has run today", () => {
    const rows = [adRow("meta_ads_spend", "2026-04-21", 40), adRow("meta_ads_spend", "2026-04-20", 35)];
    // Last synced 23:30 yesterday in Los Angeles; it is now 09:00.
    const ads = buildPaidAdsOverview({
      source: metaSource({ last_success_at: "2026-04-22T06:30:00.000Z" }),
      instagramSourceId: null,
      rows,
      range: overviewRange("7d", NOW),
      now: NOW,
    });
    expect(ads.state).toBe("live");
    expect(ads.today).toMatchObject({ date: "2026-04-22", totals: null, rates: null, delivering: null });
    expect(ads.yesterday).toMatchObject({ date: "2026-04-21", totals: null, rates: null });
    // Longer ranges keep the days already synced.
    expect(ads.period).toMatchObject({ known: true, totals: { spend: 75 } });
    expect(ads.campaigns).toHaveLength(1);

    // A Today range has nothing known yet: no zeros, no "No change", no empty campaign list claim.
    const today = buildPaidAdsOverview({
      source: metaSource({ last_success_at: "2026-04-22T06:30:00.000Z" }),
      instagramSourceId: null,
      rows,
      range: overviewRange("today", NOW),
      now: NOW,
    });
    expect(today.period.known).toBe(false);
    expect(today.period.metrics.every((metric) => metric.value === null && metric.delta.kind === "none" && metric.delta.reason === "unavailable")).toBe(true);
    expect(today.campaigns).toEqual([]);
  });

  it("counts active campaigns over the same 30 days whatever range is selected", () => {
    const rows = [
      adRow("meta_ads_spend", "2026-04-02", 8, { campaign_id: "a", campaign_name: "Recent", campaign_status: "ACTIVE" }),
      // Last delivered before the window every sync rewrites, so its status is frozen.
      adRow("meta_ads_spend", "2026-03-10", 8, { campaign_id: "b", campaign_name: "Old", campaign_status: "ACTIVE" }),
      adRow("meta_ads_spend", "2026-04-21", 8, { campaign_id: "c", campaign_name: "Paused", campaign_status: "PAUSED" }),
    ];
    for (const key of ["today", "7d", "30d"] as const) {
      const ads = buildPaidAdsOverview({ source: metaSource(), instagramSourceId: null, rows, range: overviewRange(key, NOW), now: NOW });
      expect(ads.activeCampaigns, key).toBe(1);
    }
  });

  it("asks for a reconnect when Meta reports a revoked or invalid authorization", () => {
    for (const lastError of [
      "Error validating access token: The session has been invalidated because the user changed their password.",
      "Error validating access token: Session has expired on Thursday, 01-Oct-26 10:00:00 PDT.",
      "Invalid OAuth access token - Cannot parse access token",
    ]) {
      expect(paidAdsState(metaSource({ status: "error", last_error: lastError }), NOW).state, lastError).toBe("needs_reconnect");
    }
    expect(isAuthorizationError("Meta Ads Graph API request timed out.")).toBe(false);
    expect(paidAdsState(metaSource({ status: "error", last_error: "Meta Ads Graph API request timed out." }), NOW).state).toBe("error");
  });
});

describe("supabase card", () => {
  const supabaseRows = (sourceId: string) => [
    row({ sourceTypeKey: "supabase", metricKey: "users_total", date: "2026-04-22", value: 40, sourceId, dimensions: { rollup: "snapshot" } }),
  ];

  it("shows zero new signups for a synced source with no signup days, and unknown before any sync", () => {
    const range = overviewRange("7d", NOW);
    const synced = source("supabase");
    const [syncedCard] = buildPlatformCards({ dataSpaceSlug: "autolab", sources: [synced], sumRows: [], snapshotRows: supabaseRows(synced.id), range, websiteOverview: null });
    expect(syncedCard.primary).toMatchObject({ key: "signups", value: 0 });
    expect(syncedCard.sparkline.points).toHaveLength(7);

    const neverSynced = source("supabase", { last_success_at: null });
    const [pendingCard] = buildPlatformCards({ dataSpaceSlug: "autolab", sources: [neverSynced], sumRows: [], snapshotRows: [], range, websiteOverview: null });
    expect(pendingCard.primary.value).toBeNull();

    // Broken since before the range began: nothing could have recorded these days.
    const broken = source("supabase", { status: "error", last_success_at: "2026-04-10T15:40:00.000Z" });
    const [brokenCard] = buildPlatformCards({ dataSpaceSlug: "autolab", sources: [broken], sumRows: [], snapshotRows: [], range, websiteOverview: null });
    expect(brokenCard.primary.value).toBeNull();
  });
});
