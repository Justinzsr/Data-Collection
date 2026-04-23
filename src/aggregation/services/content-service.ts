import { listContentItems, listContentMetrics } from "@/storage/repositories/content-repository";

export async function getContentDashboard() {
  const [items, metrics] = await Promise.all([listContentItems(), listContentMetrics()]);
  return { items, metrics };
}
