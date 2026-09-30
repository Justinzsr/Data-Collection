import Link from "next/link";
import { ChevronRight, Download, FileText, RefreshCcw } from "lucide-react";
import { notFound } from "next/navigation";
import { getDailyReport, listDailyReports } from "@/aggregation/services/daily-report-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { addDaysToDateKey, dateKeyInAppTimeZone, formatAppDate, normalizeDateOnlyKey, startOfAppDateUtc } from "@/storage/runtime/app-time";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { IconTile } from "@/presentation/components/ui/platform-icon";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

function yesterdayPt() {
  return addDaysToDateKey(dateKeyInAppTimeZone(), -1);
}

function displayMetric(value: number | null, textValue: string | null, unit: string | null) {
  if (textValue) return textValue;
  if (value === null) return "-";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "usd") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function DailyReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<{ date?: string }>;
}) {
  const [{ dataSpaceSlug }, query] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  const reportDate = normalizeDateOnlyKey(query?.date, yesterdayPt());
  const [report, reports] = await Promise.all([getDailyReport(reportDate, dataSpace), listDailyReports(12, dataSpace)]);
  const metricsBySection = new Map<string, NonNullable<typeof report>["metrics"]>();
  for (const metric of report?.metrics ?? []) {
    metricsBySection.set(metric.section_key, [...(metricsBySection.get(metric.section_key) ?? []), metric]);
  }

  return (
    <div className="mx-auto grid max-w-[1500px] gap-5">
      <SectionHeader
        eyebrow="Daily Morning Report"
        title={`${dataSpace.display_name} Daily Report`}
        description={`Yesterday, ${formatAppDate(startOfAppDateUtc(reportDate))} PT. Generated safely inside Data Hub; Excel is manual-only, authenticated, and data-space scoped.`}
        action={
          <>
            <form action={`/api/reports/daily/generate?dataSpaceSlug=${encodeURIComponent(dataSpace.slug)}`} method="post">
              <input type="hidden" name="reportDatePt" value={reportDate} />
              <Button type="submit" variant="primary">
                <RefreshCcw className="h-4 w-4" />
                Generate / Regenerate
              </Button>
            </form>
            {report ? (
              <LinkButton href={`/api/reports/daily/excel?date=${reportDate}&dataSpaceSlug=${encodeURIComponent(dataSpace.slug)}`} variant="secondary">
                <Download className="h-4 w-4" />
                Download Excel
              </LinkButton>
            ) : null}
          </>
        }
      />

      {report ? (
        <>
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <IconTile icon={FileText} tone="tint" size="lg" />
                <div>
                  <p className="text-sm text-muted">Generated {report.run.generated_at_pt}</p>
                  <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.022em] text-label">Yesterday, {report.run.report_date_pt}</h2>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-label-secondary">{report.run.summary}</p>
                </div>
              </div>
              <Badge tone={report.run.health_status === "healthy" ? "green" : report.run.health_status === "empty" ? "slate" : "amber"} dot>{report.run.health_status}</Badge>
            </div>
          </GlassPanel>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {report.sections.map((section) => (
              <GlassPanel key={section.id} className="p-4 sm:p-5">
                <div className="mb-4">
                  <p className="eyebrow">{section.section_key.replaceAll("_", " ")}</p>
                  <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">{section.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-label-secondary">{section.summary}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(metricsBySection.get(section.section_key) ?? []).map((metric) => (
                    <div key={metric.id} className="inset-surface p-3">
                      <p className="text-xs font-medium text-muted">{metric.label}</p>
                      <p className="tabular mt-1 break-words text-[19px] font-semibold tracking-[-0.02em] text-label">{displayMetric(metric.value, metric.text_value, metric.unit)}</p>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            ))}
          </div>
        </>
      ) : (
        <GlassPanel className="p-6">
          <IconTile icon={FileText} tone="neutral" size="lg" className="mb-4" />
          <h2 className="text-[20px] font-semibold tracking-[-0.022em] text-label">No report generated for this PT date yet</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-label-secondary">
            Generate yesterday&apos;s report when you want a fixed, reviewable snapshot. The generator is idempotent per data space and date.
          </p>
        </GlassPanel>
      )}

      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">Recent reports</h2>
          <LinkButton href={`${basePath}/data`} variant="secondary">Source Data Explorer</LinkButton>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {reports.length === 0 ? <p className="text-sm text-muted">No historical reports yet.</p> : null}
          {reports.map((item) => (
            <Link key={item.id} href={`${basePath}/reports/daily?date=${item.report_date}`} className="group flex min-h-12 items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-fill-hover">
              <span className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-4">
                <span className="block font-semibold text-label">{item.report_date_pt}</span>
                <span className="block truncate text-sm text-muted">{item.summary}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-label-quaternary transition group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
