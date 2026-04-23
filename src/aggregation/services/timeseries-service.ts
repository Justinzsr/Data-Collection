import { listMetrics } from "@/storage/repositories/metrics-repository";
import type { SourceTypeKey } from "@/storage/db/schema";
import { getDateRange, type DateRangeKey } from "@/aggregation/services/summary-service";

function enumerateDays(startDate: string, endDate: string) {
  const days: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function getMetricTimeseries(options: {
  metricKey?: string;
  range?: DateRangeKey;
  sourceId?: string;
  sourceTypeKey?: SourceTypeKey;
} = {}) {
  const metricKey = options.metricKey ?? "page_views";
  const range = getDateRange(options.range ?? "30d");
  const rows = await listMetrics({
    metricKeys: [metricKey],
    startDate: range.startDate,
    endDate: range.endDate,
    sourceId: options.sourceId,
    sourceTypeKey: options.sourceTypeKey,
  });
  return enumerateDays(range.startDate, range.endDate).map((date) => ({
    date,
    value: rows.filter((row) => row.date === date).reduce((sum, row) => sum + row.metric_value, 0),
  }));
}

export async function getSourceComparison() {
  const rows = await listMetrics({ startDate: getDateRange("30d").startDate, endDate: getDateRange("30d").endDate });
  const grouped = new Map<string, { sourceType: SourceTypeKey; page_views: number; signups: number; custom_events: number }>();
  for (const row of rows) {
    const key = row.source_id ?? row.source_type_key;
    const item = grouped.get(key) ?? { sourceType: row.source_type_key, page_views: 0, signups: 0, custom_events: 0 };
    if (row.metric_key === "page_views") item.page_views += row.metric_value;
    if (row.metric_key === "signups") item.signups += row.metric_value;
    if (row.metric_key === "custom_events") item.custom_events += row.metric_value;
    grouped.set(key, item);
  }
  return Array.from(grouped.entries()).map(([sourceId, values]) => ({ sourceId, ...values }));
}
