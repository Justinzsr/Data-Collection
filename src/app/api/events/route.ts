import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { toPublicConnectorEvent, toPublicWebEvent } from "@/aggregation/services/outbound-analytics-exposure";
import { listConnectorEvents, listWebEvents } from "@/storage/repositories/events-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  const [webEvents, connectorEvents] = await Promise.all([
    listWebEvents(100, { dataSpaceId: dataSpace.id }),
    listConnectorEvents(100, { dataSpaceId: dataSpace.id }),
  ]);
  return Response.json({
    webEvents: webEvents.map(toPublicWebEvent),
    connectorEvents: connectorEvents.map(toPublicConnectorEvent),
  });
}
