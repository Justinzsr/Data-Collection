import { describe, expect, it } from "vitest";
import {
  buildPlatformCards,
  coveredWindows,
  overviewRange,
  whatnotCard,
  whatnotCoverage,
  whatnotReportWeeks,
  whatnotShows,
  whatnotWeekRows,
} from "@/aggregation/services/platform-overview-service";
import type { JsonRecord, MetricDaily, Source } from "@/storage/db/schema";
import { cardFreshness, cardHealth } from "@/presentation/overview/platform-overview-card";

// Wednesday Oct 7, 2026, 10:00 in Los Angeles. The newest published report is the week of Sep 28.
const NOW = new Date("2026-10-07T17:00:00.000Z");

function whatnotSourceRecord(patch: Partial<Source> = {}): Source {
  return {
    id: "whatnot-source",
    data_space_id: "space",
    source_type_key: "whatnot",
    display_name: "Whatnot: moonarq",
    input_url: null,
    normalized_url: null,
    external_account_id: null,
    account_name: "moonarq",
    status: "healthy",
    sync_mode: "manual",
    sync_frequency_minutes: 10080,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: "2026-10-05T16:00:00.000Z",
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: "2026-10-05T16:00:00.000Z",
    last_error_at: null,
    last_error: null,
    next_sync_at: "2026-10-12T00:00:00.000Z",
    metadata: {},
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-10-05T16:00:00.000Z",
    ...patch,
  };
}

function metric(metricKey: string, date: string, value: number, dimensions: JsonRecord, unit = "usd"): MetricDaily {
  return {
    id: `${metricKey}-${date}-${JSON.stringify(dimensions)}`,
    date,
    source_id: "whatnot-source",
    source_type_key: "whatnot",
    metric_key: metricKey,
    metric_value: value,
    unit,
    dimensions,
    dimensions_hash: JSON.stringify(dimensions),
    created_at: "2026-10-05T16:00:00.000Z",
    updated_at: "2026-10-05T16:00:00.000Z",
  };
}

const weekly = (week: string) => ({ rollup: "weekly_report", report_week: week });

/** Daily sales of 100 through the week of Sep 21, and 150 the week of Sep 28. */
function rows(weeks: string[]) {
  const result: MetricDaily[] = [];
  for (const week of weeks) {
    const start = new Date(`${week}T12:00:00.000Z`);
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
      const sales = week === "2026-09-28" ? 150 : 100;
      result.push(
        metric("whatnot_sales", date, sales, weekly(week)),
        metric("whatnot_orders", date, 2, weekly(week), "count"),
        metric("whatnot_net_earnings", date, sales * 0.8, weekly(week)),
      );
    }
  }
  return result;
}

describe("Whatnot report coverage", () => {
  it("reads the imported weeks and covers Monday through Saturday of the latest", () => {
    const weeks = whatnotReportWeeks(rows(["2026-09-21", "2026-09-28"]), "whatnot-source");
    expect(weeks).toEqual(["2026-09-21", "2026-09-28"]);
    expect(whatnotCoverage(weeks, NOW)).toEqual({
      coveredRuns: [{ from: "2026-09-21", through: "2026-10-03" }],
      coveredFrom: "2026-09-21",
      coveredThrough: "2026-10-03",
      missingWeeks: [],
      pendingWeeks: [],
      newReportAvailable: false,
    });
    expect(whatnotCoverage(["2026-09-14"], NOW)).toMatchObject({ pendingWeeks: ["2026-09-21", "2026-09-28"], newReportAvailable: true });
    expect(whatnotCoverage([], NOW)).toEqual({
      coveredRuns: [],
      coveredFrom: null,
      coveredThrough: null,
      missingWeeks: [],
      pendingWeeks: [],
      newReportAvailable: false,
    });
  });

  it("lists the weeks missing between imports and leaves their days uncovered", () => {
    expect(whatnotCoverage(["2026-09-07", "2026-09-28"], NOW)).toMatchObject({
      coveredRuns: [{ from: "2026-09-07", through: "2026-09-12" }, { from: "2026-09-28", through: "2026-10-03" }],
      missingWeeks: ["2026-09-14", "2026-09-21"],
      newReportAvailable: false,
    });
  });

  it("clips a range to the covered days and compares with the same days one period earlier", () => {
    const range = overviewRange("7d", NOW);
    expect(range).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-07" });
    const coverage = whatnotCoverage(["2026-09-21", "2026-09-28"], NOW);
    expect(coveredWindows(range, coverage)).toEqual({
      start: "2026-10-01",
      end: "2026-10-03",
      coveredRuns: coverage.coveredRuns,
      missingWeeks: [],
      complete: true,
      comparison: {
        currentStart: "2026-10-01",
        currentEnd: "2026-10-03",
        previousStart: "2026-09-24",
        previousEnd: "2026-09-26",
        basis: "vs previous 7 days",
        currentComplete: true,
        previousComplete: true,
      },
    });
    const onlyLatest = coveredWindows(range, whatnotCoverage(["2026-09-28"], NOW));
    expect(onlyLatest?.comparison).toMatchObject({ currentComplete: true, previousComplete: false });
    expect(coveredWindows(overviewRange("today", NOW), whatnotCoverage(["2026-09-28"], NOW))).toBeNull();
  });
});

