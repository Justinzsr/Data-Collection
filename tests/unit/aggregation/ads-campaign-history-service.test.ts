import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdsCampaignHistory } from "@/aggregation/services/ads-campaign-history-service";
import type { AdsHistoryPlatform } from "@/aggregation/services/ads-campaign-history-types";
import { adsCampaignHistoryMetrics, adsHistoryWindow, createAdsCampaignHistoryReport } from "@/collection/connectors/ads-campaign-history";
import type { AdsCampaignHistoryRow } from "@/collection/connectors/ads-campaign-history";
import type { JsonRecord, MetricDaily, Source, SyncRun } from "@/storage/db/schema";

const NOW = new Date("2026-11-19T12:00:00Z");
const UPDATED = "2026-11-19T11:30:00.000Z";
const SPACE = "history-space";
const ZONE = "America/Los_Angeles";
let sequence = 0;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("MOONARQ_OVERVIEW_E2E_FIXTURES", "false");
});
afterEach(() => vi.unstubAllEnvs());

function account(platform: AdsHistoryPlatform) { return platform === "meta_ads" ? "12345" : "adacct_example"; }
function source(platform: AdsHistoryPlatform = "meta_ads", patch: Partial<Source> = {}): Source {
  return {
    id: "history-source", data_space_id: SPACE, source_type_key: platform, display_name: "Example ads", input_url: null, normalized_url: null,
    external_account_id: platform === "meta_ads" ? "act_12345" : account(platform), account_name: "Example account", status: "healthy",
    sync_mode: "hourly", sync_frequency_minutes: 60, supports_webhook: false, webhook_url: null, webhook_secret_hint: null,
    last_manual_sync_at: null, last_cron_sync_at: UPDATED, last_webhook_sync_at: null, last_success_at: UPDATED,
    last_error_at: null, last_error: null, next_sync_at: null, metadata: { account_currency: "USD", account_timezone: ZONE },
    created_at: UPDATED, updated_at: UPDATED, ...patch,
  };
}
function run(platform: AdsHistoryPlatform, cursor: JsonRecord = {}, patch: Partial<SyncRun> = {}): SyncRun {
  return {
    id: "history-run", source_id: "history-source", source_type_key: platform, trigger: "cron", status: "success", idempotency_key: null,
    lock_key: null, started_at: "2026-11-19T11:29:00.000Z", finished_at: UPDATED, duration_ms: 60_000,
    records_fetched: 1, records_inserted: 1, records_updated: 0, metrics_upserted: 4, error_message: null, error_stack: null,
    cursor_before: null, cursor_after: { accountId: platform === "meta_ads" ? "act_12345" : account(platform), currency: "USD",
      ...(platform === "meta_ads" ? { accountTimeZone: ZONE } : { timeZone: ZONE }), fetchedAt: UPDATED, ...cursor },
    metadata: {}, created_at: UPDATED, ...patch,
  };
}
function daily(platform: AdsHistoryPlatform, field: string, number: number, patch: Partial<MetricDaily> = {}): MetricDaily {
  return {
    id: `daily-${sequence++}`, date: "2026-07-16", source_id: "history-source", source_type_key: platform,
    metric_key: `${platform}_${field}`, metric_value: number, unit: field === "spend" ? "usd" : "count",
    dimensions: { account_id: account(platform), account_currency: "USD", account_timezone: ZONE,
      rollup: platform === "meta_ads" ? "ad_daily" : "account_daily", ...(platform === "meta_ads" ? { ad_id: "ad-a", campaign_id: "campaign-a", campaign_name: "Example campaign" } : {}) },
    dimensions_hash: `dimension-${sequence}`, created_at: UPDATED, updated_at: UPDATED, ...patch,
  };
}
function triplet(platform: AdsHistoryPlatform = "meta_ads", numbers = [5, 100, 10]) {
  return ["spend", "impressions", "clicks"].map((field, index) => daily(platform, field, numbers[index]));
}
function report(platform: AdsHistoryPlatform, campaigns: AdsCampaignHistoryRow[], fetchedAt = UPDATED) {
  const window = adsHistoryWindow(platform, fetchedAt, ZONE);
  const result = createAdsCampaignHistoryReport({ platform, accountId: account(platform), currency: "USD", timeZone: ZONE, ...window, rows: campaigns });
  const metrics = adsCampaignHistoryMetrics({ status: "available", report: result }, source(platform), { id: account(platform), currency: "USD", timeZone: ZONE }, fetchedAt);
  const rows: MetricDaily[] = metrics.map((metric) => ({
    id: `history-${sequence++}`, date: metric.date, source_id: metric.sourceId, source_type_key: metric.sourceTypeKey,
    metric_key: metric.metricKey, metric_value: metric.metricValue, unit: metric.unit, dimensions: metric.dimensions ?? {},
    dimensions_hash: `history-dimension-${sequence}`, created_at: fetchedAt, updated_at: fetchedAt,
  }));
  return { rows, cursor: { historyStatus: "available", historyReportHash: result.reportHash, historyReportStart: result.startDate, historyReportEnd: result.endDate } };
}
function deps(platform: AdsHistoryPlatform, rows: MetricDaily[] = [], cursor: JsonRecord = {}, sources = [source(platform)]) {
  return { now: NOW, loadSources: vi.fn(async () => sources), loadMetrics: vi.fn(async () => rows), loadSyncRuns: vi.fn(async () => [run(platform, cursor)]) };
}
const CAMPAIGN = { campaignId: "campaign-a", campaignName: "Example campaign", spend: 24.88, impressions: 1320, clicks: 88 };

