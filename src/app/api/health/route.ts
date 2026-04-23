import { getSystemHealth } from "@/aggregation/services/health-service";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ status: "ok", health: await getSystemHealth() });
}
