import { listSyncRuns } from "@/storage/repositories/sync-runs-repository";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ runs: await listSyncRuns(50) });
}
