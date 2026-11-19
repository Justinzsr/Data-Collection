import { afterEach, describe, expect, it, vi } from "vitest";
import { adsCampaignHistoryCursor, adsCampaignHistoryMetrics, adsHistoryEpochCoverage, adsHistoryNumber, adsHistoryWindow, createAdsCampaignHistoryReport, type AdsCampaignHistoryReport, type AdsHistoryPlatform } from "@/collection/connectors/ads-campaign-history";
import { fetchChatgptAdsCampaignHistory, fetchChatgptAdsSnapshot, type ChatgptAdsSyncSnapshot } from "@/collection/connectors/chatgpt-ads/api";
import { chatgptAdsConnector } from "@/collection/connectors/chatgpt-ads/connector";
import { fetchMetaAdsCampaignHistory, fetchMetaAdsSnapshot, type MetaAdsSyncSnapshot } from "@/collection/connectors/meta-ads/api";
import { metaAdsConnector } from "@/collection/connectors/meta-ads/connector";
import type { JsonRecord, Source } from "@/storage/db/schema";

const KEY = "synthetic-history-test-secret";
const fetchedAt = "2026-11-18T09:00:00.000Z";
const timeZone = "America/Los_Angeles";
const account = { id: "adacct_history", currency_code: "USD", timezone: timeZone, name: "History account" };
const metaAccount = { id: "act_123", account_id: "123", currency: "USD", timezone_name: timeZone };
const campaign = { campaignId: "campaign_a", campaignName: "Campaign A", spend: 12.5, impressions: 100, clicks: 7 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function source(platform: AdsHistoryPlatform): Source {
  return { id: "88888888-8888-4888-8888-888888888888", source_type_key: platform, external_account_id: platform === "meta_ads" ? "act_123" : account.id } as Source;
}
function report(platform: AdsHistoryPlatform = "chatgpt_ads", overrides: Partial<Omit<AdsCampaignHistoryReport, "reportHash">> = {}) {
  return createAdsCampaignHistoryReport({ platform, accountId: platform === "meta_ads" ? "123" : account.id, currency: "USD", timeZone, ...adsHistoryWindow(platform, fetchedAt, timeZone), rows: [campaign], ...overrides });
}
function chatRow(overrides: JsonRecord = {}): JsonRecord {
  return { campaign_id: campaign.campaignId, campaign_name: campaign.campaignName, ad_account_id: account.id, timezone: timeZone, spend: "12.5", impressions: "100", clicks: "7", ...overrides };
}
function metaRow(overrides: JsonRecord = {}): JsonRecord {
  const window = adsHistoryWindow("meta_ads", fetchedAt, timeZone);
  return { account_id: "123", account_currency: "USD", campaign_id: campaign.campaignId, campaign_name: campaign.campaignName, date_start: window.startDate, date_stop: window.endDate, spend: "12.5", impressions: "100", clicks: "7", ...overrides };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("campaign history report integrity", () => {
  it("uses completed account-local days, clamps month ends, and respects leap years", () => {
    expect(adsHistoryWindow("chatgpt_ads", fetchedAt, timeZone)).toEqual({ startDate: "2025-11-18", endDate: "2026-11-17" });
    expect(adsHistoryWindow("meta_ads", fetchedAt, timeZone)).toEqual({ startDate: "2023-10-19", endDate: "2026-11-17" });
    expect(adsHistoryWindow("meta_ads", "2026-04-01T08:00:00Z", timeZone)).toEqual({ startDate: "2023-03-02", endDate: "2026-03-31" });
    expect(adsHistoryWindow("meta_ads", "2027-04-01T08:00:00Z", timeZone)).toEqual({ startDate: "2024-03-02", endDate: "2027-03-31" });
    expect(adsHistoryWindow("meta_ads", "2026-03-01T09:00:00Z", timeZone)).toEqual({ startDate: "2023-02-02", endDate: "2026-02-28" });
    expect(adsHistoryWindow("chatgpt_ads", "2026-11-18T07:59:00Z", timeZone).endDate).toBe("2026-11-16");
    expect(() => adsHistoryWindow("meta_ads", fetchedAt, "not/a-zone")).toThrow();
  });
  it.each([null, undefined, "", " ", false, true, "NaN", "Infinity", "0x10", -1, Number.POSITIVE_INFINITY])("rejects unavailable/invalid metric %s", (value) => {
    expect(() => adsHistoryNumber(value)).toThrow("invalid metric");
  });
  it("preserves main currency units and rejects fractional counts", () => {
    expect(adsHistoryNumber("0")).toBe(0);
    expect(adsHistoryNumber("12.50")).toBe(12.5);
    expect(() => adsHistoryNumber("0.5", true)).toThrow();
  });
  it("hashes canonical content independent of row order and exact pagination duplicates", () => {
    const other = { ...campaign, campaignId: "campaign_b", spend: 0 };
    const first = report("chatgpt_ads", { rows: [campaign, other] });
    expect(report("chatgpt_ads", { rows: [other, campaign, other] })).toEqual(first);
    expect(report("chatgpt_ads", { rows: [campaign, other], evidence: { rows: [{ timezone: "UTC" }] } }).reportHash).toBe(first.reportHash);
    expect(report("chatgpt_ads", { rows: [{ ...campaign, spend: 13 }, other] }).reportHash).not.toBe(first.reportHash);
    expect(() => report("chatgpt_ads", { rows: [campaign, { ...campaign, clicks: 8 }] })).toThrow("conflicting duplicate");
  });
  it("emits one complete marker plus separate historical facts without daily keys", () => {
    const data = report();
    const metrics = adsCampaignHistoryMetrics({ status: "available", report: data }, source("chatgpt_ads"), { id: account.id, currency: "USD", timeZone }, fetchedAt);
    expect(metrics).toHaveLength(4);
    expect(metrics[0]).toMatchObject({ metricKey: "chatgpt_ads_history_campaign_count", metricValue: 1, date: "2026-11-18", dimensions: { report_hash: data.reportHash, rollup: "campaign_history_report", report_start: "2025-11-18", report_end: "2026-11-17" } });
    expect(metrics[1]).toMatchObject({ metricKey: "chatgpt_ads_history_spend", metricValue: 12.5, unit: "USD", dimensions: { rollup: "campaign_history_total", campaign_id: campaign.campaignId } });
    expect(adsCampaignHistoryCursor({ status: "available", report: data })).toEqual({ historyStatus: "available", historyReportHash: data.reportHash, historyReportStart: data.startDate, historyReportEnd: data.endDate });
    expect(JSON.stringify(metrics)).not.toContain(fetchedAt);
  });
  it("records an empty complete report without fabricating campaign totals and preserves unavailable/old snapshots", () => {
    expect(adsCampaignHistoryMetrics({ status: "available", report: report("meta_ads", { rows: [] }) }, source("meta_ads"), { id: "123", currency: "USD", timeZone }, fetchedAt)).toEqual([
      expect.objectContaining({ metricKey: "meta_ads_history_campaign_count", metricValue: 0 }),
    ]);
    expect(adsCampaignHistoryMetrics(undefined, source("meta_ads"), { id: "123", currency: "USD", timeZone }, fetchedAt)).toEqual([]);
    expect(adsCampaignHistoryMetrics({ status: "unavailable", error: "Unavailable" }, source("meta_ads"), { id: "123", currency: "USD", timeZone }, fetchedAt)).toEqual([]);
  });
  it.each([
    { id: "other", currency: "USD", timeZone }, { id: account.id, currency: "EUR", timeZone }, { id: account.id, currency: "USD", timeZone: "UTC" },
  ])("rejects mismatched verified snapshot identity %o", (identity) => {
    expect(() => adsCampaignHistoryMetrics({ status: "available", report: report() }, source("chatgpt_ads"), identity, fetchedAt)).toThrow("verified account");
  });
  it("rejects a forged content hash or changed source account", () => {
    expect(() => adsCampaignHistoryMetrics({ status: "available", report: { ...report(), reportHash: "forged" } }, source("chatgpt_ads"), { id: account.id, currency: "USD", timeZone }, fetchedAt)).toThrow();
    expect(() => adsCampaignHistoryMetrics({ status: "available", report: report() }, { ...source("chatgpt_ads"), external_account_id: "other" }, { id: account.id, currency: "USD", timeZone }, fetchedAt)).toThrow();
  });
  it.each([
    ["2026-11-01", "2026-11-01T07:00:00Z", "2026-11-02T08:00:00Z"],
    ["2026-03-08", "2026-03-08T08:00:00Z", "2026-03-09T07:00:00Z"],
  ])("proves DST-local midnight bounds for %s", (date, start, end) => {
    expect(adsHistoryEpochCoverage(Date.parse(start) / 1_000, Date.parse(end) / 1_000, date, date, timeZone)).toBe(true);
    expect(adsHistoryEpochCoverage(Date.parse(start) / 1_000, Date.parse(end) / 1_000 - 1, date, date, timeZone)).toBe(false);
  });
});

describe("ChatGPT official campaign history", () => {
  it("requests one unsegmented completed-day campaign period, paginates, and deduplicates exact rows", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init?: RequestInit) => {
      requests.push(new URL(input));
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
      return response(input.searchParams.has("after")
        ? { data: [chatRow()], has_more: false }
        : { data: [chatRow()], has_more: true, last_id: "cursor" });
    }));
    const data = await fetchChatgptAdsCampaignHistory(KEY, account, fetchedAt);
    expect(data.rows).toEqual([campaign]);
    expect(requests).toHaveLength(2);
    for (const url of requests) {
      expect(url.searchParams.get("aggregation_level")).toBe("campaign");
      expect(url.searchParams.get("time_granularity")).toBe("none");
      expect(url.searchParams.getAll("includes[]")).toEqual(["zero_impression_items"]);
      expect(url.searchParams.has("segments[]")).toBe(false);
      expect(url.searchParams.getAll("fields[]")).toEqual(["metadata.timezone", "campaign.id", "campaign.name", "campaign.spend", "campaign.impressions", "campaign.clicks"]);
      expect(JSON.parse(url.searchParams.get("time_ranges[]")!)).toEqual({ type: "date_range", since: "2025-11-18", until: "2026-11-17", timezone: timeZone });
      expect(url.toString()).not.toContain(KEY);
    }
  });
  it("accepts UTC-labelled explicit zero only with returned epochs proving the complete requested local period", async () => {
    const row = chatRow({ timezone: "UTC", spend: 0, impressions: 0, clicks: 0, start_time: Date.parse("2025-11-18T08:00:00Z") / 1_000, end_time: Date.parse("2026-11-18T08:00:00Z") / 1_000, unknown_private_field: "must not persist" });
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [row], has_more: false })));
    const result = await fetchChatgptAdsCampaignHistory(KEY, account, fetchedAt);
    expect(result.rows[0]).toMatchObject({ spend: 0, impressions: 0, clicks: 0 });
    expect(result.evidence?.rows[0]).toMatchObject({ timezone: "UTC", start_time: row.start_time, end_time: row.end_time });
    expect(JSON.stringify(result)).not.toContain("must not persist");
    expect(row.timezone).toBe("UTC");
  });
  it.each([
    ["wrong account", { ad_account_id: "other" }], ["wrong currency", { account_currency: "EUR" }],
    ["missing campaign", { campaign_id: null }], ["missing spend", { spend: undefined }], ["null spend", { spend: null }],
    ["invalid count", { clicks: "1.5" }], ["alias conflict", { campaign_spend: 1 }], ["null alias", { campaign_clicks: null }],
    ["positive UTC label", { timezone: "UTC" }], ["unknown timezone", { timezone: "Etc/UTC" }],
    ["zero without epochs", { timezone: "UTC", spend: 0, clicks: 0, impressions: 0 }],
    ["zero actual UTC bucket", { timezone: "UTC", spend: 0, clicks: 0, impressions: 0, start_time: Date.parse("2025-11-18T00:00:00Z") / 1_000, end_time: Date.parse("2026-11-18T00:00:00Z") / 1_000 }],
    ["zero fractional epoch", { timezone: "UTC", spend: 0, clicks: 0, impressions: 0, start_time: 1763452800.5, end_time: 1794988800 }],
    ["proved zero/null alias conflict", { timezone: "UTC", spend: 0, clicks: 0, impressions: 0, campaign_spend: null, start_time: Date.parse("2025-11-18T08:00:00Z") / 1_000, end_time: Date.parse("2026-11-18T08:00:00Z") / 1_000 }],
    ["proved zero/positive alias conflict", { timezone: "UTC", spend: 0, clicks: 0, impressions: 0, campaign_clicks: 1, start_time: Date.parse("2025-11-18T08:00:00Z") / 1_000, end_time: Date.parse("2026-11-18T08:00:00Z") / 1_000 }],
  ])("rejects %s without inventing zeros", async (_name, overrides) => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [chatRow(overrides as JsonRecord)], has_more: false })));
    await expect(fetchChatgptAdsCampaignHistory(KEY, account, fetchedAt)).rejects.toThrow();
  });
  it("rejects malformed/repeated pagination instead of publishing an incomplete report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [chatRow()], has_more: true, last_id: "repeat" })));
    await expect(fetchChatgptAdsCampaignHistory(KEY, account, fetchedAt)).rejects.toThrow("did not advance");
    vi.stubGlobal("fetch", vi.fn(async () => response({ has_more: false })));
    await expect(fetchChatgptAdsCampaignHistory(KEY, account, fetchedAt)).rejects.toThrow("invalid page");
  });
  it("keeps successful daily reports when optional history fails and redacts the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      if (url.searchParams.get("aggregation_level") === "campaign") return response({ error: { message: `Unavailable Bearer ${KEY}` } }, 503);
      if (url.pathname.endsWith("/conversions/insights")) return response({ data: [], account_currency: "USD" });
      return response({ data: [{ readable_time: "2026-11-17", spend: 1, impressions: 2, clicks: 1 }], has_more: false });
    }));
    const data = await fetchChatgptAdsSnapshot({ apiKey: KEY, account, startDate: "2026-11-17", endDate: "2026-11-17", fetchedAt });
    expect(data.campaignHistory).toMatchObject({ status: "unavailable" });
    expect(JSON.stringify(data)).not.toContain(KEY);
    const normalized = await chatgptAdsConnector.normalize([{ fetchedAt, payload: data as unknown as JsonRecord }], source("chatgpt_ads"));
    expect(normalized.metrics).toHaveLength(3);
    expect(normalized.snapshotMetrics).toEqual([]);
    const legacy = { ...data, campaignHistory: undefined } as ChatgptAdsSyncSnapshot;
    expect((await chatgptAdsConnector.normalize([{ fetchedAt, payload: legacy as unknown as JsonRecord }], source("chatgpt_ads"))).metrics).toEqual(normalized.metrics);
  });
});

