import Link from "next/link";
import { Activity, CalendarDays, Clock3, DatabaseZap } from "lucide-react";
import type { WebsiteFunnelOverview } from "@/aggregation/services/website-funnel-types";
import { Badge } from "@/presentation/components/ui/badge";
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

/** Coverage facts and the period controls for the Website storefront analysis. */
export function WebsiteOverviewControls({
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
    <section
      className="glass grid min-w-0 gap-4 rounded-[28px] p-4 sm:p-5"
      aria-label="Website period and coverage"
      data-testid="website-overview-controls"
    >
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
          <nav className="segmented" aria-label="Website date range">
            {MOONARQ_OVERVIEW_RANGES.map((range) => (
              <Link
                key={range}
                href={buildMoonArqOverviewHref(basePath, query, { range })}
                className="segmented-item min-h-11 sm:min-h-10"
                aria-current={query.range === range ? "page" : undefined}
              >
                {rangeLabels[range]}
              </Link>
            ))}
          </nav>
          <nav className="segmented" aria-label="Website comparison">
            {MOONARQ_OVERVIEW_COMPARISONS.map((compare) => (
              <Link
                key={compare}
                href={buildMoonArqOverviewHref(basePath, query, { compare })}
                className="segmented-item min-h-11 sm:min-h-10"
                aria-current={query.compare === compare ? "page" : undefined}
              >
                {compare === "previous" ? "Previous period" : "Comparison off"}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {overview.range.partialDay ? <Badge tone="amber" dot>Partial day</Badge> : null}
          <Badge tone="slate">Pacific Time</Badge>
          <OverviewRefreshButton />
        </div>
      </div>
    </section>
  );
}
