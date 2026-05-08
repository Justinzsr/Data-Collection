import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { listSyncRuns } from "@/storage/repositories/sync-runs-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  return Response.json({ runs: await listSyncRuns(50, undefined, { dataSpaceId: dataSpace.id }) });
}
