/**
 * Fictional, local-only data for the public product tour.
 * This module deliberately has no imports from the private data layers.
 */
export const SAMPLE_DAYS = Object.freeze([
  [312, 32, 18, 8, 584], [338, 36, 19, 9, 702], [295, 29, 17, 7, 511],
  [371, 41, 22, 10, 760], [402, 44, 25, 11, 847], [389, 40, 23, 10, 790],
  [426, 48, 28, 12, 948], [352, 37, 21, 9, 711], [398, 43, 24, 11, 825],
  [415, 46, 27, 12, 936], [387, 42, 25, 10, 810], [461, 51, 30, 13, 1014],
  [438, 49, 28, 12, 948], [472, 53, 31, 14, 1106], [421, 47, 28, 12, 972],
  [455, 52, 30, 13, 1040], [498, 57, 34, 15, 1185], [467, 51, 30, 13, 1053],
  [522, 61, 36, 16, 1280], [491, 56, 33, 15, 1215], [548, 63, 37, 17, 1343],
  [512, 59, 35, 16, 1296], [536, 62, 37, 17, 1377], [489, 55, 33, 15, 1200],
  [563, 66, 40, 18, 1458], [541, 63, 38, 17, 1394], [598, 71, 43, 20, 1620],
  [572, 67, 41, 19, 1558], [621, 74, 45, 21, 1743], [649, 78, 48, 22, 1804],
].map(([sessions, carts, checkouts, orders, revenue], index) => Object.freeze({
  day: index + 1,
  sessions,
  carts,
  checkouts,
  orders,
  revenue,
})));

export type DemoPeriod = 7 | 30;
export type DemoView = "overview" | "acquisition" | "connections";

export function getDemoPeriod(period: DemoPeriod) {
  const days = SAMPLE_DAYS.slice(-period);
  const total = days.reduce((sum, day) => ({
    sessions: sum.sessions + day.sessions,
    carts: sum.carts + day.carts,
    checkouts: sum.checkouts + day.checkouts,
    orders: sum.orders + day.orders,
    revenue: sum.revenue + day.revenue,
  }), { sessions: 0, carts: 0, checkouts: 0, orders: 0, revenue: 0 });

  const organic = Math.floor(total.sessions * 0.42);
  const social = Math.floor(total.sessions * 0.28);
  const direct = Math.floor(total.sessions * 0.19);

  return {
    days,
    total,
    conversionRate: total.orders / total.sessions * 100,
    averageOrderValue: total.revenue / total.orders,
    channels: [
      { label: "Organic search", sessions: organic, colorKey: "website" },
      { label: "Social", sessions: social, colorKey: "instagram" },
      { label: "Direct", sessions: direct, colorKey: "tiktok" },
      { label: "Email", sessions: total.sessions - organic - social - direct, colorKey: "supabase" },
    ],
  };
}

export const SAMPLE_CONNECTIONS = Object.freeze([
  Object.freeze({ name: "Website", description: "First-party visits & events", mode: "Event tracking", icon: "website", status: "Healthy" }),
  Object.freeze({ name: "Shopify", description: "Orders & commerce", mode: "Scheduled sync", icon: "shopify", status: "Healthy" }),
  Object.freeze({ name: "Instagram", description: "Content & engagement", mode: "Scheduled sync", icon: "instagram", status: "Healthy" }),
  Object.freeze({ name: "Meta Ads", description: "Campaign performance", mode: "Scheduled sync", icon: "meta_ads", status: "Healthy" }),
]);

export const formatDemoNumber = (value: number) => new Intl.NumberFormat("en-US").format(value);
export const formatDemoCurrency = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
}).format(value);
