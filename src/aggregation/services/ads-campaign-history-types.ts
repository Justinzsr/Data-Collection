export type AdsHistoryPlatform = "meta_ads" | "chatgpt_ads";

export type AdsHistoryTotals = {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
};

export type AdsCampaignHistorySnapshot = {
  platform: AdsHistoryPlatform;
  state: "ready" | "partial" | "stale" | "unavailable" | "ambiguous";
  sourceId: string | null;
  accountName: string | null;
  currency: string | null;
  timeZone: string | null;
  clickLabel: "All clicks" | "Ad clicks";
  coverage: {
    basis: "official_available_history" | "collected_history";
    startDate: string | null;
    endDate: string | null;
    note: string;
  };
  totals: AdsHistoryTotals;
  campaigns: Array<AdsHistoryTotals & { key: string; name: string; startDate: string | null; endDate: string | null }>;
  updatedAt: string | null;
  note: string;
};
