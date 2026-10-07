import { beforeEach, describe, expect, it } from "vitest";
import { getWhatnotDetail } from "@/aggregation/services/platform-overview-service";
import { POST as importRoute } from "@/app/api/sources/[id]/import/route";
import { POST as syncRoute } from "@/app/api/sources/[id]/sync/route";
import { detectSource, getInitialSourceStatus } from "@/collection/connectors/registry";
import { whatnotConnector } from "@/collection/connectors/whatnot/connector";
import { parseWhatnotWeeklyReport, WHATNOT_MAX_REPORT_BYTES, WHATNOT_REPORT_KIND } from "@/collection/connectors/whatnot/weekly-report";
import { enqueueSyncRun } from "@/collection/sync/engine";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { createSource } from "@/storage/repositories/sources-repository";
import { AUTO_LAB_DATA_SPACE_SLUG, DATA_SPACE_IDS } from "@/storage/data-spaces";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";
import { weeklyReportCsv, whatnotSale, WHATNOT_TEST_WEEK, type WhatnotReportLine } from "../fixtures/whatnot-report";

const REPORT = weeklyReportCsv([
  whatnotSale({ "Order ID": "ORD-1", "Ledger Transaction ID": "L-1" }),
  whatnotSale({ "Order ID": "ORD-2", "Ledger Transaction ID": "L-2", "Post Coupon Price": "$30.00", "Transaction Amount": "$25.00" }),
]);

async function whatnotSource(): Promise<Source> {
  return createSource({
    data_space_id: DATA_SPACE_IDS.moonarq,
    source_type_key: "whatnot",
    display_name: "Whatnot: moonarq",
    input_url: "https://www.whatnot.com/user/moonarq",
    normalized_url: "https://www.whatnot.com/user/moonarq",
    account_name: "moonarq",
    sync_mode: "manual",
    status: "healthy",
  });
}

/** One sale in the week of Sep 14, two weeks before the test week. */
const EARLIER_REPORT = weeklyReportCsv([whatnotSale({
  "Report Start Date": "2026-09-14",
  "Order Placed At UTC": "2026-09-12 02:00:00",
  "Transaction Completed at UTC": "2026-09-16 20:00:00",
  "Ledger Transaction ID": "E-1",
  "Order ID": "E-ORD-1",
})]);

function importPayload(csv = REPORT): JsonRecord {
  const parsed = parseWhatnotWeeklyReport(csv);
  if (!parsed.ok) throw new Error(parsed.error);
  return { kind: WHATNOT_REPORT_KIND, fileName: "report.csv", rows: parsed.rows as unknown as JsonRecord[] };
}

function uploadRequest(sourceId: string, file: File | null, query = "") {
  const form = new FormData();
  if (file) form.append("file", file);
  return importRoute(
    new Request(`https://app.example.com/api/sources/${sourceId}/import${query}`, { method: "POST", body: form }),
    { params: Promise.resolve({ id: sourceId }) },
  );
}

