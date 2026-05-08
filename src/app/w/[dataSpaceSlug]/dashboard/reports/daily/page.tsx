import Link from "next/link";
import { Download, FileText, RefreshCcw } from "lucide-react";
import { notFound } from "next/navigation";
import { getDailyReport, listDailyReports } from "@/aggregation/services/daily-report-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { addDaysToDateKey, dateKeyInAppTimeZone, formatAppDate, normalizeDateOnlyKey, startOfAppDateUtc } from "@/storage/runtime/app-time";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
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
    <div className="mx-auto grid max-w-[1500px] gap-6">
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
                <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10">
                  <FileText className="h-5 w-5 text-cyan-100" />
                </span>
                <div>
                  <p className="text-sm text-slate-500">Generated {report.run.generated_at_pt}</p>
                  <h2 className="mt-1 text-xl font-semibold text-white">Yesterday, {report.run.report_date_pt}</h2>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">{report.run.summary}</p>
                </div>
              </div>
              <Badge tone={report.run.health_status === "healthy" ? "green" : report.run.health_status === "empty" ? "slate" : "amber"}>{report.run.health_status}</Badge>
            </div>
          </GlassPanel>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {report.sections.map((section) => (
              <GlassPanel key={section.id} className="p-4 sm:p-5">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/75">{section.section_key.replaceAll("_", " ")}</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{section.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{section.summary}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(metricsBySection.get(section.section_key) ?? []).map((metric) => (
                    <div key={metric.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
                      <p className="mt-1 break-words text-lg font-semibold text-slate-100">{displayMetric(metric.value, metric.text_value, metric.unit)}</p>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            ))}
          </div>
        </>
      ) : (
        <GlassPanel className="p-6">
          <h2 className="text-xl font-semibold text-white">No report generated for this PT date yet</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Generate yesterday&apos;s report when you want a fixed, reviewable snapshot. The generator is idempotent per data space and date.
          </p>
        </GlassPanel>
      )}

      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-white">Recent reports</h2>
          <LinkButton href={`${basePath}/data`} variant="secondary">Source Data Explorer</LinkButton>
        </div>
        <div className="grid gap-2">
          {reports.length === 0 ? <p className="text-sm text-slate-500">No historical reports yet.</p> : null}
          {reports.map((item) => (
            <Link key={item.id} href={`${basePath}/reports/daily?date=${item.report_date}`} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 transition hover:bg-white/[0.06] sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium text-white">{item.report_date_pt}</span>
              <span className="text-sm text-slate-500">{item.summary}</span>
            </Link>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
