import { describe, expect, it } from "vitest";
import {
  aggregateWhatnotReport,
  coveredDateRuns,
  latestPublishedReportWeek,
  parseCsv,
  parseCsvRecords,
  parseMoney,
  parseUtcTimestamp,
  parseWhatnotWeeklyReport,
  reportWeekDates,
  reportWeekFor,
  whatnotWeekMetrics,
  type WhatnotReportRow,
} from "@/collection/connectors/whatnot/weekly-report";
import {
  downloadedGiveaway,
  downloadedReportCsv,
  downloadedSale,
  weeklyReportCsv,
  WHATNOT_DOWNLOADED_WEEK,
  WHATNOT_REPORT_HEADER,
  WHATNOT_TEST_WEEK,
  whatnotSale,
  type WhatnotReportLine,
} from "../fixtures/whatnot-report";

const HEADER = WHATNOT_REPORT_HEADER;
const WEEK = WHATNOT_TEST_WEEK;
const sale = whatnotSale;
type Line = WhatnotReportLine;

function tip(ledgerId: string, completedAt: string, overrides: Line = {}): Line {
  return {
    "Transaction Completed at UTC": completedAt,
    "Transaction Type": "Tips",
    "Transaction Currency": "USD",
    "Transaction Amount": "$5.00",
    "Ledger Transaction ID": ledgerId,
    ...overrides,
  };
}

describe("CSV and value parsing", () => {
  it("reads quoted fields with commas, quotes, and line breaks", () => {
    const rows = parseCsv("﻿a,b,c\r\n\"x, y\",\"say \"\"hi\"\"\",\"line\nbreak\"\r\n1,,3\n\n");
    expect(rows).toEqual([["a", "b", "c"], ["x, y", "say \"hi\"", "line\nbreak"], ["1", "", "3"]]);
  });

  it("keeps a stray quote inside a value, and refuses a quoted value that never closes", () => {
    expect(parseCsv("a,b\nRing size 7\",2\n")).toEqual([["a", "b"], ["Ring size 7\"", "2"]]);
    expect(() => parseCsv("a,b\n\"never closed,2\n3,4\n")).toThrow("never closed");
    expect(() => parseCsv("a,b\n\"x\"y,2\n")).toThrow("after a closing quote");
  });

  it("numbers each record by the line it starts on, blank lines included", () => {
    expect(parseCsvRecords("a,b\n\n1,\"two\nlines\"\n\n3,4\n").map((record) => record.line)).toEqual([1, 3, 6]);
  });

  it("reads money in the formats a spreadsheet may produce", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("-$5.00")).toBe(-5);
    expect(parseMoney("$-5.00")).toBe(-5);
    expect(parseMoney("(5.25)")).toBe(-5.25);
    expect(parseMoney("12")).toBe(12);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("1,234")).toBe(1234);
    expect(parseMoney("USD 12.50")).toBe(12.5);
    expect(parseMoney("12.50 USD")).toBe(12.5);
    expect(Object.is(parseMoney("-0.00"), 0)).toBe(true);
    expect(Number.isNaN(parseMoney("about five"))).toBe(true);
  });

  it("refuses amounts written with decimal commas instead of misreading them", () => {
    for (const value of ["48,00", "1.234,50", "1,23", "--5", "(-5.00)", "5.00-"]) expect(Number.isNaN(parseMoney(value))).toBe(true);
  });

  it("reads UTC timestamps in ISO, database, spreadsheet, and US formats", () => {
    expect(parseUtcTimestamp("2026-09-30T02:15:00Z")).toBe("2026-09-30T02:15:00.000Z");
    expect(parseUtcTimestamp("2026-09-30 02:15:00")).toBe("2026-09-30T02:15:00.000Z");
    expect(parseUtcTimestamp("2026-09-30 02:15:00 UTC")).toBe("2026-09-30T02:15:00.000Z");
    expect(parseUtcTimestamp("2026-09-30T04:15:00+02:00")).toBe("2026-09-30T02:15:00.000Z");
    expect(parseUtcTimestamp("2026-09-30 02:15:00.123+00")).toBe("2026-09-30T02:15:00.123Z");
    expect(parseUtcTimestamp("2026-09-29 19:15:00-0700")).toBe("2026-09-30T02:15:00.000Z");
    expect(parseUtcTimestamp("2026-09-30T02:15:00.1234567Z")).toBe("2026-09-30T02:15:00.123Z");
    expect(parseUtcTimestamp("9/30/2026 2:15:00 AM")).toBe("2026-09-30T02:15:00.000Z");
    expect(parseUtcTimestamp("9/30/2026 2:15 PM")).toBe("2026-09-30T14:15:00.000Z");
    expect(parseUtcTimestamp("9/30/26 2:15")).toBe("2026-09-30T02:15:00.000Z");
    expect(parseUtcTimestamp("2026-09-28")).toBe("2026-09-28T00:00:00.000Z");
  });

  it("refuses timestamps that are unreadable or name a day that does not exist", () => {
    expect(parseUtcTimestamp("last Tuesday")).toBeNull();
    expect(parseUtcTimestamp("")).toBeNull();
    expect(parseUtcTimestamp("2026-09-31 10:00:00")).toBeNull();
    expect(parseUtcTimestamp("2/30/2026")).toBeNull();
    expect(parseUtcTimestamp("28/09/2026 10:00")).toBeNull();
    expect(parseUtcTimestamp("2026-09-30 24:10:00")).toBeNull();
    expect(parseUtcTimestamp("2026-09-30T02:15:00+99:99")).toBeNull();
    expect(parseUtcTimestamp("0026-09-30 02:15:00")).toBeNull();
  });

  it("places a completion in its Monday-to-Sunday UTC report week", () => {
    expect(reportWeekFor("2026-09-28T00:00:00.000Z")).toBe("2026-09-28");
    expect(reportWeekFor("2026-10-04T23:59:59.000Z")).toBe("2026-09-28");
    expect(reportWeekFor("2026-10-05T00:00:00.000Z")).toBe("2026-10-05");
  });
});

