import { getDashboardSummary } from "@/aggregation/services/summary-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const range = new URL(request.url).searchParams.get("range");
  return Response.json({ summary: await getDashboardSummary(range === "today" || range === "7d" ? range : "30d") });
}
