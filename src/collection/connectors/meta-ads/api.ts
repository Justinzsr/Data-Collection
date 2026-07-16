import { createHash } from "node:crypto";
import type { JsonRecord } from "@/storage/db/schema";

export const META_ADS_GRAPH_API_VERSION = "v25.0";
export const META_ADS_DEFAULT_LOOKBACK_DAYS = 30;
export const META_ADS_MAX_LOOKBACK_DAYS = 90;

const META_GRAPH_HOSTNAME = "graph.facebook.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 100;

export type MetaAdsConfig = {
  graphApiVersion: string;
};

export type MetaAdAccount = {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  timezone_offset_hours_utc?: number;
};

export type MetaAdMetadata = {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  campaign?: {
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    objective?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    budget_remaining?: string;
    buying_type?: string;
  };
  adset?: {
    id?: string;
    name?: string;
    status?: string;
    effective_status?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    budget_remaining?: string;
    start_time?: string;
    end_time?: string;
    billing_event?: string;
    optimization_goal?: string;
    destination_type?: string;
  };
  creative?: {
    id?: string;
    name?: string;
    url_tags?: string;
    object_url?: string;
    object_type?: string;
  };
};

export type MetaAdsActionValue = {
  action_type?: string;
  value?: string | number;
};

export type MetaAdsInsightRow = {
  account_id?: string;
  account_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  date_stop?: string;
  attribution_setting?: string;
  impressions?: string | number;
  reach?: string | number;
  frequency?: string | number;
  clicks?: string | number;
  outbound_clicks?: MetaAdsActionValue[];
  inline_link_clicks?: string | number;
  ctr?: string | number;
  cpc?: string | number;
  cpm?: string | number;
  spend?: string | number;
  actions?: MetaAdsActionValue[];
  action_values?: MetaAdsActionValue[];
  cost_per_action_type?: MetaAdsActionValue[];
  purchase_roas?: MetaAdsActionValue[];
  website_purchase_roas?: MetaAdsActionValue[];
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
  video_p25_watched_actions?: MetaAdsActionValue[];
  video_p50_watched_actions?: MetaAdsActionValue[];
  video_p75_watched_actions?: MetaAdsActionValue[];
  video_p95_watched_actions?: MetaAdsActionValue[];
  video_p100_watched_actions?: MetaAdsActionValue[];
  video_thruplay_watched_actions?: MetaAdsActionValue[];
};

export type MetaAdsSyncSnapshot = {
  kind: "meta_ads_sync_snapshot";
  account: MetaAdAccount;
  ads: MetaAdMetadata[];
  insights: MetaAdsInsightRow[];
  graphApiVersion: string;
  windowStartDate: string;
  windowEndDate: string;
  fetchedAt: string;
};

type GraphCollection<T> = {
  data?: T[];
  paging?: {
    next?: string;
  };
};

export class MetaAdsGraphApiError extends Error {
  status: number;
  code?: number;
  errorType?: string;

