import { getMetricTimeseries } from "@/aggregation/services/timeseries-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const metricKey = url.searchParams.get("metricKey") ?? "page_views";
  return Response.json({ series: await getMetricTimeseries({ metricKey }) });
}
