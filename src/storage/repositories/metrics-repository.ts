import { randomUUID } from "node:crypto";
import type { NormalizedMetric } from "@/collection/connectors/types";
import {
  getDatabasePool,
  isRuntimeDatabaseConfigured,
  queryRows,
  withDatabaseTransaction,
  type DatabaseExecutor,
} from "@/storage/db/client";
import type { JsonRecord, MetricDaily, SourceTypeKey } from "@/storage/db/schema";
import { dimensionsHash } from "@/storage/seed/demo-data";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listSources } from "@/storage/repositories/sources-repository";

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

function normalizeDateKey(value: unknown) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeJsonRecord(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function normalizeMetricDailyRow(row: MetricDaily): MetricDaily {
  const createdAt = row.created_at as unknown;
  const updatedAt = row.updated_at as unknown;
  return {
    ...row,
    date: normalizeDateKey(row.date),
    metric_value: typeof row.metric_value === "number" ? row.metric_value : Number(row.metric_value ?? 0),
    dimensions: normalizeJsonRecord(row.dimensions),
    created_at: createdAt instanceof Date ? createdAt.toISOString() : row.created_at,
    updated_at: updatedAt instanceof Date ? updatedAt.toISOString() : row.updated_at,
  };
}

type MetricReplacementWindow = {
  sourceId: string;
  sourceTypeKey: SourceTypeKey;
  metricKeys: string[];
  startDate: string;
  endDate: string;
};

function validateMetricReplacement(metrics: NormalizedMetric[], window: MetricReplacementWindow) {
  const allowedKeys = new Set(window.metricKeys);
  if (
    !window.sourceId ||
    window.metricKeys.length === 0 ||
    allowedKeys.size !== window.metricKeys.length ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(window.startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(window.endDate) ||
    window.startDate > window.endDate
  ) {
    throw new Error("Metric replacement window is invalid.");
  }
  const identities = new Set<string>();
  for (const metric of metrics) {
    const identity = `${metric.date}\u0000${metric.metricKey}\u0000${dimensionsHash(metric.dimensions ?? {})}`;
    if (
      metric.sourceId !== window.sourceId ||
      metric.sourceTypeKey !== window.sourceTypeKey ||
      !allowedKeys.has(metric.metricKey) ||
      metric.date < window.startDate ||
      metric.date > window.endDate ||
      !Number.isFinite(metric.metricValue) ||
      identities.has(identity)
    ) {
      throw new Error("A replacement metric is invalid, duplicated, or outside its declared source, type, key, or date window.");
    }
    identities.add(identity);
  }
}

async function upsertMetricRows(metrics: NormalizedMetric[], executor: DatabaseExecutor) {
  const now = new Date().toISOString();
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
      executor,
    );
  }
  return { upserted: metrics.length };
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

  return upsertMetricRows(metrics, getDatabasePool());
}

export async function replaceMetricsWindow(
  metrics: NormalizedMetric[],
  window: MetricReplacementWindow,
  lease: { syncRunId: string; lockKey: string },
): Promise<{ upserted: number }> {
  validateMetricReplacement(metrics, window);

  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const keys = new Set(window.metricKeys);
    store.metricsDaily = store.metricsDaily.filter((row) => !(
      row.source_id === window.sourceId &&
      row.source_type_key === window.sourceTypeKey &&
      keys.has(row.metric_key) &&
      row.date >= window.startDate &&
      row.date <= window.endDate
    ));
    return upsertMetrics(metrics);
  }

  return withDatabaseTransaction(async (client) => {
    await queryRows("select pg_advisory_xact_lock(hashtextextended($1, 0))", [window.sourceId], client);
    const assertLeaseOwner = async () => {
      const rows = await queryRows<{ owned: boolean }>(
        `
          select exists (
            select 1
            from source_locks
            where source_id = $1
              and locked_by_sync_run_id = $2
              and lock_key = $3
              and expires_at > now()
          ) as owned
        `,
        [window.sourceId, lease.syncRunId, lease.lockKey],
        client,
      );
      if (!rows[0]?.owned) throw new Error("Source lock lease was lost before the metric snapshot could be replaced.");
    };
    await assertLeaseOwner();
    await queryRows(
      `
        delete from metrics_daily
        where source_id = $1
          and source_type_key = $2
          and metric_key = any($3::text[])
          and date between $4 and $5
      `,
      [window.sourceId, window.sourceTypeKey, window.metricKeys, window.startDate, window.endDate],
      client,
    );
    const result = await upsertMetricRows(metrics, client);
    await assertLeaseOwner();
    return result;
  });
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
  return { upserted: 1, value: rows[0] ? normalizeMetricDailyRow(rows[0]).metric_value : metric.metricValue };
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
  dataSpaceId?: string;
} = {}): Promise<MetricDaily[]> {
  if (!isRuntimeDatabaseConfigured()) {
    const scopedSourceIds = options.dataSpaceId
      ? new Set((await listSources({ dataSpaceId: options.dataSpaceId })).map((source) => source.id))
      : null;
    return getDemoStore().metricsDaily.filter((metric) => {
      if (scopedSourceIds && (!metric.source_id || !scopedSourceIds.has(metric.source_id))) return false;
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
    where.push(`m.metric_key = any($${values.length}::text[])`);
  }
  if (options.sourceId) {
    values.push(options.sourceId);
    where.push(`m.source_id = $${values.length}`);
  }
  if (options.sourceTypeKey) {
    values.push(options.sourceTypeKey);
    where.push(`m.source_type_key = $${values.length}`);
  }
  if (options.startDate) {
    values.push(options.startDate);
    where.push(`m.date >= $${values.length}`);
  }
  if (options.endDate) {
    values.push(options.endDate);
    where.push(`m.date <= $${values.length}`);
  }
  if (options.dataSpaceId) {
    values.push(options.dataSpaceId);
    where.push(`s.data_space_id = $${values.length}`);
  }
  const rows = await queryRows<MetricDaily>(
    `
      select m.*
      from metrics_daily m
      ${options.dataSpaceId ? "join sources s on s.id = m.source_id" : ""}
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by m.date asc, m.metric_key asc
    `,
    values,
  );
  return rows.map(normalizeMetricDailyRow);
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
