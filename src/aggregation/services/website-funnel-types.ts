import type { SourceStatus } from "@/storage/db/schema";

export type WebsiteFunnelRangeKey = "today" | "7d" | "30d";
export type WebsiteFunnelComparisonMode = "previous" | "off";
export type WebsiteFunnelSegment = "all" | "ready-made" | "builder";
export type WebsiteFunnelDevice = "all" | "desktop" | "mobile" | "tablet" | "bot" | "unknown";
export type WebsiteFunnelTrendMetric =
  | "sessions"
  | "product_intent"
  | "add_to_cart"
  | "checkout"
  | "visit_to_checkout_rate";

export type WebsiteFunnelStageKey =
  | "visit"
  | "product_intent"
  | "add_to_cart"
  | "begin_checkout";

export type WebsiteFunnelSourceState =
  | {
      state: "missing";
      candidateCount: 0;
      displayName: null;
      status: null;
    }
  | {
      state: "ambiguous";
      candidateCount: number;
      displayName: null;
      status: null;
    }
  | {
      state: "ready" | "unhealthy";
      candidateCount: 1;
      displayName: string;
      status: SourceStatus;
    };

export type WebsiteFunnelDataState =
  | "ready"
  | "no_events"
  | "filtered_empty"
  | "pre_coverage"
  | "source_unavailable";

export type WebsiteFunnelStage = {
  key: WebsiteFunnelStageKey;
  label: string;
  description: string;
  measured: boolean;
  sessions: number;
  events: number;
  percentOfStart: number | null;
  fromPrevious: number | null;
  dropOff: number | null;
  previousSessions: number | null;
  deltaPercent: number | null;
};

export type WebsiteFunnelTrendValues = {
  sessions: number | null;
  product_intent: number | null;
  add_to_cart: number | null;
  checkout: number | null;
  visit_to_checkout_rate: number | null;
};

export type WebsiteFunnelTrendPoint = {
  date: string;
  comparisonDate: string | null;
  current: WebsiteFunnelTrendValues;
  previous: WebsiteFunnelTrendValues | null;
};

export type WebsiteJourneyStage = {
  label: string;
  sessions: number;
  events: number;
  fromPrevious: number | null;
};

export type WebsiteReadyMadeJourney = {
  stages: WebsiteJourneyStage[];
};

export type WebsiteBuilderJourney = {
  starts: WebsiteJourneyStage;
  completions: WebsiteJourneyStage;
  saves: WebsiteJourneyStage;
  completionRate: number | null;
  saveRate: number | null;
};

export type WebsiteEmailSignupOutcome = {
  sessions: number;
  visitors: number;
  events: number;
};

export type WebsiteCollectionPerformanceRow = {
  key: string;
  collectionName: string;
  collectionViewSessions: number;
  productViewSessions: number;
  progressionRate: number | null;
  state: "mapped" | "unknown";
};

export type WebsiteProductPerformanceRow = {
  key: string;
  itemId: string | null;
  itemName: string;
  itemCategory: string;
  productViewSessions: number;
  addToCartSessions: number;
  viewToCartRate: number | null;
  identityState: "stable" | "view_only" | "cart_only" | "unknown";
};

export type WebsitePaginatedRows<Row> = {
  rows: Row[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type WebsiteAcquisitionRow = {
  key: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  landingPath: string;
  referrerHost: string;
  sessions: number;
  productIntentSessions: number;
  checkoutSessions: number | null;
  visitToCheckoutRate: number | null;
};

export type WebsiteDeviceRow = {
  device: Exclude<WebsiteFunnelDevice, "all">;
  sessions: number;
  productIntentSessions: number;
  checkoutSessions: number | null;
  visitToCheckoutRate: number | null;
};

export type WebsiteFunnelQuality = {
  duplicateDeliveriesRemoved: number;
  equalTimeIntentSessions: number;
  equalTimeCartSessions: number;
  equalTimeCheckoutSessions: number;
  unsequencedIntentSessions: number;
  unsequencedCartSessions: number;
  unsequencedCheckoutSessions: number;
  unknownEvents: Array<{ eventName: string; events: number }>;
  unknownEventTotalRows: number;
  invalidPropertyEvents: Array<{ eventName: string; events: number }>;
};

export type WebsiteFunnelReconciliation = {
  state: "matched" | "delayed" | "disagrees" | "unavailable";
  rawPageViews: number;
  dailyPageViews: number | null;
  rawCustomEvents: number;
  dailyCustomEvents: number | null;
  note: string;
};

export type WebsiteFunnelFilters = {
  segment: WebsiteFunnelSegment;
  device: WebsiteFunnelDevice;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  landingPath: string;
  referrerHost: string;
};

export type WebsiteFunnelFilterOptions = {
  devices: Exclude<WebsiteFunnelDevice, "all">[];
  utmSources: string[];
  utmMediums: string[];
  utmCampaigns: string[];
  landingPaths: string[];
  referrerHosts: string[];
};

export type WebsiteFunnelOverview = {
  source: WebsiteFunnelSourceState;
  dataState: WebsiteFunnelDataState;
  range: {
    key: WebsiteFunnelRangeKey;
    label: string;
    startDate: string;
    endDate: string;
    startAt: string;
    endExclusive: string;
    timeZone: "America/Los_Angeles";
    partialDay: boolean;
  };
  comparison: {
    mode: WebsiteFunnelComparisonMode;
    available: boolean;
    reason: string | null;
    startAt: string | null;
    endExclusive: string | null;
  };
  coverage: {
    firstOccurredAt: string | null;
    latestReceivedAt: string | null;
    startsDuringSelection: boolean;
  };
  filters: WebsiteFunnelFilters;
  filterOptions: WebsiteFunnelFilterOptions;
  acceptedEvents: number;
  uniqueVisitors: number;
  unfilteredEvents: number;
  stages: WebsiteFunnelStage[];
  trend: WebsiteFunnelTrendPoint[];
  readyMade: WebsiteReadyMadeJourney;
  builder: WebsiteBuilderJourney;
  emailSignup: WebsiteEmailSignupOutcome;
  collections: WebsitePaginatedRows<WebsiteCollectionPerformanceRow>;
  products: WebsitePaginatedRows<WebsiteProductPerformanceRow>;
  acquisition: WebsitePaginatedRows<WebsiteAcquisitionRow>;
  devices: WebsiteDeviceRow[];
  quality: WebsiteFunnelQuality;
  reconciliation: WebsiteFunnelReconciliation;
  lowVolume: boolean;
};