  constructor(message: string, options: { status: number; code?: number; errorType?: string }) {
    super(message);
    this.name = "MetaAdsGraphApiError";
    this.status = options.status;
    this.code = options.code;
    this.errorType = options.errorType;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeMetaAdsErrorMessage(value: unknown) {
  const message = typeof value === "string" && value.trim() ? value.trim() : "Meta Ads Graph API request failed.";
  return message
    .replace(/access_token=[^&\s]+/giu, "access_token=[redacted]")
    .replace(/client_secret=[^&\s]+/giu, "client_secret=[redacted]")
    .replace(/appsecret_proof=[^&\s]+/giu, "appsecret_proof=[redacted]")
    .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [redacted]");
}

function graphVersion(value?: string | null) {
  const version = value?.trim() || META_ADS_GRAPH_API_VERSION;
  if (!/^v\d+\.\d+$/u.test(version)) {
    throw new Error("Meta Ads Graph API version must use the vNN.N format.");
  }
  return version;
}

export function getMetaAdsConfig(credentials: Record<string, string>, env: NodeJS.ProcessEnv = process.env): MetaAdsConfig {
  return {
    graphApiVersion: graphVersion(
      credentials.meta_ads_graph_api_version ||
        env.META_ADS_GRAPH_API_VERSION ||
        env.MOONARQ_META_GRAPH_API_VERSION ||
        env.META_GRAPH_API_VERSION,
    ),
  };
}

export function selectMetaAdsAccessToken(credentials: Record<string, string>) {
  return credentials.meta_ads_long_lived_access_token || credentials.meta_ads_access_token || "";
}

export function isMetaAdsTokenExpired(credentials: Record<string, string>, now = new Date()) {
  const expiresAt = credentials.meta_ads_expires_at;
  if (!expiresAt) return false;
  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

export function normalizeMetaAdAccountId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Meta ad account ID is required.");
  const bare = trimmed.replace(/^act_/u, "");
  if (!/^\d+$/u.test(bare)) throw new Error("Meta ad account ID must contain digits only.");
  return `act_${bare}`;
}

function graphUrl(config: MetaAdsConfig, path: string) {
  return new URL(`https://${META_GRAPH_HOSTNAME}/${config.graphApiVersion}${path.startsWith("/") ? path : `/${path}`}`);
}

function stripSensitiveQuery(url: URL) {
  const safe = new URL(url.toString());
  safe.searchParams.delete("access_token");
  safe.searchParams.delete("client_secret");
  safe.searchParams.delete("appsecret_proof");
  if (safe.protocol !== "https:" || safe.hostname !== META_GRAPH_HOSTNAME) {
    throw new MetaAdsGraphApiError("Meta Ads pagination returned an unexpected host.", { status: 502 });
  }
  return safe;
}

async function readGraphJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: "Meta Ads Graph API returned a non-JSON response." } };
  }
}

async function graphFetch<T>(url: URL, accessToken: string): Promise<T> {
  const safeUrl = stripSensitiveQuery(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(safeUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });
    const body = await readGraphJson(response);
    if (!response.ok || (isRecord(body) && isRecord(body.error))) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : {};
      throw new MetaAdsGraphApiError(sanitizeMetaAdsErrorMessage(error.message), {
        status: response.status,
        code: typeof error.code === "number" ? error.code : undefined,
        errorType: typeof error.type === "string" ? error.type : undefined,
      });
    }
    return body as T;
  } catch (error) {
    if (error instanceof MetaAdsGraphApiError) throw error;
    if (controller.signal.aborted) {
      throw new MetaAdsGraphApiError("Meta Ads Graph API request timed out.", { status: 504 });
    }
    throw new MetaAdsGraphApiError(sanitizeMetaAdsErrorMessage(error instanceof Error ? error.message : error), { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPaginated<T>(initialUrl: URL, accessToken: string): Promise<T[]> {
  const rows: T[] = [];
  const visited = new Set<string>();
  let next: URL | null = initialUrl;
  let pages = 0;

  while (next) {
    const safeUrl = stripSensitiveQuery(next);
    const key = safeUrl.toString();
    if (visited.has(key)) throw new MetaAdsGraphApiError("Meta Ads pagination repeated the same page.", { status: 502 });
    if (pages >= MAX_PAGES) throw new MetaAdsGraphApiError("Meta Ads pagination exceeded the safe page limit.", { status: 502 });
    visited.add(key);
    pages += 1;

    const page: GraphCollection<T> = await graphFetch<GraphCollection<T>>(safeUrl, accessToken);
    if (Array.isArray(page.data)) rows.push(...page.data);
    next = page.paging?.next ? stripSensitiveQuery(new URL(page.paging.next, safeUrl)) : null;
  }
  return rows;
}

export async function fetchMetaAdAccounts(accessToken: string, config: MetaAdsConfig) {
  const url = graphUrl(config, "/me/adaccounts");
  url.searchParams.set("fields", "id,account_id,name,account_status,currency,timezone_name,timezone_offset_hours_utc");
  url.searchParams.set("limit", "100");
  return fetchPaginated<MetaAdAccount>(url, accessToken);
}

export async function fetchMetaAds(accessToken: string, config: MetaAdsConfig, adAccountId: string) {
  const url = graphUrl(config, `/${normalizeMetaAdAccountId(adAccountId)}/ads`);
  url.searchParams.set(
    "fields",
    "id,name,status,effective_status,campaign{id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,buying_type},adset{id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,billing_event,optimization_goal,destination_type},creative{id,name,url_tags,object_url,object_type}",
  );
  url.searchParams.set("limit", "100");
  return fetchPaginated<MetaAdMetadata>(url, accessToken);
}

export const META_ADS_INSIGHT_FIELDS = [
  "account_id",
  "account_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "attribution_setting",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "outbound_clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
  "cost_per_action_type",
  "purchase_roas",
  "website_purchase_roas",
  "quality_ranking",
  "engagement_rate_ranking",
  "conversion_rate_ranking",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
] as const;

export async function fetchMetaAdsInsights(
  accessToken: string,
  config: MetaAdsConfig,
  adAccountId: string,
  startDate: string,
  endDate: string,
) {
  const url = graphUrl(config, `/${normalizeMetaAdAccountId(adAccountId)}/insights`);
  url.searchParams.set("fields", META_ADS_INSIGHT_FIELDS.join(","));
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since: startDate, until: endDate }));
  url.searchParams.set("use_account_attribution_setting", "true");
  url.searchParams.set("limit", "100");
  return fetchPaginated<MetaAdsInsightRow>(url, accessToken);
}

