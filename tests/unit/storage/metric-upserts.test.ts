import { beforeEach, describe, expect, it } from "vitest";
import { incrementMetric, upsertMetrics, listMetrics, normalizeMetricDailyRow } from "@/storage/repositories/metrics-repository";
import { resetDemoStore } from "@/storage/repositories/demo-store";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

describe("metric upserts", () => {
  beforeEach(() => resetDemoStore());

  it("updates same date/source/metric/dimensions instead of duplicating", async () => {
    await upsertMetrics([
      {
        date: "2026-04-22",
        sourceId: DEMO_SOURCE_IDS.website,
        sourceTypeKey: "website",
        metricKey: "page_views",
        metricValue: 123,
        unit: "count",
        dimensions: { test: true },
      },
    ]);
    await upsertMetrics([
      {
        date: "2026-04-22",
        sourceId: DEMO_SOURCE_IDS.website,
        sourceTypeKey: "website",
        metricKey: "page_views",
        metricValue: 456,
        unit: "count",
        dimensions: { test: true },
      },
    ]);
    const rows = (await listMetrics({ metricKeys: ["page_views"] })).filter((row) => row.dimensions.test === true);
    expect(rows).toHaveLength(1);
    expect(rows[0].metric_value).toBe(456);
  });

  it("increments same daily metric dimensions for event counters", async () => {
    const metric = {
      date: "2026-04-22",
      sourceId: DEMO_SOURCE_IDS.website,
      sourceTypeKey: "website" as const,
      metricKey: "page_views",
      metricValue: 1,
      unit: "count",
      dimensions: { rollup: "daily" },
    };
    await incrementMetric(metric);
    await incrementMetric(metric);
    const rows = (await listMetrics({ metricKeys: ["page_views"] })).filter((row) => row.dimensions.rollup === "daily");
    expect(rows).toHaveLength(1);
    expect(rows[0].metric_value).toBe(2);
  });

  it("normalizes database-returned metric rows before aggregation services read them", () => {
    const normalized = normalizeMetricDailyRow({
      id: "metric-row",
      date: new Date("2026-04-26T00:00:00.000Z"),
      source_id: DEMO_SOURCE_IDS.supabase,
      source_type_key: "supabase",
      metric_key: "users_total",
      metric_value: "2",
      unit: "count",
      dimensions: "{\"rollup\":\"snapshot\"}",
      dimensions_hash: "hash",
      created_at: new Date("2026-04-27T06:30:00.000Z"),
      updated_at: new Date("2026-04-27T06:30:00.000Z"),
    } as never);

    expect(normalized.date).toBe("2026-04-26");
    expect(normalized.metric_value).toBe(2);
    expect(normalized.dimensions).toEqual({ rollup: "snapshot" });
    expect(normalized.created_at).toBe("2026-04-27T06:30:00.000Z");
  });
});
