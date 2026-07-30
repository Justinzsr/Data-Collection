export const MOONARQ_OVERVIEW_RANGES = ["today", "7d", "30d"] as const;
export const MOONARQ_OVERVIEW_COMPARISONS = ["previous", "off"] as const;
export const MOONARQ_OVERVIEW_SEGMENTS = ["all", "ready-made", "builder"] as const;
export const MOONARQ_OVERVIEW_TRENDS = [
  "sessions",
  "product_intent",
  "add_to_cart",
  "checkout",
  "visit_to_checkout_rate",
] as const;
export const MOONARQ_OVERVIEW_DEVICES = ["all", "desktop", "mobile", "tablet", "bot", "unknown"] as const;
export const MOONARQ_OVERVIEW_DEMO_STATES = ["populated", "empty", "low-volume"] as const;

export const MOONARQ_OVERVIEW_FILTER_LIMITS = {
  utm: 256,
  landingPath: 500,
  referrerHost: 253,
  productPage: 401,
} as const;

export type MoonArqOverviewQuery = {
  range: (typeof MOONARQ_OVERVIEW_RANGES)[number];
  compare: (typeof MOONARQ_OVERVIEW_COMPARISONS)[number];
  segment: (typeof MOONARQ_OVERVIEW_SEGMENTS)[number];
  trend: (typeof MOONARQ_OVERVIEW_TRENDS)[number];
  device: (typeof MOONARQ_OVERVIEW_DEVICES)[number];
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  landing_path: string;
  referrer_host: string;
  collection_page: number;
  product_page: number;
  acquisition_page: number;
  demo_state: (typeof MOONARQ_OVERVIEW_DEMO_STATES)[number];
};

export type MoonArqOverviewQueryPatch = Partial<MoonArqOverviewQuery>;

export const DEFAULT_MOONARQ_OVERVIEW_QUERY: MoonArqOverviewQuery = {
  range: "30d",
  compare: "previous",
  segment: "all",
  trend: "sessions",
  device: "all",
  utm_source: "",
  utm_medium: "",
  utm_campaign: "",
  landing_path: "",
  referrer_host: "",
  collection_page: 1,
  product_page: 1,
  acquisition_page: 1,
  demo_state: "populated",
};

type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

const analyticFilterKeys = [
  "range",
  "compare",
  "segment",
  "trend",
  "device",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "landing_path",
  "referrer_host",
  "demo_state",
] as const satisfies readonly (keyof MoonArqOverviewQuery)[];

function singleValue(input: SearchParamsInput, key: string) {
  if (input instanceof URLSearchParams) {
    const values = input.getAll(key);
    return values.length === 1 ? values[0] : undefined;
  }
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function allowlistedValue<const Values extends readonly string[]>(
  value: string | undefined,
  values: Values,
  fallback: Values[number],
): Values[number] {
  return value !== undefined && (values as readonly string[]).includes(value)
    ? value as Values[number]
    : fallback;
}

function boundedText(value: string | undefined, maximumLength: number) {
  return (value ?? "").trim().slice(0, maximumLength);
}

function tablePage(value: string | undefined) {
  if (!value || !/^\d+$/u.test(value)) return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MOONARQ_OVERVIEW_FILTER_LIMITS.productPage);
}

export function parseMoonArqOverviewQuery(input: SearchParamsInput): MoonArqOverviewQuery {
  return {
    range: allowlistedValue(
      singleValue(input, "range"),
      MOONARQ_OVERVIEW_RANGES,
      DEFAULT_MOONARQ_OVERVIEW_QUERY.range,
    ),
    compare: allowlistedValue(
      singleValue(input, "compare"),
      MOONARQ_OVERVIEW_COMPARISONS,
      DEFAULT_MOONARQ_OVERVIEW_QUERY.compare,
    ),
    segment: allowlistedValue(
      singleValue(input, "segment"),
      MOONARQ_OVERVIEW_SEGMENTS,
      DEFAULT_MOONARQ_OVERVIEW_QUERY.segment,
    ),
    trend: allowlistedValue(
      singleValue(input, "trend"),
      MOONARQ_OVERVIEW_TRENDS,
      DEFAULT_MOONARQ_OVERVIEW_QUERY.trend,
    ),
    device: allowlistedValue(
      singleValue(input, "device"),
      MOONARQ_OVERVIEW_DEVICES,
      DEFAULT_MOONARQ_OVERVIEW_QUERY.device,
    ),
    utm_source: boundedText(singleValue(input, "utm_source"), MOONARQ_OVERVIEW_FILTER_LIMITS.utm),
    utm_medium: boundedText(singleValue(input, "utm_medium"), MOONARQ_OVERVIEW_FILTER_LIMITS.utm),
    utm_campaign: boundedText(singleValue(input, "utm_campaign"), MOONARQ_OVERVIEW_FILTER_LIMITS.utm),
    landing_path: boundedText(singleValue(input, "landing_path"), MOONARQ_OVERVIEW_FILTER_LIMITS.landingPath),
    referrer_host: boundedText(singleValue(input, "referrer_host"), MOONARQ_OVERVIEW_FILTER_LIMITS.referrerHost),
    collection_page: tablePage(singleValue(input, "collection_page")),
    product_page: tablePage(singleValue(input, "product_page")),
    acquisition_page: tablePage(singleValue(input, "acquisition_page")),
    demo_state: allowlistedValue(
      singleValue(input, "demo_state"),
      MOONARQ_OVERVIEW_DEMO_STATES,
      DEFAULT_MOONARQ_OVERVIEW_QUERY.demo_state,
    ),
  };
}

