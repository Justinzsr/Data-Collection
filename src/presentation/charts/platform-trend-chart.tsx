"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GlassPanel } from "@/presentation/components/ui/panel";

type Series = {
  key: string;
  label: string;
  color: string;
  data: { date: string; value: number }[];
};

const chartMargin = { top: 8, right: 8, bottom: 0, left: -18 } as const;
const initialChartDimension = { width: 960, height: 240 } as const;
const tooltipCursor = { stroke: "rgba(125,211,252,0.35)", strokeDasharray: "3 3" } as const;
const tooltipContentStyle = {
  background: "rgba(8,12,18,0.96)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "10px",
  color: "#e2e8f0",
  fontSize: "12px",
} as const;
const tooltipLabelStyle = { color: "#94a3b8", marginBottom: "4px" } as const;
const activeDot = { r: 4, strokeWidth: 0 } as const;

export function PlatformTrendChart({ series }: { series: Series[] }) {
  const indexedSeries = series.map((item) => {
    const baseline = item.data.find((point) => point.value > 0)?.value ?? 0;
    return {
      ...item,
      data: item.data.map((point) => ({
        ...point,
        value: baseline > 0 ? (point.value / baseline) * 100 : 0,
      })),
    };
  });
  const dates = series[0]?.data ?? [];
  const chartData = dates.map((point, index) => {
    const row: Record<string, string | number> = { date: point.date.slice(5) };
    for (const item of indexedSeries) row[item.key] = item.data[index]?.value ?? 0;
    return row;
  });
  const labels = new Map(indexedSeries.map((item) => [item.key, item.label]));

  return (
    <GlassPanel className="min-w-0 p-3 sm:p-4" data-testid="overview-chart" data-overview-chart="true">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/65">Cross-platform graph</p>
          <h2 className="mt-0.5 text-base font-semibold text-white">Indexed source momentum</h2>
        </div>
        <p className="max-w-xl text-xs leading-5 text-slate-500">Every line begins at 100, making unlike platform signals directly comparable.</p>
      </div>

      <div
        className="h-[13rem] min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black/25 px-1 py-2 sm:h-[15rem] sm:px-2"
        role="img"
        aria-label="Cross-platform indexed trend chart"
      >
        {chartData.length > 0 && indexedSeries.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={initialChartDimension}>
            <LineChart data={chartData} margin={chartMargin}>
              <CartesianGrid stroke="rgba(148,163,184,0.11)" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: "#64748b", fontSize: 10 }} />
              <YAxis axisLine={false} tickLine={false} width={42} tick={{ fill: "#64748b", fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip
                cursor={tooltipCursor}
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
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
                  activeDot={activeDot}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center px-4 text-center" role="status">
            <div>
              <p className="text-sm font-medium text-slate-200">No trend data yet</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Connect or sync a source to populate this graph.</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1.5">
        {indexedSeries.map((item) => (
          <span key={item.key} className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="truncate">{item.label}</span>
            <span className="font-medium text-slate-200">{Math.round(item.data.at(-1)?.value ?? 0)}</span>
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}
