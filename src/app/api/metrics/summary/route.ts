import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getDashboardSummary } from "@/aggregation/services/summary-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const range = new URL(request.url).searchParams.get("range");
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  return Response.json({ summary: await getDashboardSummary(range === "today" || range === "7d" ? range : "30d", { dataSpaceId: dataSpace.id }) });
}
