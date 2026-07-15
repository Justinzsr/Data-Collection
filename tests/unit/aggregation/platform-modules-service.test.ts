import { beforeEach, describe, expect, it } from "vitest";
import { calculateDelta, getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { AUTO_LAB_TIKTOK_SOURCE_ID } from "@/collection/connectors/tiktok/constants";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { upsertMetrics } from "@/storage/repositories/metrics-repository";
import { createSource } from "@/storage/repositories/sources-repository";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

const NOW = "2026-05-11T18:30:00.000Z";
const ORIGINAL_DEMO_NOW = process.env.DEMO_NOW;

function autoLabTikTokSource(): Source {
  return {
    id: AUTO_LAB_TIKTOK_SOURCE_ID,
    data_space_id: DATA_SPACE_IDS.autoLab,
    source_type_key: "tiktok",
    display_name: "Auto Lab TikTok",
    input_url: "https://www.tiktok.com/@just_4is",
    normalized_url: "https://www.tiktok.com/@just_4is",
    external_account_id: "open-id-auto-lab-tiktok",
    account_name: "just_4is",
    status: "healthy",
    sync_mode: "manual",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: NOW,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: NOW,
    last_error_at: null,
    last_error: null,
    next_sync_at: null,
    metadata: { oauth_connected: true },
    created_at: NOW,
    updated_at: NOW,
  };
}

function tiktokSnapshot(date: string, sourceId: string, metricKey: string, metricValue: number) {
  return {
    date,
    sourceId,
    sourceTypeKey: "tiktok" as const,
    metricKey,
    metricValue,
    unit: "count",
    dimensions: { rollup: "video_sync_total" },
  };
}

function instagramSnapshot(date: string, metricKey: string, metricValue: number) {
  return {
    date,
    sourceId: DEMO_SOURCE_IDS.instagram,
    sourceTypeKey: "instagram" as const,
    metricKey,
    metricValue,
    unit: "count",
    dimensions: { rollup: metricKey === "instagram_followers" ? "snapshot" : "media_sync_total" },
  };
}

function enableDemoInstagram() {
  const store = getDemoStore();
  const instagramSource = store.sources.find((source) => source.id === DEMO_SOURCE_IDS.instagram);
  if (instagramSource) {
    instagramSource.status = "healthy";
    instagramSource.metadata = { oauth_connected: true };
  }
  store.metricsDaily = store.metricsDaily.filter((metric) => metric.source_id !== DEMO_SOURCE_IDS.instagram);
}

describe("platform modules service", () => {
  beforeEach(() => {
    if (ORIGINAL_DEMO_NOW) process.env.DEMO_NOW = ORIGINAL_DEMO_NOW;
    else delete process.env.DEMO_NOW;
    resetDemoStore();
  });

  it("returns normalized platform modules in product order", async () => {
    const modules = await getPlatformModules("30d");
    expect(modules.map((module) => module.platformLabel)).toEqual([
      "MoonArq Website / Vercel",
      "MoonArq Supabase",
      "MoonArq TikTok",
      "MoonArq Instagram",
      "MoonArq Commerce",
      "MoonArq Custom API",
      "MoonArq Custom CSV",
    ]);
    expect(modules.find((module) => module.sourceTypeKey === "website")?.primaryMetric.key).toBe("unique_visitors");
    expect(modules.find((module) => module.sourceTypeKey === "supabase")?.primaryMetric.key).toBe("signups");
    expect(modules.find((module) => module.sourceTypeKey === "shopify")?.status).toBe("needs_credentials");
    expect(modules.find((module) => module.sourceTypeKey === "shopify")?.setupState.label).toBe("Needs setup");
    expect(modules.find((module) => module.sourceTypeKey === "website")?.sourceModeLabel).toBe("Demo");
    expect(modules.find((module) => module.sourceTypeKey === "website")?.rangeLabel).toBe("Last 30 days");
  });

  it("computes delta vs previous period", () => {
    expect(calculateDelta(150, 100)).toBe(50);
    expect(calculateDelta(0, 0)).toBe(0);
    expect(calculateDelta(10, 0)).toBeNull();
  });

  it("marks setup state for missing credentials and future modules", async () => {
    const modules = await getPlatformModules("30d");
    const supabase = modules.find((module) => module.sourceTypeKey === "supabase");
    const customApi = modules.find((module) => module.sourceTypeKey === "custom_api");
    expect(supabase?.setupState.severity).toBe("warning");
    expect(customApi?.setupState.label).toBe("Future");
  });

  it("shows live Shopify totals in the store currency with a top-product insight", async () => {
    process.env.DEMO_NOW = NOW;
    const source = await createSource({
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "shopify",
      display_name: "MoonArq Shopify",
      input_url: "https://moonarq-store.myshopify.com",
      normalized_url: "https://moonarq-store.myshopify.com",
      status: "healthy",
      sync_mode: "hourly",
    });
    await upsertMetrics([
      { date: "2026-05-11", sourceId: source.id, sourceTypeKey: "shopify", metricKey: "orders", metricValue: 2, unit: "count", dimensions: { rollup: "daily_order_summary", currency: "CAD" } },
      { date: "2026-05-11", sourceId: source.id, sourceTypeKey: "shopify", metricKey: "net_payment", metricValue: 120, unit: "cad", dimensions: { rollup: "daily_order_summary", currency: "CAD" } },
      { date: "2026-05-11", sourceId: source.id, sourceTypeKey: "shopify", metricKey: "gross_sales", metricValue: 150, unit: "cad", dimensions: { rollup: "daily_order_summary", currency: "CAD" } },
      { date: "2026-05-11", sourceId: source.id, sourceTypeKey: "shopify", metricKey: "refunds", metricValue: 10, unit: "cad", dimensions: { rollup: "daily_order_summary", currency: "CAD" } },
      { date: "2026-05-11", sourceId: source.id, sourceTypeKey: "shopify", metricKey: "top_products", metricValue: 3, unit: "units", dimensions: { rollup: "order_line_units", product_name: "Moon Bracelet" } },
    ]);

    const shopifyModule = (await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq })).find((item) => item.sourceTypeKey === "shopify");
    expect(shopifyModule).toMatchObject({
      sourceId: source.id,
      status: "healthy",
      primaryMetric: { key: "orders", value: 2 },
    });
    expect(shopifyModule?.secondaryMetrics.find((metric) => metric.key === "net_payment")).toMatchObject({ value: 120, unit: "cad" });
    expect(shopifyModule?.insights.find((insight) => insight.label === "Top product")?.value).toBe("Moon Bracelet (3 units)");
  });

  it("shows latest Supabase snapshot totals even when signups are historical", async () => {
    const store = getDemoStore();
    store.metricsDaily = store.metricsDaily.filter((metric) => metric.source_id !== DEMO_SOURCE_IDS.supabase);
    const supabase = store.sources.find((source) => source.id === DEMO_SOURCE_IDS.supabase);
    if (supabase) supabase.status = "healthy";

    await upsertMetrics([
      {
        date: "2026-02-20",
        sourceId: DEMO_SOURCE_IDS.supabase,
        sourceTypeKey: "supabase",
        metricKey: "signups",
        metricValue: 2,
        unit: "count",
        dimensions: { rollup: "daily" },
      },
      {
        date: "2026-01-15",
        sourceId: DEMO_SOURCE_IDS.supabase,
        sourceTypeKey: "supabase",
        metricKey: "users_total",
        metricValue: 2,
        unit: "count",
        dimensions: { rollup: "snapshot" },
      },
      {
        date: "2026-01-15",
        sourceId: DEMO_SOURCE_IDS.supabase,
        sourceTypeKey: "supabase",
        metricKey: "confirmed_users",
        metricValue: 1,
        unit: "count",
        dimensions: { rollup: "snapshot" },
      },
    ]);

    const modules = await getPlatformModules("30d");
    const supabaseModule = modules.find((item) => item.sourceTypeKey === "supabase");
    expect(supabaseModule?.primaryMetric.value).toBe(0);
    expect(supabaseModule?.primaryMetric.deltaLabel).toBe("No new signups");
    expect(supabaseModule?.primaryMetric.deltaPercent).toBeNull();
    expect(supabaseModule?.secondaryMetrics.find((metric) => metric.key === "users_total")?.value).toBe(2);
    expect(supabaseModule?.secondaryMetrics.find((metric) => metric.key === "confirmed_users")?.value).toBe(1);
  });

  it("shows Auto Lab TikTok overview metrics without leaking into MoonArq modules", async () => {
    process.env.DEMO_NOW = "2026-05-12T17:00:00.000Z";
    const store = getDemoStore();
    store.sources.push(autoLabTikTokSource());

    await upsertMetrics([
      {
        date: "2026-05-11",
        sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
        sourceTypeKey: "tiktok",
        metricKey: "tiktok_video_views",
        metricValue: 1000,
        unit: "count",
        dimensions: { rollup: "video_sync_total" },
      },
      {
        date: "2026-05-11",
        sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
        sourceTypeKey: "tiktok",
        metricKey: "tiktok_likes",
        metricValue: 42,
        unit: "count",
        dimensions: { rollup: "video_sync_total" },
      },
      {
        date: "2026-05-11",
        sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
        sourceTypeKey: "tiktok",
        metricKey: "tiktok_comments",
        metricValue: 5,
        unit: "count",
        dimensions: { rollup: "video_sync_total" },
      },
      {
        date: "2026-05-11",
        sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
        sourceTypeKey: "tiktok",
        metricKey: "tiktok_shares",
        metricValue: 3,
        unit: "count",
        dimensions: { rollup: "video_sync_total" },
      },
    ]);

    const autoLabModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.autoLab, dataSpaceName: "Auto Lab" });
    const moonarqModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq, dataSpaceName: "MoonArq" });
    const autoLabTikTok = autoLabModules.find((module) => module.sourceTypeKey === "tiktok");
    const moonarqTikTok = moonarqModules.find((module) => module.sourceTypeKey === "tiktok");

    expect(autoLabTikTok?.sourceId).toBe(AUTO_LAB_TIKTOK_SOURCE_ID);
    expect(autoLabTikTok?.primaryMetric).toMatchObject({ key: "tiktok_video_views", value: 1000 });
    expect(autoLabTikTok?.secondaryMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "tiktok_likes", value: 42 }),
      expect.objectContaining({ key: "tiktok_comments", value: 5 }),
      expect.objectContaining({ key: "tiktok_shares", value: 3 }),
    ]));
    expect(moonarqTikTok?.sourceId).not.toBe(AUTO_LAB_TIKTOK_SOURCE_ID);
  });

  it("uses the latest TikTok snapshots for Auto Lab and MoonArq instead of summing cumulative totals", async () => {
    process.env.DEMO_NOW = "2026-07-14T20:00:00.000Z";
    const store = getDemoStore();
    store.sources.push(autoLabTikTokSource());
    store.metricsDaily = store.metricsDaily.filter(
      (metric) => metric.source_id !== AUTO_LAB_TIKTOK_SOURCE_ID && metric.source_id !== DEMO_SOURCE_IDS.tiktok,
    );

    await upsertMetrics([
      tiktokSnapshot("2026-07-10", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_video_views", 210_000),
      tiktokSnapshot("2026-07-12", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_video_views", 215_000),
      tiktokSnapshot("2026-07-14", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_video_views", 219_396),
      tiktokSnapshot("2026-07-10", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_likes", 14_800),
      tiktokSnapshot("2026-07-14", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_likes", 15_068),
      tiktokSnapshot("2026-07-10", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_comments", 180),
      tiktokSnapshot("2026-07-14", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_comments", 187),
      tiktokSnapshot("2026-07-10", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_shares", 900),
      tiktokSnapshot("2026-07-14", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_shares", 928),
      tiktokSnapshot("2026-07-04", DEMO_SOURCE_IDS.tiktok, "tiktok_video_views", 67),
      tiktokSnapshot("2026-07-08", DEMO_SOURCE_IDS.tiktok, "tiktok_video_views", 67),
      tiktokSnapshot("2026-07-14", DEMO_SOURCE_IDS.tiktok, "tiktok_video_views", 67),
    ]);

    const autoLabModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.autoLab, dataSpaceName: "Auto Lab" });
    const moonarqModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq, dataSpaceName: "MoonArq" });
    const autoLabTikTok = autoLabModules.find((module) => module.sourceTypeKey === "tiktok");
    const moonarqTikTok = moonarqModules.find((module) => module.sourceTypeKey === "tiktok");

    expect(autoLabTikTok?.primaryMetric.value).toBe(219_396);
    expect(autoLabTikTok?.secondaryMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "tiktok_likes", value: 15_068 }),
      expect.objectContaining({ key: "tiktok_comments", value: 187 }),
      expect.objectContaining({ key: "tiktok_shares", value: 928 }),
    ]));
    expect(autoLabTikTok?.sparkline).toEqual([
      { date: "2026-07-10", value: 210_000 },
      { date: "2026-07-11", value: 210_000 },
      { date: "2026-07-12", value: 215_000 },
      { date: "2026-07-13", value: 215_000 },
      { date: "2026-07-14", value: 219_396 },
    ]);
    expect(moonarqTikTok?.primaryMetric.value).toBe(67);
    expect(moonarqTikTok?.sparkline.every((point) => point.value === 67)).toBe(true);
  });

  it("uses the latest Instagram account and media snapshots instead of summing daily snapshots", async () => {
    process.env.DEMO_NOW = "2026-07-14T20:00:00.000Z";
    const store = getDemoStore();
    const instagramSource = store.sources.find((source) => source.id === DEMO_SOURCE_IDS.instagram);
    if (instagramSource) {
      instagramSource.status = "healthy";
      instagramSource.metadata = { oauth_connected: true };
    }
    store.metricsDaily = store.metricsDaily.filter((metric) => metric.source_id !== DEMO_SOURCE_IDS.instagram);

    await upsertMetrics([
      {
        date: "2026-05-01",
        sourceId: DEMO_SOURCE_IDS.instagram,
        sourceTypeKey: "instagram",
        metricKey: "instagram_followers",
        metricValue: 20,
        unit: "count",
        dimensions: { rollup: "snapshot" },
      },
      {
        date: "2026-05-01",
        sourceId: DEMO_SOURCE_IDS.instagram,
        sourceTypeKey: "instagram",
        metricKey: "instagram_engagement_rate",
        metricValue: 23.1,
        unit: "percent",
        dimensions: { rollup: "media_sync_total" },
      },
      ...[
        { date: "2026-07-12", reach: 100, likes: 10, comments: 1 },
        { date: "2026-07-13", reach: 110, likes: 11, comments: 2 },
        { date: "2026-07-14", reach: 120, likes: 12, comments: 3 },
      ].flatMap((snapshot) => [
        {
          date: snapshot.date,
          sourceId: DEMO_SOURCE_IDS.instagram,
          sourceTypeKey: "instagram" as const,
          metricKey: "instagram_media_reach",
          metricValue: snapshot.reach,
          unit: "count",
          dimensions: { rollup: "media_sync_total" },
        },
        {
          date: snapshot.date,
          sourceId: DEMO_SOURCE_IDS.instagram,
          sourceTypeKey: "instagram" as const,
          metricKey: "instagram_media_likes",
          metricValue: snapshot.likes,
          unit: "count",
          dimensions: { rollup: "media_sync_total" },
        },
        {
          date: snapshot.date,
          sourceId: DEMO_SOURCE_IDS.instagram,
          sourceTypeKey: "instagram" as const,
          metricKey: "instagram_media_comments",
          metricValue: snapshot.comments,
          unit: "count",
          dimensions: { rollup: "media_sync_total" },
        },
      ]),
    ]);

    const modules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq, dataSpaceName: "MoonArq" });
    const instagram = modules.find((module) => module.sourceTypeKey === "instagram");

    expect(instagram?.primaryMetric.value).toBe(120);
    expect(instagram?.primaryMetric).toMatchObject({ deltaPercent: 20, deltaLabel: "+20.0% since Jul 12" });
    expect(instagram?.secondaryMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "instagram_followers", value: 20 }),
      expect.objectContaining({ key: "instagram_media_likes", value: 12 }),
      expect.objectContaining({ key: "instagram_media_comments", value: 3 }),
      expect.objectContaining({ key: "instagram_engagement_rate", value: 23.1 }),
    ]));
    expect(instagram?.sparkline).toEqual([
      { date: "2026-07-12", value: 100 },
      { date: "2026-07-13", value: 110 },
      { date: "2026-07-14", value: 120 },
    ]);
  });

  it("uses the latest snapshot before the range as the Instagram baseline", async () => {
    process.env.DEMO_NOW = "2026-07-14T20:00:00.000Z";
    enableDemoInstagram();
    await upsertMetrics([
      instagramSnapshot("2026-06-14", "instagram_media_reach", 100),
      instagramSnapshot("2026-07-14", "instagram_media_reach", 120),
    ]);

    const instagram = (await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq }))
      .find((module) => module.sourceTypeKey === "instagram");

    expect(instagram?.primaryMetric).toMatchObject({ value: 120, deltaPercent: 20, deltaLabel: "+20.0% in selected range" });
    expect(instagram?.sparkline).toHaveLength(30);
    expect(instagram?.sparkline.at(0)?.value).toBe(100);
    expect(instagram?.sparkline.at(-1)?.value).toBe(120);
  });

  it("describes a zero Instagram baseline without claiming the earlier snapshot is missing", async () => {
    process.env.DEMO_NOW = "2026-07-14T20:00:00.000Z";
    enableDemoInstagram();
    await upsertMetrics([
      instagramSnapshot("2026-06-14", "instagram_media_reach", 0),
      instagramSnapshot("2026-07-14", "instagram_media_reach", 10),
    ]);

    const instagram = (await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq }))
      .find((module) => module.sourceTypeKey === "instagram");

    expect(instagram?.primaryMetric).toMatchObject({ value: 10, deltaPercent: null, deltaLabel: "Up from 0 in selected range" });
  });

  it("ignores future-dated Instagram rows and carries the latest valid snapshot into Today", async () => {
    process.env.DEMO_NOW = "2026-07-14T20:00:00.000Z";
    enableDemoInstagram();
    await upsertMetrics([
      instagramSnapshot("2026-07-13", "instagram_media_reach", 100),
      instagramSnapshot("2026-07-13", "instagram_followers", 20),
      instagramSnapshot("2026-07-15", "instagram_media_reach", 999),
      instagramSnapshot("2026-07-15", "instagram_followers", 999),
    ]);

    const instagram = (await getPlatformModules("today", { dataSpaceId: DATA_SPACE_IDS.moonarq }))
      .find((module) => module.sourceTypeKey === "instagram");

    expect(instagram?.primaryMetric).toMatchObject({ value: 100, deltaPercent: null, deltaLabel: "Latest snapshot Jul 13" });
    expect(instagram?.secondaryMetrics.find((metric) => metric.key === "instagram_followers")?.value).toBe(20);
    expect(instagram?.sparkline).toEqual([{ date: "2026-07-14", value: 100 }]);
  });

  it("compares TikTok end-minus-start growth against the previous period", async () => {
    process.env.DEMO_NOW = "2026-07-14T20:00:00.000Z";
    const store = getDemoStore();
    store.sources.push(autoLabTikTokSource());
    store.metricsDaily = store.metricsDaily.filter((metric) => metric.source_id !== AUTO_LAB_TIKTOK_SOURCE_ID);

    await upsertMetrics([
      tiktokSnapshot("2026-07-01", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_video_views", 100),
      tiktokSnapshot("2026-07-07", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_video_views", 140),
      tiktokSnapshot("2026-07-08", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_video_views", 200),
      tiktokSnapshot("2026-07-14", AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_video_views", 260),
    ]);

    const modules = await getPlatformModules("7d", { dataSpaceId: DATA_SPACE_IDS.autoLab, dataSpaceName: "Auto Lab" });
    const tiktok = modules.find((module) => module.sourceTypeKey === "tiktok");

    expect(tiktok?.primaryMetric).toMatchObject({ value: 260, deltaPercent: 50, deltaLabel: "+50.0% vs previous period" });
    expect(tiktok?.sparkline.map((point) => point.value)).toEqual([200, 200, 200, 200, 200, 200, 260]);
  });

  it("keeps additive platform metrics summed across the selected period", async () => {
    process.env.DEMO_NOW = "2026-07-14T20:00:00.000Z";
    const store = getDemoStore();
    store.metricsDaily = store.metricsDaily.filter(
      (metric) => !(metric.source_id === DEMO_SOURCE_IDS.website && metric.metric_key === "unique_visitors"),
    );

    await upsertMetrics([
      {
        date: "2026-07-10",
        sourceId: DEMO_SOURCE_IDS.website,
        sourceTypeKey: "website",
        metricKey: "unique_visitors",
        metricValue: 10,
        unit: "count",
        dimensions: { rollup: "daily" },
      },
      {
        date: "2026-07-14",
        sourceId: DEMO_SOURCE_IDS.website,
        sourceTypeKey: "website",
        metricKey: "unique_visitors",
        metricValue: 20,
        unit: "count",
        dimensions: { rollup: "daily" },
      },
    ]);

    const modules = await getPlatformModules("7d", { dataSpaceId: DATA_SPACE_IDS.moonarq, dataSpaceName: "MoonArq" });
    expect(modules.find((module) => module.sourceTypeKey === "website")?.primaryMetric.value).toBe(30);
  });

  it("marks Vercel Drain sessions unavailable instead of showing a fabricated total", async () => {
    process.env.DEMO_NOW = "2026-07-14T20:00:00.000Z";
    const source = await createSource({
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "vercel_web_analytics_drain",
      display_name: "MoonArq Vercel Drain",
      status: "healthy",
      sync_mode: "webhook",
      supports_webhook: true,
    });
    await upsertMetrics([
      { date: "2026-07-14", sourceId: source.id, sourceTypeKey: "vercel_web_analytics_drain", metricKey: "unique_visitors", metricValue: 5, unit: "count", dimensions: { rollup: "daily" } },
      { date: "2026-07-14", sourceId: source.id, sourceTypeKey: "vercel_web_analytics_drain", metricKey: "page_views", metricValue: 12, unit: "count", dimensions: { rollup: "daily" } },
      { date: "2026-07-14", sourceId: source.id, sourceTypeKey: "vercel_web_analytics_drain", metricKey: "sessions", metricValue: 99, unit: "count", dimensions: { rollup: "daily" } },
    ]);

    const website = (await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq }))
      .find((module) => module.sourceTypeKey === "website");

    expect(website?.sourceModeLabel).toBe("Vercel Drain");
    expect(website?.secondaryMetrics.find((metric) => metric.key === "sessions")).toMatchObject({
      value: "Unavailable",
      unit: "status",
    });
  });

  it("uses concise global freshness copy", async () => {
    const { getGlobalPlatformHealth } = await import("@/aggregation/services/platform-modules-service");
    const health = await getGlobalPlatformHealth("30d");
    expect(health.dataFreshness).toBe("Fresh");
  });
});