describe("campaign history aggregation", () => {
  it("accepts the collection writer's complete official batch, independently of daily facts", async () => {
    const official = report("meta_ads", [CAMPAIGN, { ...CAMPAIGN, campaignId: "campaign-b", spend: 315.27, impressions: 6305, clicks: 277 }]);
    const load = deps("meta_ads", [...official.rows, ...triplet("meta_ads", [999, 999, 999])], official.cursor);
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, load);
    expect(result).toMatchObject({ state: "ready", currency: "USD", timeZone: ZONE, clickLabel: "All clicks", totals: { spend: 340.15, impressions: 7625, clicks: 365 } });
    expect(result.coverage.basis).toBe("official_available_history");
    expect(result.campaigns).toHaveLength(2);
    expect(load.loadMetrics).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "history-source", dataSpaceId: SPACE, sourceTypeKey: "meta_ads" }));
    expect(load.loadSyncRuns).toHaveBeenCalledWith(1, "success", { dataSpaceId: SPACE, sourceId: "history-source" });
  });

  it("uses the newest complete content hash once, never adds multiple cumulative snapshots", async () => {
    const old = report("meta_ads", [CAMPAIGN], "2026-11-19T10:30:00Z");
    const current = report("meta_ads", [{ ...CAMPAIGN, spend: 30 }]);
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", [...old.rows, ...current.rows, { ...current.rows[1], id: "exact-duplicate" }], current.cursor));
    expect(result.state).toBe("ready");
    expect(result.totals.spend).toBe(30);
    expect(result.campaigns).toHaveLength(1);
  });

  it.each(["2026-03-01T12:00:00Z", "2026-03-31T12:00:00Z", "2028-03-01T12:00:00Z"])("accepts writer coverage and fixture coverage across Meta month boundary %s", async (fetchedAt) => {
    const official = report("meta_ads", [CAMPAIGN], fetchedAt);
    const load = deps("meta_ads", official.rows, official.cursor, [source("meta_ads", { last_success_at: fetchedAt })]);
    load.now = new Date(fetchedAt);
    load.loadSyncRuns.mockResolvedValue([run("meta_ads", { ...official.cursor, fetchedAt }, { started_at: new Date(Date.parse(fetchedAt) - 60_000).toISOString(), finished_at: fetchedAt })]);
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, load);
    expect(result.state).toBe("ready");
    expect(result.coverage).toMatchObject(adsHistoryWindow("meta_ads", fetchedAt, ZONE));
    expect(result.totals.spend).toBe(CAMPAIGN.spend);
    if (fetchedAt.startsWith("2026-03-01")) expect(result.coverage.startDate).toBe("2023-02-02");
    vi.stubEnv("MOONARQ_OVERVIEW_E2E_FIXTURES", "true");
    const preview = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads", fixture: true }, load);
    expect(preview.coverage).toMatchObject(adsHistoryWindow("meta_ads", fetchedAt, ZONE));
  });

  it("retains an earlier valid snapshot as stale when the latest batch is incomplete", async () => {
    const old = report("meta_ads", [CAMPAIGN], "2026-11-18T11:30:00Z");
    const current = report("meta_ads", [{ ...CAMPAIGN, spend: 40 }]);
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", [...old.rows, ...current.rows.filter((row) => !row.metric_key.endsWith("_clicks"))], current.cursor));
    expect(result).toMatchObject({ state: "stale", totals: { spend: 24.88, clicks: 88 } });
    expect(result.coverage.endDate).toBe("2026-11-17");
  });

  it("does not mark previous history ready when the latest successful cursor says unavailable", async () => {
    const official = report("chatgpt_ads", [{ ...CAMPAIGN, spend: 0, impressions: 0, clicks: 0 }]);
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "chatgpt_ads" }, deps("chatgpt_ads", official.rows, { historyStatus: "unavailable", historyError: "private-error-do-not-render" }));
    expect(result).toMatchObject({ state: "stale", totals: { spend: 0, impressions: 0, clicks: 0 }, clickLabel: "Ad clicks" });
    expect(JSON.stringify(result)).not.toContain("private-error-do-not-render");
  });

  it("preserves unknown amounts for a valid empty-campaign marker", async () => {
    const official = report("chatgpt_ads", []);
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "chatgpt_ads" }, deps("chatgpt_ads", official.rows, official.cursor));
    expect(result).toMatchObject({ state: "ready", totals: { spend: null, impressions: null, clicks: null }, campaigns: [] });
  });

  it.each(["missing", "null", "negative", "wrong-unit", "wrong-currency", "wrong-timezone", "wrong-account", "wrong-rollup", "changed-name", "fractional-count"])("rejects a %s official fact instead of inventing zero", async (fault) => {
    const official = report("meta_ads", [CAMPAIGN]);
    const rows = structuredClone(official.rows);
    const row = rows.find((item) => item.metric_key === "meta_ads_history_clicks")!;
    if (fault === "missing") rows.splice(rows.indexOf(row), 1);
    if (fault === "null") row.metric_value = null as unknown as number;
    if (fault === "negative") row.metric_value = -1;
    if (fault === "wrong-unit") row.unit = "USD";
    if (fault === "wrong-currency") row.dimensions.account_currency = "EUR";
    if (fault === "wrong-timezone") row.dimensions.account_timezone = "UTC";
    if (fault === "wrong-account") row.dimensions.account_id = "99999";
    if (fault === "wrong-rollup") row.dimensions.rollup = "ad_daily";
    if (fault === "changed-name") row.dimensions.campaign_name = "An altered campaign name";
    if (fault === "fractional-count") row.metric_value = 0.4;
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", rows, official.cursor));
    expect(result).toMatchObject({ state: "unavailable", totals: { spend: null, impressions: null, clicks: null }, campaigns: [] });
  });

  it("does not accept another source's official report", async () => {
    const official = report("meta_ads", [CAMPAIGN]);
    const rows = official.rows.map((row) => ({ ...row, source_id: "another-source" }));
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", rows, official.cursor));
    expect(result.totals.spend).toBeNull();
  });

  it("does not infer an official current report from a changed marker hash or coverage", async () => {
    for (const dimension of ["report_hash", "report_start", "report_end"]) {
      const official = report("meta_ads", [CAMPAIGN]);
      official.rows[0].dimensions[dimension] = dimension === "report_hash" ? "a".repeat(64) : "2026-01-01";
      const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", official.rows, official.cursor));
      expect(result.state).toBe("unavailable");
      expect(result.totals.spend).toBeNull();
    }
  });

  it("falls back to old Meta daily records and deduplicates date/ad/metric despite changed dimension hashes", async () => {
    const old = triplet().map((row) => ({ ...row, updated_at: "2026-11-18T10:00:00Z" }));
    const current = triplet("meta_ads", [7, 200, 20]);
    const irrelevant = triplet("meta_ads", [900, 900, 900]).map((row) => ({ ...row, dimensions: { ...row.dimensions, rollup: "campaign_daily" } }));
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", [...old, ...current, ...irrelevant]));
    expect(result).toMatchObject({ state: "partial", totals: { spend: 7, impressions: 200, clicks: 20 }, clickLabel: "All clicks" });
    expect(result.coverage).toMatchObject({ basis: "collected_history", startDate: "2026-07-16", endDate: "2026-07-16" });
    expect(result.coverage.note).toContain("Earlier reports");
    expect(result.campaigns).toHaveLength(1);
  });

  it("permits old Meta's single explicitly reported currency when the old cursor has no currency", async () => {
    const load = deps("meta_ads", triplet(), {}, [source("meta_ads", { metadata: { account_timezone: ZONE } })]);
    load.loadSyncRuns.mockResolvedValue([run("meta_ads", { currency: null })]);
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, load);
    expect(result).toMatchObject({ state: "partial", currency: "USD", totals: { spend: 5 } });
    const mixed = triplet(); mixed[1].dimensions.account_currency = "EUR";
    load.loadMetrics.mockResolvedValue(mixed);
    expect((await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, load)).totals.spend).toBeNull();
  });

  it("never assigns account-level ChatGPT daily totals to a campaign", async () => {
    const dailyRows = triplet("chatgpt_ads", [0, 0, 0]);
    const unrelated = triplet("chatgpt_ads", [500, 600, 700]).map((row) => ({ ...row, dimensions: { ...row.dimensions, rollup: "campaign_daily", campaign_id: "campaign-a" } }));
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "chatgpt_ads" }, deps("chatgpt_ads", [...dailyRows, ...unrelated]));
    expect(result).toMatchObject({ state: "partial", totals: { spend: 0, impressions: 0, clicks: 0 }, campaigns: [] });
    expect(result.note).toContain("cannot be assigned");
  });

  it("keeps daily missing and latest invalid values unknown rather than using an earlier zero", async () => {
    const missing = triplet().filter((row) => row.metric_key !== "meta_ads_clicks");
    let result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", missing));
    expect(result.totals).toEqual({ spend: 5, impressions: 100, clicks: null });
    const old = triplet("meta_ads", [0, 0, 0]).map((row) => ({ ...row, updated_at: "2026-11-18T10:00:00Z" }));
    const invalid = daily("meta_ads", "spend", null as unknown as number);
    result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", [...old, invalid]));
    expect(result.totals).toEqual({ spend: null, impressions: 0, clicks: 0 });
  });

  it("isolates fallback source/account/calendar/currency and skips non-daily rollups", async () => {
    const valid = triplet();
    const injected = [
      ...triplet().map((row) => ({ ...row, source_id: "foreign-source" })),
      ...triplet().map((row) => ({ ...row, dimensions: { ...row.dimensions, account_id: "99999" } })),
      ...triplet().map((row) => ({ ...row, dimensions: { ...row.dimensions, account_currency: "EUR" } })),
      ...triplet().map((row) => ({ ...row, dimensions: { ...row.dimensions, account_timezone: "UTC" } })),
      ...triplet().map((row) => ({ ...row, dimensions: { ...row.dimensions, rollup: "account_daily" } })),
    ];
    const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", [...valid, ...injected]));
    expect(result.totals).toEqual({ spend: 5, impressions: 100, clicks: 10 });
  });

  it("fails closed when source metadata conflicts with the verified current account/calendar/currency", async () => {
    for (const patch of [{ external_account_id: "act_99999" }, { metadata: { account_currency: "EUR", account_timezone: ZONE } }, { metadata: { account_currency: "USD", account_timezone: "UTC" } }]) {
      const result = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, deps("meta_ads", triplet(), {}, [source("meta_ads", patch)]));
      expect(result.state).toBe("unavailable"); expect(result.totals.spend).toBeNull();
    }
  });

  it("does not combine multiple sources, while disabled single-source history remains visible", async () => {
    const load = deps("meta_ads", triplet(), {}, [source(), source("meta_ads", { id: "another", external_account_id: "act_99999" })]);
    const ambiguous = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, load);
    expect(ambiguous.state).toBe("ambiguous"); expect(load.loadMetrics).not.toHaveBeenCalled();
    load.loadSources.mockResolvedValue([source("meta_ads", { status: "disabled" })]);
    const disabled = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, load);
    expect(disabled).toMatchObject({ state: "stale", totals: { spend: 5 } });
  });

  it("excludes sources from other data spaces and sanitizes optional-section loader failures", async () => {
    const load = deps("meta_ads", triplet(), {}, [source("meta_ads", { data_space_id: "foreign-space" })]);
    expect((await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, load)).sourceId).toBeNull();
    load.loadSources.mockRejectedValue(new Error("private-token-never-render"));
    const failed = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads" }, load);
    expect(failed).toMatchObject({ state: "unavailable", totals: { spend: null, impressions: null, clicks: null } });
    expect(JSON.stringify(failed)).not.toContain("private-token-never-render");
  });

  it("renders fixtures only through the existing explicit local/no-database gate", async () => {
    vi.stubEnv("MOONARQ_OVERVIEW_E2E_FIXTURES", "true");
    const load = deps("meta_ads");
    const example = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads", fixture: true }, load);
    expect(example).toMatchObject({ state: "ready", totals: { spend: 340.15, impressions: 7625, clicks: 365 } });
    expect(example.campaigns).toHaveLength(3); expect(example.coverage.note).toContain("Sample data");
    expect(example.campaigns.some((item) => item.name.length > 90)).toBe(true);
    expect(load.loadSources).not.toHaveBeenCalled();
    const chatgpt = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "chatgpt_ads", fixture: true }, deps("chatgpt_ads"));
    expect(chatgpt.totals).toEqual({ spend: 0, impressions: 0, clicks: 0 }); expect(chatgpt.campaigns).toHaveLength(1);
    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/test");
    const blocked = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads", fixture: true }, load);
    expect(blocked.state).toBe("unavailable"); expect(blocked.coverage.note).not.toContain("Sample data");
    vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("MOONARQ_OVERVIEW_E2E_FIXTURES", "false");
    const disabled = await getAdsCampaignHistory({ dataSpaceId: SPACE, platform: "meta_ads", fixture: true }, load);
    expect(disabled.coverage.note).not.toContain("Sample data");
  });
});