describe("Whatnot card", () => {
  it("leads with completed sales over the covered days and how they changed", () => {
    const card = whatnotCard({
      source: whatnotSourceRecord(),
      rows: rows(["2026-09-21", "2026-09-28"]),
      reportWeeks: ["2026-09-21", "2026-09-28"],
      range: overviewRange("7d", NOW),
      now: NOW,
    });
    expect(card.primary).toMatchObject({ key: "sales", label: "Completed sales", value: 450, unit: "usd", delta: { kind: "percent", value: 50, basis: "vs previous 7 days" } });
    expect(card.secondary.map((item) => [item.key, item.value])).toEqual([["orders", 6], ["net_earnings", 360]]);
    expect(card.sparkline.points.at(-1)).toEqual({ date: "2026-10-03", value: 150 });
    expect(card.unavailableReason).toBeNull();
    expect(cardFreshness(card, NOW.getTime())).toBe("Data through Oct 3");
    expect(cardHealth(card, NOW.getTime())).toEqual({ tone: "green", label: "Up to date", needsAttention: false });
  });

  it("never compares a period that crosses a missing week", () => {
    const weeks = ["2026-09-14", "2026-09-28"];
    const sevenDays = whatnotCard({ source: whatnotSourceRecord(), rows: rows(weeks), reportWeeks: weeks, range: overviewRange("7d", NOW), now: NOW });
    // Oct 1–3 is covered, but Sep 24–26 falls in the missing week of Sep 21.
    expect(sevenDays.primary).toMatchObject({ value: 450, delta: { kind: "none", reason: "no_baseline" } });

    const thirtyDays = whatnotCard({ source: whatnotSourceRecord(), rows: rows(weeks), reportWeeks: weeks, range: overviewRange("30d", NOW), now: NOW });
    // Sep 14–19 and Sep 28–Oct 3; the Sundays next to the missing week only partly arrived, so they count for nothing.
    expect(thirtyDays.primary).toMatchObject({
      value: 6 * 100 + 6 * 150,
      delta: { kind: "none", reason: "incomplete", basis: "The week of Sep 21 – Sep 27 is not imported" },
    });
    expect(thirtyDays.sparkline.points.map((point) => point.date)).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03",
    ]);
    expect(cardHealth(thirtyDays, NOW.getTime())).toEqual({ tone: "amber", label: "1 week missing", needsAttention: false });
  });

  it("asks for the first report, and says when a newer report is ready", () => {
    const empty = whatnotCard({ source: whatnotSourceRecord({ last_success_at: null }), rows: [], reportWeeks: [], range: overviewRange("30d", NOW), now: NOW });
    expect(empty.unavailableReason).toBe("Import your first Whatnot weekly orders report.");
    expect(empty.primary.value).toBeNull();
    expect(cardFreshness(empty, NOW.getTime())).toBe("No report imported yet");
    expect(cardHealth(empty, NOW.getTime()).label).toBe("No data yet");

    const behind = whatnotCard({ source: whatnotSourceRecord(), rows: rows(["2026-09-21"]), reportWeeks: ["2026-09-21"], range: overviewRange("30d", NOW), now: NOW });
    expect(cardHealth(behind, NOW.getTime())).toEqual({ tone: "amber", label: "New report ready", needsAttention: false });
  });

  it("appears on the Overview only once Whatnot is added", () => {
    const range = overviewRange("30d", NOW);
    const without = buildPlatformCards({ dataSpaceSlug: "moonarq", sources: [], sumRows: [], snapshotRows: [], range, websiteOverview: null });
    expect(without.map((card) => card.key)).toEqual(["website", "shopify", "instagram", "tiktok", "supabase"]);
    const withWhatnot = buildPlatformCards({
      dataSpaceSlug: "moonarq",
      sources: [whatnotSourceRecord()],
      sumRows: [],
      snapshotRows: [],
      range,
      websiteOverview: null,
      whatnot: { rows: rows(["2026-09-28"]), reportWeeks: ["2026-09-28"], now: NOW },
    });
    expect(withWhatnot.map((card) => card.key)).toEqual(["website", "shopify", "whatnot", "instagram", "tiktok", "supabase"]);
  });
});

