import { describe, expect, it } from "vitest";
import { createDemoWorkspace } from "@/storage/seed/demo-data";
import { getDashboardSummary } from "@/aggregation/services/summary-service";
import { getMetricTimeseries } from "@/aggregation/services/timeseries-service";

describe("demo data and aggregation", () => {
  it("generates 30 days of demo metrics", () => {
    const store = createDemoWorkspace();
    const dates = new Set(store.metricsDaily.filter((row) => row.metric_key === "page_views").map((row) => row.date));
    expect(dates.size).toBe(30);
    expect(store.sources.some((source) => source.status === "demo")).toBe(true);
  });

  it("returns summary KPIs without commerce dominance", async () => {
    const summary = await getDashboardSummary("30d");
    expect(summary.kpis.map((kpi) => kpi.key)).toContain("page_views");
    expect(summary.kpis.map((kpi) => kpi.key)).not.toContain("orders");
  });

  it("fills timeseries days", async () => {
    const series = await getMetricTimeseries({ metricKey: "page_views", range: "30d" });
    expect(series).toHaveLength(30);
    expect(series.every((point) => typeof point.value === "number")).toBe(true);
  });
});
