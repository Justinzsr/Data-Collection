import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHATGPT_ADS_ATTRIBUTION,
  chatgptAdsNumber,
  fetchChatgptAdsAccount,
  fetchChatgptAdsConversions,
  fetchChatgptAdsInsights,
  hashChatgptAdsSnapshot,
  type ChatgptAdsAccount,
  type ChatgptAdsInsightRow,
  type ChatgptAdsSyncSnapshot,
} from "@/collection/connectors/chatgpt-ads/api";
import { CHATGPT_ADS_METRIC_KEYS, chatgptAdsConnector, chatgptAdsMetricWindow } from "@/collection/connectors/chatgpt-ads/connector";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { updateSource } from "@/storage/repositories/sources-repository";

vi.mock("@/storage/repositories/sources-repository", () => ({ updateSource: vi.fn() }));

const API_KEY = "test-only-advertiser-api-key";
const account: ChatgptAdsAccount = { id: "adacct_test", name: "Test advertiser", currency_code: "USD", timezone: "America/Los_Angeles", status: "active" };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function source(externalAccountId: string | null = account.id): Source {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    data_space_id: "22222222-2222-4222-8222-222222222222",
    source_type_key: "chatgpt_ads",
    display_name: "ChatGPT Ads test",
    input_url: "https://ads.openai.com/",
    normalized_url: "https://ads.openai.com/",
    external_account_id: externalAccountId,
    account_name: "Test advertiser",
    status: "healthy",
    sync_mode: "hourly",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    next_sync_at: null,
    metadata: externalAccountId ? { account_timezone: account.timezone, account_currency: account.currency_code } : {},
    created_at: "2026-11-13T00:00:00.000Z",
    updated_at: "2026-11-13T00:00:00.000Z",
  };
}

function snapshot(overrides: Partial<ChatgptAdsSyncSnapshot> = {}): ChatgptAdsSyncSnapshot {
  return {
    kind: "chatgpt_ads_sync_snapshot",
    account,
    insights: [{ readable_time: "2026-11-13", ad_account_id: account.id, spend: 12.5, clicks: 50, impressions: 1_000 }],
    conversions: [{ entity_id: account.id, date: "2026-11-13", conversions: 4, click_through_conversions: 3, view_through_conversions: 1, order_created_attributed_sales: "125.75", order_created_attributed_sales_currency: "USD" }],
    conversionCurrency: "USD",
    conversionStatus: "available",
    windowStartDate: "2026-10-15",
    windowEndDate: "2026-11-13",
    attribution: CHATGPT_ADS_ATTRIBUTION,
    fetchedAt: "2026-11-13T12:00:00.000Z",
    ...overrides,
  };
}

async function normalize(data: ChatgptAdsSyncSnapshot) {
  return chatgptAdsConnector.normalize([{ fetchedAt: data.fetchedAt, payload: data as unknown as JsonRecord }], source());
}

