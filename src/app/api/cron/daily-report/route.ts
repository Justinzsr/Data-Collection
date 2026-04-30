import { ensureDailyReportForYesterday, isDailyReportStorageReady, isReportingMigrationMissingError, shouldGenerateDailyReportNow } from "@/aggregation/services/daily-report-service";
import { isCronRequestAuthorized } from "@/storage/auth/cron-secret";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    await recordConnectorEvent({
      source_id: null,
      event_type: "daily_report_cron_unauthorized",
      severity: "warning",
      message: "Rejected daily report cron request without CRON_SECRET.",
    });
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!shouldGenerateDailyReportNow()) {
    return Response.json({ skipped: true, reason: "Daily report waits until after 7:00 AM PT." });
  }

  if (!(await isDailyReportStorageReady())) {
    return Response.json({ skipped: true, reason: "Reporting migration is not applied yet. Run pnpm db:migrate." });
  }

  try {
    const result = await ensureDailyReportForYesterday();
    await recordConnectorEvent({
      source_id: null,
      event_type: result.generated ? "daily_report_generated" : "daily_report_skipped",
      severity: "info",
      message: result.generated ? "Generated yesterday's MoonArq Daily Report." : "Daily report already exists for yesterday.",
      metadata: { reportDate: result.report.run.report_date },
    });
    return Response.json({ generated: result.generated, reportDate: result.report.run.report_date });
  } catch (error) {
    if (isReportingMigrationMissingError(error)) {
      return Response.json({ error: "Reporting migration is not applied yet. Run pnpm db:migrate." }, { status: 503 });
    }
    await recordConnectorEvent({
      source_id: null,
      event_type: "daily_report_error",
      severity: "error",
      message: error instanceof Error ? error.message : "Daily report generation failed.",
    });
    return Response.json({ error: error instanceof Error ? error.message : "Daily report generation failed." }, { status: 500 });
  }
}
