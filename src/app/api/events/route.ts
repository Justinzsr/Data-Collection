import { listConnectorEvents, listWebEvents } from "@/storage/repositories/events-repository";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ webEvents: await listWebEvents(100), connectorEvents: await listConnectorEvents(100) });
}
