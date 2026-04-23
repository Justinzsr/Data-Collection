import { detectSource } from "@/collection/connectors/registry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const input = typeof body.input === "string" ? body.input : "";
  return Response.json({ detections: detectSource(input) });
}