describe("Meta official campaign history", () => {
  it("requests a bounded completed-day campaign total and follows safe paginated results", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      requests.push(new URL(url));
      return response({ data: [metaRow()], ...(url.searchParams.has("after") ? {} : { paging: { next: `https://graph.facebook.com/v25.0/act_123/insights?after=next&access_token=${KEY}` } }) });
    }));
    const data = await fetchMetaAdsCampaignHistory(KEY, { graphApiVersion: "v25.0" }, metaAccount, fetchedAt);
    expect(data.rows).toEqual([campaign]);
    expect(requests).toHaveLength(2);
    expect(requests[0].searchParams.get("level")).toBe("campaign");
    expect(requests[0].searchParams.get("time_increment")).toBe("all_days");
    expect(JSON.parse(requests[0].searchParams.get("time_range")!)).toEqual({ since: "2023-10-19", until: "2026-11-17" });
    expect(requests[0].searchParams.has("date_preset")).toBe(false);
    expect(requests.every((url) => !url.toString().includes(KEY))).toBe(true);
    expect(requests.every((url) => url.searchParams.get("level") === "campaign" && url.searchParams.get("time_range") === requests[0].searchParams.get("time_range"))).toBe(true);
  });
  it.each([
    ["wrong account", { account_id: "999" }], ["wrong currency", { account_currency: "EUR" }],
    ["wrong coverage", { date_stop: "2026-11-18" }], ["wrong timezone", { timezone: "UTC" }],
    ["missing campaign", { campaign_id: undefined }], ["missing metric", { spend: undefined }],
    ["null metric", { impressions: null }], ["blank metric", { clicks: "" }],
  ])("rejects %s", async (_name, overrides) => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [metaRow(overrides as JsonRecord)] })));
    await expect(fetchMetaAdsCampaignHistory(KEY, { graphApiVersion: "v25.0" }, metaAccount, fetchedAt)).rejects.toThrow();
  });
  it("handles explicit zeros/empty reports and rejects missing data or conflicting pages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [metaRow({ spend: 0, impressions: "0", clicks: "0" })] })));
    expect((await fetchMetaAdsCampaignHistory(KEY, { graphApiVersion: "v25.0" }, metaAccount, fetchedAt)).rows[0].spend).toBe(0);
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [] })));
    expect((await fetchMetaAdsCampaignHistory(KEY, { graphApiVersion: "v25.0" }, metaAccount, fetchedAt)).rows).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => response({})));
    await expect(fetchMetaAdsCampaignHistory(KEY, { graphApiVersion: "v25.0" }, metaAccount, fetchedAt)).rejects.toThrow("invalid page");
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [metaRow(), metaRow({ spend: 13 })] })));
    await expect(fetchMetaAdsCampaignHistory(KEY, { graphApiVersion: "v25.0" }, metaAccount, fetchedAt)).rejects.toThrow("conflicting duplicate");
  });
  it("rejects repeated pagination and scope changes before returning a complete report", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [metaRow()], paging: { next: "https://graph.facebook.com/v25.0/act_123/insights?after=repeat" } })));
    await expect(fetchMetaAdsCampaignHistory(KEY, { graphApiVersion: "v25.0" }, metaAccount, fetchedAt)).rejects.toThrow("repeated");
    vi.stubGlobal("fetch", vi.fn(async () => response({ data: [metaRow()], paging: { next: "https://graph.facebook.com/v25.0/act_999/insights?after=next" } })));
    await expect(fetchMetaAdsCampaignHistory(KEY, { graphApiVersion: "v25.0" }, metaAccount, fetchedAt)).rejects.toThrow("changed reporting scope");
  });
  it("preserves daily metrics and legacy snapshots after sanitized optional history failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      if (url.searchParams.get("level") === "campaign") return response({ error: { message: `Failure access_token=${KEY}` } }, 500);
      if (url.pathname.endsWith("/ads")) return response({ data: [] });
      return response({ data: [{ ad_id: "ad_a", campaign_id: "campaign_a", date_start: "2026-11-17", spend: "1", impressions: "2", clicks: "1" }] });
    }));
    const data = await fetchMetaAdsSnapshot({ accessToken: KEY, config: { graphApiVersion: "v25.0" }, account: metaAccount, startDate: "2026-11-17", endDate: "2026-11-17", fetchedAt });
    expect(data.campaignHistory).toMatchObject({ status: "unavailable" });
    expect(JSON.stringify(data)).not.toContain(KEY);
    const normalized = await metaAdsConnector.normalize([{ fetchedAt, payload: data as unknown as JsonRecord }], source("meta_ads"));
    expect(normalized.metrics.find((value) => value.metricKey === "meta_ads_spend")?.metricValue).toBe(1);
    expect(normalized.snapshotMetrics).toEqual([]);
    expect((await metaAdsConnector.normalize([{ fetchedAt, payload: { ...data, campaignHistory: undefined } as unknown as JsonRecord }], source("meta_ads"))).metrics).toEqual(normalized.metrics);
  });
  it("publishes marker and campaign facts as snapshot metrics excluded from daily replacement", async () => {
    const data: MetaAdsSyncSnapshot = { kind: "meta_ads_sync_snapshot", account: metaAccount, ads: [], insights: [], graphApiVersion: "v25.0", windowStartDate: "2026-11-17", windowEndDate: "2026-11-17", fetchedAt, campaignHistory: { status: "available", report: report("meta_ads") } };
    const normalized = await metaAdsConnector.normalize([{ fetchedAt, payload: data as unknown as JsonRecord }], source("meta_ads"));
    expect(normalized.snapshotMetrics).toHaveLength(4);
    expect(normalized.replaceMetricWindow?.metricKeys.some((key) => key.includes("history"))).toBe(false);
    expect(normalized.snapshotMetrics?.every((metric) => metaAdsConnector.getMetricDefinitions().some((definition) => definition.key === metric.metricKey))).toBe(true);
  });
});