function utcZeroRow(overrides: Partial<ChatgptAdsInsightRow> = {}): ChatgptAdsInsightRow {
  return { readable_time: "2026-11-13", start_time: 1794556800, end_time: 1794643200,
    timezone: "UTC", ad_account_id: account.id, spend: "0", clicks: "0", impressions: "0", ...overrides };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ChatGPT Ads source and authentication", () => {
  it("recognizes only the official HTTPS host and discards sensitive URL components", () => {
    expect(chatgptAdsConnector.detect(`https://ads.openai.com/campaigns?api_key=${API_KEY}#token`)).toMatchObject({ sourceTypeKey: "chatgpt_ads", normalizedUrl: "https://ads.openai.com/", demoAvailable: false });
    for (const url of ["http://ads.openai.com", "https://ads.openai.com.evil.example", "https://example.com/ads.openai.com", "https://user:password@ads.openai.com", "https://ads.openai.com:8443"]) {
      expect(chatgptAdsConnector.detect(url)).toBeNull();
    }
  });

  it("does not send a request until the source has its own encrypted credential", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await chatgptAdsConnector.testConnection({ source: source(), credentials: {}, isDemoMode: false });
    expect(result.status).toBe("needs_credentials");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(chatgptAdsConnector.sync({ source: source(), credentials: {}, isDemoMode: false, trigger: "manual" })).rejects.toThrow("credentials are missing");
  });

  it("uses the account-scoped API key only in the header and projects account metadata", async () => {
    const fetchMock = vi.fn(async () => response({ ...account, account_name: "Internal test name", api_key: API_KEY }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchChatgptAdsAccount(API_KEY);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.ads.openai.com/v1/ad_account");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(result.name).toBe("Internal test name");
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it("rejects missing currency and invalid timezone instead of applying a currency/timezone fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...account, currency_code: null })));
    await expect(fetchChatgptAdsAccount(API_KEY)).rejects.toThrow("identity and currency");
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...account, timezone: "not-a-timezone" })));
    await expect(fetchChatgptAdsAccount(API_KEY)).rejects.toThrow("time zone");
  });

  it("rejects an API key for a different source account before requesting any reports", async () => {
    const fetchMock = vi.fn(async () => response({ ...account, id: "adacct_other" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await chatgptAdsConnector.testConnection({ source: source(), credentials: { chatgpt_ads_api_key: API_KEY }, isDemoMode: false });
    expect(result).toMatchObject({ ok: false, status: "error" });
    expect(result.message).toContain("different account");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redacts exact credentials and authorization strings from API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: { message: `Bad api_key=${API_KEY}; Authorization: Bearer ${API_KEY}` } }, 401)));
    const result = await chatgptAdsConnector.testConnection({ source: source(), credentials: { chatgpt_ads_api_key: API_KEY }, isDemoMode: false });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(result.message).toContain("[redacted]");
  });
});

