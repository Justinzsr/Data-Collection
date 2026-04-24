import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { ContentItem, ContentMetric } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export async function listContentItems(): Promise<ContentItem[]> {
  if (!isRuntimeDatabaseConfigured()) {
    return getDemoStore().contentItems;
  }
  return queryRows<ContentItem>(
    `
      select *
      from content_items
      order by coalesce(published_at, created_at) desc
    `,
  );
}

export async function listContentMetrics(): Promise<ContentMetric[]> {
  if (!isRuntimeDatabaseConfigured()) {
    return getDemoStore().contentMetrics;
  }
  return queryRows<ContentMetric>(
    `
      select *
      from content_metrics
      order by date desc, metric_key asc
    `,
  );
}
