import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildPaidAdsOverview, overviewRange } from "@/aggregation/services/platform-overview-service";
import type { Source } from "@/storage/db/schema";
import { DailyMetricChart } from "@/presentation/charts/daily-metric-chart";
import { formatAxisValue, formatMetricValue } from "@/presentation/components/ui/format";
import { shouldAutoSync } from "@/presentation/overview/ads-auto-sync";
import { deltaDescription, deltaLabel, deltaTone, MetricDelta } from "@/presentation/overview/metric-delta";
import { paidAdsAutoSyncEnabled, paidAdsFreshness, paidAdsHasData, paidAdsStatus } from "@/presentation/overview/paid-ads-hero";
import { platformHealth } from "@/presentation/overview/platform-health";

const now = Date.parse("2026-10-02T12:00:00.000Z");

function source(overrides: Partial<Source>): Source {
  return {
    id: "source-1",
    data_space_id: "space-1",
    source_type_key: "instagram",
    display_name: "Instagram",
    input_url: null,
    normalized_url: null,
    external_account_id: null,
    account_name: null,
    status: "healthy",
    sync_mode: "hourly",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: "2026-10-02T11:40:00.000Z",
    last_error_at: null,
    last_error: null,
    next_sync_at: "2026-10-02T13:00:00.000Z",
    metadata: { oauth_connected: true, token_expires_at: "2026-11-30T00:00:00.000Z" },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-10-02T11:40:00.000Z",
    ...overrides,
  };
}

describe("metric delta", () => {
  it("labels direction with an explicit sign, not color alone", () => {
    expect(deltaLabel({ kind: "percent", value: 12.44, basis: "vs previous 30 days" })).toBe("+12.4%");
    expect(deltaLabel({ kind: "percent", value: -3.1, basis: "vs previous 30 days" })).toBe("−3.1%");
    expect(deltaLabel({ kind: "absolute", value: 12_500, basis: "over 30 days" })).toBe("+12.5K");
    expect(deltaLabel({ kind: "points", value: 0.31, basis: "over 7 days" })).toBe("+0.3 pt");
    expect(deltaLabel({ kind: "points", value: -0.02, basis: "over 7 days" })).toBe("No change");
    expect(deltaLabel({ kind: "none", reason: "partial_day" })).toBe("So far today");
    expect(deltaLabel({ kind: "none", reason: "unavailable" })).toBeNull();
    expect(deltaLabel({ kind: "none", reason: "incomplete", basis: "The week of Sep 21 – Sep 27 is not imported" })).toBe("Incomplete");
  });

  it("describes the change and whether it is good in words, not only color", () => {
    expect(deltaDescription({ kind: "percent", value: -3.1, basis: "vs previous 30 days" })).toBe("Down 3.1% vs previous 30 days");
    expect(deltaDescription({ kind: "percent", value: -3.1, basis: "vs previous 30 days" }, false)).toBe("Down 3.1% vs previous 30 days, better");
    expect(deltaDescription({ kind: "percent", value: 8, basis: "vs previous 7 days" }, false)).toBe("Up 8.0% vs previous 7 days, worse");
    expect(deltaDescription({ kind: "absolute", value: 0, basis: "over 7 days" }, true)).toBe("No change over 7 days");
  });

  it("colors costs and neutral values by what is good for the business", () => {
    const down = { kind: "percent", value: -8, basis: "b" } as const;
    expect(deltaTone(down, false)).toBe("good");
    expect(deltaTone(down, true)).toBe("bad");
    expect(deltaTone(down, null)).toBe("neutral");
  });

  it("renders nothing when a change cannot be measured", () => {
    expect(renderToStaticMarkup(<MetricDelta delta={{ kind: "none", reason: "unavailable" }} higherIsBetter />)).toBe("");
    const markup = renderToStaticMarkup(<MetricDelta delta={{ kind: "percent", value: 20, basis: "vs previous 7 days" }} higherIsBetter />);
    expect(markup).toContain("+20.0%");
    expect(markup).toContain("Up 20.0% vs previous 7 days, better");
    expect(markup).toContain('data-delta-tone="good"');
  });

  it("marks a period with a missing report as incomplete, with the reason for screen readers", () => {
    const delta = { kind: "none", reason: "incomplete", basis: "The week of Sep 21 – Sep 27 is not imported" } as const;
    expect(deltaDescription(delta)).toBe("Incomplete: The week of Sep 21 – Sep 27 is not imported");
    const markup = renderToStaticMarkup(<MetricDelta delta={delta} higherIsBetter />);
    expect(markup).toContain("Incomplete");
    expect(markup).toContain('<span class="sr-only">: The week of Sep 21 – Sep 27 is not imported</span>');
  });

  it("shows days without data as not imported, never as zero", () => {
    const markup = renderToStaticMarkup(
      <DailyMetricChart
        title="Daily completed sales"
        data={[{ date: "2026-09-19", value: 0 }, { date: "2026-09-20", value: null }, { date: "2026-09-28", value: 48 }]}
        unit="usd"
        color="var(--chart-7)"
        missingLabel="Not imported"
      />,
    );
    expect(markup).toContain("Not imported");
    expect(markup).toContain("$0.00");
    expect(markup).toContain("$48.00");
  });
});

