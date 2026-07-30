import { Activity, CalendarDays, Clock3, DatabaseZap } from "lucide-react";
import type { WebsiteFunnelOverview } from "@/aggregation/services/website-funnel-types";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { OverviewRefreshButton } from "@/presentation/dashboard/overview-refresh-button";
import {
  buildMoonArqOverviewHref,
  MOONARQ_OVERVIEW_COMPARISONS,
  MOONARQ_OVERVIEW_RANGES,
  type MoonArqOverviewQuery,
} from "@/presentation/dashboard/moonarq-overview-query";
import { formatAppDate, formatAppDateTime } from "@/storage/runtime/app-time";

const rangeLabels = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
} as const;

function sourceLabel(source: WebsiteFunnelOverview["source"]) {
  if (source.state === "missing") return "Website source unavailable";
  if (source.state === "ambiguous") return "Website source ambiguous";
  if (source.state === "unhealthy") return "Website source warning";
  return "Website source healthy";
}

function sourceTone(source: WebsiteFunnelOverview["source"]) {
  if (source.state === "missing" || source.state === "ambiguous") return "rose" as const;
  if (source.state === "unhealthy") return "amber" as const;
  return statusTone(source.status);
}

export function MoonArqOverviewHeader({
  overview,
  query,
  basePath,
}: {
  overview: WebsiteFunnelOverview;
  query: MoonArqOverviewQuery;
  basePath: string;
}) {
  return (
    <header
      className="glass grid min-w-0 gap-4 rounded-2xl p-4 sm:p-5"
      data-testid="dashboard-overview"
      data-overview-header="moonarq"
    >
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/70">
            Storefront intelligence
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#f5f2eb] sm:text-3xl">
            MoonArq Overview
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            First-party storefront behavior, Shopify commerce outcomes, and acquisition signals in one decision view.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={sourceTone(overview.source)}>{sourceLabel(overview.source)}</Badge>
          {overview.range.partialDay ? <Badge tone="amber">Partial day</Badge> : null}
          <Badge tone="slate">Pacific Time</Badge>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 border-y border-white/[0.08] py-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200/80" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Data through</p>
            <p className="mt-1 break-words text-sm text-slate-200">
              {formatAppDateTime(overview.coverage.latestReceivedAt, "No accepted events yet")}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2.5">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200/80" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Tracking coverage</p>
            <p className="mt-1 break-words text-sm text-slate-200">
              {overview.coverage.firstOccurredAt
                ? `Since ${formatAppDate(overview.coverage.firstOccurredAt)}`
                : "Coverage has not started"}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2.5">
          <Activity className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200/80" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Selected period</p>
            <p className="mt-1 text-sm text-slate-200">{overview.range.label}</p>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2.5">
          <DatabaseZap className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200/80" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Source role</p>
            <p className="mt-1 text-sm text-slate-200">First-party Website Tracker</p>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
          <nav
            className="flex max-w-full flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1"
            aria-label="Overview date range"
          >
            {MOONARQ_OVERVIEW_RANGES.map((range) => (
              <LinkButton
                key={range}
                href={buildMoonArqOverviewHref(basePath, query, { range })}
                variant={query.range === range ? "primary" : "ghost"}
                className="min-h-11 rounded-lg border-0 px-3 text-xs"
                aria-current={query.range === range ? "page" : undefined}
              >
                {rangeLabels[range]}
              </LinkButton>
            ))}
          </nav>
          <nav
            className="flex max-w-full flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1"
            aria-label="Overview comparison"
          >
            {MOONARQ_OVERVIEW_COMPARISONS.map((compare) => (
              <LinkButton
                key={compare}
                href={buildMoonArqOverviewHref(basePath, query, { compare })}
                variant={query.compare === compare ? "secondary" : "ghost"}
                className="min-h-11 rounded-lg px-3 text-xs"
                aria-current={query.compare === compare ? "page" : undefined}
              >
                {compare === "previous" ? "Previous period" : "Comparison off"}
              </LinkButton>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap gap-2">
          <OverviewRefreshButton />
          <LinkButton href={`${basePath}/sources`} variant="secondary" className="min-h-11 px-3">
            Sources
          </LinkButton>
          <LinkButton href={`${basePath}/sync`} variant="ghost" className="min-h-11 px-3">
            Sync Center
          </LinkButton>
        </div>
      </div>
    </header>
  );
}
