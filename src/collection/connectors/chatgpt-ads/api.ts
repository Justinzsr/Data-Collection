import "server-only";
import { createHash } from "node:crypto";
import type { JsonRecord } from "@/storage/db/schema";

const API_BASE = "https://api.ads.openai.com/v1";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGES = 100;

export const CHATGPT_ADS_DEFAULT_LOOKBACK_DAYS = 30;
export const CHATGPT_ADS_MAX_LOOKBACK_DAYS = 365;
export const CHATGPT_ADS_ATTRIBUTION = {
  attribution_time_basis: "ad_event_time",
  attribution_window_days: 30,
  view_through_attribution_window_days: 1,
} as const;

export type ChatgptAdsAccount = {
  id: string;
  name: string;
  currency_code: string;
  timezone: string;
  status?: string;
};

type NumericValue = number | string | null;

export type ChatgptAdsInsightRow = {
  id?: string;
  start_time?: number;
  end_time?: number;
  readable_time?: string;
  timezone?: string;
  ad_account_id?: string | null;
  impressions?: NumericValue;
  clicks?: NumericValue;
  spend?: NumericValue;
  ad_account_impressions?: NumericValue;
  ad_account_clicks?: NumericValue;
  ad_account_spend?: NumericValue;
  data_status?: string;
};

export type ChatgptAdsConversionRow = {
  entity_id?: string;
  date?: string;
  conversions?: NumericValue;
  click_through_conversions?: NumericValue;
  view_through_conversions?: NumericValue;
  order_created_attributed_sales?: NumericValue;
  order_created_attributed_sales_currency?: string;
};

export type ChatgptAdsSyncSnapshot = {
  kind: "chatgpt_ads_sync_snapshot";
  account: ChatgptAdsAccount;
  insights: ChatgptAdsInsightRow[];
  conversions: ChatgptAdsConversionRow[];
  conversionCurrency: string | null;
  conversionStatus: "available";
  windowStartDate: string;
  windowEndDate: string;
  attribution: typeof CHATGPT_ADS_ATTRIBUTION;
  fetchedAt: string;
};

