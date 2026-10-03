import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { OverviewMetric, OverviewPlatformCard } from "@/aggregation/services/platform-overview-service";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { SparklineChart } from "@/presentation/charts/sparkline-chart";
import { Badge } from "@/presentation/components/ui/badge";
import { formatMetricValue } from "@/presentation/components/ui/format";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { formatRelativeTime } from "@/presentation/components/ui/relative-time";
import { MetricDelta } from "@/presentation/overview/metric-delta";
import { platformHealth } from "@/presentation/overview/platform-health";

function deltaBasis(metric: OverviewMetric) {
  return metric.delta.kind === "none" ? null : metric.delta.basis;
}

/**
 * One platform at a glance: its headline number and direction, a small trend, and
 * two supporting numbers. The whole card opens the platform's detail page. On
 * phones it condenses to a single row so every platform fits on one screen.
 */
export function PlatformOverviewCard({
  card,
  href,
  now,
}: {
  card: OverviewPlatformCard;
  href: string;
  now: number;
}) {
  const health = platformHealth(card.source, now);
  const unavailable = card.unavailableReason !== null;
  const basis = deltaBasis(card.primary);
  const primaryId = `platform-card-${card.key}-primary`;

  return (
    <article
      className="glass group relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-3xl p-3.5 transition-shadow duration-200 hover:shadow-[inset_0_1px_0_0_var(--glass-rim),var(--glass-shadow-lg)] motion-reduce:transition-none has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-[var(--focus-ring)] sm:flex sm:flex-col sm:items-stretch sm:p-5"
      data-testid={`platform-card-${card.key}`}
      data-platform={card.key}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PlatformIcon sourceTypeKey={card.iconKey} />
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold leading-5 tracking-[-0.012em] text-label">
              <Link
                href={href}
                className="outline-hidden after:absolute after:inset-0 after:z-[1] after:rounded-3xl"
                aria-describedby={primaryId}
              >
                {card.title}
              </Link>
            </h3>
            {card.account ? <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{card.account}</p> : null}
            <Badge tone={health.tone} dot className="mt-1.5 sm:hidden">{health.label}</Badge>
          </div>
        </div>
        <Badge tone={health.tone} dot className="hidden shrink-0 sm:inline-flex">{health.label}</Badge>
      </div>

      <div className="min-w-0 text-right sm:mt-5 sm:text-left" id={primaryId}>
        <p className="text-xs font-medium text-label-secondary sm:text-[13px]">{card.primary.label}</p>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:mt-1 sm:justify-start">
          <p className="tabular text-[22px] font-semibold leading-7 tracking-[-0.03em] text-label sm:text-[32px] sm:leading-9 sm:tracking-[-0.035em]">
            {formatMetricValue(card.primary.value, card.primary.unit, { compact: true })}
          </p>
          {unavailable ? null : <MetricDelta delta={card.primary.delta} higherIsBetter={card.primary.higherIsBetter} />}
        </div>
        {basis && !unavailable ? <p className="mt-0.5 hidden text-xs text-[var(--muted)] sm:block">{basis}</p> : null}
      </div>

      <div className="hidden sm:contents">
        {unavailable ? (
          <p className="mt-4 flex-1 text-[13px] leading-5 text-label-secondary">{card.unavailableReason}</p>
        ) : (
          <>
            <div className="mt-3">
              {card.sparkline.points.length > 1 ? (
                <SparklineChart
                  data={card.sparkline.points}
                  color={platformSeriesColor(card.iconKey)}
                  label={`${card.title} ${card.sparkline.label}`}
                  compact
                />
              ) : (
                <div className="grid h-11 place-items-center rounded-xl bg-fill text-[11px] text-[var(--muted)]">Trend appears after a few days of data</div>
              )}
            </div>
            <dl className="mt-3 grid flex-1 grid-cols-2 gap-x-3 gap-y-2 border-t border-separator pt-3">
              {card.secondary.map((metric) => (
                <div key={metric.key} className="min-w-0">
                  <dt className="truncate text-xs text-[var(--muted)]">{metric.label}</dt>
                  <dd className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="tabular text-[15px] font-semibold tracking-[-0.01em] text-label">
                      {formatMetricValue(metric.value, metric.unit, { compact: true })}
                    </span>
                    <MetricDelta delta={metric.delta} higherIsBetter={metric.higherIsBetter} size="sm" />
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-[var(--muted)]">
            {card.updatedAt ? `Updated ${formatRelativeTime(card.updatedAt, { now })}` : "No data received yet"}
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-tint-text" aria-hidden="true">
            Details
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </div>
      </div>
    </article>
  );
}
