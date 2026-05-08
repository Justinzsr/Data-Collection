import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { listConnectorEvents, listWebEvents } from "@/storage/repositories/events-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  return Response.json({
    webEvents: await listWebEvents(100, { dataSpaceId: dataSpace.id }),
    connectorEvents: await listConnectorEvents(100, { dataSpaceId: dataSpace.id }),
  });
}
