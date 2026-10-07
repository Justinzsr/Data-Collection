import { ArrowRight, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import {
  getWhatnotDetail,
  reportWeekSpanLabel,
  shortDateLabel,
  type WhatnotShowRow,
} from "@/aggregation/services/platform-overview-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { DailyMetricChart } from "@/presentation/charts/daily-metric-chart";
import { LinkButton } from "@/presentation/components/ui/button";
import { formatMetricValue } from "@/presentation/components/ui/format";
import { Callout, GlassPanel, SectionTitle } from "@/presentation/components/ui/panel";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { currentTime } from "@/presentation/components/ui/relative-time";
import { cardHealth } from "@/presentation/overview/platform-overview-card";
import { MetricTileGrid } from "@/presentation/platforms/metric-tile-grid";
import { PlatformPageHeader } from "@/presentation/platforms/platform-page-header";
import { parseDetailRange } from "@/presentation/platforms/social-platform-page";
import { WhatnotImportPanel } from "@/presentation/platforms/whatnot-import-panel";
import { WhatnotWeekList } from "@/presentation/platforms/whatnot-week-list";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

/** "the weeks of Sep 14 – Sep 20 and Sep 21 – Sep 27", shortened past three weeks. */
function weekList(weeks: string[]) {
  const labels = weeks.map(reportWeekSpanLabel);
  if (labels.length === 1) return `the week of ${labels[0]}`;
  if (labels.length <= 3) return `the weeks of ${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `${labels.length} weeks, from ${labels[0]} to ${labels.at(-1)}`;
}

function showName(show: WhatnotShowRow) {
  if (show.id === "marketplace") return "Marketplace, outside shows";
  return show.title ?? `Show on ${shortDateLabel(show.date)}`;
}

function ShowsTable({ shows, currency, periodLabel }: { shows: WhatnotShowRow[]; currency: string; periodLabel: string }) {
  return (
    <section className="grid min-w-0 content-start gap-3" aria-labelledby="whatnot-shows-title" data-testid="whatnot-shows">
      <SectionTitle title="Completed sales by show" id="whatnot-shows-title" action={<span className="text-xs text-[var(--muted)]">{periodLabel}, highest first</span>} />
      <GlassPanel className="min-w-0 overflow-hidden p-0">
        {shows.length === 0 ? (
          <p className="p-4 text-sm text-label-secondary sm:p-5" role="status">No completed sales in this period.</p>
        ) : (
          <div className="min-w-0 overflow-x-auto focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-tint/30" role="region" aria-label="Scrollable sales by show" tabIndex={0}>
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">Whatnot completed sales by show for {periodLabel.toLowerCase()}</caption>
              <thead className="border-b border-separator text-xs text-[var(--muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-medium sm:pl-5">Show</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Orders</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Items</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium sm:pr-5">Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {shows.map((show) => (
                  <tr key={show.id}>
                    <th scope="row" className="max-w-[20rem] px-3 py-3 font-normal sm:pl-5">
                      <span className="block truncate font-semibold text-label" title={showName(show)}>{showName(show)}</span>
                      {show.id === "marketplace" ? null : (
                        <span className="mt-0.5 block text-xs text-[var(--muted)]">Ran {shortDateLabel(show.date)}</span>
                      )}
                    </th>
                    <td className="tabular px-3 py-3 text-right text-label-secondary">{formatMetricValue(show.orders, "count")}</td>
                    <td className="tabular px-3 py-3 text-right text-label-secondary">{formatMetricValue(show.items, "count")}</td>
                    <td className="tabular px-3 py-3 text-right font-semibold text-label sm:pr-5">{formatMetricValue(show.sales, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>
    </section>
  );
}

export default async function WhatnotPlatformPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ dataSpaceSlug }, query] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  const rangeKey = parseDetailRange(query?.range);
  const detail = await getWhatnotDetail({ dataSpace, rangeKey });
  const { card, coverage, period, range, source } = detail;
  const now = currentTime();
  const health = source ? cardHealth(card, now) : { tone: "slate" as const, label: "Not connected" };
  const path = `${basePath}/platforms/whatnot`;
  const hasReports = detail.reportWeeks.length > 0;
  const latestWeek = detail.reportWeeks[0] ?? null;
  const periodNote = period
    ? `${shortDateLabel(period.start)} – ${shortDateLabel(period.end)}${range.comparison ? `, change ${range.comparison.basis}` : ""}`
    : null;
  const pending = coverage.pendingWeeks.length;
  const emptyPeriodNote = range.days === 1
    ? "Whatnot reports arrive once a week, so today has no data yet. Choose 7 or 30 days."
    : [
        coverage.coveredThrough ? `Your imported reports cover days through ${shortDateLabel(coverage.coveredThrough)}, before this period.` : null,
        pending > 0 ? "Import the newer reports below to fill it in." : "Whatnot publishes the next report early on Monday (UTC).",
        range.days < 30 ? "Choose 30 days to see the latest imported week." : null,
      ].filter(Boolean).join(" ");

  const importSection = source ? (
    <section className="grid min-w-0 gap-3" aria-labelledby="whatnot-import-title" id="import">
      <SectionTitle
        title={hasReports ? "Import a weekly report" : "Import your first weekly report"}
        id="whatnot-import-title"
        action={latestWeek ? <span className="text-xs text-[var(--muted)]">Latest imported: week of {reportWeekSpanLabel(latestWeek)}</span> : null}
      />
      <GlassPanel className="min-w-0 p-4 sm:p-5">
        <WhatnotImportPanel sourceId={source.id} dataSpaceSlug={dataSpace.slug} />
      </GlassPanel>
    </section>
  ) : null;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5" data-testid="whatnot-platform">
      <PlatformPageHeader
        overviewHref={basePath}
        iconKey="whatnot"
        title="Whatnot"
        subtitle={card.account ? `Live shopping for ${card.account}, from the weekly orders report` : "Live shopping sales, from the weekly orders report"}
        status={{ tone: health.tone, label: health.label }}
        range={rangeKey}
        rangeHref={(next) => (next === "30d" ? path : `${path}?range=${next}`)}
        testId="whatnot-header"
        actions={source ? (
          <LinkButton href={`${basePath}/sources/${source.id}`} variant="secondary" className="min-h-11 sm:min-h-10">
            Source settings
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </LinkButton>
        ) : (
          <LinkButton href={`${basePath}/sources/new?template=whatnot`} variant="primary" className="min-h-11 sm:min-h-10">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Whatnot
          </LinkButton>
        )}
      />

      {!source ? (
        <GlassPanel className="grid min-w-0 gap-4 p-5 sm:p-7" data-testid="whatnot-setup">
          <div className="flex min-w-0 items-start gap-4">
            <PlatformIcon sourceTypeKey="whatnot" size="lg" />
            <div className="min-w-0 max-w-2xl">
              <h2 className="text-[20px] font-semibold tracking-[-0.022em] text-label">Bring in your Whatnot sales</h2>
              <p className="mt-2 text-sm leading-6 text-label-secondary">
                Whatnot sends every seller a weekly orders report. Add Whatnot here, then upload that report each week to see sales,
                orders, earnings, fees, and how each show performed. No Whatnot password or login is needed.
              </p>
            </div>
          </div>
          <LinkButton href={`${basePath}/sources/new?template=whatnot`} variant="primary" className="w-full sm:w-fit">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Whatnot
          </LinkButton>
        </GlassPanel>
      ) : null}

      {source && coverage.missingWeeks.length > 0 ? (
        <Callout tone="warning" title={coverage.missingWeeks.length === 1 ? "A week hasn't been imported" : "Some weeks haven't been imported"} role="status">
          Totals leave out {weekList(coverage.missingWeeks)}, and changes that include those days are not shown. Download the missing
          reports from Financials → Statements and import them below. For a week you sold nothing in, choose “No sales that week”
          under Report weeks.
        </Callout>
      ) : null}

      {source && latestWeek && pending > 0 ? (
        <Callout tone="warning" title={pending === 1 ? "A newer weekly report is ready" : `${pending} newer weekly reports are ready`} role="status">
          Whatnot has published {pending === 1 ? "a report" : `${pending} reports`} since the week of {reportWeekSpanLabel(latestWeek)}.
          Download {pending === 1 ? "it" : "them"} from Financials → Statements and import {pending === 1 ? "it" : "them"} below to bring
          these numbers up to date. For a week you sold nothing in, choose “No sales that week” under Report weeks instead.
        </Callout>
      ) : null}

      {/* The import panel keeps one position in the tree, so its confirmation survives the refresh after an import. */}
      {source && hasReports ? (
        <section className="grid min-w-0 gap-3" aria-labelledby="whatnot-period-title">
          <SectionTitle
            title={range.label}
            id="whatnot-period-title"
            action={periodNote ? <span className="text-xs text-[var(--muted)]">{periodNote}</span> : null}
          />
          {!period ? (
            <Callout tone="info" role="status">
              {emptyPeriodNote}
            </Callout>
          ) : null}
          <MetricTileGrid metrics={detail.metrics} testId="whatnot-metrics" />
        </section>
      ) : null}

      {source && hasReports && period ? (
        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" aria-label="Sales">
          <DailyMetricChart
            title="Daily completed sales"
            description={coverage.coveredThrough ? `${range.sparkline.label}, through ${shortDateLabel(coverage.coveredThrough)}` : range.sparkline.label}
            data={detail.daily.map((point) => ({ date: point.date, value: point.sales }))}
            unit={detail.currency}
            color={platformSeriesColor("whatnot")}
            missingLabel="Not imported"
            testId="whatnot-daily-sales"
          />
          <ShowsTable shows={detail.shows} currency={detail.currency} periodLabel={range.label} />
        </section>
      ) : null}

      {importSection}

      {/* Rendered whenever the source exists, so the list's confirmation survives removing the last week. */}
      {source ? (
        <section className="grid min-w-0 gap-3" aria-labelledby="whatnot-weeks-title">
          <SectionTitle
            title="Report weeks"
            id="whatnot-weeks-title"
            action={<span className="text-xs text-[var(--muted)]">Monday to Sunday UTC, newest first</span>}
          />
          <GlassPanel className="min-w-0 overflow-hidden p-0">
            <WhatnotWeekList
              weeks={detail.weeks.map((week) => ({ ...week, label: reportWeekSpanLabel(week.reportWeek) }))}
              sourceId={source.id}
              dataSpaceSlug={dataSpace.slug}
            />
          </GlassPanel>
        </section>
      ) : null}

      <p className="px-1 text-xs leading-5 text-[var(--muted)]">
        Whatnot puts an order in its weekly report when the order completes, about four hours after delivery (sooner with Early Payout),
        so sales, orders, and shows count on that day rather than the day the order was placed. Sales are item prices after your coupons;
        giveaways are not sales, and the shipping you pay for them is part of net earnings. Net earnings are what reached your Whatnot
        balance after fees, refunds, tips, and shipping charges. Days follow Pacific Time. Each report covers Monday to Sunday in UTC, so a
        week is complete through its Saturday, and its Sunday once the next week is imported.
      </p>
    </div>
  );
}