function weekRequest(sourceId: string, body: unknown) {
  return importRoute(
    new Request(`https://app.example.com/api/sources/${sourceId}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: sourceId }) },
  );
}

function whatnotMetrics(sourceId: string) {
  return getDemoStore().metricsDaily.filter((row) => row.source_id === sourceId);
}

function total(sourceId: string, metricKey: string, filter: (dimensions: JsonRecord) => boolean = () => true) {
  return whatnotMetrics(sourceId)
    .filter((row) => row.metric_key === metricKey && filter(row.dimensions))
    .reduce((sum, row) => sum + row.metric_value, 0);
}

describe("Whatnot connector", () => {
  beforeEach(() => resetDemoStore());

  it("recognizes seller profiles and names the source after them", () => {
    expect(whatnotConnector.detect("https://www.whatnot.com/user/moonarq?ref=share")).toMatchObject({
      sourceTypeKey: "whatnot",
      availability: "live",
      setupKind: "upload",
      confidence: 0.97,
      normalizedUrl: "https://www.whatnot.com/user/moonarq",
      accountName: "moonarq",
    });
    expect(whatnotConnector.detect("https://whatnot.com/live/abc")).toMatchObject({ confidence: 0.7, accountName: null });
    expect(whatnotConnector.detect("https://www.etsy.com/shop/moonarq")).toBeNull();
    expect(detectSource("https://www.whatnot.com/user/moonarq")[0]?.sourceTypeKey).toBe("whatnot");
  });

  it("needs no credentials and starts ready for its first report", () => {
    expect(whatnotConnector.requiredFields).toEqual([]);
    expect(whatnotConnector.capabilities).toMatchObject({ supportsPolling: false, supportsWebhook: false, supportsManualSync: true, canTestConnection: false });
    expect(getInitialSourceStatus(whatnotConnector, true)).toBe("healthy");
    expect(getInitialSourceStatus(whatnotConnector, false)).toBe("demo");
    expect(whatnotConnector.getMetricDefinitions().map((definition) => definition.key)).toEqual(expect.arrayContaining([
      "whatnot_sales",
      "whatnot_orders",
      "whatnot_net_earnings",
      "whatnot_show_sales",
    ]));
  });

  it("has nothing to fetch without an uploaded report", async () => {
    const source = await whatnotSource();
    const result = await whatnotConnector.sync({ source, credentials: {}, isDemoMode: false, trigger: "manual" });
    expect(result).toMatchObject({ rawPayloads: [], recordsFetched: 0, skippedReason: expect.stringContaining("Weekly Orders Report") });
  });

  it("stores one raw snapshot for the report week, recognized again when re-uploaded", async () => {
    const source = await whatnotSource();
    const payload = importPayload();
    const first = await whatnotConnector.sync({ source, credentials: {}, isDemoMode: false, trigger: "manual", importPayload: payload });
    const reordered = { ...payload, rows: [...(payload.rows as JsonRecord[])].reverse() };
    const second = await whatnotConnector.sync({ source, credentials: {}, isDemoMode: false, trigger: "manual", importPayload: reordered });
    expect(first.rawPayloads).toHaveLength(1);
    expect(first.rawPayloads[0]).toMatchObject({ externalId: `whatnot:weekly_report:${WHATNOT_TEST_WEEK}`, cursor: { reportWeek: WHATNOT_TEST_WEEK } });
    expect(second.rawPayloads[0].payloadHash).toBe(first.rawPayloads[0].payloadHash);
  });

  it("replaces exactly one report week when normalizing", async () => {
    const source = await whatnotSource();
    const synced = await whatnotConnector.sync({ source, credentials: {}, isDemoMode: false, trigger: "manual", importPayload: importPayload() });
    const normalized = await whatnotConnector.normalize(synced.rawPayloads, source);
    expect(normalized.replaceMetricWindow).toEqual({
      metricKeys: expect.arrayContaining(["whatnot_sales", "whatnot_show_sales"]),
      startDate: "2026-09-27",
      endDate: "2026-10-04",
      dimension: { key: "report_week", value: WHATNOT_TEST_WEEK },
    });
    expect(normalized.metrics.every((metric) => metric.dimensions?.report_week === WHATNOT_TEST_WEEK)).toBe(true);
  });

  it("writes zeros for a week without sales, and nothing for a removed week, replacing that week either way", async () => {
    const source = await whatnotSource();
    const noSales = await whatnotConnector.sync({
      source, credentials: {}, isDemoMode: false, trigger: "manual",
      importPayload: { kind: WHATNOT_REPORT_KIND, mode: "no_sales", reportWeek: "2026-09-21", currency: "cad" },
    });
    expect(noSales.rawPayloads[0]).toMatchObject({ externalId: "whatnot:weekly_report:2026-09-21", payload: { mode: "no_sales", rows: [] } });
    const zeros = await whatnotConnector.normalize(noSales.rawPayloads, source);
    expect(zeros.metrics).toHaveLength(8 * 8);
    expect(zeros.metrics.every((metric) => metric.metricValue === 0 && metric.dimensions?.recorded_as === "no_sales")).toBe(true);
    expect(zeros.metrics.find((metric) => metric.metricKey === "whatnot_net_earnings")?.unit).toBe("cad");
    expect(zeros.replaceMetricWindow).toMatchObject({ startDate: "2026-09-20", endDate: "2026-09-27", dimension: { key: "report_week", value: "2026-09-21" } });

    // Nothing is stored yet, so a removal has nothing to do.
    await expect(whatnotConnector.sync({
      source, credentials: {}, isDemoMode: false, trigger: "manual",
      importPayload: { kind: WHATNOT_REPORT_KIND, mode: "remove", reportWeek: "2026-09-21" },
    })).resolves.toMatchObject({ rawPayloads: [], skippedReason: "Nothing is imported for that week." });
    await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: { kind: WHATNOT_REPORT_KIND, mode: "no_sales", reportWeek: "2026-09-21" } });
    const removal = await whatnotConnector.sync({
      source, credentials: {}, isDemoMode: false, trigger: "manual",
      importPayload: { kind: WHATNOT_REPORT_KIND, mode: "remove", reportWeek: "2026-09-21" },
    });
    const removed = await whatnotConnector.normalize(removal.rawPayloads, source);
    expect(removed.metrics).toEqual([]);
    expect(removed.replaceMetricWindow?.dimension).toEqual({ key: "report_week", value: "2026-09-21" });
    // A week that is not a Monday is not a report week, so nothing is changed.
    await expect(whatnotConnector.sync({
      source, credentials: {}, isDemoMode: false, trigger: "manual",
      importPayload: { kind: WHATNOT_REPORT_KIND, mode: "remove", reportWeek: "2026-09-22" },
    })).resolves.toMatchObject({ skippedReason: expect.stringContaining("nothing to fetch") });
  });

  it("imports through the shared engine, and importing the same week again changes nothing", async () => {
    const source = await whatnotSource();
    const run = await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: importPayload() });
    expect(run).toMatchObject({ status: "success", trigger: "manual", records_fetched: 2 });
    const store = getDemoStore();
    const afterFirst = { raw: store.rawIngestions.length, metrics: whatnotMetrics(source.id).length };
    expect(total(source.id, "whatnot_sales")).toBe(78);

    const again = await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: importPayload() });
    expect(again.status).toBe("success");
    expect({ raw: store.rawIngestions.length, metrics: whatnotMetrics(source.id).length }).toEqual(afterFirst);
    expect(total(source.id, "whatnot_sales")).toBe(78);
    expect(store.sources.find((item) => item.id === source.id)?.last_success_at).toBeTruthy();
  });

  it("replaces a corrected week completely, and leaves the neighbouring week's shared Sunday alone", async () => {
    const source = await whatnotSource();
    // Week of Sep 21: a sale completed Sunday, Sep 27 at 15:00 Pacific (22:00 UTC, still that week).
    const previousWeek = weeklyReportCsv([whatnotSale({
      "Report Start Date": "2026-09-21",
      "Ledger Transaction ID": "P-1",
      "Order ID": "P-ORD-1",
      "Order Placed At UTC": "2026-09-20 02:00:00",
      "Transaction Completed at UTC": "2026-09-27 22:00:00",
      "Post Coupon Price": "$11.00",
      "Livestream ID": "live-0",
      "Livestream Title": "Earlier show",
    })]);
    expect((await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: importPayload(previousWeek) })).status).toBe("success");

    // Week of Sep 28, first version: a sale on Sunday evening, Sep 27 Pacific (Sep 28 in UTC), and two on Sep 30.
    const firstVersion: WhatnotReportLine[] = [
      whatnotSale({ "Ledger Transaction ID": "L-1", "Order ID": "ORD-1", "Transaction Completed at UTC": "2026-09-28 01:00:00", "Post Coupon Price": "$7.00" }),
      whatnotSale({ "Ledger Transaction ID": "L-2", "Order ID": "ORD-2" }),
      whatnotSale({ "Ledger Transaction ID": "L-3", "Order ID": "ORD-3", "Post Coupon Price": "$30.00" }),
    ];
    expect((await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: importPayload(weeklyReportCsv(firstVersion)) })).status).toBe("success");
    const previousWeekRows = (dimensions: JsonRecord) => dimensions.report_week === "2026-09-21";
    expect(total(source.id, "whatnot_sales")).toBe(11 + 7 + 48 + 30);
    expect(whatnotMetrics(source.id).filter((row) => row.date === "2026-09-27" && row.metric_key === "whatnot_sales").map((row) => row.metric_value).sort((left, right) => left - right))
      .toEqual([7, 11]);

    // The corrected report drops the Sunday sale and one order, and the show was renamed.
    const corrected = weeklyReportCsv([whatnotSale({ "Ledger Transaction ID": "L-2", "Order ID": "ORD-2", "Livestream Title": "Wednesday silver drop, encore" })]);
    expect((await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: importPayload(corrected) })).status).toBe("success");

    const thisWeek = (dimensions: JsonRecord) => dimensions.report_week === WHATNOT_TEST_WEEK;
    expect(total(source.id, "whatnot_sales", thisWeek)).toBe(48);
    expect(total(source.id, "whatnot_orders", thisWeek)).toBe(1);
    const showTitles = new Set(whatnotMetrics(source.id)
      .filter((row) => row.metric_key === "whatnot_show_sales" && thisWeek(row.dimensions))
      .map((row) => row.dimensions.livestream_title));
    expect([...showTitles]).toEqual(["Wednesday silver drop, encore"]);
    expect(total(source.id, "whatnot_show_sales", thisWeek)).toBe(48);
    // The previous week, including its part of Sunday, Sep 27, is untouched.
    expect(total(source.id, "whatnot_sales", previousWeekRows)).toBe(11);
    expect(total(source.id, "whatnot_show_sales", previousWeekRows)).toBe(11);
    expect(whatnotMetrics(source.id).filter((row) => row.date === "2026-09-27" && row.metric_key === "whatnot_sales").map((row) => row.metric_value).sort((left, right) => left - right))
      .toEqual([0, 11]);
  });

  it("imports an uploaded CSV through the import route and reports what it left out", async () => {
    const source = await whatnotSource();
    const csv = weeklyReportCsv([
      whatnotSale({ "Order ID": "ORD-1", "Ledger Transaction ID": "L-1" }),
      whatnotSale({ "Order ID": "ORD-2", "Ledger Transaction ID": "L-2", "Post Coupon Price": "$30.00", "Transaction Amount": "$25.00" }),
      whatnotSale({ "Order ID": "ORD-2", "Ledger Transaction ID": "L-2", "Post Coupon Price": "$30.00", "Transaction Amount": "$25.00" }),
      whatnotSale({ "Ledger Transaction ID": "" }),
      ...Array.from({ length: 8 }, (_, index) => whatnotSale({ "Order ID": `ORD-X${index}`, "Ledger Transaction ID": `L-X${index}` })),
    ]);
    const response = await uploadRequest(source.id, new File([csv], "Weekly Orders Report.csv", { type: "text/csv" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      error: null,
      run: { status: "success", trigger: "manual", records_fetched: 10 },
      import: { reportWeek: WHATNOT_TEST_WEEK, transactions: 10, skippedRows: 1, duplicateRows: 1, currency: "usd" },
    });
    expect(JSON.stringify(getDemoStore().rawIngestions.filter((row) => row.source_id === source.id))).not.toContain("Private Person");
  });

  it("rejects a wrong file before anything is stored or the source is marked failing", async () => {
    const source = await whatnotSource();
    const store = getDemoStore();
    const runsBefore = store.syncRuns.length;
    const wrong = await uploadRequest(source.id, new File(["name,email\nA,a@example.com"], "contacts.csv", { type: "text/csv" }));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toContain("not a Whatnot Weekly Orders Report");
    const missing = await uploadRequest(source.id, null);
    expect(missing.status).toBe(400);
    const notCsv = await uploadRequest(source.id, new File([REPORT], "report.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    expect(notCsv.status).toBe(400);
    const tooLarge = await uploadRequest(source.id, new File(["x".repeat(WHATNOT_MAX_REPORT_BYTES + 1)], "report.csv", { type: "text/csv" }));
    expect(tooLarge.status).toBe(413);
    expect(store.syncRuns).toHaveLength(runsBefore);
    expect(store.sources.find((item) => item.id === source.id)?.status).toBe("healthy");
  });

  it("keeps imports inside the source's data space", async () => {
    const source = await whatnotSource();
    const response = await uploadRequest(source.id, new File([REPORT], "report.csv", { type: "text/csv" }), `?dataSpaceSlug=${AUTO_LAB_DATA_SPACE_SLUG}`);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Source not found.");
    expect(whatnotMetrics(source.id)).toHaveLength(0);
  });

  it("records a week without sales, refuses it for an imported week, and removes a week on request", async () => {
    const source = await whatnotSource();
    expect((await uploadRequest(source.id, new File([EARLIER_REPORT], "earlier.csv", { type: "text/csv" }))).status).toBe(200);
    expect((await uploadRequest(source.id, new File([REPORT], "report.csv", { type: "text/csv" }))).status).toBe(200);
    const imported = total(source.id, "whatnot_sales");
    expect(imported).toBe(48 + 78);

    const noSales = await weekRequest(source.id, { action: "no_sales", reportWeek: "2026-09-21" });
    expect(noSales.status).toBe(200);
    expect(await noSales.json()).toMatchObject({ ok: true, week: { reportWeek: "2026-09-21", action: "no_sales" } });
    const emptyWeek = whatnotMetrics(source.id).filter((row) => row.dimensions.report_week === "2026-09-21");
    expect(emptyWeek).toHaveLength(8 * 8);
    expect(emptyWeek.every((row) => row.metric_value === 0)).toBe(true);
    // The zero rows carry the currency the imported sales use.
    expect(emptyWeek.find((row) => row.metric_key === "whatnot_sales")?.unit).toBe("usd");

    const onImported = await weekRequest(source.id, { action: "no_sales", reportWeek: WHATNOT_TEST_WEEK });
    expect(onImported.status).toBe(409);
    expect((await onImported.json()).error).toContain("already has an imported report");
    expect(total(source.id, "whatnot_sales")).toBe(imported);

    const removed = await weekRequest(source.id, { action: "remove", reportWeek: WHATNOT_TEST_WEEK });
    expect(removed.status).toBe(200);
    expect(whatnotMetrics(source.id).filter((row) => row.dimensions.report_week === WHATNOT_TEST_WEEK)).toHaveLength(0);
    expect(whatnotMetrics(source.id).filter((row) => row.dimensions.report_week === "2026-09-21")).toHaveLength(64);
    expect(total(source.id, "whatnot_sales")).toBe(48);
    expect((await weekRequest(source.id, { action: "remove", reportWeek: WHATNOT_TEST_WEEK })).status).toBe(409);
  });

  it("checks the week again under the sync lock, so a week action never overwrites an import that just finished", async () => {
    const source = await whatnotSource();
    expect((await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: importPayload() })).status).toBe("success");
    // As if the route's check had run before the import committed.
    const late = await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: { kind: WHATNOT_REPORT_KIND, mode: "no_sales", reportWeek: WHATNOT_TEST_WEEK } });
    expect(late).toMatchObject({ status: "skipped", error_message: expect.stringContaining("has an imported report now") });
    expect(total(source.id, "whatnot_sales")).toBe(78);
    expect(getDemoStore().sources.find((item) => item.id === source.id)?.status).toBe("healthy");
  });

  it("only records no sales for weeks from the first imported report onward", async () => {
    const source = await whatnotSource();
    const beforeAnyImport = await weekRequest(source.id, { action: "no_sales", reportWeek: "2026-09-21" });
    expect(beforeAnyImport.status).toBe(400);
    expect((await beforeAnyImport.json()).error).toContain("Import a report first");
    expect((await uploadRequest(source.id, new File([EARLIER_REPORT], "earlier.csv", { type: "text/csv" }))).status).toBe(200);
    expect((await weekRequest(source.id, { action: "no_sales", reportWeek: "2026-09-07" })).status).toBe(400);
    expect((await weekRequest(source.id, { action: "no_sales", reportWeek: "2026-09-21" })).status).toBe(200);
  });

  it("refuses week changes that do not name a finished report week", async () => {
    const source = await whatnotSource();
    const store = getDemoStore();
    const runsBefore = store.syncRuns.length;
    for (const body of [
      { action: "no_sales", reportWeek: "2026-09-22" },
      { action: "no_sales", reportWeek: "2099-01-05" },
      { action: "no_sales", reportWeek: "2018-01-01" },
      { action: "delete_everything", reportWeek: "2026-09-21" },
      { reportWeek: "2026-09-21" },
      null,
    ]) {
      expect((await weekRequest(source.id, body)).status).toBe(400);
    }
    expect(store.syncRuns).toHaveLength(runsBefore);
  });

  it("only imports reports into upload sources", async () => {
    const response = await uploadRequest(DEMO_SOURCE_IDS.supabase, new File([REPORT], "report.csv", { type: "text/csv" }));
    expect(response.status).toBe(409);
  });

  it("does not run a pointless sync when Refresh is pressed on a Whatnot source", async () => {
    const source = await whatnotSource();
    const response = await syncRoute(
      new Request(`https://app.example.com/api/sources/${source.id}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id: source.id }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).run).toMatchObject({ status: "skipped" });
    expect(getDemoStore().sources.find((item) => item.id === source.id)?.status).toBe("healthy");
  });
});

