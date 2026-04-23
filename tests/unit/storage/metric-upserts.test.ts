import { beforeEach, describe, expect, it } from "vitest";
import { incrementMetric, upsertMetrics, listMetrics } from "@/storage/repositories/metrics-repository";
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
});