describe("report weeks on the Pacific calendar", () => {
  it("lists the eight Pacific dates a week touches, from Sunday evening to Sunday afternoon", () => {
    expect(reportWeekDates(WEEK)).toEqual([
      "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    // Daylight saving time ends on Sunday, Nov 1, 2026; the week still spans Sunday to Sunday.
    expect(reportWeekDates("2026-10-26")).toEqual([
      "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
  });

  it("covers Monday through Saturday of a week, and a Sunday only between two imported weeks", () => {
    expect(coveredDateRuns([WEEK])).toEqual([{ from: "2026-09-28", through: "2026-10-03" }]);
    expect(coveredDateRuns(["2026-09-21", WEEK])).toEqual([{ from: "2026-09-21", through: "2026-10-03" }]);
    expect(coveredDateRuns(["2026-09-14", WEEK])).toEqual([
      { from: "2026-09-14", through: "2026-09-19" },
      { from: "2026-09-28", through: "2026-10-03" },
    ]);
    expect(coveredDateRuns(["2026-10-26"])).toEqual([{ from: "2026-10-26", through: "2026-10-31" }]);
    expect(coveredDateRuns(["2026-09-29", "not a week"])).toEqual([]);
  });
});

describe("weekly report parsing", () => {
  it("keeps only the fields the dashboard needs and drops buyer details", () => {
    const parsed = parseWhatnotWeeklyReport(weeklyReportCsv([sale()]));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.reportWeek).toBe(WEEK);
    expect(parsed.currency).toBe("usd");
    expect(parsed.rows[0]).toMatchObject({
      reportWeek: WEEK,
      type: "order_earnings",
      orderPlacedAt: "2026-09-26T02:15:00.000Z",
      completedAt: "2026-09-30T21:40:00.000Z",
      orderId: "ORD-1",
      livestreamId: "live-1",
      transactionAmount: 40.1,
      postCouponPrice: 48,
      commissionFee: 3.84,
    });
    for (const dropped of ["buyerPaid", "shippingFee", "costOfGoods", "listingTitle", "sku", "productCategory", "saleType"]) {
      expect(parsed.rows[0]).not.toHaveProperty(dropped);
    }
    const stored = JSON.stringify(parsed.rows);
    for (const personal of ["Private Person", "@someone", "SHP-9", "crescent", "Moon bracelet", "\"CA\""]) {
      expect(stored).not.toContain(personal);
    }
  });

  it("counts a transaction once when a row repeats exactly", () => {
    const parsed = parseWhatnotWeeklyReport(weeklyReportCsv([sale(), sale()]));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.duplicateRows).toBe(1);
  });

  it("refuses rows that share a Ledger Transaction ID but differ, and IDs rewritten in scientific notation", () => {
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale(), sale({ "Post Coupon Price": "$300.00" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Rows 2 and 3 share a Ledger Transaction ID but have different values."),
    });
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Ledger Transaction ID": "1.23457E+17" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("scientific notation"),
    });
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Order ID": "4.5E+12" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("scientific notation"),
    });
    // Hexadecimal IDs can look numeric but never carry "E+".
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Ledger Transaction ID": "81e7" }), sale({ "Ledger Transaction ID": "4096e1234", "Order ID": "5e10" })])).ok).toBe(true);
  });

  it("counts a charge listed once per order it covers as one transaction", () => {
    const charge = (orderId: string) => ({
      "Report Start Date": WEEK,
      "Transaction Completed at UTC": "2026-10-01 19:00:00",
      "Transaction Type": "Shipping Charge",
      "Order ID": orderId,
      "Transaction Currency": "USD",
      "Transaction Amount": "-$3.50",
      "Ledger Transaction ID": "L-SHIP",
    });
    const parsed = parseWhatnotWeeklyReport(weeklyReportCsv([sale(), charge("ORD-1"), charge("ORD-2")]));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows.filter((row) => row.type === "shipping_charge")).toHaveLength(1);
    expect(parsed.duplicateRows).toBe(1);
    // The same charge with another amount is not the same ledger entry.
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([charge("ORD-1"), { ...charge("ORD-2"), "Transaction Amount": "-$4.00" }])).ok).toBe(false);
  });

  it("refuses rows whose values do not line up with the header", () => {
    const csv = weeklyReportCsv([sale()]);
    const [header, line] = csv.split("\r\n");
    expect(parseWhatnotWeeklyReport(`${header}\r\n${line},extra`)).toMatchObject({
      ok: false,
      error: expect.stringContaining(`Row 2 has ${HEADER.length + 1} values but the header has ${HEADER.length} columns`),
    });
    expect(parseWhatnotWeeklyReport(`${header}\r\n${line.split(",").slice(0, -2).join(",")}`)).toMatchObject({ ok: false });
    // A trailing comma adds an empty value, which shifts nothing; so does one on the header line alone.
    expect(parseWhatnotWeeklyReport(`${header}\r\n${line},`).ok).toBe(true);
    expect(parseWhatnotWeeklyReport(`${header},\r\n${line}`).ok).toBe(true);
  });

  it("skips a totals or note line that has no Ledger Transaction ID", () => {
    const lines = Array.from({ length: 12 }, (_, index) => sale({ "Ledger Transaction ID": `L-${index}`, "Order ID": `O-${index}` }));
    const parsed = parseWhatnotWeeklyReport(`${weeklyReportCsv(lines)}\r\nTotal,,,,,489.20`);
    expect(parsed).toMatchObject({ ok: true, skippedRows: 1 });
    expect(parseWhatnotWeeklyReport(`${weeklyReportCsv(lines)}\r\nGenerated by Whatnot`)).toMatchObject({ ok: true, skippedRows: 1 });
  });

  it("allows spaces between a closing quote and the next comma", () => {
    expect(parseCsv("a,b\n\"x\"  ,2\n")).toEqual([["a", "b"], ["x", "2"]]);
  });

  it("refuses a file with an unclosed quote instead of merging the rest of it into one value", () => {
    const lines = Array.from({ length: 20 }, (_, index) => sale({ "Ledger Transaction ID": `L-${index}`, "Order ID": `O-${index}` }));
    const csv = weeklyReportCsv(lines).replace("O-14", "\"O-14");
    expect(parseWhatnotWeeklyReport(csv)).toMatchObject({ ok: false, error: expect.stringContaining("The file is not valid CSV") });
  });

  it("reports the line of the file a bad row is on, even after blank lines", () => {
    const csv = weeklyReportCsv([sale(), sale({ "Ledger Transaction ID": "L-2", "Transaction Amount": "forty" })]);
    const [header, first, second] = csv.split("\r\n");
    expect(parseWhatnotWeeklyReport([header, first, "", "", second].join("\r\n"))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Row 5 has an amount that can't be read in Transaction Amount."),
    });
  });

  it("accepts columns in any order and any letter case", () => {
    const header = [...HEADER].reverse().map((name) => name.toUpperCase());
    const line = Object.fromEntries(Object.entries(sale()).map(([key, value]) => [key.toUpperCase(), value]));
    const parsed = parseWhatnotWeeklyReport(weeklyReportCsv([line as Line], header));
    expect(parsed.ok).toBe(true);
  });

  it("explains what is wrong with a file that is not the weekly report", () => {
    expect(parseWhatnotWeeklyReport("")).toEqual({ ok: false, error: "The file is empty." });
    const ledger = parseWhatnotWeeklyReport("Created Date,Amount,Listing ID,Order ID,Message,Status,Transaction Type,Completed Date\n2026-09-30,10,1,2,x,done,Sale,2026-09-30");
    expect(ledger).toMatchObject({ ok: false, error: expect.stringContaining("Ledger / Transactions export") });
    const other = parseWhatnotWeeklyReport("name,email\nA,a@example.com");
    expect(other).toMatchObject({ ok: false, error: expect.stringContaining("missing Transaction Completed at UTC") });
    expect(parseWhatnotWeeklyReport(HEADER.join(","))).toMatchObject({ ok: false, error: expect.stringContaining("choose “No sales that week”") });
  });

  it("rejects unreadable values in the columns the metrics read, and mixed currencies", () => {
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Transaction Amount": "forty" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Row 2 has an amount that can't be read in Transaction Amount."),
    });
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale(), sale({ "Ledger Transaction ID": "L-2", "Commission Fee": "N/A" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Row 3 has an amount that can't be read in Commission Fee."),
    });
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Post Coupon Price": "48,00" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Row 2 has an amount that can't be read in Post Coupon Price."),
    });
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Quantity Sold": "two" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Row 2 has a quantity that can't be read."),
    });
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale(), sale({ "Ledger Transaction ID": "L-2", "Transaction Currency": "CAD" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("mixes currencies (USD, CAD)"),
    });
  });

  it("ignores odd values in columns the metrics never read", () => {
    const parsed = parseWhatnotWeeklyReport(weeklyReportCsv([
      sale({ "Cost of Goods": "N/A", "Buyer Paid": "-", "Shipping Fee": "n/a" }),
      // Fees are read only from Order Earnings rows.
      tip("L-2", "2026-10-01 18:00:00", { "Commission Fee": "N/A", "Post Coupon Price": "-" }),
    ]));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]).toMatchObject({ type: "tips", commissionFee: 0, postCouponPrice: null });
  });

  it("gives a row with a blank currency the file's currency", () => {
    const parsed = parseWhatnotWeeklyReport(weeklyReportCsv([
      sale({ "Transaction Currency": "CAD" }),
      tip("L-2", "2026-10-01 18:00:00", { "Transaction Currency": "" }),
    ]));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.currency).toBe("cad");
    expect(parsed.rows.map((row) => row.currency)).toEqual(["cad", "cad"]);
  });

  it("treats a completion time it cannot read as an error, not a row to drop", () => {
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Transaction Completed at UTC": "30.09.2026 21:40" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Row 2 has a completion time that can't be read. Upload the report exactly as downloaded"),
    });
  });

  it("takes the report week from the completion time and requires Report Start Date to agree", () => {
    const parsed = parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Report Start Date": "" })]));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.reportWeek).toBe(WEEK);
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Report Start Date": "9/28/2026" })])).ok).toBe(true);
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Report Start Date": "2026-09-21" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Row 2 completed outside the week its Report Start Date names"),
    });
  });

  it("refuses dates a spreadsheet rewrote day first", () => {
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Transaction Completed at UTC": "30/09/2026 21:40" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Row 2 writes dates day first (DD/MM/YYYY)"),
    });
    // Oct 5 and Oct 7 re-saved day first read as May 10 and July 10; Report Start Date gives it away.
    const reSaved = sale({ "Report Start Date": "05/10/2026", "Order Placed At UTC": "04/10/2026 18:00", "Transaction Completed at UTC": "07/10/2026 18:00" });
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([reSaved]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("outside the week its Report Start Date names"),
    });
  });

  it("refuses dates from before Whatnot existed", () => {
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([sale({ "Report Start Date": "", "Transaction Completed at UTC": "2009-09-30 21:40:00" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("before Whatnot existed"),
    });
  });

  it("imports one report week at a time", () => {
    const twoWeeks = parseWhatnotWeeklyReport(weeklyReportCsv([
      sale(),
      sale({ "Ledger Transaction ID": "L-2", "Transaction Completed at UTC": "2026-10-05 01:00:00", "Report Start Date": "2026-10-05" }),
    ]));
    expect(twoWeeks).toMatchObject({
      ok: false,
      error: expect.stringContaining("transactions from 2 report weeks, from the week of Sep 28, 2026 to the week of Oct 5, 2026"),
    });
  });

  it("refuses a report for a week that has not ended yet", () => {
    const csv = weeklyReportCsv([sale()]);
    expect(parseWhatnotWeeklyReport(csv, { now: new Date("2026-10-04T23:59:59.000Z") })).toMatchObject({
      ok: false,
      error: expect.stringContaining("hasn't ended yet"),
    });
    expect(parseWhatnotWeeklyReport(csv, { now: new Date("2026-10-05T00:00:00.000Z") }).ok).toBe(true);
  });

  it("reports rows it leaves out, and refuses a file that leaves out too many", () => {
    const sales = Array.from({ length: 12 }, (_, index) => sale({ "Ledger Transaction ID": `L-${index + 1}`, "Order ID": `ORD-${index + 1}` }));
    const oneBlank = parseWhatnotWeeklyReport(weeklyReportCsv([...sales, sale({ "Ledger Transaction ID": "L-99", "Transaction Completed at UTC": "" })]));
    expect(oneBlank).toMatchObject({ ok: true, skippedRows: 1 });
    if (oneBlank.ok) expect(oneBlank.rows).toHaveLength(12);

    const withoutIds = [1, 2].map(() => sale({ "Ledger Transaction ID": "" }));
    expect(parseWhatnotWeeklyReport(weeklyReportCsv([...sales.slice(0, 3), ...withoutIds]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("2 of 5 rows have no Ledger Transaction ID, completion time, or amount"),
    });
  });
});

function rowsFor(lines: Line[]): WhatnotReportRow[] {
  const parsed = parseWhatnotWeeklyReport(weeklyReportCsv(lines));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.rows;
}

function metricValue(metrics: ReturnType<typeof aggregateWhatnotReport>, key: string, date: string, extra: (dimensions: Record<string, unknown>) => boolean = () => true) {
  return metrics
    .filter((metric) => metric.metricKey === key && metric.date === date && extra(metric.dimensions ?? {}))
    .reduce((total, metric) => total + metric.metricValue, 0);
}

describe("weekly report metrics", () => {
  const lines: Line[] = [
    // Two items of one order from Friday's show (Sep 25, Pacific), completed Wednesday, Sep 30.
    sale({ "Order ID": "ORD-1", "Ledger Transaction ID": "L-1" }),
    sale({ "Order ID": "ORD-1", "Ledger Transaction ID": "L-2", "Quantity Sold": "", "Post Coupon Price": "$20.00", "Transaction Amount": "$17.20", "Commission Fee": "-$1.60", "Payment Processing Fee": "-$1.20" }),
    // A marketplace sale with a seller coupon, placed Oct 1 and completed late Saturday, Oct 3 (Pacific; Oct 4 in UTC).
    sale({
      "Order ID": "ORD-2",
      "Ledger Transaction ID": "L-3",
      "Order Placed At UTC": "2026-10-02 06:30:00",
      "Transaction Completed at UTC": "2026-10-04 03:00:00",
      "Livestream ID": "",
      "Livestream Title": "",
      "Sale Type": "Marketplace",
      "Original Item Price": "$30.00",
      "Coupon Cost": "$5.00",
      "Post Coupon Price": "$25.00",
      "Transaction Amount": "$21.80",
      "Commission Fee": "$2.00",
      "Payment Processing Fee": "$1.20",
    }),
    { "Transaction Completed at UTC": "2026-10-03 18:00:00", "Transaction Type": "Order Refund", "Order ID": "ORD-1", "Transaction Currency": "USD", "Transaction Amount": "-$20.00", "Ledger Transaction ID": "L-4" },
    tip("L-5", "2026-10-03 18:05:00"),
    { "Transaction Completed at UTC": "2026-10-03 19:00:00", "Transaction Type": "Shipping Charge", "Transaction Currency": "USD", "Transaction Amount": "-$3.50", "Ledger Transaction ID": "L-6" },
    // Completed Sunday afternoon, Oct 4 (Pacific), the last hours of the UTC week.
    sale({ "Order ID": "ORD-3", "Ledger Transaction ID": "L-7", "Transaction Completed at UTC": "2026-10-04 22:00:00", "Post Coupon Price": "$10.00", "Transaction Amount": "$8.40" }),
  ];
  const metrics = aggregateWhatnotReport(rowsFor(lines), "source-1");

  it("dates sales, orders, and items by the Pacific day the order completed, not the day it was placed", () => {
    expect(metricValue(metrics, "whatnot_sales", "2026-09-25")).toBe(0);
    expect(metricValue(metrics, "whatnot_sales", "2026-09-30")).toBe(68);
    expect(metricValue(metrics, "whatnot_orders", "2026-09-30")).toBe(1);
    // A blank quantity on a sale counts as one item.
    expect(metricValue(metrics, "whatnot_items_sold", "2026-09-30")).toBe(2);
    expect(metricValue(metrics, "whatnot_sales", "2026-10-03")).toBe(25);
    expect(metricValue(metrics, "whatnot_orders", "2026-10-03")).toBe(1);
    expect(metricValue(metrics, "whatnot_sales", "2026-10-04")).toBe(10);
  });

  it("dates earnings, fees, refunds, tips, and shipping charges by when they completed", () => {
    expect(metricValue(metrics, "whatnot_net_earnings", "2026-09-30")).toBeCloseTo(57.3);
    expect(metricValue(metrics, "whatnot_fees", "2026-09-30")).toBeCloseTo(3.84 + 1.71 + 1.6 + 1.2);
    expect(metricValue(metrics, "whatnot_net_earnings", "2026-10-03")).toBeCloseTo(21.8 - 20 + 5 - 3.5);
    expect(metricValue(metrics, "whatnot_refunds", "2026-10-03")).toBe(20);
    expect(metricValue(metrics, "whatnot_tips", "2026-10-03")).toBe(5);
    expect(metricValue(metrics, "whatnot_shipping_charges", "2026-10-03")).toBe(3.5);
  });

  it("splits completed sales by show, with the day each show ran", () => {
    const show = (dimensions: Record<string, unknown>) => dimensions.livestream_id === "live-1";
    expect(metricValue(metrics, "whatnot_show_sales", "2026-09-30", show)).toBe(68);
    expect(metricValue(metrics, "whatnot_show_orders", "2026-09-30", show)).toBe(1);
    expect(metricValue(metrics, "whatnot_show_sales", "2026-10-04", show)).toBe(10);
    const showRow = metrics.find((metric) => metric.metricKey === "whatnot_show_sales" && show(metric.dimensions ?? {}));
    expect(showRow?.dimensions).toMatchObject({ livestream_title: "Wednesday silver drop", show_date: "2026-09-25", report_week: WEEK });
    const marketplace = (dimensions: Record<string, unknown>) => dimensions.livestream_id === "marketplace";
    expect(metricValue(metrics, "whatnot_show_sales", "2026-10-03", marketplace)).toBe(25);
    expect(metrics.find((metric) => metric.metricKey === "whatnot_show_sales" && marketplace(metric.dimensions ?? {}))?.dimensions)
      .toMatchObject({ livestream_title: null, show_date: "2026-10-01" });
  });

  it("leaves giveaways out of sales, orders, items, and shows, and keeps their shipping cost in net earnings", () => {
    const giveaway = (ledgerId: string) => sale({
      "Ledger Transaction ID": ledgerId,
      "Order ID": `G-${ledgerId}`,
      "Buy Format": "Giveaway",
      "Original Item Price": "$0.00",
      "Post Coupon Price": "$0.00",
      "Transaction Amount": "-$4.40",
      "Commission Fee": "$0.00",
      "Payment Processing Fee": "$0.00",
    });
    const withGiveaways = aggregateWhatnotReport(rowsFor([
      sale({ "Ledger Transaction ID": "L-1", "Order ID": "ORD-1" }),
      sale({ "Ledger Transaction ID": "L-2", "Order ID": "ORD-2", "Post Coupon Price": "$30.00", "Transaction Amount": "$25.00" }),
      giveaway("G-1"),
      giveaway("G-2"),
      giveaway("G-3"),
    ]), "source-1");
    expect(metricValue(withGiveaways, "whatnot_sales", "2026-09-30")).toBe(78);
    expect(metricValue(withGiveaways, "whatnot_orders", "2026-09-30")).toBe(2);
    expect(metricValue(withGiveaways, "whatnot_items_sold", "2026-09-30")).toBe(2);
    expect(metricValue(withGiveaways, "whatnot_show_orders", "2026-09-30")).toBe(2);
    expect(metricValue(withGiveaways, "whatnot_net_earnings", "2026-09-30")).toBeCloseTo(40.1 + 25 - 3 * 4.4);
  });

  it("names a show by the title most of its rows carry, whatever the row order", () => {
    const titled = (ledgerId: string, title: string) => sale({ "Ledger Transaction ID": ledgerId, "Order ID": ledgerId, "Livestream Title": title });
    const showLines = [titled("L-1", "Friday drop (draft)"), titled("L-2", "Friday drop"), titled("L-3", "Friday drop")];
    const titleOf = (input: Line[]) => aggregateWhatnotReport(rowsFor(input), "source-1")
      .find((metric) => metric.metricKey === "whatnot_show_sales")?.dimensions?.livestream_title;
    expect(titleOf(showLines)).toBe("Friday drop");
    expect(titleOf([...showLines].reverse())).toBe("Friday drop");
    // A tie goes to the title on the lowest Ledger Transaction ID.
    expect(titleOf([titled("L-9", "Second"), titled("L-8", "First")])).toBe("First");
  });

  it("writes every daily metric for every day the week touches, zeros included", () => {
    const dailyKeys = new Set(["whatnot_sales", "whatnot_orders", "whatnot_items_sold", "whatnot_net_earnings", "whatnot_fees", "whatnot_refunds", "whatnot_tips", "whatnot_shipping_charges"]);
    const daily = metrics.filter((metric) => dailyKeys.has(metric.metricKey));
    expect([...new Set(daily.map((metric) => metric.date))].sort()).toEqual(reportWeekDates(WEEK));
    expect(daily).toHaveLength(reportWeekDates(WEEK).length * dailyKeys.size);
    expect(daily.every((metric) => metric.dimensions?.report_week === WEEK && metric.dimensions?.rollup === "weekly_report")).toBe(true);
    expect(metricValue(metrics, "whatnot_sales", "2026-09-27")).toBe(0);
    expect(daily.find((metric) => metric.metricKey === "whatnot_sales")?.unit).toBe("usd");
    expect(daily.find((metric) => metric.metricKey === "whatnot_orders")?.unit).toBe("count");
  });

  it("records a week without transactions as zeros on every day it touches, marked when the seller said so", () => {
    const empty = whatnotWeekMetrics(WEEK, [], "source-1", "cad", { recordedAsNoSales: true });
    expect(empty).toHaveLength(reportWeekDates(WEEK).length * 8);
    expect(empty.every((metric) => metric.metricValue === 0 && metric.dimensions?.report_week === WEEK)).toBe(true);
    expect(empty.every((metric) => metric.dimensions?.recorded_as === "no_sales")).toBe(true);
    expect(empty.find((metric) => metric.metricKey === "whatnot_sales")?.unit).toBe("cad");
    expect(whatnotWeekMetrics(WEEK, rowsFor([sale()]), "source-1", "usd", { recordedAsNoSales: true })
      .some((metric) => metric.dimensions?.recorded_as !== undefined)).toBe(false);
  });

  it("produces identical rows when the same week is imported again, in any row order", () => {
    expect(aggregateWhatnotReport(rowsFor([...lines].reverse()), "source-1")).toEqual(metrics);
  });
});

describe("the report as Whatnot's download writes it", () => {
  const downloaded = parseWhatnotWeeklyReport(downloadedReportCsv([downloadedSale(), downloadedGiveaway()]), {
    now: new Date("2026-10-07T00:00:00.000Z"),
  });

  it("reads upper-case, underscored column names and transaction types", () => {
    if (!downloaded.ok) throw new Error(downloaded.error);
    expect(downloaded).toMatchObject({ reportWeek: WHATNOT_DOWNLOADED_WEEK, currency: "usd", skippedRows: 0, duplicateRows: 0 });
    expect(downloaded.rows).toHaveLength(2);
    expect(downloaded.rows[0]).toMatchObject({
      type: "order_earnings",
      buyFormat: "AUCTION",
      orderId: "900000003",
      ledgerTransactionId: "700000003",
      orderPlacedAt: "2026-09-11T03:05:10.000Z",
      completedAt: "2026-09-15T19:20:45.000Z",
      quantity: 1,
      livestreamId: "00000000-0000-4000-8000-000000000001",
      livestreamTitle: "Test studio show",
      transactionAmount: 6.83,
      postCouponPrice: 8,
      commissionFee: 0.64,
      paymentProcessingFee: 0.53,
    });
    expect(downloaded.rows[1]).toMatchObject({ type: "order_earnings", buyFormat: "GIVEAWAY", transactionAmount: -5.1, postCouponPrice: 0 });
  });

  it("reads the tax on commission from TAX_ON_COMMISSION_FEE", () => {
    const taxed = parseWhatnotWeeklyReport(downloadedReportCsv([downloadedSale({ TAX_ON_COMMISSION_FEE: "0.05", TAX_ON_PAYMENT_PROCESSING_FEE: "0.04" })]));
    if (!taxed.ok) throw new Error(taxed.error);
    expect(taxed.rows[0]).toMatchObject({ taxOnCommission: 0.05, taxOnPaymentProcessingFee: 0.04 });
  });

  it("reads every transaction type written with underscores", () => {
    const parsed = parseWhatnotWeeklyReport(downloadedReportCsv([
      downloadedSale(),
      downloadedSale({ TRANSACTION_TYPE: "ORDER_REFUND", TRANSACTION_AMOUNT: "-8.00", LEDGER_TRANSACTION_ID: "700000201" }),
      downloadedSale({ TRANSACTION_TYPE: "TIPS", ORDER_ID: "", TRANSACTION_AMOUNT: "3.00", LEDGER_TRANSACTION_ID: "700000202" }),
      downloadedSale({ TRANSACTION_TYPE: "SHIPPING_CHARGE", ORDER_ID: "", TRANSACTION_AMOUNT: "-2.25", LEDGER_TRANSACTION_ID: "700000203" }),
    ]));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.rows.map((row) => row.type)).toEqual(["order_earnings", "order_refund", "tips", "shipping_charge"]);
  });

  it("keeps none of the buyer, shipment, seller, or listing details", () => {
    if (!downloaded.ok) throw new Error(downloaded.error);
    const stored = JSON.stringify(downloaded.rows);
    for (const dropped of ["synthetic_buyer_1", "\"WA\"", "800000001", "55500055", "Test bracelet", "“live”", "TestGiveaway1"]) {
      expect(stored).not.toContain(dropped);
    }
  });

  it("counts a giveaway as shipping paid, not as a sale", () => {
    if (!downloaded.ok) throw new Error(downloaded.error);
    const metrics = whatnotWeekMetrics(downloaded.reportWeek, downloaded.rows, "source-1");
    expect(metricValue(metrics, "whatnot_sales", "2026-09-15")).toBe(8);
    expect(metricValue(metrics, "whatnot_orders", "2026-09-15")).toBe(1);
    expect(metricValue(metrics, "whatnot_items_sold", "2026-09-15")).toBe(1);
    expect(metricValue(metrics, "whatnot_fees", "2026-09-15")).toBeCloseTo(1.17);
    expect(metricValue(metrics, "whatnot_net_earnings", "2026-09-15")).toBeCloseTo(6.83 - 5.1);
    expect(metricValue(metrics, "whatnot_show_orders", "2026-09-15")).toBe(1);
  });

  it("names a column as the file writes it when one of its values can't be read", () => {
    expect(parseWhatnotWeeklyReport(downloadedReportCsv([downloadedSale({ TRANSACTION_AMOUNT: "6,83" })]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("Row 2 has an amount that can't be read in TRANSACTION_AMOUNT."),
    });
  });
});

describe("report schedule", () => {
  it("knows the newest published report, which appears Monday 06:00 UTC", () => {
    expect(latestPublishedReportWeek(new Date("2026-10-05T05:59:00.000Z"))).toBe("2026-09-21");
    expect(latestPublishedReportWeek(new Date("2026-10-05T06:00:00.000Z"))).toBe("2026-09-28");
    expect(latestPublishedReportWeek(new Date("2026-10-07T00:00:00.000Z"))).toBe("2026-09-28");
  });
});
