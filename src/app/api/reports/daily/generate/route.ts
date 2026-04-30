import { generateDailyReport } from "@/aggregation/services/daily-report-service";
import { addDaysToDateKey, dateKeyInAppTimeZone, normalizeDateOnlyKey } from "@/storage/runtime/app-time";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const fallbackReportDate = addDaysToDateKey(dateKeyInAppTimeZone(), -1);
  let reportDatePt = fallbackReportDate;
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({})) as { reportDatePt?: string };
    reportDatePt = normalizeDateOnlyKey(body.reportDatePt, fallbackReportDate);
  } else {
    const form = await request.formData();
    const value = form.get("reportDatePt");
    reportDatePt = normalizeDateOnlyKey(typeof value === "string" ? value : null, fallbackReportDate);
  }

  const report = await generateDailyReport(reportDatePt);
  if (contentType.includes("application/json")) {
    return Response.json({ reportDate: report.run.report_date, status: report.run.status });
  }
  return Response.redirect(new URL(`/dashboard/reports/daily?date=${report.run.report_date}`, request.url), 303);
}
