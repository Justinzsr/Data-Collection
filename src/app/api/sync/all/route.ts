import { runDueSources } from "@/collection/sync/engine";
import { resolveDataSpaceFromRequest } from "@/app/api/data-space";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  const runs = await runDueSources("manual", { dataSpaceId: dataSpace.id });
  return Response.json({ runs });
}
