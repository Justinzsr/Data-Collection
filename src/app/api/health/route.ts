import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getSystemHealth } from "@/aggregation/services/health-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  return Response.json({ status: "ok", health: await getSystemHealth({ dataSpaceId: dataSpace.id }) });
}
