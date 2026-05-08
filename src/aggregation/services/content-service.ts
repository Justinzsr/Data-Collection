import { listContentItems, listContentMetrics } from "@/storage/repositories/content-repository";

export async function getContentDashboard(options: { dataSpaceId?: string } = {}) {
  const [items, metrics] = await Promise.all([
    listContentItems({ dataSpaceId: options.dataSpaceId }),
    listContentMetrics({ dataSpaceId: options.dataSpaceId }),
  ]);
  return { items, metrics };
}