describe("Whatnot shows", () => {
  const show = (week: string, id: string, title: string | null, showDate: string) => ({
    rollup: "show",
    report_week: week,
    livestream_id: id,
    livestream_title: title,
    show_date: showDate,
  });

  it("totals each show over the covered days, highest sales first, dated by the day it ran", () => {
    const showRows = [
      metric("whatnot_show_sales", "2026-09-30", 120, show("2026-09-28", "live-1", "Silver drop", "2026-09-29")),
      metric("whatnot_show_orders", "2026-09-30", 3, show("2026-09-28", "live-1", "Silver drop", "2026-09-29"), "count"),
      metric("whatnot_show_items", "2026-09-30", 4, show("2026-09-28", "live-1", "Silver drop", "2026-09-29"), "count"),
      metric("whatnot_show_sales", "2026-10-02", 300, show("2026-09-28", "live-2", "Friday night", "2026-09-25")),
      metric("whatnot_show_orders", "2026-10-02", 5, show("2026-09-28", "live-2", "Friday night", "2026-09-25"), "count"),
      metric("whatnot_show_sales", "2026-10-01", 25, show("2026-09-28", "marketplace", null, "2026-09-30")),
      metric("whatnot_show_orders", "2026-10-01", 1, show("2026-09-28", "marketplace", null, "2026-09-30"), "count"),
      // Completed outside the covered days of the range.
      metric("whatnot_show_sales", "2026-09-10", 999, show("2026-09-07", "live-0", "Old show", "2026-09-08")),
    ];
    const windows = coveredWindows(overviewRange("7d", NOW), whatnotCoverage(["2026-09-21", "2026-09-28"], NOW));
    expect(whatnotShows(showRows, "whatnot-source", windows)).toEqual([
      { id: "live-2", title: "Friday night", date: "2026-09-25", sales: 300, orders: 5, items: 0 },
      { id: "marketplace", title: null, date: "2026-09-30", sales: 25, orders: 1, items: 0 },
    ]);
  });

  it("adds a show's sales across report weeks and names it as the newest report does", () => {
    const showRows = [
      metric("whatnot_show_sales", "2026-09-26", 40, show("2026-09-21", "live-7", "Saturday drop", "2026-09-25")),
      metric("whatnot_show_sales", "2026-09-29", 60, show("2026-09-28", "live-7", "Saturday drop, part 1", "2026-09-25")),
    ];
    const windows = coveredWindows(overviewRange("30d", NOW), whatnotCoverage(["2026-09-21", "2026-09-28"], NOW));
    expect(whatnotShows(showRows, "whatnot-source", windows)).toEqual([
      { id: "live-7", title: "Saturday drop, part 1", date: "2026-09-25", sales: 100, orders: 0, items: 0 },
    ]);
  });
});

describe("Whatnot report weeks", () => {
  it("lists every week from the newest published back to the first import, with its status", () => {
    const weekRows = [
      ...rows(["2026-09-07"]),
      // A week recorded as having no sales stores zeros with that marker.
      metric("whatnot_net_earnings", "2026-09-22", 0, { ...weekly("2026-09-21"), recorded_as: "no_sales" }),
      metric("whatnot_net_earnings", "2026-09-23", 0, { ...weekly("2026-09-21"), recorded_as: "no_sales" }),
      // A real report whose amounts net to zero is still an imported week.
      metric("whatnot_net_earnings", "2026-09-29", 0, weekly("2026-09-28")),
    ];
    const coverage = whatnotCoverage(whatnotReportWeeks(weekRows, "whatnot-source"), NOW);
    expect(whatnotWeekRows(weekRows, "whatnot-source", coverage)).toEqual([
      { reportWeek: "2026-09-28", status: "imported" },
      { reportWeek: "2026-09-21", status: "no_sales" },
      { reportWeek: "2026-09-14", status: "missing" },
      { reportWeek: "2026-09-07", status: "imported" },
    ]);
    expect(whatnotWeekRows([], "whatnot-source", whatnotCoverage([], NOW))).toEqual([]);
  });

  it("takes the currency from real sales, never from the zeros of a week without sales", () => {
    const card = whatnotCard({
      source: whatnotSourceRecord(),
      rows: [
        metric("whatnot_sales", "2026-09-23", 0, weekly("2026-09-21"), "usd"),
        metric("whatnot_sales", "2026-09-16", 50, weekly("2026-09-14"), "cad"),
      ],
      reportWeeks: ["2026-09-14", "2026-09-21"],
      range: overviewRange("30d", NOW),
      now: NOW,
    });
    expect(card.primary).toMatchObject({ unit: "cad", value: 50 });
  });
});
