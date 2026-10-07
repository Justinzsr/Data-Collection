import { createHash } from "node:crypto";
import type { NormalizedMetric } from "@/collection/connectors/types";
import type { JsonRecord } from "@/storage/db/schema";
import { addDaysToDateKey, APP_TIME_ZONE, isAppDateKey, startOfAppDateUtc } from "@/storage/runtime/app-time";

/*
 * Whatnot's Seller Weekly Orders Report: the CSV a seller downloads from Seller
 * Hub → Financials → Statements. Whatnot generates one every Monday at 06:00 UTC
 * for the transactions completed from Monday 00:00 to Sunday 23:59:59 UTC.
 * https://help.whatnot.com/hc/en-us/articles/36772664621837-Seller-Weekly-Orders-Report
 *
 * Only the fields the metrics read are kept. Buyer name, state, and country,
 * shipment IDs, listing titles and descriptions, SKUs, free-text transaction
 * messages, and the seller's cost of goods are dropped while parsing and never
 * stored.
 */

export const WHATNOT_REPORT_KIND = "whatnot_weekly_orders_report";
export const WHATNOT_MAX_REPORT_BYTES = 4 * 1024 * 1024;
export const WHATNOT_DEFINITION_VERSION = "whatnot-weekly-v1";
/** Whatnot launched in 2019; no report week can start earlier. */
export const WHATNOT_EARLIEST_REPORT_WEEK = "2019-01-07";
const MAX_ROWS = 20_000;
/** A file that skips more than this share of its rows is not the report as downloaded. */
const MAX_SKIPPED_SHARE = 0.1;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const AS_DOWNLOADED = "Upload the report exactly as downloaded from Whatnot; opening and saving it in a spreadsheet app can rewrite its dates, amounts, and IDs.";

export type WhatnotTransactionType = "order_earnings" | "order_refund" | "tips" | "shipping_charge" | "other";

export type WhatnotReportRow = {
  /** Monday (UTC) of the report week the transaction completed in, as YYYY-MM-DD. */
  reportWeek: string;
  ledgerTransactionId: string;
  type: WhatnotTransactionType;
  /** ISO timestamps in UTC. */
  orderPlacedAt: string | null;
  completedAt: string;
  orderId: string | null;
  /** "Auction", "Buy-it-Now", or "Giveaway". */
  buyFormat: string | null;
  /** Order Earnings rows only; null when blank. */
  quantity: number | null;
  livestreamId: string | null;
  livestreamTitle: string | null;
  currency: string;
  /** Signed amount that reached the Whatnot balance. */
  transactionAmount: number;
  /** Sale price after seller coupons, which Whatnot charges commission on (Order Earnings rows). */
  postCouponPrice: number | null;
  originalItemPrice: number;
  couponCost: number;
  commissionFee: number;
  paymentProcessingFee: number;
  taxOnCommission: number;
  taxOnPaymentProcessingFee: number;
};

export type WhatnotReportParseResult =
  | {
      ok: true;
      /** Monday (UTC) of the one report week the file covers. */
      reportWeek: string;
      rows: WhatnotReportRow[];
      currency: string;
      /** Rows left out because they have no Ledger Transaction ID, completion time, or amount. */
      skippedRows: number;
      /** Rows repeating another row exactly; each transaction counts once. */
      duplicateRows: number;
    }
  | { ok: false; error: string };

type ColumnKey =
  | "reportStartDate"
  | "orderPlacedAt"
  | "completedAt"
  | "transactionType"
  | "orderId"
  | "buyFormat"
  | "quantitySold"
  | "livestreamId"
  | "livestreamTitle"
  | "currency"
  | "transactionAmount"
  | "originalItemPrice"
  | "couponCost"
  | "postCouponPrice"
  | "commissionFee"
  | "paymentProcessingFee"
  | "taxOnCommission"
  | "taxOnPaymentProcessingFee"
  | "ledgerTransactionId";

const COLUMN_NAMES: Record<ColumnKey, string> = {
  reportStartDate: "Report Start Date",
  orderPlacedAt: "Order Placed At UTC",
  completedAt: "Transaction Completed at UTC",
  transactionType: "Transaction Type",
  orderId: "Order ID",
  buyFormat: "Buy Format",
  quantitySold: "Quantity Sold",
  livestreamId: "Livestream ID",
  livestreamTitle: "Livestream Title",
  currency: "Transaction Currency",
  transactionAmount: "Transaction Amount",
  originalItemPrice: "Original Item Price",
  couponCost: "Coupon Cost",
  postCouponPrice: "Post Coupon Price",
  commissionFee: "Commission Fee",
  paymentProcessingFee: "Payment Processing Fee",
  taxOnCommission: "Tax on Commission",
  taxOnPaymentProcessingFee: "Tax on Payment Processing Fee",
  ledgerTransactionId: "Ledger Transaction ID",
};

