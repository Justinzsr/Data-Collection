import { beforeEach, describe, expect, it } from "vitest";
import { calculateDelta, getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { upsertMetrics } from "@/storage/repositories/metrics-repository";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

describe("platform modules service", () => {
  beforeEach(() => resetDemoStore());

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
        date: "2026-04-22",
        sourceId: DEMO_SOURCE_IDS.supabase,
        sourceTypeKey: "supabase",
        metricKey: "users_total",
        metricValue: 2,
        unit: "count",
        dimensions: { rollup: "snapshot" },
      },
      {
        date: "2026-04-22",
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
    expect(supabaseModule?.secondaryMetrics.find((metric) => metric.key === "users_total")?.value).toBe(2);
    expect(supabaseModule?.secondaryMetrics.find((metric) => metric.key === "confirmed_users")?.value).toBe(1);
  });
});
