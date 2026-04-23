export async function getCommerceDashboard() {
  return {
    connected: false,
    message: "Shopify is scaffolded for future official Admin API integration. It is intentionally not dominant in the MVP dashboard.",
    plannedMetrics: ["orders", "gross_sales", "current_total", "net_payment", "refunds", "top_products"],
  };
}
