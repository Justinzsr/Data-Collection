"use client";

import { ChevronDown } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  chartActiveDot,
  chartCursor,
  chartGridStroke,
  chartTick,
  chartTooltipLabelStyle,
  chartTooltipStyle,
} from "@/presentation/charts/chart-theme";
import { formatAxisValue, formatMetricValue } from "@/presentation/components/ui/format";
import { GlassPanel } from "@/presentation/components/ui/panel";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(date: string) {
  const [, month = "1", day = "1"] = date.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)}`;
}

const initialDimension = { width: 640, height: 208 } as const;

/**
 * A single daily series: bars for amounts that add up per day (spend, orders),
 * a line for running levels (followers). One axis, a hover tooltip, and a table
 * of the same values for anyone who cannot use the chart.
 */
export function DailyMetricChart({
  title,
  description,
  data,
  unit,
  color,
  kind = "bar",
  testId,
}: {
  title: string;
  description?: string;
  data: Array<{ date: string; value: number }>;
  unit: string;
  color: string;
  kind?: "bar" | "line";
  testId?: string;
}) {
  const chartData = data.map((point) => ({ ...point, label: dayLabel(point.date) }));
  const hasData = data.some((point) => point.value !== 0) || (kind === "line" && data.length > 1);
  const format = (value: unknown) => formatMetricValue(Number(value), unit);
  const axis = (value: unknown) => formatAxisValue(Number(value), unit);

  return (
    <GlassPanel className="flex min-w-0 flex-col p-4 sm:p-5" data-testid={testId}>
      <div className="mb-3 min-w-0">
        <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] leading-5 text-label-secondary">{description}</p> : null}
      </div>
      <div className="inset-surface h-52 min-w-0 overflow-hidden rounded-[18px] px-1 py-2 sm:px-2" role="group" aria-label={`${title} chart`}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={initialDimension}>
            {kind === "bar" ? (
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
                <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={24} tick={chartTick} />
                <YAxis axisLine={false} tickLine={false} width={52} tick={chartTick} tickFormatter={axis} />
                <Tooltip
                  cursor={{ fill: "var(--fill-hover)" }}
                  contentStyle={chartTooltipStyle}
                  labelStyle={chartTooltipLabelStyle}
                  formatter={(value) => [format(value), title]}
                />
                <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
                <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={24} tick={chartTick} />
                <YAxis axisLine={false} tickLine={false} width={52} tick={chartTick} domain={["auto", "auto"]} tickFormatter={axis} />
                <Tooltip
                  cursor={chartCursor}
                  contentStyle={chartTooltipStyle}
                  labelStyle={chartTooltipLabelStyle}
                  formatter={(value) => [format(value), title]}
                />
                <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={chartActiveDot} isAnimationActive={false} />
              </LineChart>
            )}
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center px-4 text-center" role="status">
            <p className="text-sm text-label-secondary">No values in this period yet.</p>
          </div>
        )}
      </div>
      {data.length > 0 ? (
        <details className="group mt-3 min-w-0 max-w-full overflow-hidden rounded-[14px]">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[14px] px-1 text-[13px] font-medium text-tint-text transition hover:bg-fill-hover sm:px-2">
            View daily values
            <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="mt-1 max-h-72 min-w-0 overflow-auto rounded-[14px] bg-fill">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{title}, daily values</caption>
              <thead className="text-xs text-[var(--muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2">Date</th>
                  <th scope="col" className="px-3 py-2 text-right">{title}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {[...data].reverse().map((point) => (
                  <tr key={point.date}>
                    <th scope="row" className="px-3 py-2 font-medium text-label">{dayLabel(point.date)}</th>
                    <td className="tabular px-3 py-2 text-right text-label-secondary">{format(point.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </GlassPanel>
  );
}