describe("ChatGPT Ads read-only reports", () => {
  it("requests canonical account/day fields, follows cursors and never sends credentials in a URL", async () => {
    const requests: { url: URL; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init?: RequestInit) => {
      requests.push({ url: new URL(input), init });
      return input.searchParams.has("after")
        ? response({ object: "list", data: [{ readable_time: "2026-11-13", clicks: 2 }], has_more: false, last_id: null })
        : response({ object: "list", data: [{ readable_time: "2026-11-12", spend: 4.5, unexpected_api_key: API_KEY }], has_more: true, last_id: "cursor-one" });
    }));
    const rows = await fetchChatgptAdsInsights(API_KEY, account, "2026-11-12", "2026-11-13");
    expect(rows).toEqual([{ readable_time: "2026-11-12", spend: 4.5 }, { readable_time: "2026-11-13", clicks: 2 }]);
    expect(requests[0].url.searchParams.get("aggregation_level")).toBe("ad_account");
    expect(requests[0].url.searchParams.get("fields[]")).toBe("metadata.readable_time");
    expect(requests[0].url.searchParams.getAll("fields[]")).toContain("ad_account.spend");
    expect(JSON.parse(requests[0].url.searchParams.get("time_ranges[]")!)).toEqual({ type: "date_range", since: "2026-11-12", until: "2026-11-13", timezone: account.timezone });
    expect(requests[1].url.searchParams.get("after")).toBe("cursor-one");
    expect(requests.every(({ url }) => url.searchParams.getAll("includes[]").join() === "zero_impression_items"
      && !url.searchParams.has("segments[]"))).toBe(true);
    expect(requests.every(({ url, init }) => !url.toString().includes(API_KEY) && init?.method === "GET")).toBe(true);
  });

  it("requests official zero-delivery rows and normalizes explicit zeros without filling null or absent metrics", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => response({
      object: "list",
      data: input.searchParams.getAll("includes[]").includes("zero_impression_items") ? [
        { readable_time: "2026-11-12", ad_account_id: account.id, impressions: 0, clicks: "0", spend: "0" },
        { readable_time: "2026-11-13", ad_account_id: account.id, impressions: null, spend: null },
      ] : [],
      has_more: false,
      last_id: null,
    })));
    const insights = await fetchChatgptAdsInsights(API_KEY, account, "2026-11-12", "2026-11-13");
    const result = await normalize(snapshot({ insights, conversions: [] }));
    expect(result.metrics).toHaveLength(3);
    expect(result.metrics.map(({ date, metricKey, metricValue, unit, dimensions }) => ({ date, metricKey, metricValue, unit, dimensions }))).toEqual([
      { date: "2026-11-12", metricKey: "chatgpt_ads_clicks", metricValue: 0, unit: "count", dimensions: expect.objectContaining({ account_id: account.id, rollup: "account_daily" }) },
      { date: "2026-11-12", metricKey: "chatgpt_ads_impressions", metricValue: 0, unit: "count", dimensions: expect.objectContaining({ account_id: account.id, rollup: "account_daily" }) },
      { date: "2026-11-12", metricKey: "chatgpt_ads_spend", metricValue: 0, unit: "USD", dimensions: expect.objectContaining({ account_id: account.id, rollup: "account_daily" }) },
    ]);
  });

  it("fails incomplete/repeated pagination rather than returning a truncated report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [], has_more: true, last_id: "same-cursor" })));
    await expect(fetchChatgptAdsInsights(API_KEY, account, "2026-11-13", "2026-11-13")).rejects.toThrow("did not advance");
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [], has_more: true })));
    await expect(fetchChatgptAdsInsights(API_KEY, account, "2026-11-13", "2026-11-13")).rejects.toThrow("did not advance");
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [], has_more: "false" })));
    await expect(fetchChatgptAdsInsights(API_KEY, account, "2026-11-13", "2026-11-13")).rejects.toThrow("invalid page");
  });

  it("requests account-wide daily goal attribution through the reporting POST only", async () => {
    const fetchMock = vi.fn(async () => response({ object: "list", data: [], count: 0, account_currency: "USD" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchChatgptAdsConversions(API_KEY, account, "2026-11-12", "2026-11-13")).toEqual({ rows: [], currency: "USD" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.ads.openai.com/v1/conversions/insights");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ aggregation_level: "campaign", group_by_entity: false, time_granularity: "daily", ...CHATGPT_ADS_ATTRIBUTION });
    expect(body.entity_ids).toBeUndefined();
    expect(body.include).toBeUndefined();
    expect(JSON.parse(body.time_ranges[0])).toMatchObject({ since: "2026-11-12", until: "2026-11-13", timezone: account.timezone });
  });

  it("rejects reports longer than documented retention before making network requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchChatgptAdsConversions(API_KEY, account, "2025-11-12", "2026-11-13")).rejects.toThrow("365");
    await expect(fetchChatgptAdsInsights(API_KEY, account, "2026-02-30", "2026-03-01")).rejects.toThrow("valid inclusive date range");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails the sync on unexplained measurement errors rather than inventing zero conversions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
      if (input.pathname === "/v1/ad_account") return response(account);
      if (input.pathname === "/v1/ad_account/insights") return response({ data: [{ readable_time: "2026-11-13", spend: 8, clicks: 10 }], has_more: false });
      return response({ error: { message: "Reporting unavailable" } }, 403);
    }));
    await expect(chatgptAdsConnector.sync({ source: source(), credentials: { chatgpt_ads_api_key: API_KEY }, isDemoMode: false, trigger: "manual" })).rejects.toThrow("Reporting unavailable");
  });

  it("returns safe snapshots/cursors and treats a successful empty report as missing metrics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T03:00:00.000Z"));
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
      paths.push(input.pathname);
      if (input.pathname === "/v1/ad_account") return response(account);
      if (input.pathname === "/v1/ad_account/insights") return response({ object: "list", data: [], count: 0, has_more: false });
      if (input.pathname === "/v1/conversions/insights") return response({ object: "list", data: [], count: 0, account_currency: "USD" });
      throw new Error("Unexpected route");
    }));
    const result = await chatgptAdsConnector.sync({ source: source(), credentials: { chatgpt_ads_api_key: API_KEY, chatgpt_ads_lookback_days: "3" }, isDemoMode: false, trigger: "manual" });
    expect(paths.sort()).toEqual(["/v1/ad_account", "/v1/ad_account/insights", "/v1/conversions/insights"]);
    expect(result.cursorAfter).toEqual({ accountId: account.id, currency: "USD", timeZone: account.timezone, startDate: "2026-11-11", endDate: "2026-11-13", fetchedAt: "2026-11-14T03:00:00.000Z", conversionStatus: "available" });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    const normalized = await chatgptAdsConnector.normalize(result.rawPayloads, source());
    expect(normalized.metrics).toEqual([]);
    expect(normalized.replaceMetricWindow).toMatchObject({ metricKeys: [...CHATGPT_ADS_METRIC_KEYS], startDate: "2026-11-11", endDate: "2026-11-13" });
    expect(updateSource).not.toHaveBeenCalled();
  });

  it("pins the first verified account without credentials and rejects a changed account on later syncs", async () => {
    const unbound = source(null);
    unbound.metadata = { existing_preference: "keep" };
    vi.mocked(updateSource).mockResolvedValue({ ...unbound, external_account_id: account.id });
    const fetchMock = vi.fn(async (input: URL) => {
      if (input.pathname === "/v1/ad_account") return response(account);
      if (input.pathname === "/v1/ad_account/insights") return response({ data: [], has_more: false });
      return response({ data: [], account_currency: "USD" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await chatgptAdsConnector.sync({ source: unbound, credentials: { chatgpt_ads_api_key: API_KEY }, isDemoMode: false, trigger: "initial" });
    expect(updateSource).toHaveBeenCalledWith(unbound.id, {
      external_account_id: account.id,
      account_name: account.name,
      metadata: { existing_preference: "keep", account_timezone: account.timezone, account_currency: "USD" },
    }, { dataSpaceId: unbound.data_space_id });
    expect(JSON.stringify(vi.mocked(updateSource).mock.calls)).not.toContain(API_KEY);
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => response({ ...account, id: "adacct_changed" }));
    await expect(chatgptAdsConnector.sync({ source: source(), credentials: { chatgpt_ads_api_key: API_KEY }, isDemoMode: false, trigger: "cron" })).rejects.toThrow("different account");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not continue with reporting when the first identity cannot be persisted", async () => {
    vi.mocked(updateSource).mockResolvedValue(null);
    const fetchMock = vi.fn(async () => response(account));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatgptAdsConnector.sync({ source: source(null), credentials: { chatgpt_ads_api_key: API_KEY }, isDemoMode: false, trigger: "initial" })).rejects.toThrow("Could not bind");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("repairs verified reporting metadata for an already pinned account without changing its identity", async () => {
    const existing = source();
    existing.metadata = { unrelated_preference: "keep" };
    vi.mocked(updateSource).mockResolvedValue({ ...existing, metadata: { ...existing.metadata, account_currency: "USD", account_timezone: account.timezone } });
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
      if (input.pathname === "/v1/ad_account") return response(account);
      if (input.pathname === "/v1/ad_account/insights") return response({ data: [], has_more: false });
      return response({ data: [], account_currency: "USD" });
    }));
    await chatgptAdsConnector.sync({ source: existing, credentials: { chatgpt_ads_api_key: API_KEY }, isDemoMode: false, trigger: "manual" });
    expect(updateSource).toHaveBeenCalledWith(existing.id, {
      external_account_id: account.id,
      account_name: account.name,
      metadata: { unrelated_preference: "keep", account_timezone: account.timezone, account_currency: "USD" },
    }, { dataSpaceId: existing.data_space_id });
  });
});

