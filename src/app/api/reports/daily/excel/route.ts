import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { dailyReportToExcelXml, generateDailyReport, getDailyReport } from "@/aggregation/services/daily-report-service";
import { addDaysToDateKey, dateKeyInAppTimeZone, normalizeDateOnlyKey } from "@/storage/runtime/app-time";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fallbackReportDate = addDaysToDateKey(dateKeyInAppTimeZone(), -1);
  const reportDate = normalizeDateOnlyKey(url.searchParams.get("date"), fallbackReportDate);
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  const report = (await getDailyReport(reportDate, dataSpace)) ?? (await generateDailyReport(reportDate, dataSpace));
  const xml = dailyReportToExcelXml(report);
  const slug = dataSpace.slug.replaceAll("-", "_");
  return new Response(xml, {
    headers: {
      "content-type": "application/vnd.ms-excel; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-daily-report-${report.run.report_date}.xls"`,
      "cache-control": "private, no-store",
    },
  });
}
