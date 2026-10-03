import type { OverviewMetric } from "@/aggregation/services/platform-overview-service";
import { formatMetricValue } from "@/presentation/components/ui/format";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { cn } from "@/presentation/components/ui/utils";
import { MetricDelta } from "@/presentation/overview/metric-delta";

/** Key numbers for a platform, each with its direction of change and what it is compared against. */
export function MetricTileGrid({
  metrics,
  className,
  testId,
}: {
  metrics: OverviewMetric[];
  className?: string;
  testId?: string;
}) {
  return (
    <dl className={cn("grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4", className)} data-testid={testId}>
      {metrics.map((metric) => (
        <GlassPanel key={metric.key} className="flex min-w-0 flex-col rounded-[22px] p-4" data-metric={metric.key}>
          <dt className="text-[13px] font-medium leading-5 text-label-secondary">{metric.label}</dt>
          <dd className="mt-1.5 min-w-0">
            <span className="tabular block break-words text-[26px] font-semibold leading-8 tracking-[-0.03em] text-label">
              {formatMetricValue(metric.value, metric.unit)}
            </span>
            <span className="mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <MetricDelta delta={metric.delta} higherIsBetter={metric.higherIsBetter} size="sm" />
              {metric.delta.kind !== "none" ? (
                <span className="text-[11px] leading-4 text-[var(--muted)]">{metric.delta.basis}</span>
              ) : null}
            </span>
          </dd>
        </GlassPanel>
      ))}
    </dl>
  );
}
