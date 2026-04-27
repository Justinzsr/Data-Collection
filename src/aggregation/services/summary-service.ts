import { aggregateMetrics, listMetrics } from "@/storage/repositories/metrics-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { listSyncRuns } from "@/storage/repositories/sync-runs-repository";
import { getDemoNow } from "@/storage/seed/demo-data";
import { getAppDateRange } from "@/storage/runtime/app-time";

export type DateRangeKey = "today" | "7d" | "30d";

export function getDateRange(range: DateRangeKey = "30d") {
  return getAppDateRange(range, getDemoNow());
}

function latestMetricValue(metrics: Awaited<ReturnType<typeof listMetrics>>, metricKey: string) {
  return (
    metrics
      .filter((row) => row.metric_key === metricKey)
      .sort((left, right) => left.date.localeCompare(right.date))
      .at(-1)?.metric_value ?? 0
  );
}

export async function getDashboardSummary(range: DateRangeKey = "30d") {
  const dateRange = getDateRange(range);
  const [metrics, snapshotMetrics, sources, syncRuns] = await Promise.all([
    listMetrics({ startDate: dateRange.startDate, endDate: dateRange.endDate }),
    listMetrics({ metricKeys: ["users_total", "confirmed_users"] }),
    listSources(),
    listSyncRuns(40),
  ]);
  const activeSources = sources.filter((source) => source.status !== "disabled").length;
  const syncErrors = syncRuns.filter((run) => run.status === "error").length;
  const latestRun = syncRuns[0] ?? null;
  return {
    range,
    ...dateRange,
    kpis: [
      { key: "page_views", label: "Page views", value: aggregateMetrics(metrics, "page_views"), unit: "count", source: "Website", demo: true },
      { key: "unique_visitors", label: "Unique visitors", value: aggregateMetrics(metrics, "unique_visitors"), unit: "count", source: "Website", demo: true },
      { key: "custom_events", label: "Custom events", value: aggregateMetrics(metrics, "custom_events"), unit: "count", source: "Website", demo: true },
      { key: "signups", label: "Signups", value: aggregateMetrics(metrics, "signups"), unit: "count", source: "Supabase", demo: true },
      { key: "users_total", label: "Users total", value: latestMetricValue(snapshotMetrics, "users_total"), unit: "count", source: "Supabase", demo: true },
      { key: "active_sources", label: "Active sources", value: activeSources, unit: "count", source: "System", demo: true },
      { key: "last_sync_status", label: "Last sync", value: latestRun?.status ?? "none", unit: "status", source: "System", demo: true },
      { key: "sync_errors", label: "Sync errors", value: syncErrors, unit: "count", source: "System", demo: true },
    ],
    sources,
    latestRun,
    syncErrors,
  };
}
