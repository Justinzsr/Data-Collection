import { getContentDashboard } from "@/aggregation/services/content-service";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getContentDashboard());
}