const REQUIRED_COLUMNS: ColumnKey[] = [
  "completedAt",
  "transactionType",
  "orderId",
  "transactionAmount",
  "postCouponPrice",
  "ledgerTransactionId",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export class CsvFormatError extends Error {}

/**
 * RFC 4180 records, each with the line of the file it starts on: quoted fields,
 * doubled quotes, and commas and line breaks inside quotes; CRLF, LF, or CR line
 * ends. A quote opens a quoted field only at the start of a field, so a stray
 * quote inside a value (`Ring size 7"`) stays part of it. A quoted field that is
 * never closed, or text right after a closing quote, throws CsvFormatError rather
 * than silently merging the rest of the file into one value. Blank lines are
 * dropped.
 */
export function parseCsvRecords(text: string): Array<{ line: number; cells: string[] }> {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let atFieldStart = true;
  let afterClosingQuote = false;
  let line = 1;
  let recordLine = 1;
  const endField = () => {
    cells.push(field);
    field = "";
    atFieldStart = true;
    afterClosingQuote = false;
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === "\"") {
        if (input[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          quoted = false;
          afterClosingQuote = true;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === ",") {
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      endField();
      records.push({ line: recordLine, cells });
      cells = [];
      line += 1;
      recordLine = line;
    } else if (afterClosingQuote) {
      // Some writers pad with spaces before the comma; anything else after a closing quote is malformed.
      if (char !== " " && char !== "\t") throw new CsvFormatError(`Line ${line} has text right after a closing quote.`);
    } else if (char === "\"" && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else {
      field += char;
      atFieldStart = false;
    }
  }
  if (quoted) throw new CsvFormatError(`A quoted value starting on line ${recordLine} is never closed.`);
  if (field !== "" || cells.length > 0 || afterClosingQuote) {
    endField();
    records.push({ line: recordLine, cells });
  }
  return records.filter((record) => record.cells.some((cell) => cell.trim() !== ""));
}

/** The cells of each record; see parseCsvRecords. */
export function parseCsv(text: string): string[][] {
  return parseCsvRecords(text).map((record) => record.cells);
}

function headerKey(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function text(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

/**
 * US-formatted money: "$1,234.50", "-$5.00", "$-5.00", "(5.25)", "USD 12", "12".
 * Blank is null so callers choose the default; anything else, including the
 * decimal commas some regions write ("48,00", "1.234,50"), is NaN rather than a
 * misread amount.
 */
export function parseMoney(value: string | undefined): number | null {
  let raw = value?.trim() ?? "";
  if (!raw) return null;
  let negative = false;
  const parenthesized = /^\((.*)\)$/u.exec(raw);
  if (parenthesized) {
    negative = true;
    raw = parenthesized[1].trim();
  }
  raw = raw.replace(/^[A-Z]{3}\s*(?=[-+$\d.])/u, "").replace(/(?<=[\d.])\s*[A-Z]{3}$/u, "");
  const match = /^([+-])?\s*(?:US\$|CA\$|C\$|A\$|\$|€|£)?\s*([+-])?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/u.exec(raw);
  if (!match) return Number.NaN;
  const [, signBefore, signAfter, digits] = match;
  if ((signBefore && signAfter) || (parenthesized && (signBefore || signAfter))) return Number.NaN;
  const number = Number(digits.replace(/,/gu, ""));
  if (!Number.isFinite(number)) return Number.NaN;
  if ((signBefore ?? signAfter) === "-") negative = !negative;
  return negative && number !== 0 ? -number : number;
}

/** Minutes east of UTC for "Z", "+05", "-0700", "+05:30"; null when out of range. */
function zoneOffsetMinutes(zone: string | undefined) {
  if (!zone || zone.toUpperCase() === "Z") return 0;
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4) || "0");
  if (hours > 14 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

/**
 * Timestamps the report may use, all UTC unless an offset says otherwise:
 * ISO 8601 ("2026-09-28T18:42:11Z", any fraction length, "+00", "+0000",
 * "+00:00"), "2026-09-28 18:42:11" with or without a "UTC" suffix, and US style
 * with a two- or four-digit year ("9/28/2026 6:42:11 PM", "9/28/26 18:42", as a
 * spreadsheet re-saves it). Returns an ISO string, or null when unreadable.
 */
export function parseUtcTimestamp(value: string | undefined): string | null {
  const raw = value?.trim().replace(/\s+UTC$/iu, "") ?? "";
  if (!raw) return null;
  const isoLike = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/iu.exec(raw);
  if (isoLike) {
    const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = "0", zone] = isoLike;
    const offset = zoneOffsetMinutes(zone);
    if (offset === null) return null;
    const millisecond = Number(fraction.slice(0, 3).padEnd(3, "0"));
    const time = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), millisecond)
      - offset * 60_000;
    return validTimestamp(time, Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second));
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/iu.exec(raw);
  if (us) {
    const [, month, day, yearText, hourText = "0", minute = "0", second = "0", meridiem] = us;
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    let hour = Number(hourText);
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0);
    }
    const time = Date.UTC(year, Number(month) - 1, Number(day), hour, Number(minute), Number(second));
    return validTimestamp(time, year, Number(month), Number(day), hour, Number(minute), Number(second));
  }
  return null;
}

