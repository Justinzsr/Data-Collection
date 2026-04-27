import { enqueueSyncRun } from "@/collection/sync/engine";
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

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = await enqueueSyncRun({ sourceId: id, trigger: "manual" });
    const status = run.status === "error" ? 500 : run.status === "skipped" ? 409 : 200;
    return Response.json({
      ok: run.status === "success",
      run: serializeSyncRun(run),
      error: run.status === "error" ? run.error_message ?? "Sync failed." : null,
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
