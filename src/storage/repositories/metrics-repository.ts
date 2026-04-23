import "server-only";

import { randomUUID } from "node:crypto";
import type { NormalizedMetric } from "@/collection/connectors/types";
import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { JsonRecord, MetricDaily, SourceTypeKey } from "@/storage/db/schema";
import { dimensionsHash } from "@/storage/seed/demo-data";
import { getDemoStore } from "@/storage/repositories/demo-store";

function toMetricRow(metric: NormalizedMetric, now: string): MetricDaily {
  const dimensions = metric.dimensions ?? {};
  return {
    id: randomUUID(),
    date: metric.date,
    source_id: metric.sourceId,
    source_type_key: metric.sourceTypeKey,
    metric_key: metric.metricKey,
    metric_value: metric.metricValue,
    unit: metric.unit,
    dimensions,
    dimensions_hash: dimensionsHash(dimensions),
    created_at: now,
    updated_at: now,
  };
}

export async function upsertMetrics(metrics: NormalizedMetric[]): Promise<{ upserted: number }> {
  const now = new Date().toISOString();

  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    let upserted = 0;
    for (const metric of metrics) {
      const dimensions = metric.dimensions ?? {};
      const hash = dimensionsHash(dimensions);
      const existing = store.metricsDaily.find(
        (row) =>
          row.date === metric.date &&
          row.source_id === metric.sourceId &&
          row.source_type_key === metric.sourceTypeKey &&
          row.metric_key === metric.metricKey &&
          row.dimensions_hash === hash,
      );
      if (existing) {
        existing.metric_value = metric.metricValue;
        existing.unit = metric.unit;
        existing.dimensions = dimensions;
        existing.updated_at = now;
      } else {
        store.metricsDaily.push(toMetricRow(metric, now));
      }
      upserted += 1;
    }
    return { upserted };
  }

  for (const metric of metrics) {
    const dimensions = metric.dimensions ?? {};
    const hash = dimensionsHash(dimensions);
    await queryRows<MetricDaily>(
      `
        insert into metrics_daily (
          id,
          date,
          source_id,
          source_type_key,
          metric_key,
          metric_value,
          unit,
          dimensions,
          dimensions_hash,
          created_at,
          updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11
        )
        on conflict (date, source_id, metric_key, dimensions_hash) do update set
          source_type_key = excluded.source_type_key,
          metric_value = excluded.metric_value,
          unit = excluded.unit,
          dimensions = excluded.dimensions,
          updated_at = excluded.updated_at
        returning *
      `,
      [
        randomUUID(),
        metric.date,
        metric.sourceId,
        metric.sourceTypeKey,
        metric.metricKey,
        metric.metricValue,
        metric.unit,
        JSON.stringify(dimensions),
        hash,
        now,
        now,
      ],
    );
  }
  return { upserted: metrics.length };
}

export async function incrementMetric(metric: NormalizedMetric): Promise<{ upserted: number; value: number }> {
  const now = new Date().toISOString();
  const dimensions = metric.dimensions ?? {};
  const hash = dimensionsHash(dimensions);

  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const existing = store.metricsDaily.find(
      (row) =>
        row.date === metric.date &&
        row.source_id === metric.sourceId &&
        row.source_type_key === metric.sourceTypeKey &&
        row.metric_key === metric.metricKey &&
        row.dimensions_hash === hash,
    );
    if (existing) {
      existing.metric_value += metric.metricValue;
      existing.unit = metric.unit;
      existing.dimensions = dimensions;
      existing.updated_at = now;
      return { upserted: 1, value: existing.metric_value };
    }
    store.metricsDaily.push(toMetricRow(metric, now));
    return { upserted: 1, value: metric.metricValue };
  }

  const rows = await queryRows<MetricDaily>(
    `
      insert into metrics_daily (
        id,
        date,
        source_id,
        source_type_key,
        metric_key,
        metric_value,
        unit,
        dimensions,
        dimensions_hash,
        created_at,
        updated_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11
      )
      on conflict (date, source_id, metric_key, dimensions_hash) do update set
        source_type_key = excluded.source_type_key,
        metric_value = metrics_daily.metric_value + excluded.metric_value,
        unit = excluded.unit,
        dimensions = excluded.dimensions,
        updated_at = excluded.updated_at
      returning *
    `,
    [
      randomUUID(),
      metric.date,
      metric.sourceId,
      metric.sourceTypeKey,
      metric.metricKey,
      metric.metricValue,
      metric.unit,
      JSON.stringify(dimensions),
      hash,
      now,
      now,
    ],
  );
  return { upserted: 1, value: rows[0]?.metric_value ?? metric.metricValue };
}

export async function incrementMetrics(metrics: NormalizedMetric[]): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const metric of metrics) {
    const result = await incrementMetric(metric);
    upserted += result.upserted;
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
  if (!isRuntimeDatabaseConfigured()) {
    return getDemoStore().metricsDaily.filter((metric) => {
      if (options.metricKeys && !options.metricKeys.includes(metric.metric_key)) return false;
      if (options.sourceId && metric.source_id !== options.sourceId) return false;
      if (options.sourceTypeKey && metric.source_type_key !== options.sourceTypeKey) return false;
      if (options.startDate && metric.date < options.startDate) return false;
      if (options.endDate && metric.date > options.endDate) return false;
      return true;
    });
  }

  const where: string[] = [];
  const values: unknown[] = [];
  if (options.metricKeys?.length) {
    values.push(options.metricKeys);
    where.push(`metric_key = any($${values.length}::text[])`);
  }
  if (options.sourceId) {
    values.push(options.sourceId);
    where.push(`source_id = $${values.length}`);
  }
  if (options.sourceTypeKey) {
    values.push(options.sourceTypeKey);
    where.push(`source_type_key = $${values.length}`);
  }
  if (options.startDate) {
    values.push(options.startDate);
    where.push(`date >= $${values.length}`);
  }
  if (options.endDate) {
    values.push(options.endDate);
    where.push(`date <= $${values.length}`);
  }
  return queryRows<MetricDaily>(
    `
      select *
      from metrics_daily
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by date asc, metric_key asc
    `,
    values,
  );
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