function queryToSearchParams(query: MoonArqOverviewQuery) {
  const params = new URLSearchParams();
  if (query.range !== DEFAULT_MOONARQ_OVERVIEW_QUERY.range) params.set("range", query.range);
  if (query.compare !== DEFAULT_MOONARQ_OVERVIEW_QUERY.compare) params.set("compare", query.compare);
  if (query.segment !== DEFAULT_MOONARQ_OVERVIEW_QUERY.segment) params.set("segment", query.segment);
  if (query.trend !== DEFAULT_MOONARQ_OVERVIEW_QUERY.trend) params.set("trend", query.trend);
  if (query.device !== DEFAULT_MOONARQ_OVERVIEW_QUERY.device) params.set("device", query.device);
  if (query.utm_source) params.set("utm_source", query.utm_source);
  if (query.utm_medium) params.set("utm_medium", query.utm_medium);
  if (query.utm_campaign) params.set("utm_campaign", query.utm_campaign);
  if (query.landing_path) params.set("landing_path", query.landing_path);
  if (query.referrer_host) params.set("referrer_host", query.referrer_host);
  if (query.collection_page !== DEFAULT_MOONARQ_OVERVIEW_QUERY.collection_page) {
    params.set("collection_page", String(query.collection_page));
  }
  if (query.product_page !== DEFAULT_MOONARQ_OVERVIEW_QUERY.product_page) {
    params.set("product_page", String(query.product_page));
  }
  if (query.acquisition_page !== DEFAULT_MOONARQ_OVERVIEW_QUERY.acquisition_page) {
    params.set("acquisition_page", String(query.acquisition_page));
  }
  if (query.demo_state !== DEFAULT_MOONARQ_OVERVIEW_QUERY.demo_state) {
    params.set("demo_state", query.demo_state);
  }
  return params;
}

function queryAsInput(query: MoonArqOverviewQuery): Record<string, string> {
  return {
    range: query.range,
    compare: query.compare,
    segment: query.segment,
    trend: query.trend,
    device: query.device,
    utm_source: query.utm_source,
    utm_medium: query.utm_medium,
    utm_campaign: query.utm_campaign,
    landing_path: query.landing_path,
    referrer_host: query.referrer_host,
    collection_page: String(query.collection_page),
    product_page: String(query.product_page),
    acquisition_page: String(query.acquisition_page),
    demo_state: query.demo_state,
  };
}

export function buildMoonArqOverviewHref(
  basePath: string,
  current: MoonArqOverviewQuery,
  patch: MoonArqOverviewQueryPatch = {},
) {
  const normalizedCurrent = parseMoonArqOverviewQuery(queryAsInput(current));
  const normalizedNext = parseMoonArqOverviewQuery(queryAsInput({ ...normalizedCurrent, ...patch }));
  const analyticFilterChanged = analyticFilterKeys.some(
    (key) => Object.hasOwn(patch, key) && normalizedNext[key] !== normalizedCurrent[key],
  );
  const next = analyticFilterChanged
    ? {
        ...normalizedNext,
        collection_page: DEFAULT_MOONARQ_OVERVIEW_QUERY.collection_page,
        product_page: DEFAULT_MOONARQ_OVERVIEW_QUERY.product_page,
        acquisition_page: DEFAULT_MOONARQ_OVERVIEW_QUERY.acquisition_page,
      }
    : normalizedNext;
  const search = queryToSearchParams(next).toString();
  return `${basePath}${search ? `?${search}` : ""}`;
}
