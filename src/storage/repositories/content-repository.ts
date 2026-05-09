import { randomUUID } from "node:crypto";
import type { NormalizedContentMetric } from "@/collection/connectors/types";
import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { ContentItem, ContentMetric } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listSources } from "@/storage/repositories/sources-repository";

function toContentMetricRow(input: NormalizedContentMetric, contentItemId: string, now: string): ContentMetric {
  return {
    id: randomUUID(),
    date: input.date,
    content_item_id: contentItemId,
    source_id: input.sourceId,
    source_type_key: input.sourceTypeKey,
    metric_key: input.metricKey,
    metric_value: input.metricValue,
    unit: input.unit,
    dimensions: input.dimensions ?? {},
    created_at: now,
    updated_at: now,
  };
}

export async function upsertContentMetrics(contentMetrics: NormalizedContentMetric[]): Promise<{ itemsUpserted: number; metricsUpserted: number }> {
  const now = new Date().toISOString();
  let itemsUpserted = 0;
  let metricsUpserted = 0;
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    for (const metric of contentMetrics) {
      let item = store.contentItems.find((candidate) => candidate.source_id === metric.sourceId && candidate.external_content_id === metric.externalContentId);
      if (!item) {
        item = {
          id: randomUUID(),
          source_id: metric.sourceId,
          source_type_key: metric.sourceTypeKey,
          external_content_id: metric.externalContentId,
          content_type: metric.contentType,
          title: metric.title ?? null,
          caption: metric.caption ?? null,
          url: metric.url ?? null,
          thumbnail_url: metric.thumbnailUrl ?? null,
          published_at: metric.publishedAt ?? null,
          metadata: metric.dimensions ?? {},
          created_at: now,
          updated_at: now,
        };
        store.contentItems.push(item);
      } else {
        item.content_type = metric.contentType;
        item.title = metric.title ?? item.title;
        item.caption = metric.caption ?? item.caption;
        item.url = metric.url ?? item.url;
        item.thumbnail_url = metric.thumbnailUrl ?? item.thumbnail_url;
        item.published_at = metric.publishedAt ?? item.published_at;
        item.metadata = { ...item.metadata, ...(metric.dimensions ?? {}) };
        item.updated_at = now;
      }
      itemsUpserted += 1;
      const existing = store.contentMetrics.find((candidate) => candidate.date === metric.date && candidate.content_item_id === item.id && candidate.metric_key === metric.metricKey);
      if (existing) {
        existing.metric_value = metric.metricValue;
        existing.unit = metric.unit;
        existing.dimensions = metric.dimensions ?? {};
        existing.updated_at = now;
      } else {
        store.contentMetrics.push(toContentMetricRow(metric, item.id, now));
      }
      metricsUpserted += 1;
    }
    return { itemsUpserted, metricsUpserted };
  }

  for (const metric of contentMetrics) {
    const itemRows = await queryRows<ContentItem>(
      `
        insert into content_items (
          id,
          source_id,
          source_type_key,
          external_content_id,
          content_type,
          title,
          caption,
          url,
          thumbnail_url,
          published_at,
          metadata,
          created_at,
          updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13
        )
        on conflict (source_id, external_content_id) do update set
          source_type_key = excluded.source_type_key,
          content_type = excluded.content_type,
          title = coalesce(excluded.title, content_items.title),
          caption = coalesce(excluded.caption, content_items.caption),
          url = coalesce(excluded.url, content_items.url),
          thumbnail_url = coalesce(excluded.thumbnail_url, content_items.thumbnail_url),
          published_at = coalesce(excluded.published_at, content_items.published_at),
          metadata = content_items.metadata || excluded.metadata,
          updated_at = excluded.updated_at
        returning *
      `,
      [
        randomUUID(),
        metric.sourceId,
        metric.sourceTypeKey,
        metric.externalContentId,
        metric.contentType,
        metric.title ?? null,
        metric.caption ?? null,
        metric.url ?? null,
        metric.thumbnailUrl ?? null,
        metric.publishedAt ?? null,
        JSON.stringify(metric.dimensions ?? {}),
        now,
        now,
      ],
    );
    const item = itemRows[0];
    itemsUpserted += 1;
    await queryRows<ContentMetric>(
      `
        insert into content_metrics (
          id,
          date,
          content_item_id,
          source_id,
          source_type_key,
          metric_key,
          metric_value,
          unit,
          dimensions,
          created_at,
          updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11
        )
        on conflict (date, content_item_id, metric_key) do update set
          source_id = excluded.source_id,
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
        item.id,
        metric.sourceId,
        metric.sourceTypeKey,
        metric.metricKey,
        metric.metricValue,
        metric.unit,
        JSON.stringify(metric.dimensions ?? {}),
        now,
        now,
      ],
    );
    metricsUpserted += 1;
  }
  return { itemsUpserted, metricsUpserted };
}

export async function listContentItems(options: { dataSpaceId?: string } = {}): Promise<ContentItem[]> {
  if (!isRuntimeDatabaseConfigured()) {
    if (!options.dataSpaceId) return getDemoStore().contentItems;
    const sourceIds = new Set((await listSources({ dataSpaceId: options.dataSpaceId })).map((source) => source.id));
    return getDemoStore().contentItems.filter((item) => sourceIds.has(item.source_id));
  }
  if (options.dataSpaceId) {
    return queryRows<ContentItem>(
      `
        select c.*
        from content_items c
        join sources s on s.id = c.source_id
        where s.data_space_id = $1
        order by coalesce(c.published_at, c.created_at) desc
      `,
      [options.dataSpaceId],
    );
  }
  return queryRows<ContentItem>(
    `
      select *
      from content_items
      order by coalesce(published_at, created_at) desc
    `,
  );
}

export async function listContentMetrics(options: { dataSpaceId?: string } = {}): Promise<ContentMetric[]> {
  if (!isRuntimeDatabaseConfigured()) {
    if (!options.dataSpaceId) return getDemoStore().contentMetrics;
    const sourceIds = new Set((await listSources({ dataSpaceId: options.dataSpaceId })).map((source) => source.id));
    return getDemoStore().contentMetrics.filter((item) => sourceIds.has(item.source_id));
  }
  if (options.dataSpaceId) {
    return queryRows<ContentMetric>(
      `
        select c.*
        from content_metrics c
        join sources s on s.id = c.source_id
        where s.data_space_id = $1
        order by c.date desc, c.metric_key asc
      `,
      [options.dataSpaceId],
    );
  }
  return queryRows<ContentMetric>(
    `
      select *
      from content_metrics
      order by date desc, metric_key asc
    `,
  );
}