export async function fetchMetaAdsSnapshot(input: {
  accessToken: string;
  config: MetaAdsConfig;
  account: MetaAdAccount;
  startDate: string;
  endDate: string;
  fetchedAt?: string;
}): Promise<MetaAdsSyncSnapshot> {
  const [ads, insights] = await Promise.all([
    fetchMetaAds(input.accessToken, input.config, input.account.id),
    fetchMetaAdsInsights(input.accessToken, input.config, input.account.id, input.startDate, input.endDate),
  ]);
  return {
    kind: "meta_ads_sync_snapshot",
    account: input.account,
    ads,
    insights,
    graphApiVersion: input.config.graphApiVersion,
    windowStartDate: input.startDate,
    windowEndDate: input.endDate,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
  };
}

export function parseMetaAdsUrlTags(value?: string | null): JsonRecord {
  if (!value?.trim()) return {};
  const decodedSeparators = value.trim().replace(/&amp;/giu, "&");
  let query = decodedSeparators.replace(/^\?/u, "");
  try {
    const asUrl = new URL(decodedSeparators);
    query = asUrl.search.slice(1);
  } catch {
    // Creative url_tags is normally a query string rather than a complete URL.
  }
  const params = new URLSearchParams(query);
  const dimensions: JsonRecord = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const parameter = params.get(key)?.trim();
    if (parameter) dimensions[key] = parameter.slice(0, 500);
  }
  return dimensions;
}

export function metaAdsActionValue(actions: MetaAdsActionValue[] | undefined, preferredActionTypes: readonly string[]) {
  for (const actionType of preferredActionTypes) {
    const item = actions?.find((action) => action.action_type === actionType);
    if (!item) continue;
    const value = Number(item.value);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function isMetaAdsSyncSnapshot(value: unknown): value is MetaAdsSyncSnapshot {
  return (
    isRecord(value) &&
    value.kind === "meta_ads_sync_snapshot" &&
    isRecord(value.account) &&
    Array.isArray(value.ads) &&
    Array.isArray(value.insights) &&
    typeof value.windowStartDate === "string" &&
    typeof value.windowEndDate === "string" &&
    typeof value.fetchedAt === "string"
  );
}

export function hashMetaAdsSnapshot(payload: MetaAdsSyncSnapshot) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
