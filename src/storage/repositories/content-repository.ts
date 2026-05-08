import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { ContentItem, ContentMetric } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listSources } from "@/storage/repositories/sources-repository";

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
