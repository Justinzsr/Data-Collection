import type { ContentItem, ContentMetric } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export async function listContentItems(): Promise<ContentItem[]> {
  return getDemoStore().contentItems;
}

export async function listContentMetrics(): Promise<ContentMetric[]> {
  return getDemoStore().contentMetrics;
}
