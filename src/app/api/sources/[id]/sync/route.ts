import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getSourceOperationBlockReason } from "@/collection/connectors/registry";
import { enqueueSyncRun } from "@/collection/sync/engine";
import { isSourceLocked } from "@/collection/sync/locks";
import { getSource } from "@/storage/repositories/sources-repository";
import type { SyncRun } from "@/storage/db/schema";

export const runtime = "nodejs";

function serializeSyncRun(run: SyncRun) {
  return {
    id: run.id,
    source_id: run.source_id,
    source_type_key: run.source_type_key,
    trigger: run.trigger,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    duration_ms: run.duration_ms,
    records_fetched: run.records_fetched,
    records_inserted: run.records_inserted,
    records_updated: run.records_updated,
    metrics_upserted: run.metrics_upserted,
    error_message: run.error_message,
    created_at: run.created_at,
  };
}

const MAX_MIN_AGE_MINUTES = 24 * 60;

/**
 * Live monitors pass `minAgeMinutes`: the sync only runs when the last
 * successful sync is at least that old, so any number of open pages, tabs, or
 * people share one sync per interval. Without it, the request always syncs
 * (the Refresh now and Sync now buttons).
 */
function parseMinAgeMinutes(request: Request): { value: number | null; invalid: boolean } {
  const raw = new URL(request.url).searchParams.get("minAgeMinutes");
  if (raw === null) return { value: null, invalid: false };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_MIN_AGE_MINUTES) return { value: null, invalid: true };
  return { value, invalid: false };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const minAge = parseMinAgeMinutes(request);
    if (minAge.invalid) {
      return Response.json({ ok: false, error: `minAgeMinutes must be a whole number from 1 to ${MAX_MIN_AGE_MINUTES}.` }, { status: 400 });
    }
    const dataSpace = await resolveDataSpaceFromRequest(request);
    if (!dataSpace) return Response.json({ ok: false, error: "Unknown data space." }, { status: 404 });
    const source = await getSource(id, { dataSpaceId: dataSpace.id });
    if (!source) return Response.json({ ok: false, error: "Source not found." }, { status: 404 });
    const blocked = getSourceOperationBlockReason(source);
    if (blocked) {
      return Response.json(
        { ok: false, error: blocked, code: "connector_unavailable" },
        { status: 409 },
      );
    }
    if (minAge.value !== null) {
      const minAgeMs = minAge.value * 60_000;
      const lastSuccess = source.last_success_at ? Date.parse(source.last_success_at) : Number.NaN;
      const age = Date.now() - lastSuccess;
      if (Number.isFinite(lastSuccess) && age < minAgeMs) {
        // Already fresh enough. The server's clock decides when to ask again, so a skewed browser clock cannot loop.
        return Response.json({
          ok: true,
          fresh: true,
          run: null,
          last_success_at: source.last_success_at,
          retry_after_ms: Math.max(0, minAgeMs - age),
          error: null,
        });
      }
      if (await isSourceLocked(source.id)) {
        // Another sync is running; ask again shortly instead of recording a skipped run.
        return Response.json({ ok: true, in_progress: true, run: null, error: null });
      }
    }
    const run = await enqueueSyncRun({ sourceId: id, trigger: "manual" });
    const status = run.status === "error" ? 500 : run.status === "skipped" ? 409 : 200;
    return Response.json({
      ok: run.status === "success",
      run: serializeSyncRun(run),
      error: run.status === "success" ? null : run.error_message ?? "Sync did not run.",
    }, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manual sync failed.";
    return Response.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