describe("ChatGPT Ads normalization and measurement integrity", () => {
  it("stores only additive facts, preserves major currency units, and labels attribution", async () => {
    const data = snapshot();
    const first = await normalize(data);
    expect(await normalize(data)).toEqual(first);
    const byKey = new Map(first.metrics.map((metric) => [metric.metricKey, metric]));
    expect([...byKey.keys()].sort()).toEqual([...CHATGPT_ADS_METRIC_KEYS].sort());
    expect(byKey.get("chatgpt_ads_spend")).toMatchObject({ metricValue: 12.5, unit: "USD", dimensions: { account_id: account.id, account_currency: "USD", account_timezone: account.timezone, rollup: "account_daily" } });
    expect(byKey.get("chatgpt_ads_conversions")).toMatchObject({ metricValue: 4, dimensions: { conversion_scope: "campaign_goals", ...CHATGPT_ADS_ATTRIBUTION } });
    expect(byKey.get("chatgpt_ads_purchase_value")).toMatchObject({ metricValue: 125.75, unit: "USD", dimensions: { purchase_scope: "attributed_order_created_goal_and_non_goal", ...CHATGPT_ADS_ATTRIBUTION } });
  });

  it("never turns null, absent, blank, boolean, or invalid fields into zero", async () => {
    for (const value of [null, undefined, "", " ", true, false, "NaN", "Infinity", "0x10", -1]) expect(chatgptAdsNumber(value)).toBeNull();
    expect(chatgptAdsNumber(0)).toBe(0);
    const result = await normalize(snapshot({
      insights: [{ readable_time: "2026-11-13", spend: null, clicks: "", impressions: 0 }],
      conversions: [{ entity_id: account.id, date: "2026-11-13", conversions: 0, order_created_attributed_sales: null }],
    }));
    expect(result.metrics.map((metric) => metric.metricKey).sort()).toEqual(["chatgpt_ads_conversions", "chatgpt_ads_impressions"]);
    expect(result.metrics.every((metric) => metric.metricValue === 0)).toBe(true);
  });

  it("accepts prefixed response keys once and derives dates from account-local timestamps", async () => {
    const result = await normalize(snapshot({ insights: [{ start_time: Date.parse("2026-11-13T08:00:00Z") / 1_000, ad_account_spend: 20.25, ad_account_clicks: 7, ad_account_impressions: 120 }], conversions: [] }));
    expect(result.metrics).toHaveLength(3);
    expect(result.metrics.every((metric) => metric.date === "2026-11-13")).toBe(true);
    expect(result.metrics.find((metric) => metric.metricKey === "chatgpt_ads_spend")?.metricValue).toBe(20.25);
  });

  it.each([
    ["2026-11-13", "2026-11-13T08:00:00Z", "2026-11-14T08:00:00Z", 24],
    ["2026-11-01", "2026-11-01T07:00:00Z", "2026-11-02T08:00:00Z", 25],
    ["2026-03-08", "2026-03-08T08:00:00Z", "2026-03-09T07:00:00Z", 23],
  ])("accepts only validated account-local UTC-labelled zero rows for %s (%s to %s)", async (date, start, end, hours) => {
    const row = utcZeroRow({ readable_time: String(date), start_time: Date.parse(String(start)) / 1_000, end_time: Date.parse(String(end)) / 1_000 });
    expect(row.end_time! - row.start_time!).toBe(Number(hours) * 3_600);
    const result = await normalize(snapshot({ insights: [row], conversions: [], windowStartDate: String(date), windowEndDate: String(date) }));
    expect(result.metrics).toHaveLength(3);
    expect(result.metrics.every((metric) => metric.date === date && metric.metricValue === 0
      && metric.dimensions?.account_timezone === account.timezone)).toBe(true);
    expect(row.timezone).toBe("UTC");
  });

  it("accepts explicit prefixed zeros without changing normal metric precedence", async () => {
    const result = await normalize(snapshot({ insights: [utcZeroRow({ spend: undefined, clicks: undefined, impressions: undefined,
      ad_account_spend: "0", ad_account_clicks: 0, ad_account_impressions: "0" })], conversions: [] }));
    expect(result.metrics).toHaveLength(3);
    expect(result.metrics.every((metric) => metric.metricValue === 0 && metric.date === "2026-11-13")).toBe(true);
  });

  it.each([
    ["actual UTC-midnight bucket", { start_time: Date.parse("2026-11-13T00:00:00Z") / 1_000, end_time: Date.parse("2026-11-14T00:00:00Z") / 1_000 }],
    ["wrong readable date", { readable_time: "2026-11-12" }],
    ["missing readable date", { readable_time: undefined }],
    ["multi-day bucket", { end_time: 1794729600 }],
    ["missing start", { start_time: undefined }], ["missing end", { end_time: undefined }],
    ["fractional start", { start_time: 1794556800.5 }], ["fractional end", { end_time: 1794643200.5 }],
    ["non-numeric epoch", { start_time: "1794556800" }], ["out-of-range epoch", { end_time: Number.MAX_SAFE_INTEGER }],
    ["reversed range", { end_time: 1794470400 }], ["non-midnight end", { end_time: 1794643199 }],
    ["fall DST forced to 24 hours", { readable_time: "2026-11-01", start_time: Date.parse("2026-11-01T07:00:00Z") / 1_000, end_time: Date.parse("2026-11-02T07:00:00Z") / 1_000 }],
    ["other timezone label", { timezone: "Etc/UTC" }],
    ["nonzero spend", { spend: "0.01" }], ["nonzero clicks", { clicks: 1 }], ["nonzero impressions", { impressions: 1 }],
    ["missing metric", { spend: undefined }], ["null metric", { spend: null }],
    ["blank metric", { clicks: "" }], ["boolean metric", { impressions: false }],
    ["missing account ID", { ad_account_id: undefined }],
    ["flat-zero/prefixed-positive conflict", { ad_account_spend: 1 }],
    ["flat-zero/prefixed-null conflict", { ad_account_clicks: null }],
    ["flat-null/prefixed-zero conflict", { spend: null, ad_account_spend: 0 }],
  ])("rejects UTC zero-row exception for %s", async (_label, overrides) => {
    await expect(normalize(snapshot({ insights: [utcZeroRow(overrides as Partial<ChatgptAdsInsightRow>)], conversions: [] })))
      .rejects.toThrow("different account time zone");
  });

  it("still rejects the wrong account and ordinary nonzero timezone mismatches", async () => {
    await expect(normalize(snapshot({ insights: [utcZeroRow({ ad_account_id: "adacct_other" })] }))).rejects.toThrow("different account");
    await expect(normalize(snapshot({ insights: [{ ...snapshot().insights[0], timezone: "UTC" }] }))).rejects.toThrow("different account time zone");
  });

  it("rejects duplicate daily rows, dates outside the window and mismatched accounts", async () => {
    const data = snapshot();
    await expect(normalize({ ...data, insights: [...data.insights, ...data.insights] })).rejects.toThrow("duplicate");
    await expect(normalize(snapshot({ insights: [{ readable_time: "2026-11-14", clicks: 4 }] }))).rejects.toThrow("outside");
    await expect(normalize(snapshot({ conversions: [{ entity_id: "adacct_other", date: "2026-11-13", conversions: 2 }] }))).rejects.toThrow("different account");
  });

  it("does not mix purchase currencies or assume a missing monetary currency", async () => {
    await expect(normalize(snapshot({ conversionCurrency: "EUR" }))).rejects.toThrow("currency");
    await expect(normalize(snapshot({ conversionCurrency: null, conversions: [{ entity_id: account.id, date: "2026-11-13", conversions: 1, order_created_attributed_sales: "10" }] }))).rejects.toThrow("currency");
  });

  it("computes date windows using the account timezone across DST and validates lookback", () => {
    expect(chatgptAdsMetricWindow({ chatgpt_ads_lookback_days: "2" }, account.timezone, new Date("2026-11-02T07:30:00Z"))).toEqual({ startDate: "2026-10-31", endDate: "2026-11-01" });
    expect(() => chatgptAdsMetricWindow({ chatgpt_ads_lookback_days: "3650" }, account.timezone)).toThrow("1 to 365");
    expect(() => chatgptAdsMetricWindow({ chatgpt_ads_lookback_days: "1.5" }, account.timezone)).toThrow("whole number");
  });

  it("deduplicates unchanged source content while preserving revisions in its hash", () => {
    const first = snapshot();
    expect(hashChatgptAdsSnapshot(first)).toBe(hashChatgptAdsSnapshot({ ...first, fetchedAt: "2026-11-14T00:00:00.000Z" }));
    expect(hashChatgptAdsSnapshot(first)).not.toBe(hashChatgptAdsSnapshot({ ...first, insights: [{ readable_time: "2026-11-13", spend: 13 }] }));
  });
});
