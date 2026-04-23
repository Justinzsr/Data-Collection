import { randomUUID } from "node:crypto";
import type { NormalizedMetric } from "@/collection/connectors/types";
import type { JsonRecord, MetricDaily, SourceTypeKey } from "@/storage/db/schema";
import { dimensionsHash } from "@/storage/seed/demo-data";
import { getDemoStore } from "@/storage/repositories/demo-store";

export async function upsertMetrics(metrics: NormalizedMetric[]): Promise<{ upserted: number }> {
  const store = getDemoStore();
  let upserted = 0;
  const now = new Date().toISOString();
  for (const metric of metrics) {
    const dimensions = metric.dimensions ?? {};
    const hash = dimensionsHash(dimensions);
    const existing = store.metricsDaily.find(
      (row) =>
        row.date === metric.date &&
        row.source_id === metric.sourceId &&
        row.metric_key === metric.metricKey &&
        row.dimensions_hash === hash,
    );
    if (existing) {
      existing.metric_value = metric.metricValue;
      existing.unit = metric.unit;
      existing.dimensions = dimensions;
      existing.updated_at = now;
    } else {
      store.metricsDaily.push({
        id: randomUUID(),
        date: metric.date,
        source_id: metric.sourceId,
        source_type_key: metric.sourceTypeKey,
        metric_key: metric.metricKey,
        metric_value: metric.metricValue,
        unit: metric.unit,
        dimensions,
        dimensions_hash: hash,
        created_at: now,
        updated_at: now,
      });
    }
    upserted += 1;
  }
  return { upserted };
}

export async function listMetrics(options: {
  metricKeys?: string[];
  sourceId?: string | null;
  sourceTypeKey?: SourceTypeKey;
  startDate?: string;
  endDate?: string;
} = {}): Promise<MetricDaily[]> {
  return getDemoStore().metricsDaily.filter((metric) => {
    if (options.metricKeys && !options.metricKeys.includes(metric.metric_key)) return false;
    if (options.sourceId && metric.source_id !== options.sourceId) return false;
    if (options.sourceTypeKey && metric.source_type_key !== options.sourceTypeKey) return false;
    if (options.startDate && metric.date < options.startDate) return false;
    if (options.endDate && metric.date > options.endDate) return false;
    return true;
  });
}

export function aggregateMetrics(rows: MetricDaily[], metricKey: string, dimensions?: JsonRecord): number {
  return rows
    .filter((row) => row.metric_key === metricKey)
    .filter((row) => {
      if (!dimensions) return true;
      return Object.entries(dimensions).every(([key, value]) => row.dimensions[key] === value);
    })
    .reduce((sum, row) => sum + row.metric_value, 0);
}