function validTimestamp(time: number, year: number, month: number, day: number, hour: number, minute: number, second: number) {
  if (!Number.isFinite(time)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  // Date.UTC rolls a day that does not exist (September 31) into the next month; refuse it instead.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  return new Date(time).toISOString();
}

/** True when a slash date can only be day-first ("28/09/2026"): its first part is not a month. */
function isDayFirstSlashDate(value: string | undefined) {
  const parts = /^\s*(\d{1,2})\/(\d{1,2})\/(?:\d{2}|\d{4})\b/u.exec(value ?? "");
  return Boolean(parts && Number(parts[1]) > 12 && Number(parts[2]) <= 12);
}

/**
 * A number a spreadsheet rewrote in scientific notation, losing its digits
 * ("1.23457E+17"). Only that form counts: an ID such as "81e7" or "4096e1234"
 * (hexadecimal) has no plus sign.
 */
function isScientificNotation(value: string | null) {
  return value !== null && /^\d(?:\.\d+)?E\+\d+$/iu.test(value);
}

/** The Monday (UTC) of the report week a completion time falls in. */
export function reportWeekFor(completedAtIso: string) {
  const date = new Date(completedAtIso);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

/** True for a YYYY-MM-DD key that is a Monday, as every report week is. */
export function isReportWeek(value: unknown): value is string {
  return isAppDateKey(value) && new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1;
}

function weekStartMs(reportWeek: string) {
  return Date.parse(`${reportWeek}T00:00:00.000Z`);
}

/** True once the report week's last second (Sunday 23:59:59 UTC) has passed. */
export function reportWeekHasEnded(reportWeek: string, now: Date) {
  return weekStartMs(reportWeek) + WEEK_MS <= now.getTime();
}

/** "Sep 28, 2026": the Monday a report week starts. */
export function reportWeekLabel(reportWeek: string) {
  const [year, month, day] = reportWeek.split("-").map(Number);
  return `${MONTHS[month - 1] ?? month} ${day}, ${year}`;
}

let appDateFormatter: Intl.DateTimeFormat | null = null;

/** The app's (Pacific) calendar date of an instant; one formatter serves every row of a report. */
export function appDateKey(instant: number | string) {
  appDateFormatter ??= new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(appDateFormatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Every Pacific date a report week touches: from the Sunday evening it starts on
 * (Monday 00:00 UTC) to the Sunday afternoon it ends on (Sunday 23:59:59 UTC).
 */
export function reportWeekDates(reportWeek: string) {
  const first = appDateKey(weekStartMs(reportWeek));
  const last = appDateKey(weekStartMs(reportWeek) + WEEK_MS - 1);
  const dates: string[] = [];
  for (let date = first; date <= last; date = addDaysToDateKey(date, 1)) dates.push(date);
  return dates;
}

/**
 * Pacific dates the given report weeks cover completely, as runs of consecutive
 * dates. On its own a week completes Monday through Saturday; a Sunday is split
 * between two reports, so it is complete only when the weeks on both sides of it
 * are imported.
 */
export function coveredDateRuns(reportWeeks: string[]): Array<{ from: string; through: string }> {
  const weeks = [...new Set(reportWeeks.filter(isReportWeek))].sort();
  const runs: Array<{ from: string; through: string }> = [];
  let index = 0;
  while (index < weeks.length) {
    let last = index;
    while (last + 1 < weeks.length && addDaysToDateKey(weeks[last], 7) === weeks[last + 1]) last += 1;
    const start = weekStartMs(weeks[index]);
    const end = weekStartMs(weeks[last]) + WEEK_MS;
    const startDate = appDateKey(start);
    const from = Date.parse(startOfAppDateUtc(startDate)) === start ? startDate : addDaysToDateKey(startDate, 1);
    const through = addDaysToDateKey(appDateKey(end), -1);
    if (from <= through) runs.push({ from, through });
    index = last + 1;
  }
  return runs;
}

function transactionType(value: string | null): WhatnotTransactionType {
  const normalized = (value ?? "").toLowerCase().replace(/\s+/gu, " ").trim();
  if (normalized === "order earnings" || normalized === "order earning") return "order_earnings";
  if (normalized === "order refund" || normalized === "order refunds") return "order_refund";
  if (normalized === "tips" || normalized === "tip") return "tips";
  if (normalized === "shipping charge" || normalized === "shipping charges") return "shipping_charge";
  return "other";
}

/** A giveaway is an Order Earnings row with a $0 price whose (negative) amount is the shipping the seller paid. */
export function isGiveaway(row: Pick<WhatnotReportRow, "buyFormat">) {
  return (row.buyFormat ?? "").trim().toLowerCase() === "giveaway";
}

class ReportRowError extends Error {}

/**
 * Validates and parses one Weekly Orders Report. The result holds only the fields
 * the metrics read. Columns a metric reads must be readable on the rows it reads
 * them from; other columns are never parsed, so an odd value there cannot reject
 * the file. Signs of a spreadsheet re-save that would silently change the numbers
 * (day-first dates, IDs in scientific notation, shifted columns, rows that repeat
 * an ID with different values) reject the file instead. With `now`, a report for
 * a week that has not ended yet is refused.
 */
export function parseWhatnotWeeklyReport(textContent: string, options: { now?: Date } = {}): WhatnotReportParseResult {
  if (!textContent.trim()) return { ok: false, error: "The file is empty." };
  let records: Array<{ line: number; cells: string[] }>;
  try {
    records = parseCsvRecords(textContent);
  } catch (error) {
    if (error instanceof CsvFormatError) return { ok: false, error: `The file is not valid CSV: ${error.message} ${AS_DOWNLOADED}` };
    throw error;
  }
  const [headerRecord, ...allRecords] = records;
  if (!headerRecord) return { ok: false, error: "The file is empty." };
  // A trailing comma on the header line adds empty column names that no row fills.
  const header = [...headerRecord.cells];
  while (header.length > 0 && header[header.length - 1].trim() === "") header.pop();

  const positions = new Map<string, number>();
  header.forEach((name, index) => {
    const key = headerKey(name);
    if (!positions.has(key)) positions.set(key, index);
  });
  const column = (key: ColumnKey) => positions.get(headerKey(COLUMN_NAMES[key]));
  const cell = (cells: string[], key: ColumnKey) => {
    const index = column(key);
    return index === undefined ? undefined : cells[index];
  };
  const missing = REQUIRED_COLUMNS.filter((key) => column(key) === undefined).map((key) => COLUMN_NAMES[key]);
  if (missing.length > 0) {
    const looksLikeLedger = positions.has("created date") && positions.has("amount");
    return {
      ok: false,
      error: looksLikeLedger
        ? "This looks like the Ledger / Transactions export. Upload the Weekly Orders Report from Seller Hub → Financials → Statements instead."
        : `This is not a Whatnot Weekly Orders Report: it is missing ${missing.join(", ")}.`,
    };
  }
  if (allRecords.length === 0) {
    return {
      ok: false,
      error: "The report has a header but no transactions. If you sold nothing that week, choose “No sales that week” for it under Report weeks on the Whatnot page.",
    };
  }
  if (allRecords.length > MAX_ROWS) return { ok: false, error: `The report has more than ${MAX_ROWS.toLocaleString("en-US")} rows; upload one week at a time.` };

  // A value with a comma the writer did not quote shifts every later column, so amounts would be read from the wrong place.
  // A line that does not line up and has no Ledger Transaction ID (a totals or note line) is not a transaction: it is skipped.
  const body: typeof allRecords = [];
  let unalignedSkipped = 0;
  for (const record of allRecords) {
    const extra = record.cells.slice(header.length);
    const aligned = record.cells.length >= header.length && extra.every((value) => value.trim() === "");
    if (aligned) {
      body.push(record);
    } else if (!text(cell(record.cells, "ledgerTransactionId"))) {
      unalignedSkipped += 1;
    } else {
      return {
        ok: false,
        error: `Row ${record.line} has ${record.cells.length} values but the header has ${header.length} columns, so its columns cannot be matched. ${AS_DOWNLOADED}`,
      };
    }
  }
  const dateColumns: ColumnKey[] = ["completedAt", "orderPlacedAt", "reportStartDate"];
  const dayFirst = body.find((record) => dateColumns.some((key) => isDayFirstSlashDate(cell(record.cells, key))));
  if (dayFirst) {
    return {
      ok: false,
      error: `Row ${dayFirst.line} writes dates day first (DD/MM/YYYY), which a spreadsheet app does when it re-saves the report in some regions. ${AS_DOWNLOADED}`,
    };
  }

  /** A money cell; unreadable is an error only where a metric reads it. */
  const money = (cells: string[], key: ColumnKey, lineNumber: number, strict: boolean) => {
    const value = parseMoney(cell(cells, key));
    if (value === null || !Number.isNaN(value)) return value;
    if (strict) throw new ReportRowError(`Row ${lineNumber} has an amount that can't be read in ${COLUMN_NAMES[key]}. ${AS_DOWNLOADED}`);
    return null;
  };

  const parseRow = (cells: string[], lineNumber: number): WhatnotReportRow | null => {
    const ledgerTransactionId = text(cell(cells, "ledgerTransactionId"));
    const completedText = text(cell(cells, "completedAt"));
    if (!ledgerTransactionId || !completedText) return null;
    const orderId = text(cell(cells, "orderId"));
    if (isScientificNotation(ledgerTransactionId) || isScientificNotation(orderId)) {
      throw new ReportRowError(`Row ${lineNumber} has an ID that a spreadsheet app rewrote in scientific notation (like 1.23E+17), which loses digits. ${AS_DOWNLOADED}`);
    }
    const completedAt = parseUtcTimestamp(completedText);
    if (!completedAt) throw new ReportRowError(`Row ${lineNumber} has a completion time that can't be read. ${AS_DOWNLOADED}`);
    const reportWeek = reportWeekFor(completedAt);
    // Report Start Date is the Monday (UTC) of the report's week; a mismatch means the dates were rewritten.
    const reportStart = parseUtcTimestamp(cell(cells, "reportStartDate"));
    if (reportStart && Math.abs(Date.parse(reportStart) - weekStartMs(reportWeek)) > DAY_MS) {
      throw new ReportRowError(`Row ${lineNumber} completed outside the week its Report Start Date names, so its dates don't add up. ${AS_DOWNLOADED}`);
    }
    const transactionAmount = money(cells, "transactionAmount", lineNumber, true);
    if (transactionAmount === null) return null;
    const currency = text(cell(cells, "currency"))?.toLowerCase() ?? null;
    if (currency !== null && !/^[a-z]{3}$/u.test(currency)) throw new ReportRowError(`Row ${lineNumber} has an unknown currency.`);

    // Sales, items, and fees come from Order Earnings rows, so only there must they be readable.
    const type = transactionType(text(cell(cells, "transactionType")));
    const isSale = type === "order_earnings";
    const postCouponPrice = money(cells, "postCouponPrice", lineNumber, isSale);
    const usesItemPrice = isSale && postCouponPrice === null;
    let quantity: number | null = null;
    const quantityText = isSale ? text(cell(cells, "quantitySold")) : null;
    if (quantityText !== null) {
      quantity = Number(quantityText.replace(/,/gu, ""));
      if (!Number.isInteger(quantity) || quantity < 0) throw new ReportRowError(`Row ${lineNumber} has a quantity that can't be read. ${AS_DOWNLOADED}`);
    }
    return {
      reportWeek,
      ledgerTransactionId,
      type,
      orderPlacedAt: parseUtcTimestamp(cell(cells, "orderPlacedAt")),
      completedAt,
      orderId,
      buyFormat: text(cell(cells, "buyFormat")),
      quantity,
      livestreamId: text(cell(cells, "livestreamId")),
      livestreamTitle: text(cell(cells, "livestreamTitle")),
      // A blank currency cell takes the file's currency once every row is read.
      currency: currency ?? "",
      transactionAmount,
      postCouponPrice,
      originalItemPrice: money(cells, "originalItemPrice", lineNumber, usesItemPrice) ?? 0,
      couponCost: money(cells, "couponCost", lineNumber, usesItemPrice) ?? 0,
      commissionFee: money(cells, "commissionFee", lineNumber, isSale) ?? 0,
      paymentProcessingFee: money(cells, "paymentProcessingFee", lineNumber, isSale) ?? 0,
      taxOnCommission: money(cells, "taxOnCommission", lineNumber, isSale) ?? 0,
      taxOnPaymentProcessingFee: money(cells, "taxOnPaymentProcessingFee", lineNumber, isSale) ?? 0,
    };
  };

  const rows = new Map<string, { row: WhatnotReportRow; line: number; signature: string }>();
  const currencies = new Set<string>();
  let skippedRows = unalignedSkipped;
  let duplicateRows = 0;
  try {
    for (const record of body) {
      const row = parseRow(record.cells, record.line);
      if (!row) {
        skippedRows += 1;
        continue;
      }
      if (row.currency) currencies.add(row.currency);
      const signature = JSON.stringify(row);
      const earlier = rows.get(row.ledgerTransactionId);
      if (earlier) {
        // A charge or tip can be listed once per order it covers (one shipping charge for a shipment of several
        // orders); it moved the balance once, so it counts once. A sale repeated with other values is ambiguous.
        const sameLedgerEntry = earlier.row.type === row.type
          && earlier.row.type !== "order_earnings"
          && earlier.row.completedAt === row.completedAt
          && earlier.row.transactionAmount === row.transactionAmount
          && earlier.row.currency === row.currency;
        if (earlier.signature !== signature && !sameLedgerEntry) {
          throw new ReportRowError(`Rows ${earlier.line} and ${record.line} share a Ledger Transaction ID but have different values. ${AS_DOWNLOADED}`);
        }
        duplicateRows += 1;
        continue;
      }
      rows.set(row.ledgerTransactionId, { row, line: record.line, signature });
    }
  } catch (error) {
    if (error instanceof ReportRowError) return { ok: false, error: error.message };
    throw error;
  }

  if (rows.size === 0) return { ok: false, error: "No row in the report has a Ledger Transaction ID, a completion time, and an amount." };
  if (skippedRows > 1 && skippedRows > allRecords.length * MAX_SKIPPED_SHARE) {
    return {
      ok: false,
      error: `${skippedRows} of ${allRecords.length} rows have no Ledger Transaction ID, completion time, or amount, so this is not a complete Weekly Orders Report. ${AS_DOWNLOADED}`,
    };
  }
  if (currencies.size > 1) {
    return { ok: false, error: `The report mixes currencies (${[...currencies].map((value) => value.toUpperCase()).join(", ")}); import one currency at a time.` };
  }
  const currency = [...currencies][0] ?? "usd";
  const parsedRows = [...rows.values()].map(({ row }) => (row.currency ? row : { ...row, currency }));
  const weeks = [...new Set(parsedRows.map((row) => row.reportWeek))].sort();
  if (weeks.length > 1) {
    return {
      ok: false,
      error: `The file has transactions from ${weeks.length} report weeks, from the week of ${reportWeekLabel(weeks[0])} to the week of ${reportWeekLabel(weeks.at(-1) ?? weeks[0])}. Import one Weekly Orders Report at a time. ${AS_DOWNLOADED}`,
    };
  }
  const reportWeek = weeks[0];
  if (reportWeek < WHATNOT_EARLIEST_REPORT_WEEK) {
    return { ok: false, error: `This file's dates fall before Whatnot existed, so they were misread. ${AS_DOWNLOADED}` };
  }
  if (options.now && !reportWeekHasEnded(reportWeek, options.now)) {
    return {
      ok: false,
      error: `This file has transactions from the week of ${reportWeekLabel(reportWeek)}, which hasn't ended yet. Import that week's report after Whatnot publishes it on the following Monday.`,
    };
  }
  return { ok: true, reportWeek, rows: parsedRows, currency, skippedRows, duplicateRows };
}

export function hashWhatnotRows(rows: WhatnotReportRow[]) {
  const ordered = [...rows].sort(byLedgerId);
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isWhatnotReportRow(value: unknown): value is WhatnotReportRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.reportWeek === "string"
    && typeof row.ledgerTransactionId === "string"
    && typeof row.completedAt === "string"
    && Number.isFinite(Date.parse(row.completedAt))
    && typeof row.type === "string"
    && typeof row.currency === "string"
    && (row.buyFormat === undefined || row.buyFormat === null || typeof row.buyFormat === "string")
    && isNumber(row.transactionAmount)
    && (row.postCouponPrice === null || isNumber(row.postCouponPrice))
    && (row.quantity === null || isNumber(row.quantity))
    && isNumber(row.originalItemPrice)
    && isNumber(row.couponCost)
    && isNumber(row.commissionFee)
    && isNumber(row.paymentProcessingFee)
    && isNumber(row.taxOnCommission)
    && isNumber(row.taxOnPaymentProcessingFee);
}

export function whatnotRowsFromPayload(payload: JsonRecord): WhatnotReportRow[] {
  const rows = payload.rows;
  return Array.isArray(rows) ? rows.filter(isWhatnotReportRow) : [];
}

// ---------------------------------------------------------------------------
// Daily metrics

export const WHATNOT_DAILY_METRIC_KEYS = [
  "whatnot_sales",
  "whatnot_orders",
  "whatnot_items_sold",
  "whatnot_net_earnings",
  "whatnot_fees",
  "whatnot_refunds",
  "whatnot_tips",
  "whatnot_shipping_charges",
] as const;

export const WHATNOT_SHOW_METRIC_KEYS = ["whatnot_show_sales", "whatnot_show_orders", "whatnot_show_items"] as const;

export type WhatnotDailyMetricKey = (typeof WHATNOT_DAILY_METRIC_KEYS)[number];

function saleValue(row: WhatnotReportRow) {
  if (row.postCouponPrice !== null) return row.postCouponPrice;
  return row.originalItemPrice - Math.abs(row.couponCost);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function zeroTotals() {
  return Object.fromEntries(WHATNOT_DAILY_METRIC_KEYS.map((key) => [key, 0])) as Record<WhatnotDailyMetricKey, number>;
}

type ShowTotals = { sales: number; items: number; orders: Set<string> };

type ShowAccumulator = {
  id: string;
  /** Title → how many rows carry it, and the first Ledger Transaction ID that did. */
  titles: Map<string, { count: number; firstLedger: string }>;
  /** Pacific date of the earliest order: the day the show ran. */
  showDate: string;
  byDate: Map<string, ShowTotals>;
};

/** The title most rows carry; ties go to the one seen on the lowest Ledger Transaction ID, so re-imports agree. */
function showTitle(show: ShowAccumulator) {
  let best: { title: string; count: number; firstLedger: string } | null = null;
  for (const [title, stats] of show.titles) {
    if (!best || stats.count > best.count || (stats.count === best.count && stats.firstLedger < best.firstLedger)) {
      best = { title, ...stats };
    }
  }
  return best?.title ?? null;
}

function byLedgerId(left: WhatnotReportRow, right: WhatnotReportRow) {
  return left.ledgerTransactionId < right.ledgerTransactionId ? -1 : left.ledgerTransactionId > right.ledgerTransactionId ? 1 : 0;
}

function ascending(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * One report week's daily totals and per-show results on Pacific dates, by the
 * day each transaction completed. An order completes about 4 hours after delivery
 * is confirmed (or when its label is created with Early Payout), and the weekly
 * report is cut on that same clock, so every metric of a covered day is complete
 * once its report is in. Giveaways are not sales: their $0 orders stay out of
 * sales, orders, items, and shows, while the shipping the seller paid for them is
 * part of net earnings.
 *
 * Every daily metric is written for every date the week touches, zeros included,
 * so a week with no transactions (`rows` empty) still records that it was
 * imported. The connector replaces all of a week's rows whenever the week is
 * imported again.
 */
export function whatnotWeekMetrics(
  reportWeek: string,
  rows: WhatnotReportRow[],
  sourceId: string,
  fallbackCurrency = "usd",
  options: { recordedAsNoSales?: boolean } = {},
): NormalizedMetric[] {
  const metrics: NormalizedMetric[] = [];
  const currency = rows[0]?.currency || fallbackCurrency;
  const totals = new Map(reportWeekDates(reportWeek).map((date) => [date, zeroTotals()]));
  const day = (date: string) => {
    let record = totals.get(date);
    if (!record) {
      record = zeroTotals();
      totals.set(date, record);
    }
    return record;
  };
  const orders = new Map<string, Set<string>>();
  const shows = new Map<string, ShowAccumulator>();

  for (const row of [...rows].sort(byLedgerId)) {
    const completedDate = appDateKey(row.completedAt);
    const totalsForDay = day(completedDate);
    totalsForDay.whatnot_net_earnings += row.transactionAmount;
    if (row.type === "order_refund") totalsForDay.whatnot_refunds += Math.abs(row.transactionAmount);
    if (row.type === "tips") totalsForDay.whatnot_tips += row.transactionAmount;
    if (row.type === "shipping_charge") totalsForDay.whatnot_shipping_charges += Math.abs(row.transactionAmount);
    if (row.type !== "order_earnings") continue;

    totalsForDay.whatnot_fees += Math.abs(row.commissionFee)
      + Math.abs(row.paymentProcessingFee)
      + Math.abs(row.taxOnCommission)
      + Math.abs(row.taxOnPaymentProcessingFee);
    if (isGiveaway(row)) continue;
    const value = saleValue(row);
    const items = row.quantity ?? 1;
    const orderKey = row.orderId ?? row.ledgerTransactionId;
    totalsForDay.whatnot_sales += value;
    totalsForDay.whatnot_items_sold += items;
    const dayOrders = orders.get(completedDate) ?? new Set<string>();
    dayOrders.add(orderKey);
    orders.set(completedDate, dayOrders);

    const showId = row.livestreamId ?? "marketplace";
    const placedDate = row.orderPlacedAt ? appDateKey(row.orderPlacedAt) : completedDate;
    let show = shows.get(showId);
    if (!show) {
      show = { id: showId, titles: new Map(), showDate: placedDate, byDate: new Map() };
      shows.set(showId, show);
    }
    if (placedDate < show.showDate) show.showDate = placedDate;
    if (row.livestreamId && row.livestreamTitle) {
      const stats = show.titles.get(row.livestreamTitle);
      if (stats) stats.count += 1;
      else show.titles.set(row.livestreamTitle, { count: 1, firstLedger: row.ledgerTransactionId });
    }
    const showDay = show.byDate.get(completedDate) ?? { sales: 0, items: 0, orders: new Set<string>() };
    showDay.sales += value;
    showDay.items += items;
    showDay.orders.add(orderKey);
    show.byDate.set(completedDate, showDay);
  }
  for (const [date, set] of orders) day(date).whatnot_orders = set.size;

  const dimensions: JsonRecord = {
    rollup: "weekly_report",
    report_week: reportWeek,
    definition_version: WHATNOT_DEFINITION_VERSION,
    // The seller said this week had no sales, as opposed to a report whose amounts happen to net to zero.
    ...(options.recordedAsNoSales && rows.length === 0 ? { recorded_as: "no_sales" } : {}),
  };
  for (const [date, values] of [...totals.entries()].sort(([left], [right]) => ascending(left, right))) {
    for (const key of WHATNOT_DAILY_METRIC_KEYS) {
      const isCount = key === "whatnot_orders" || key === "whatnot_items_sold";
      metrics.push({
        date,
        sourceId,
        sourceTypeKey: "whatnot",
        metricKey: key,
        metricValue: isCount ? values[key] : round(values[key]),
        unit: isCount ? "count" : currency,
        dimensions,
      });
    }
  }
  for (const show of [...shows.values()].sort((left, right) => ascending(left.id, right.id))) {
    const showDimensions: JsonRecord = {
      rollup: "show",
      report_week: reportWeek,
      livestream_id: show.id,
      livestream_title: show.id === "marketplace" ? null : showTitle(show),
      show_date: show.showDate,
      definition_version: WHATNOT_DEFINITION_VERSION,
    };
    for (const [date, values] of [...show.byDate.entries()].sort(([left], [right]) => ascending(left, right))) {
      metrics.push(
        { date, sourceId, sourceTypeKey: "whatnot", metricKey: "whatnot_show_sales", metricValue: round(values.sales), unit: currency, dimensions: showDimensions },
        { date, sourceId, sourceTypeKey: "whatnot", metricKey: "whatnot_show_orders", metricValue: values.orders.size, unit: "count", dimensions: showDimensions },
        { date, sourceId, sourceTypeKey: "whatnot", metricKey: "whatnot_show_items", metricValue: values.items, unit: "count", dimensions: showDimensions },
      );
    }
  }
  return metrics;
}

/** whatnotWeekMetrics for every report week the rows complete in. */
export function aggregateWhatnotReport(rows: WhatnotReportRow[], sourceId: string): NormalizedMetric[] {
  const byWeek = new Map<string, WhatnotReportRow[]>();
  for (const row of rows) {
    const week = reportWeekFor(row.completedAt);
    const weekRows = byWeek.get(week);
    if (weekRows) weekRows.push(row);
    else byWeek.set(week, [row]);
  }
  return [...byWeek.entries()]
    .sort(([left], [right]) => ascending(left, right))
    .flatMap(([reportWeek, weekRows]) => whatnotWeekMetrics(reportWeek, weekRows, sourceId));
}

// ---------------------------------------------------------------------------
// Report schedule

/**
 * The newest report Whatnot has published at `now`: the week before the current
 * one, available from Monday 06:00 UTC. Returns that report's Monday (UTC).
 */
export function latestPublishedReportWeek(now: Date) {
  const currentWeek = reportWeekFor(now.toISOString());
  const publishedAt = Date.parse(`${currentWeek}T06:00:00.000Z`);
  return addDaysToDateKey(currentWeek, now.getTime() >= publishedAt ? -7 : -14);
}
