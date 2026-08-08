import { randomUUID } from "node:crypto";
import type { NormalizedContentMetric } from "@/collection/connectors/types";
import { isRuntimeDatabaseConfigured, queryRows, type DatabaseExecutor } from "@/storage/db/client";
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

export type ContentMetricsUpsertResult = {
  itemsInserted: number;
  itemsUpdated: number;
  metricsUpserted: number;
};

type ContentMetricGroup = {
  item: NormalizedContentMetric;
  metrics: NormalizedContentMetric[];
};

function groupContentMetrics(contentMetrics: NormalizedContentMetric[]) {
  const groups = new Map<string, ContentMetricGroup>();
  for (const metric of contentMetrics) {
    const key = `${metric.sourceId}:${metric.externalContentId}`;
    const group = groups.get(key);
    if (group) {
      group.metrics.push(metric);
      group.item = {
        ...group.item,
        contentType: metric.contentType,
        title: metric.title ?? group.item.title,
        caption: metric.caption ?? group.item.caption,
        url: metric.url ?? group.item.url,
        thumbnailUrl: metric.thumbnailUrl ?? group.item.thumbnailUrl,
        publishedAt: metric.publishedAt ?? group.item.publishedAt,
        dimensions: {
          ...(group.item.dimensions ?? {}),
          ...(metric.dimensions ?? {}),
        },
      };
      continue;
    }
    groups.set(key, {
      item: {
        ...metric,
        dimensions: { ...(metric.dimensions ?? {}) },
      },
      metrics: [metric],
    });
  }
  return Array.from(groups.values());
}

export async function upsertContentMetrics(
  contentMetrics: NormalizedContentMetric[],
  executor?: DatabaseExecutor,
): Promise<ContentMetricsUpsertResult> {
  const now = new Date().toISOString();
  let itemsInserted = 0;
  let itemsUpdated = 0;
  let metricsUpserted = 0;
  const groups = groupContentMetrics(contentMetrics);
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    for (const group of groups) {
      const input = group.item;
      let item = store.contentItems.find((candidate) => candidate.source_id === input.sourceId && candidate.external_content_id === input.externalContentId);
      if (!item) {
        item = {
          id: randomUUID(),
          source_id: input.sourceId,
          source_type_key: input.sourceTypeKey,
          external_content_id: input.externalContentId,
          content_type: input.contentType,
          title: input.title ?? null,
          caption: input.caption ?? null,
          url: input.url ?? null,
          thumbnail_url: input.thumbnailUrl ?? null,
          published_at: input.publishedAt ?? null,
          metadata: input.dimensions ?? {},
          created_at: now,
          updated_at: now,
        };
        store.contentItems.push(item);
        itemsInserted += 1;
      } else {
        item.content_type = input.contentType;
        item.title = input.title ?? item.title;
        item.caption = input.caption ?? item.caption;
        item.url = input.url ?? item.url;
        item.thumbnail_url = input.thumbnailUrl ?? item.thumbnail_url;
        item.published_at = input.publishedAt ?? item.published_at;
        item.metadata = { ...item.metadata, ...(input.dimensions ?? {}) };
        item.updated_at = now;
        itemsUpdated += 1;
      }
      for (const metric of group.metrics) {
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
    }
    return { itemsInserted, itemsUpdated, metricsUpserted };
  }

  for (const group of groups) {
    const input = group.item;
    const itemRows = await queryRows<ContentItem & { was_inserted: boolean }>(
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
        returning *, (xmax = 0) as was_inserted
      `,
      [
        randomUUID(),
        input.sourceId,
        input.sourceTypeKey,
        input.externalContentId,
        input.contentType,
        input.title ?? null,
        input.caption ?? null,
        input.url ?? null,
        input.thumbnailUrl ?? null,
        input.publishedAt ?? null,
        JSON.stringify(input.dimensions ?? {}),
        now,
        now,
      ],
      executor,
    );
    const item = itemRows[0];
    if (!item) {
      throw new Error(`Content item upsert returned no row for ${input.sourceId}:${input.externalContentId}.`);
    }
    if (item.was_inserted) itemsInserted += 1;
    else itemsUpdated += 1;

    for (const metric of group.metrics) {
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
        executor,
      );
      metricsUpserted += 1;
    }
  }
  return { itemsInserted, itemsUpdated, metricsUpserted };
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
