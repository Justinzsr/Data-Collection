import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getSourceOperationBlockReason } from "@/collection/connectors/registry";
import { enqueueSyncRun } from "@/collection/sync/engine";
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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
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
