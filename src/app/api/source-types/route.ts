import { listSourceTypes } from "@/collection/connectors/registry";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ sourceTypes: listSourceTypes() });
}
