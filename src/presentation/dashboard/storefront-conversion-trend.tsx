"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  WebsiteFunnelOverview,
  WebsiteFunnelTrendMetric,
  WebsiteFunnelTrendPoint,
} from "@/aggregation/services/website-funnel-types";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { resolveComparisonDisplay } from "@/presentation/dashboard/comparison-display";
import {
  buildMoonArqOverviewHref,
  MOONARQ_OVERVIEW_TRENDS,
  type MoonArqOverviewQuery,
} from "@/presentation/dashboard/moonarq-overview-query";

const trendLabels: Record<WebsiteFunnelTrendMetric, string> = {
  sessions: "Website sessions",
  product_intent: "Product-intent sessions",
  add_to_cart: "Add-to-cart sessions",
  checkout: "Checkout-start sessions",
  visit_to_checkout_rate: "Visit-to-checkout-start rate",
};

export type StorefrontTrendChartPoint = {
  date: string;
  comparisonDate: string | null;
  current: number | null;
  previous: number | null;
};

export function buildStorefrontTrendData(
  points: WebsiteFunnelTrendPoint[],
  metric: WebsiteFunnelTrendMetric,
): StorefrontTrendChartPoint[] {
  return points.map((point) => ({
    date: point.date,
    comparisonDate: point.comparisonDate,
    current: point.current[metric],
    previous: point.previous?.[metric] ?? null,
  }));
}

export function formatStorefrontTrendValue(value: number | null, metric: WebsiteFunnelTrendMetric) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (metric === "visit_to_checkout_rate") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function storefrontTrendText(
  point: StorefrontTrendChartPoint,
  metric: WebsiteFunnelTrendMetric,
  includePrevious = true,
) {
  const current = formatStorefrontTrendValue(point.current, metric);
  if (!includePrevious) return `${point.date}: ${current}`;
  const previous = point.comparisonDate
    ? `${point.comparisonDate}: ${formatStorefrontTrendValue(point.previous, metric)}`
    : "previous period unavailable";
  return `${point.date}: ${current}; ${previous}`;
}

const tooltipStyle = {
  background: "rgba(8,12,18,0.97)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "10px",
  color: "#e2e8f0",
  fontSize: "12px",
} as const;

