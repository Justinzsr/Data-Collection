import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getMetricTimeseries } from "@/aggregation/services/timeseries-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const metricKey = url.searchParams.get("metricKey") ?? "page_views";
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  return Response.json({ series: await getMetricTimeseries({ metricKey, dataSpaceId: dataSpace.id }) });
}
