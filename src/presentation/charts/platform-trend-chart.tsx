"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GlassPanel } from "@/presentation/components/ui/panel";
import {
  chartActiveDot,
  chartCursor,
  chartGridStroke,
  chartTick,
  chartTooltipLabelStyle,
  chartTooltipStyle,
} from "@/presentation/charts/chart-theme";

export type PlatformTrendSeries = {
  key: string;
  label: string;
  color: string;
  data: { date: string; value: number }[];
};

type IndexedSeries = PlatformTrendSeries;

export function buildIndexedTrendData(series: PlatformTrendSeries[]) {
  const indexedSeries: IndexedSeries[] = series.map((item) => {
    const baseline = item.data.find((point) => point.value > 0)?.value ?? 0;
    return {
      ...item,
      data: item.data.map((point) => ({
        ...point,
        value: baseline > 0 ? (point.value / baseline) * 100 : 0,
      })),
    };
  });
  const dates = [...new Set(indexedSeries.flatMap((item) => item.data.map((point) => point.date)))].sort();
  const valuesBySeries = new Map(indexedSeries.map((item) => [item.key, new Map(item.data.map((point) => [point.date, point.value]))]));
  const chartData = dates.map((date) => {
    const row: Record<string, string | number | null> = { date: date.slice(5) };
    for (const item of indexedSeries) row[item.key] = valuesBySeries.get(item.key)?.get(date) ?? null;
    return row;
  });
  return { indexedSeries, chartData };
}

const chartMargin = { top: 8, right: 8, bottom: 0, left: -18 } as const;
const initialChartDimension = { width: 960, height: 240 } as const;

export function PlatformTrendChart({ series }: { series: PlatformTrendSeries[] }) {
  const { indexedSeries, chartData } = buildIndexedTrendData(series);
  const labels = new Map(indexedSeries.map((item) => [item.key, item.label]));

  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5" data-testid="overview-chart" data-overview-chart="true">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Cross-platform graph</p>
          <h2 className="mt-0.5 text-[17px] font-semibold tracking-[-0.018em] text-label">Indexed source momentum</h2>
        </div>
        <p className="max-w-xl text-xs leading-5 text-muted">Each measured series is indexed to its first non-zero point for a comparable view.</p>
      </div>

      <div
        className="inset-surface h-[13rem] min-w-0 overflow-hidden rounded-[18px] px-1 py-2 sm:h-[15rem] sm:px-2"
        role="img"
        aria-label="Cross-platform indexed trend chart"
      >
        {chartData.length > 0 && indexedSeries.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={initialChartDimension}>
            <LineChart data={chartData} margin={chartMargin}>
              <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={28} tick={chartTick} />
              <YAxis axisLine={false} tickLine={false} width={42} tick={chartTick} domain={["auto", "auto"]} />
              <Tooltip
                cursor={chartCursor}
                contentStyle={chartTooltipStyle}
                labelStyle={chartTooltipLabelStyle}
                formatter={(value, name) => [`${Number(value).toFixed(0)} index`, labels.get(String(name)) ?? String(name)]}
              />
              {indexedSeries.map((item) => (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  stroke={item.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={chartActiveDot}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center px-4 text-center" role="status">
            <div>
              <p className="text-sm font-semibold text-label">No trend data yet</p>
              <p className="mt-1 text-xs leading-5 text-muted">Connect or sync a source to populate this graph.</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap gap-x-5 gap-y-2">
        {indexedSeries.map((item) => (
          <span key={item.key} className="inline-flex min-w-0 items-center gap-2 text-xs text-label-secondary">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="truncate">{item.label}</span>
            <span className="tabular font-semibold text-label">{Math.round(item.data.at(-1)?.value ?? 0)}</span>
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}
