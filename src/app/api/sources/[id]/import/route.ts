import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getConnector, getSourceOperationBlockReason } from "@/collection/connectors/registry";
import {
  isReportWeek,
  parseWhatnotWeeklyReport,
  reportWeekHasEnded,
  WHATNOT_EARLIEST_REPORT_WEEK,
  WHATNOT_MAX_REPORT_BYTES,
  WHATNOT_REPORT_KIND,
} from "@/collection/connectors/whatnot/weekly-report";
import { enqueueSyncRun } from "@/collection/sync/engine";
import type { JsonRecord, SyncRun } from "@/storage/db/schema";
import { listMetrics } from "@/storage/repositories/metrics-repository";
import { getSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

/** Multipart overhead allowed on top of the file itself. */
const MULTIPART_ALLOWANCE_BYTES = 64 * 1024;

function safeFileName(name: string) {
  const base = name.split(/[\\/]/u).pop() ?? "";
  const cleaned = base.replace(/[^\p{L}\p{N} ._()-]/gu, "").trim().slice(0, 120);
  return cleaned || null;
}

function serializeRun(run: SyncRun) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    finished_at: run.finished_at,
    records_fetched: run.records_fetched,
    records_inserted: run.records_inserted,
    metrics_upserted: run.metrics_upserted,
    error_message: run.error_message,
  };
}

function runStatus(run: SyncRun) {
  return run.status === "error" ? 500 : run.status === "skipped" ? 409 : 200;
}

/** Whether a report week is stored for the source, and the currency its imported sales use. */
async function storedWeekState(sourceId: string, dataSpaceId: string, reportWeek: string) {
  const rows = (await listMetrics({ sourceId, metricKeys: ["whatnot_sales", "whatnot_net_earnings"], dataSpaceId }))
    .filter((row) => row.dimensions.rollup === "weekly_report");
  const latestSale = rows
    .filter((row) => row.metric_key === "whatnot_sales" && row.metric_value !== 0)
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  const weeks = rows.map((row) => row.dimensions.report_week).filter(isReportWeek).sort();
  return {
    imported: weeks.includes(reportWeek),
    firstWeek: weeks[0] ?? null,
    currency: latestSale?.unit.toLowerCase() ?? null,
  };
}

/**
 * Changes one report week without a file: "no_sales" records a week the seller
 * sold nothing in (Whatnot has no rows to put in that week's report), "remove"
 * deletes a week imported by mistake. Both go through the shared sync engine.
 */
async function applyWeekAction(request: Request, sourceId: string, dataSpaceId: string) {
  const body = await request.json().catch(() => null) as { action?: unknown; reportWeek?: unknown } | null;
  const action = body?.action;
  const reportWeek = body?.reportWeek;
  if ((action !== "no_sales" && action !== "remove") || !isReportWeek(reportWeek)) {
    return Response.json({ ok: false, error: "Choose a report week (its Monday, as YYYY-MM-DD) and what to do with it." }, { status: 400 });
  }
  if (reportWeek < WHATNOT_EARLIEST_REPORT_WEEK || !reportWeekHasEnded(reportWeek, new Date())) {
    return Response.json({ ok: false, error: "Whatnot has no report for that week: it hasn't ended yet, or it is before Whatnot existed." }, { status: 400 });
  }
  const state = await storedWeekState(sourceId, dataSpaceId, reportWeek);
  // The page offers "no sales" only for missing and newly published weeks; older weeks would open a gap back to them.
  if (action === "no_sales" && (!state.firstWeek || reportWeek < state.firstWeek)) {
    return Response.json({
      ok: false,
      error: "Only weeks from your first imported report onward can be recorded as having no sales. Import a report first.",
    }, { status: 400 });
  }
  if (action === "no_sales" && state.imported) {
    return Response.json({
      ok: false,
      error: "That week already has an imported report. Import the corrected report to replace it, or remove the week first.",
    }, { status: 409 });
  }
  if (action === "remove" && !state.imported) {
    return Response.json({ ok: false, error: "Nothing is imported for that week." }, { status: 409 });
  }
  const run = await enqueueSyncRun({
    sourceId,
    trigger: "manual",
    importPayload: { kind: WHATNOT_REPORT_KIND, mode: action, reportWeek, currency: state.currency },
  });
  return Response.json({
    ok: run.status === "success",
    run: serializeRun(run),
    week: { reportWeek, action },
    error: run.status === "success" ? null : run.error_message ?? "The change did not run.",
  }, { status: runStatus(run) });
}

/**
 * Imports an uploaded platform report through the shared sync engine. The file
 * is validated and stripped of personal fields here, before anything is stored,
 * so a wrong file never marks the source as failing. A JSON body changes one
 * report week instead (see applyWeekAction).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > WHATNOT_MAX_REPORT_BYTES + MULTIPART_ALLOWANCE_BYTES) {
      return Response.json({ ok: false, error: "The report is larger than 4 MB. Upload one week at a time." }, { status: 413 });
    }
    const dataSpace = await resolveDataSpaceFromRequest(request);
    if (!dataSpace) return Response.json({ ok: false, error: "Unknown data space." }, { status: 404 });
    const source = await getSource(id, { dataSpaceId: dataSpace.id });
    if (!source) return Response.json({ ok: false, error: "Source not found." }, { status: 404 });
    const connector = getConnector(source.source_type_key);
    if (connector.setupKind !== "upload" || source.source_type_key !== "whatnot") {
      return Response.json({ ok: false, error: "This source does not import uploaded reports." }, { status: 409 });
    }
    const blocked = getSourceOperationBlockReason(source);
    if (blocked) return Response.json({ ok: false, error: blocked, code: "connector_unavailable" }, { status: 409 });
    if (/^application\/json\b/iu.test(request.headers.get("content-type") ?? "")) {
      return applyWeekAction(request, source.id, dataSpace.id);
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: "Choose the Weekly Orders Report CSV to upload." }, { status: 400 });
    }
    if (file.size === 0) return Response.json({ ok: false, error: "The file is empty." }, { status: 400 });
    if (file.size > WHATNOT_MAX_REPORT_BYTES) {
      return Response.json({ ok: false, error: "The report is larger than 4 MB. Upload one week at a time." }, { status: 413 });
    }
    const fileName = safeFileName(file.name);
    const looksLikeCsv = /\.csv$/iu.test(file.name) || /csv|text\/plain/iu.test(file.type);
    if (!looksLikeCsv) {
      return Response.json({ ok: false, error: "Upload the CSV file Whatnot provides (Weekly Orders Report)." }, { status: 400 });
    }

    const parsed = parseWhatnotWeeklyReport(await file.text(), { now: new Date() });
    if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

    const run = await enqueueSyncRun({
      sourceId: source.id,
      trigger: "manual",
      importPayload: {
        kind: WHATNOT_REPORT_KIND,
        fileName,
        rows: parsed.rows as unknown as JsonRecord[],
      },
    });
    const status = runStatus(run);
    return Response.json({
      ok: run.status === "success",
      run: serializeRun(run),
      import: {
        reportWeek: parsed.reportWeek,
        transactions: parsed.rows.length,
        skippedRows: parsed.skippedRows,
        duplicateRows: parsed.duplicateRows,
        currency: parsed.currency,
      },
      error: run.status === "success" ? null : run.error_message ?? "The import did not run.",
    }, { status });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "The import failed." },
      { status: 500 },
    );
  }
}
