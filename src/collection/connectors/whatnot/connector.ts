import { createHash } from "node:crypto";
import type { ConnectorDefinition, SyncResult } from "@/collection/connectors/types";
import { validUrl } from "@/collection/connectors/future-connectors";
import {
  hashWhatnotRows,
  isReportWeek,
  isWhatnotReportRow,
  reportWeekDates,
  reportWeekFor,
  WHATNOT_DAILY_METRIC_KEYS,
  WHATNOT_REPORT_KIND,
  WHATNOT_SHOW_METRIC_KEYS,
  whatnotRowsFromPayload,
  whatnotWeekMetrics,
  type WhatnotReportRow,
} from "@/collection/connectors/whatnot/weekly-report";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";
import type { JsonRecord } from "@/storage/db/schema";
import { listMetrics } from "@/storage/repositories/metrics-repository";

const WHATNOT_HOSTS = new Set(["whatnot.com", "www.whatnot.com"]);

function whatnotMetricDefinitions() {
  return metricDefinitions.filter((definition) => definition.source_type_key === "whatnot");
}

export function detectWhatnot(inputUrl: string) {
  const url = validUrl(inputUrl);
  if (!url || !WHATNOT_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const section = parts[0]?.toLowerCase();
  const value = parts[1];
  if (section === "user" && value) {
    return {
      confidence: 0.97,
      normalizedUrl: `https://www.whatnot.com/user/${value}`,
      accountName: value,
      reasons: ["Whatnot seller profile detected. Data comes from the weekly orders report you download in Seller Hub."],
    };
  }
  return {
    confidence: 0.7,
    normalizedUrl: "https://www.whatnot.com/",
    accountName: null,
    reasons: ["Whatnot link detected. Paste your seller profile (whatnot.com/user/…) to name the source."],
  };
}

/**
 * What the import route hands to the shared sync engine: an uploaded report, or
 * a change to one report week the seller asked for. "no_sales" records a week
 * without transactions (Whatnot has no rows to put in its report); "remove"
 * deletes a week that was imported by mistake.
 */
export type WhatnotImportPayload =
  | { kind: typeof WHATNOT_REPORT_KIND; mode?: "report"; fileName: string | null; rows: WhatnotReportRow[] }
  | { kind: typeof WHATNOT_REPORT_KIND; mode: "no_sales" | "remove"; reportWeek: string; currency?: string | null };

export type WhatnotWeekAction = "no_sales" | "remove";

function isWeekAction(value: unknown): value is WhatnotWeekAction {
  return value === "no_sales" || value === "remove";
}

export function isWhatnotImportPayload(value: JsonRecord | null | undefined): value is JsonRecord & WhatnotImportPayload {
  if (!value || value.kind !== WHATNOT_REPORT_KIND) return false;
  if (isWeekAction(value.mode)) return isReportWeek(value.reportWeek);
  return (value.mode === undefined || value.mode === "report") && Array.isArray(value.rows) && value.rows.every(isWhatnotReportRow);
}

/** Whether anything is stored for a report week of the source. */
async function weekIsStored(sourceId: string, reportWeek: string) {
  const dates = reportWeekDates(reportWeek);
  const rows = await listMetrics({ sourceId, metricKeys: ["whatnot_net_earnings"], startDate: dates[0], endDate: dates[dates.length - 1] });
  return rows.some((row) => row.dimensions.rollup === "weekly_report" && row.dimensions.report_week === reportWeek);
}

/** The one report week a set of rows belongs to; an import never mixes weeks, so one replacement covers it. */
function singleReportWeek(rows: WhatnotReportRow[]) {
  const weeks = new Set(rows.map((row) => reportWeekFor(row.completedAt)));
  if (weeks.size > 1) throw new Error("A Whatnot import must hold exactly one report week.");
  return [...weeks][0] ?? null;
}

const SETUP = [
  "Whatnot's Seller API is in a closed developer preview that is not accepting new sellers, and Whatnot's terms forbid automated collection from its app, so this source imports the reports Whatnot gives every seller.",
  "Each Monday at 06:00 UTC, Whatnot publishes the Weekly Orders Report for the previous Monday to Sunday (UTC). Download it from whatnot.com: your profile menu → Financials → Statements → Download.",
  "Upload the CSV on the Whatnot page, one week at a time and as downloaded. Importing a week again replaces that week, so nothing is counted twice. Buyer names, states, countries, shipment IDs, and messages are dropped before anything is stored.",
];

export const whatnotConnector: ConnectorDefinition = {
  key: "whatnot",
  displayName: "Whatnot",
  description: "Live-shopping sales, orders, earnings, and per-show results from the Weekly Orders Report you upload.",
  category: "Commerce",
  icon: "Gavel",
  availability: "live",
  setupKind: "upload",
  defaultSyncMode: "manual",
  urlPatterns: [/^https:\/\/(www\.)?whatnot\.com(\/.*)?$/i],
  requiredFields: [],
  optionalFields: [],
  authType: "report_upload",
  docsUrl: "https://help.whatnot.com/hc/en-us/articles/36772664621837-Seller-Weekly-Orders-Report",
  capabilities: {
    supportsWebhook: false,
    supportsPolling: false,
    supportsManualSync: true,
    recommendedSyncFrequencyMinutes: 7 * 24 * 60,
    canBackfill: true,
    canTestConnection: false,
  },
  detect(inputUrl) {
    const detected = detectWhatnot(inputUrl);
    if (!detected) return null;
    return {
      sourceTypeKey: "whatnot",
      displayName: "Whatnot",
      availability: "live",
      setupKind: "upload",
      confidence: detected.confidence,
      normalizedUrl: detected.normalizedUrl,
      accountName: detected.accountName,
      reasons: detected.reasons,
      requiredSetup: SETUP,
      possibleMetrics: whatnotMetricDefinitions().map((definition) => definition.key),
      demoAvailable: false,
    };
  },
  async testConnection() {
    return {
      ok: true,
      status: "connected",
      message: "Whatnot has no connection to test: upload the Weekly Orders Report to import data.",
      details: { setup: "report_upload" },
    };
  },
  async sync(ctx): Promise<SyncResult> {
    if (!isWhatnotImportPayload(ctx.importPayload)) {
      return {
        rawPayloads: [],
        recordsFetched: 0,
        skippedReason: "Whatnot data arrives by uploading the Weekly Orders Report; there is nothing to fetch.",
        message: "Upload a Whatnot Weekly Orders Report to import data.",
      };
    }
    const payload = ctx.importPayload;
    const fetchedAt = new Date().toISOString();
    if (isWeekAction(payload.mode)) {
      const { mode, reportWeek } = payload as Extract<WhatnotImportPayload, { mode: WhatnotWeekAction }>;
      // The engine holds the source lock while sync runs, so this second look cannot race an import of the same week.
      const stored = await weekIsStored(ctx.source.id, reportWeek);
      if (mode === "no_sales" && stored) {
        return {
          rawPayloads: [],
          recordsFetched: 0,
          skippedReason: "That week has an imported report now, so it was not recorded as having no sales.",
          message: "Nothing changed.",
        };
      }
      if (mode === "remove" && !stored) {
        return { rawPayloads: [], recordsFetched: 0, skippedReason: "Nothing is imported for that week.", message: "Nothing changed." };
      }
      const currency = typeof payload.currency === "string" && /^[a-z]{3}$/u.test(payload.currency) ? payload.currency : null;
      const record = { kind: WHATNOT_REPORT_KIND, mode, reportWeek, currency, rows: [] };
      return {
        rawPayloads: [{
          externalId: `whatnot:weekly_report:${reportWeek}`,
          fetchedAt,
          payloadHash: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
          payload: record as unknown as JsonRecord,
          cursor: { reportWeek },
        }],
        recordsFetched: 0,
        cursorAfter: { reportWeek },
        message: mode === "no_sales"
          ? `Recorded the Whatnot report week of ${reportWeek} as having no sales.`
          : `Removed the Whatnot report week of ${reportWeek}.`,
      };
    }
    const { rows, fileName } = payload as Extract<WhatnotImportPayload, { rows: WhatnotReportRow[] }>;
    const reportWeek = singleReportWeek(rows);
    if (!reportWeek) {
      return { rawPayloads: [], recordsFetched: 0, skippedReason: "The report has no transactions.", message: "Nothing to import." };
    }
    const count = rows.length;
    return {
      // One raw snapshot per report week; an identical re-upload is recognized by its hash.
      rawPayloads: [{
        externalId: `whatnot:weekly_report:${reportWeek}`,
        fetchedAt,
        payloadHash: hashWhatnotRows(rows),
        payload: {
          kind: WHATNOT_REPORT_KIND,
          mode: "report",
          reportWeek,
          fileName,
          rowCount: count,
          rows: rows as unknown as JsonRecord[],
        } as JsonRecord,
        cursor: { reportWeek },
      }],
      recordsFetched: count,
      cursorAfter: { reportWeek },
      message: `Imported ${count} Whatnot transaction${count === 1 ? "" : "s"} for the report week of ${reportWeek}.`,
    };
  },
  async normalize(rawPayloads, source) {
    const payloads = rawPayloads.map((rawPayload) => rawPayload.payload).filter((payload) => payload.kind === WHATNOT_REPORT_KIND);
    if (payloads.length === 0) return { metrics: [] };
    if (payloads.length > 1) throw new Error("A Whatnot import must hold exactly one report week.");
    const [payload] = payloads;
    const mode = isWeekAction(payload.mode) ? payload.mode : "report";
    const rows = mode === "report" ? whatnotRowsFromPayload(payload) : [];
    const reportWeek = mode === "report" ? singleReportWeek(rows) : isReportWeek(payload.reportWeek) ? payload.reportWeek : null;
    if (!reportWeek) return { metrics: [] };
    const currency = typeof payload.currency === "string" && /^[a-z]{3}$/u.test(payload.currency) ? payload.currency : undefined;
    const dates = reportWeekDates(reportWeek);
    return {
      // A removed week writes nothing; a week without sales writes zeros, which mark it as imported.
      metrics: mode === "remove" ? [] : whatnotWeekMetrics(reportWeek, rows, source.id, currency, { recordedAsNoSales: mode === "no_sales" }),
      // Everything stored for this week goes first, so a corrected or re-dated report leaves nothing stale behind.
      replaceMetricWindow: {
        metricKeys: [...WHATNOT_DAILY_METRIC_KEYS, ...WHATNOT_SHOW_METRIC_KEYS],
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        dimension: { key: "report_week", value: reportWeek },
      },
    };
  },
  getMetricDefinitions() {
    return whatnotMetricDefinitions();
  },
  getSetupInstructions() {
    return SETUP;
  },
};
