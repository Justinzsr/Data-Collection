export const WEBSITE_COMMERCE_FUNNEL_V2_DEFINITION = "website-commerce-funnel-v2" as const;

export type WebsiteCommerceMeasurementState = "not_measured" | "partial" | "healthy";
export type WebsiteCommerceFreshnessState = "unavailable" | "fresh" | "stale";
export type WebsiteCommerceCoverageState =
  | "unavailable"
  | "pre_coverage"
  | "partial"
  | "complete";

export type WebsiteCommerceRangeKey = "today" | "7d" | "30d";
export type WebsiteCommerceSegment = "all" | "ready-made" | "builder";

export type WebsiteCommerceMetric<Value extends number | string = number> = {
  value: Value | null;
  state: WebsiteCommerceMeasurementState;
  authority: "website" | "shopify" | "meta" | "derived";
  note: string;
};

export type WebsiteCommerceSourceReadiness = {
  label: "Website Tracker" | "Shopify" | "Meta Ads";
  authority: string;
  cadence: "realtime" | "hourly";
  state: WebsiteCommerceMeasurementState;
  freshness: WebsiteCommerceFreshnessState;
  coverage: WebsiteCommerceCoverageState;
  asOf: string | null;
  note: string;
};

export type WebsiteCommerceMoneyGroup = {
  currency: string;
  orders: number;
  grossSales: string;
  currentTotal: string;
  netPayment: string;
  refunds: string;
  state: WebsiteCommerceMeasurementState;
};

export type WebsiteCommerceFunnelStage = {
  key: "visit" | "product_intent" | "add_to_cart" | "begin_checkout" | "shopify_order";
  label: string;
  authority: "website" | "shopify";
  count: number | null;
  state: WebsiteCommerceMeasurementState;
  fromPrevious: number | null;
  note: string;
};

export type WebsiteCommerceFunnelV2Snapshot = {
  schemaVersion: 1;
  definitionVersion: typeof WEBSITE_COMMERCE_FUNNEL_V2_DEFINITION;
  generatedAt: string;
  state: WebsiteCommerceMeasurementState;
  reasonCode:
    | "ready"
    | "feature_disabled"
    | "facts_disabled"
    | "source_unavailable"
    | "migration_unavailable"
    | "coverage_incomplete"
    | "source_stale";
  reason: string;
  range: {
    key: WebsiteCommerceRangeKey;
    label: string;
    startAt: string | null;
    endExclusive: string | null;
    timeZone: "America/Los_Angeles";
    segment: WebsiteCommerceSegment;
  };
  sources: {
    website: WebsiteCommerceSourceReadiness;
    shopify: WebsiteCommerceSourceReadiness;
    meta: WebsiteCommerceSourceReadiness;
  };
  funnel: WebsiteCommerceFunnelStage[];
  commerce: {
    eligibleCheckoutEvents: WebsiteCommerceMetric;
    linkedOrdersPlaced: WebsiteCommerceMetric;
    activeLinkedOrders: WebsiteCommerceMetric;
    cancelledLinkedOrders: WebsiteCommerceMetric;
    linkedOrderRatePercent: WebsiteCommerceMetric;
    linkCoveragePercent: WebsiteCommerceMetric;
    money: WebsiteCommerceMoneyGroup[];
  };
  builder: {
    linkedOrderLines: WebsiteCommerceMetric;
    itemLinkCoveragePercent: WebsiteCommerceMetric;
  };
  diagnostics: {
    excludedBotSessions: WebsiteCommerceMetric;
    excludedNonProductionSessions: WebsiteCommerceMetric;
    eligibleShopifyOrders: WebsiteCommerceMetric;
    bridgeMatchedOrders: WebsiteCommerceMetric;
    bridgeMissingOrders: WebsiteCommerceMetric;
    bridgeInvalidOrders: WebsiteCommerceMetric;
    bridgeAmbiguousOrders: WebsiteCommerceMetric;
    consentBlockedOrders: WebsiteCommerceMetric;
    reversedTimestampOrders: WebsiteCommerceMetric;
    preCoverageOrders: WebsiteCommerceMetric;
  };
  meta: {
    impressions: WebsiteCommerceMetric;
    linkClicks: WebsiteCommerceMetric;
    platformPurchases: WebsiteCommerceMetric;
    spend: Array<{
      currency: string;
      value: string;
      state: WebsiteCommerceMeasurementState;
    }>;
    note: string;
  };
  caveats: string[];
};
