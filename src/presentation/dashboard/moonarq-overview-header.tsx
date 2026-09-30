import Link from "next/link";
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
  const meta = [
    {
      label: "Data through",
      value: formatAppDateTime(overview.coverage.latestReceivedAt, "No accepted events yet"),
      icon: Clock3,
    },
    {
      label: "Tracking coverage",
      value: overview.coverage.firstOccurredAt
        ? `Since ${formatAppDate(overview.coverage.firstOccurredAt)}`
        : "Coverage has not started",
      icon: CalendarDays,
    },
    { label: "Selected period", value: overview.range.label, icon: Activity },
    { label: "Source role", value: "First-party Website Tracker", icon: DatabaseZap },
  ];

  return (
    <header
      className="glass grid min-w-0 gap-4 rounded-[28px] p-4 sm:p-5"
      data-testid="dashboard-overview"
      data-overview-header="moonarq"
    >
      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Storefront intelligence</p>
          <h1 className="mt-0.5 text-[28px] font-bold leading-tight tracking-[-0.028em] text-label sm:text-[32px]">
            MoonArq Overview
          </h1>
          <p className="mt-1 max-w-3xl text-[14px] leading-6 text-label-secondary">
            First-party storefront behavior, Shopify commerce outcomes, and acquisition signals in one decision view.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end xl:pt-1">
          <Badge tone={sourceTone(overview.source)} dot>{sourceLabel(overview.source)}</Badge>
          {overview.range.partialDay ? <Badge tone="amber" dot>Partial day</Badge> : null}
          <Badge tone="slate">Pacific Time</Badge>
        </div>
      </div>

      <dl className="inset-surface grid min-w-0 gap-3 rounded-[20px] p-3 sm:grid-cols-2 xl:grid-cols-4">
        {meta.map((item) => (
          <div key={item.label} className="flex min-w-0 items-start gap-2.5">
            <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-tint" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs text-[var(--muted)]">{item.label}</dt>
              <dd className="mt-0.5 break-words text-[13px] font-medium text-label">{item.value}</dd>
            </div>
          </div>
        ))}
      </dl>

      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
          <nav className="segmented" aria-label="Overview date range">
            {MOONARQ_OVERVIEW_RANGES.map((range) => (
              <Link
                key={range}
                href={buildMoonArqOverviewHref(basePath, query, { range })}
                className="segmented-item min-h-11 sm:min-h-9"
                aria-current={query.range === range ? "page" : undefined}
              >
                {rangeLabels[range]}
              </Link>
            ))}
          </nav>
          <nav className="segmented" aria-label="Overview comparison">
            {MOONARQ_OVERVIEW_COMPARISONS.map((compare) => (
              <Link
                key={compare}
                href={buildMoonArqOverviewHref(basePath, query, { compare })}
                className="segmented-item min-h-11 sm:min-h-9"
                aria-current={query.compare === compare ? "page" : undefined}
              >
                {compare === "previous" ? "Previous period" : "Comparison off"}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap gap-2">
          <OverviewRefreshButton />
          <LinkButton href={`${basePath}/sources`} variant="secondary" className="min-h-11 px-4 sm:min-h-10">
            Sources
          </LinkButton>
          <LinkButton href={`${basePath}/sync`} variant="primary" className="min-h-11 px-4 sm:min-h-10">
            Sync Center
          </LinkButton>
        </div>
      </div>
    </header>
  );
}
