import { enqueueSyncRun } from "@/collection/sync/engine";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await enqueueSyncRun({ sourceId: id, trigger: "manual" });
  return Response.json({ run });
}
