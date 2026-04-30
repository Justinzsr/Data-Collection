import { generateDailyReport } from "@/aggregation/services/daily-report-service";
import { dateKeyInAppTimeZone } from "@/storage/runtime/app-time";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let reportDatePt = dateKeyInAppTimeZone();
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({})) as { reportDatePt?: string };
    reportDatePt = body.reportDatePt?.slice(0, 10) ?? reportDatePt;
  } else {
    const form = await request.formData();
    const value = form.get("reportDatePt");
    if (typeof value === "string" && value) reportDatePt = value.slice(0, 10);
  }

  const report = await generateDailyReport(reportDatePt);
  if (contentType.includes("application/json")) {
    return Response.json({ reportDate: report.run.report_date, status: report.run.status });
  }
  return Response.redirect(new URL(`/dashboard/reports/daily?date=${report.run.report_date}`, request.url), 303);
}