export function StorefrontConversionTrend({
  overview,
  query,
  basePath,
}: {
  overview: WebsiteFunnelOverview;
  query: MoonArqOverviewQuery;
  basePath: string;
}) {
  const metric = query.trend;
  const data = buildStorefrontTrendData(overview.trend, metric);
  const builderCommerceUnavailable = query.segment === "builder"
    && (
      metric === "add_to_cart"
      || metric === "checkout"
      || metric === "visit_to_checkout_rate"
    );
  const hasCurrentData = data.some((point) => point.current !== null);
  const previousPointCount = data.filter((point) => point.previous !== null).length;
  const hasPreviousData = overview.comparison.available && previousPointCount > 0;
  const comparison = resolveComparisonDisplay({
    mode: overview.comparison.mode,
    globallyAvailable: overview.comparison.available,
    measured: !builderCommerceUnavailable,
    hasBaseline: hasPreviousData,
  });
  const showPrevious = comparison.showPrevious;

  return (
    <GlassPanel
      className="grid min-w-0 gap-4 p-4 sm:p-5"
      data-testid="storefront-conversion-trend"
      aria-labelledby="storefront-trend-title"
    >
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Daily movement</p>
          <h2 id="storefront-trend-title" className="mt-1 text-xl font-semibold text-[#f5f2eb]">
            Conversion trend
          </h2>
        </div>
        <nav className="flex max-w-full flex-wrap gap-1.5" aria-label="Conversion trend metric">
          {MOONARQ_OVERVIEW_TRENDS.map((trend) => (
            <LinkButton
              key={trend}
              href={buildMoonArqOverviewHref(basePath, query, { trend })}
              variant={metric === trend ? "primary" : "ghost"}
              className="min-h-11 rounded-lg px-3 text-xs"
              aria-current={metric === trend ? "page" : undefined}
            >
              {trendLabels[trend]}
            </LinkButton>
          ))}
        </nav>
      </div>

      <div
        className="min-w-0 rounded-xl border border-white/[0.09] bg-black/20 p-2"
        role="group"
        aria-label={`${trendLabels[metric]} daily trend`}
      >
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2 px-1 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2">
            <span className="h-0.5 w-5 bg-cyan-300" aria-hidden="true" />
            Selected period — solid
          </span>
          {showPrevious ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-5 border-t-2 border-dashed border-slate-400" aria-hidden="true" />
              Previous period — dashed
            </span>
          ) : null}
        </div>

        <div className="h-64 min-w-0" data-overview-chart="true">
          {hasCurrentData ? (
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
              initialDimension={{ width: 720, height: 256 }}
            >
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.11)" strokeDasharray="3 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                  tick={{ fill: "var(--muted)", fontSize: 10 }}
                  tickFormatter={(value) => String(value).slice(5)}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tick={{ fill: "var(--muted)", fontSize: 10 }}
                  tickFormatter={(value) => formatStorefrontTrendValue(Number(value), metric)}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  wrapperStyle={{ maxWidth: "min(220px, calc(100vw - 48px))" }}
                  formatter={(value, name) => [
                    formatStorefrontTrendValue(Number(value), metric),
                    name === "previous" ? "Previous period" : "Selected period",
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="current"
                  stroke="#67c7ec"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {showPrevious ? (
                  <Line
                    type="monotone"
                    dataKey="previous"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={previousPointCount === 1
                      ? { r: 3, fill: "#94a3b8", strokeWidth: 0 }
                      : false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center px-4 text-center" role="status">
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {builderCommerceUnavailable
                    ? "Builder cart and checkout trends are not measured."
                    : "No daily trend is available for this selection."}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {builderCommerceUnavailable
                    ? "The current tracker contract does not prove reliable builder-to-cart identity."
                    : "Counts remain unavailable rather than being filled with inferred zeroes."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {comparison.kind !== "available" ? (
        <p
          className="text-xs leading-5 text-[var(--muted)]"
          data-comparison-state={comparison.kind}
        >
          {comparison.label}
          {comparison.kind === "unavailable" && overview.comparison.reason
            ? ` — ${overview.comparison.reason}`
            : comparison.kind === "no_baseline"
              ? ` for ${trendLabels[metric]}.`
              : "."}
        </p>
      ) : null}

      <details className="group min-w-0 max-w-full overflow-hidden rounded-xl border border-white/[0.09] bg-black/10" data-testid="storefront-trend-table">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-slate-200">
          View daily values
        </summary>
        <div className="min-w-0 max-w-full overflow-x-auto border-t border-white/[0.08]">
          <table className={`w-full text-left text-sm ${showPrevious ? "min-w-[34rem]" : "min-w-[20rem]"}`}>
            <caption className="sr-only">
              {trendLabels[metric]} daily selected-period values
              {showPrevious ? " and equal-length previous-period comparison" : ""}
            </caption>
            <thead className="text-xs uppercase tracking-[0.12em] text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2.5">Date</th>
                <th scope="col" className="px-3 py-2.5">Selected period</th>
                {showPrevious ? <th scope="col" className="px-3 py-2.5">Comparison date</th> : null}
                {showPrevious ? <th scope="col" className="px-3 py-2.5">Previous period</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.07]">
              {data.map((point) => (
                <tr key={point.date}>
                  <th scope="row" className="px-3 py-2.5 font-medium text-slate-200">{point.date}</th>
                  <td className="px-3 py-2.5 text-slate-300">{formatStorefrontTrendValue(point.current, metric)}</td>
                  {showPrevious ? <td className="px-3 py-2.5 text-slate-400">{point.comparisonDate ?? "—"}</td> : null}
                  {showPrevious ? <td className="px-3 py-2.5 text-slate-300">{formatStorefrontTrendValue(point.previous, metric)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sr-only">
          {data.map((point) => storefrontTrendText(point, metric, showPrevious)).join("; ")}
        </p>
      </details>
    </GlassPanel>
  );
}