describe("platform health", () => {
  it("asks for a reconnect when an authorization has expired", () => {
    const expired = source({ metadata: { oauth_connected: true, token_expires_at: "2026-09-14T00:00:00.000Z" } });
    expect(platformHealth(expired, now)).toEqual({ tone: "rose", label: "Reconnect needed", needsAttention: true });
  });

  it("reports live, overdue, demo, and missing sources", () => {
    expect(platformHealth(source({}), now)).toEqual({ tone: "green", label: "Live", needsAttention: false });
    expect(platformHealth(source({ next_sync_at: "2026-10-02T05:00:00.000Z" }), now).label).toBe("Sync overdue");
    expect(platformHealth(source({ status: "demo", metadata: { demo: true } }), now).label).toBe("Demo data");
    expect(platformHealth(null, now)).toEqual({ tone: "slate", label: "Not connected", needsAttention: false });
  });

  it("treats the first-party website tracker as continuously live", () => {
    const tracker = source({ source_type_key: "website", last_success_at: null, next_sync_at: null, metadata: {} });
    expect(platformHealth(tracker, now).label).toBe("Live");
  });

  it("never calls webhook or manual sources overdue, since nothing schedules them", () => {
    for (const syncMode of ["webhook", "manual"] as const) {
      const quiet = source({ source_type_key: "supabase", sync_mode: syncMode, next_sync_at: "2026-10-02T05:00:00.000Z", metadata: {} });
      expect(platformHealth(quiet, now), syncMode).toEqual({ tone: "green", label: "Live", needsAttention: false });
      expect(platformHealth({ ...quiet, last_success_at: null }, now), syncMode).toEqual({ tone: "slate", label: "No data yet", needsAttention: false });
    }
    const hybrid = source({ source_type_key: "supabase", sync_mode: "hybrid", next_sync_at: "2026-10-02T05:00:00.000Z", metadata: {} });
    expect(platformHealth(hybrid, now).label).toBe("Sync overdue");
  });

  it("asks for a reconnect when a sync fails on a revoked authorization", () => {
    const revoked = source({ status: "error", last_error: "Error validating access token: Session has expired on Thursday, 01-Oct-26 10:00:00 PDT." });
    expect(platformHealth(revoked, now)).toEqual({ tone: "rose", label: "Reconnect needed", needsAttention: true });
    expect(platformHealth(source({ status: "error", last_error: "Instagram returned an unexpected response." }), now).label).toBe("Sync error");
  });
});

