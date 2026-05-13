import { beforeEach, describe, expect, it } from "vitest";
import { calculateDelta, getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { AUTO_LAB_TIKTOK_SOURCE_ID } from "@/collection/connectors/tiktok/constants";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { upsertMetrics } from "@/storage/repositories/metrics-repository";
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
    expect(modules.find((module) => module.sourceTypeKey === "shopify")?.status).toBe("disabled");
    expect(modules.find((module) => module.sourceTypeKey === "website")?.sourceModeLabel).toBe("Demo");
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

  it("uses concise global freshness copy", async () => {
    const { getGlobalPlatformHealth } = await import("@/aggregation/services/platform-modules-service");
    const health = await getGlobalPlatformHealth("30d");
    expect(health.dataFreshness).toBe("Fresh");
  });
});
