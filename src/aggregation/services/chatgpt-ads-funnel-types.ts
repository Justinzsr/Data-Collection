import type { WebsiteCommerceFunnelStage, WebsiteCommerceMeasurementState } from "@/aggregation/services/website-commerce-funnel-v2-types";
import type { WebsiteFunnelRangeKey } from "@/aggregation/services/website-funnel-types";

export type ChatgptAdsTotals = {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  clickThroughConversions: number | null;
  viewThroughConversions: number | null;
  purchaseValue: number | null;
  ctrPercent: number | null;
  cpc: number | null;
  cpm: number | null;
  postClickCvrPercent: number | null;
  platformRoas: number | null;
};

export type ChatgptAdsFunnelSnapshot = {
  range: { key: WebsiteFunnelRangeKey; label: string; startDate: string; endDate: string };
  connection: {
    state: "not_connected" | "ambiguous" | "first_sync" | "live" | "stale" | "error";
    sourceId: string | null;
    accountName: string | null;
    updatedAt: string | null;
    note: string;
  };
  delivery: {
    currency: string | null;
    timeZone: string | null;
    coverage: "complete" | "partial" | "unavailable";
    totals: ChatgptAdsTotals;
    daily: Array<{ date: string; spend: number | null; clicks: number | null; conversions: number | null }>;
    note: string;
  };
  website: {
    stages: WebsiteCommerceFunnelStage[];
    orderState: WebsiteCommerceMeasurementState;
    visitToOrderRatePercent: number | null;
    checkoutToOrderRatePercent: number | null;
    note: string;
  };
  fixture: boolean;
};