describe("live paid delivery", () => {
  const maxAgeMs = 15 * 60_000;
  const metaAds = (overrides: Partial<Source> = {}) => source({ source_type_key: "meta_ads", external_account_id: "act_111", ...overrides });
  const overview = (adsSource: Source | null) => buildPaidAdsOverview({
    source: adsSource,
    instagramSourceId: "instagram-1",
    rows: [],
    range: overviewRange("30d", new Date(now)),
    now: new Date(now),
  });

  it("syncs only when the shown delivery is older than the allowed age and no retry is pending", () => {
    expect(shouldAutoSync({ now, lastSyncedAt: "2026-10-02T11:50:00.000Z", nextAttemptAt: undefined, maxAgeMs })).toBe(false);
    expect(shouldAutoSync({ now, lastSyncedAt: "2026-10-02T11:40:00.000Z", nextAttemptAt: undefined, maxAgeMs })).toBe(true);
    expect(shouldAutoSync({ now, lastSyncedAt: "2026-10-02T11:40:00.000Z", nextAttemptAt: now + 60_000, maxAgeMs })).toBe(false);
    expect(shouldAutoSync({ now, lastSyncedAt: "2026-10-02T11:40:00.000Z", nextAttemptAt: now, maxAgeMs })).toBe(true);
    expect(shouldAutoSync({ now, lastSyncedAt: null, nextAttemptAt: undefined, maxAgeMs })).toBe(true);
  });

  it("keeps live and overdue connections fresh but never retries setup, errors, fixtures, or demo data", () => {
    expect(paidAdsAutoSyncEnabled(overview(metaAds()))).toBe(true);
    expect(paidAdsAutoSyncEnabled(overview(metaAds({ next_sync_at: "2026-10-02T05:00:00.000Z" })))).toBe(true);
    expect(paidAdsAutoSyncEnabled(overview(metaAds({ status: "error", last_error: "Meta returned an unexpected response." })))).toBe(false);
    expect(paidAdsAutoSyncEnabled(overview(metaAds({ metadata: { oauth_connected: true, token_expires_at: "2026-09-14T00:00:00.000Z" } })))).toBe(false);
    expect(paidAdsAutoSyncEnabled(overview(metaAds({ last_success_at: null })))).toBe(false);
    expect(paidAdsAutoSyncEnabled(overview(metaAds({ external_account_id: null })))).toBe(false);
    expect(paidAdsAutoSyncEnabled(overview(metaAds({ metadata: { oauth_connected: true, fixture: true } })))).toBe(false);
    expect(paidAdsAutoSyncEnabled(overview(metaAds({ status: "demo" })))).toBe(false);
    expect(paidAdsAutoSyncEnabled(overview(null))).toBe(false);
  });

  it("shows a prompt instead of empty panels when nothing was ever synced", () => {
    const failedFirstSync = overview(metaAds({ status: "error", last_error: "Meta returned an unexpected response.", last_success_at: null }));
    expect(failedFirstSync.state).toBe("error");
    expect(paidAdsHasData(failedFirstSync)).toBe(false);
    expect(paidAdsHasData(overview(metaAds({ status: "error", last_error: "Meta returned an unexpected response." })))).toBe(true);
  });

  it("does not claim no delivery before today's first sync", () => {
    // Last synced at 23:30 yesterday in Los Angeles.
    const beforeFirstSync = overview(metaAds({ last_success_at: "2026-10-02T06:30:00.000Z" }));
    expect(beforeFirstSync.state).toBe("live");
    expect(paidAdsStatus(beforeFirstSync)).toEqual({ tone: "slate", label: "Awaiting today's data" });
    expect(paidAdsStatus(overview(metaAds()))).toEqual({ tone: "slate", label: "No delivery today" });
  });

  it("says how fresh delivery is and how it stays fresh", () => {
    const liveCopy = "Updated 20 min ago. Syncs with Meta every 15 minutes while this page is open.";
    expect(paidAdsFreshness(overview(metaAds()), now)).toBe(liveCopy);
    // Local previews read like production even though a fixture never syncs.
    expect(paidAdsFreshness(overview(metaAds({ metadata: { oauth_connected: true, fixture: true } })), now)).toBe(liveCopy);
    expect(paidAdsFreshness(overview(metaAds({ status: "error", last_error: "Meta returned an unexpected response." })), now)).toMatch(
      /^Updated 20 min ago, next automatic sync at .+\.$/u,
    );
    expect(paidAdsFreshness(overview(metaAds({ last_success_at: null })), now)).toBeNull();
  });
});

describe("formatting", () => {
  it("never renders unavailable values as zero", () => {
    expect(formatMetricValue(null, "usd")).toBe("—");
    expect(formatMetricValue(0, "usd")).toBe("$0.00");
    expect(formatMetricValue(1.234, "ratio")).toBe("1.23×");
    expect(formatMetricValue(12_345, "count", { compact: true })).toBe("12.3K");
  });

  it("keeps chart axis labels short", () => {
    expect(formatAxisValue(100, "usd")).toBe("$100");
    expect(formatAxisValue(25_000, "usd")).toBe("$25K");
    expect(formatAxisValue(2.5, "usd")).toBe("$2.5");
    expect(formatAxisValue(1_250, "count")).toBe("1.3K");
  });
});