export class ChatgptAdsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatgptAdsApiError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function chatgptAdsNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function isChatgptAdsDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function chatgptAdsDateInTimeZone(value: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const date = `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
    if (isChatgptAdsDate(date)) return date;
  } catch {
    // Invalid time zones must not quietly bucket account data in UTC.
  }
  throw new ChatgptAdsApiError("ChatGPT Ads returned an invalid account time zone or reporting date.", 502);
}

function safeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function pickFields(value: JsonRecord, fields: string[]): JsonRecord {
  return Object.fromEntries(fields.filter((field) => field in value).map((field) => [field, value[field]]));
}

export function sanitizeChatgptAdsErrorMessage(value: unknown, apiKey = "") {
  let message = safeText(value, "ChatGPT Ads API request failed.");
  if (apiKey) message = message.split(apiKey).join("[redacted]");
  return message
    .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|access[_-]?token|authorization)[\s"']*[:=][\s"']*)[^\s&;,"']+/giu, "$1[redacted]")
    .slice(0, 500);
}

// Only these read/report routes are supported; there is no ad or budget mutation client.
async function apiRequest(
  path: "/ad_account" | "/ad_account/insights" | "/conversions/insights",
  apiKey: string,
  options: { query?: URLSearchParams; body?: JsonRecord } = {},
): Promise<JsonRecord> {
  const url = new URL(`${API_BASE}${path}`);
  if (options.query) url.search = options.query.toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.body ? "POST" : "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ChatgptAdsApiError("ChatGPT Ads API returned a non-JSON response.", response.ok ? 502 : response.status);
    }
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : null;
      const message = error?.message ?? (isRecord(body) ? body.message : null);
      throw new ChatgptAdsApiError(sanitizeChatgptAdsErrorMessage(message, apiKey), response.status);
    }
    if (!isRecord(body) || isRecord(body.error)) {
      throw new ChatgptAdsApiError("ChatGPT Ads API returned an invalid response.", 502);
    }
    return body;
  } catch (error) {
    if (error instanceof ChatgptAdsApiError) throw error;
    if (controller.signal.aborted) throw new ChatgptAdsApiError("ChatGPT Ads API request timed out.", 504);
    throw new ChatgptAdsApiError(
      sanitizeChatgptAdsErrorMessage(error instanceof Error ? error.message : null, apiKey),
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchChatgptAdsAccount(apiKey: string): Promise<ChatgptAdsAccount> {
  const body = await apiRequest("/ad_account", apiKey);
  if (typeof body.id !== "string" || !body.id.trim() || typeof body.currency_code !== "string" || !/^[A-Z]{3}$/u.test(body.currency_code)) {
    throw new ChatgptAdsApiError("ChatGPT Ads did not return a valid account identity and currency.", 502);
  }
  const timezone = safeText(body.timezone, "");
  chatgptAdsDateInTimeZone(new Date(), timezone);
  return {
    id: body.id,
    name: safeText(body.account_name, safeText(body.name, body.id)),
    currency_code: body.currency_code,
    timezone,
    ...(typeof body.status === "string" ? { status: body.status } : {}),
  };
}

function dateRange(startDate: string, endDate: string, timezone: string) {
  if (!isChatgptAdsDate(startDate) || !isChatgptAdsDate(endDate) || startDate > endDate) {
    throw new ChatgptAdsApiError("ChatGPT Ads reporting dates must be a valid inclusive date range.", 400);
  }
  const duration = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 + 1;
  if (duration > CHATGPT_ADS_MAX_LOOKBACK_DAYS) {
    throw new ChatgptAdsApiError("ChatGPT Ads reporting windows cannot exceed 365 calendar days.", 400);
  }
  return JSON.stringify({ type: "date_range", since: startDate, until: endDate, timezone });
}

export async function fetchChatgptAdsInsights(
  apiKey: string,
  account: ChatgptAdsAccount,
  startDate: string,
  endDate: string,
): Promise<ChatgptAdsInsightRow[]> {
  const query = new URLSearchParams({ aggregation_level: "ad_account", time_granularity: "daily", limit: "2000" });
  query.append("includes[]", "zero_impression_items");
  query.append("time_ranges[]", dateRange(startDate, endDate, account.timezone));
  for (const field of ["metadata.readable_time", "metadata.timezone", "ad_account.id", "ad_account.impressions", "ad_account.clicks", "ad_account.spend"]) {
    query.append("fields[]", field);
  }
  const rows: ChatgptAdsInsightRow[] = [];
  const visited = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await apiRequest("/ad_account/insights", apiKey, { query });
    if (!Array.isArray(body.data) || body.data.some((row) => !isRecord(row)) || typeof body.has_more !== "boolean") {
      throw new ChatgptAdsApiError("ChatGPT Ads insights returned an invalid page.", 502);
    }
    rows.push(...body.data.map((row) => pickFields(row as JsonRecord, [
      "id", "start_time", "end_time", "readable_time", "timezone", "ad_account_id",
      "impressions", "clicks", "spend", "ad_account_impressions", "ad_account_clicks", "ad_account_spend", "data_status",
    ])) as ChatgptAdsInsightRow[]);
    if (!body.has_more) return rows;
    const cursor = body.last_id;
    if (typeof cursor !== "string" || !cursor || visited.has(cursor)) {
      throw new ChatgptAdsApiError("ChatGPT Ads insights pagination did not advance.", 502);
    }
    visited.add(cursor);
    query.set("after", cursor);
  }
  throw new ChatgptAdsApiError("ChatGPT Ads insights exceeded the safe page limit.", 502);
}

export async function fetchChatgptAdsConversions(
  apiKey: string,
  account: ChatgptAdsAccount,
  startDate: string,
  endDate: string,
): Promise<{ rows: ChatgptAdsConversionRow[]; currency: string | null }> {
  const body = await apiRequest("/conversions/insights", apiKey, {
    body: {
      aggregation_level: "campaign",
      group_by_entity: false,
      time_granularity: "daily",
      time_ranges: [dateRange(startDate, endDate, account.timezone)],
      ...CHATGPT_ADS_ATTRIBUTION,
    },
  });
  if (!Array.isArray(body.data) || body.data.some((row) => !isRecord(row))) {
    throw new ChatgptAdsApiError("ChatGPT Ads conversion insights returned invalid rows.", 502);
  }
  // Account grouping yields at most 365 daily rows, below the non-paginated 2,000-row limit.
  return {
    rows: body.data.map((row) => pickFields(row as JsonRecord, [
      "entity_id", "date", "conversions", "click_through_conversions", "view_through_conversions",
      "order_created_attributed_sales", "order_created_attributed_sales_currency",
    ])) as ChatgptAdsConversionRow[],
    currency: typeof body.account_currency === "string" ? body.account_currency : null,
  };
}

export async function fetchChatgptAdsSnapshot(input: {
  apiKey: string;
  account: ChatgptAdsAccount;
  startDate: string;
  endDate: string;
  fetchedAt?: string;
}): Promise<ChatgptAdsSyncSnapshot> {
  const [insights, conversions] = await Promise.all([
    fetchChatgptAdsInsights(input.apiKey, input.account, input.startDate, input.endDate),
    fetchChatgptAdsConversions(input.apiKey, input.account, input.startDate, input.endDate),
  ]);
  return {
    kind: "chatgpt_ads_sync_snapshot",
    account: input.account,
    insights,
    conversions: conversions.rows,
    conversionCurrency: conversions.currency,
    conversionStatus: "available",
    windowStartDate: input.startDate,
    windowEndDate: input.endDate,
    attribution: CHATGPT_ADS_ATTRIBUTION,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
  };
}

export function isChatgptAdsSyncSnapshot(value: unknown): value is ChatgptAdsSyncSnapshot {
  return isRecord(value) && value.kind === "chatgpt_ads_sync_snapshot" && isRecord(value.account)
    && typeof value.account.id === "string" && typeof value.account.timezone === "string"
    && typeof value.account.currency_code === "string" && Array.isArray(value.insights)
    && Array.isArray(value.conversions) && isChatgptAdsDate(value.windowStartDate)
    && isChatgptAdsDate(value.windowEndDate) && typeof value.fetchedAt === "string";
}

export function hashChatgptAdsSnapshot(snapshot: ChatgptAdsSyncSnapshot) {
  // Fetch time is provenance, not source content; identical responses remain deduplicable.
  return createHash("sha256").update(JSON.stringify({ ...snapshot, fetchedAt: undefined })).digest("hex");
}