describe("Whatnot page data", () => {
  beforeEach(() => resetDemoStore());

  it("shows days inside a missing week as not imported, and leaves them out of totals", async () => {
    const source = await whatnotSource();
    const weekOf = (completedAt: string, ledgerId: string, price: string) => weeklyReportCsv([whatnotSale({
      "Report Start Date": "",
      "Ledger Transaction ID": ledgerId,
      "Order ID": ledgerId,
      "Order Placed At UTC": "",
      "Transaction Completed at UTC": completedAt,
      "Post Coupon Price": price,
    })]);
    await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: importPayload(weekOf("2026-09-16 20:00:00", "A-1", "$100.00")) });
    await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: importPayload(weekOf("2026-09-30 21:40:00", "B-1", "$48.00")) });

    const detail = await getWhatnotDetail({
      dataSpace: { id: DATA_SPACE_IDS.moonarq, slug: "moonarq" },
      rangeKey: "30d",
      now: new Date("2026-10-07T17:00:00.000Z"),
    });
    expect(detail.coverage).toMatchObject({ missingWeeks: ["2026-09-21"], coveredFrom: "2026-09-14", coveredThrough: "2026-10-03" });
    expect(detail.period).toEqual({ start: "2026-09-14", end: "2026-10-03", missingWeeks: ["2026-09-21"] });
    const sales = detail.metrics.find((metric) => metric.key === "sales");
    expect(sales).toMatchObject({ label: "Completed sales", value: 148, delta: { kind: "none", reason: "incomplete" } });
    const byDate = new Map(detail.daily.map((point) => [point.date, point.sales]));
    expect(byDate.get("2026-09-16")).toBe(100);
    expect(byDate.get("2026-09-19")).toBe(0);
    for (const date of ["2026-09-20", "2026-09-23", "2026-09-27"]) expect(byDate.get(date)).toBeNull();
    expect(byDate.get("2026-09-30")).toBe(48);
    expect(detail.daily.at(-1)?.date).toBe("2026-10-03");
    expect(detail.card.sparkline.points.map((point) => point.date)).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03",
    ]);
    expect(detail.shows).toEqual([
      { id: "live-1", title: "Wednesday silver drop", date: "2026-09-16", sales: 148, orders: 2, items: 2 },
    ]);
    expect(detail.weeks).toEqual([
      { reportWeek: "2026-09-28", status: "imported" },
      { reportWeek: "2026-09-21", status: "missing" },
      { reportWeek: "2026-09-14", status: "imported" },
    ]);

    // Recording the missing week as having no sales completes the coverage.
    await enqueueSyncRun({ sourceId: source.id, trigger: "manual", importPayload: { kind: WHATNOT_REPORT_KIND, mode: "no_sales", reportWeek: "2026-09-21" } });
    const filled = await getWhatnotDetail({
      dataSpace: { id: DATA_SPACE_IDS.moonarq, slug: "moonarq" },
      rangeKey: "30d",
      now: new Date("2026-10-07T17:00:00.000Z"),
    });
    expect(filled.coverage).toMatchObject({ missingWeeks: [], coveredRuns: [{ from: "2026-09-14", through: "2026-10-03" }] });
    expect(filled.weeks.map((week) => week.status)).toEqual(["imported", "no_sales", "imported"]);
    expect(filled.metrics.find((metric) => metric.key === "sales")).toMatchObject({ value: 148, delta: { kind: "none", reason: "no_baseline" } });
    expect(filled.daily.every((point) => point.sales !== null)).toBe(true);
  });
});
