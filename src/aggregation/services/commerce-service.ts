import { getPlatformModules } from "@/aggregation/services/platform-modules-service";

export async function getCommerceDashboard(options: { dataSpaceId?: string; dataSpaceName?: string } = {}) {
  const modules = await getPlatformModules("30d", options);
  const shopifyModule = modules.find((item) => item.sourceTypeKey === "shopify");
  if (!shopifyModule) throw new Error("Shopify platform module is unavailable.");
  const connected = Boolean(shopifyModule.sourceId && shopifyModule.status === "healthy");
  return {
    connected,
    module: shopifyModule,
    message: connected
      ? "Live Shopify order and sales metrics from the official Admin GraphQL API."
      : "Connect a store-owned Shopify Dev Dashboard app with the minimum read_orders scope.",
  };
}
