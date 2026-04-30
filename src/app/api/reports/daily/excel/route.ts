import { dailyReportToExcelXml, generateDailyReport, getDailyReport } from "@/aggregation/services/daily-report-service";
import { addDaysToDateKey, dateKeyInAppTimeZone, normalizeDateOnlyKey } from "@/storage/runtime/app-time";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fallbackReportDate = addDaysToDateKey(dateKeyInAppTimeZone(), -1);
  const reportDate = normalizeDateOnlyKey(url.searchParams.get("date"), fallbackReportDate);
  const report = (await getDailyReport(reportDate)) ?? (await generateDailyReport(reportDate));
  const xml = dailyReportToExcelXml(report);
  return new Response(xml, {
    headers: {
      "content-type": "application/vnd.ms-excel; charset=utf-8",
      "content-disposition": `attachment; filename="moonarq-daily-report-${report.run.report_date}.xls"`,
      "cache-control": "private, no-store",
    },
  });
}
