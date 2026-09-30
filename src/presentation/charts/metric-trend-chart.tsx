import { GlassPanel } from "@/presentation/components/ui/panel";

function areaPath(data: { value: number }[]) {
  if (data.length === 0) return { line: "", area: "" };
  const max = Math.max(...data.map((point) => point.value), 1);
  const last = Math.max(data.length - 1, 1);
  const points = data.map((point, index) => {
    const x = (index / last) * 100;
    const y = 92 - (point.value / max) * 78;
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L 100 100 L 0 100 Z`;
  return { line, area };
}

export function MetricTrendChart({
  data,
  title = "Primary trend",
  description = "30-day signal from demo metrics",
}: {
  data: { date: string; value: number }[];
  title?: string;
  description?: string;
}) {
  const chartData = data.filter((point) => Number.isFinite(point.value));
  const paths = areaPath(chartData);
  const first = chartData[0]?.date.slice(5) ?? "";
  const last = chartData.at(-1)?.date.slice(5) ?? "";
  return (
    <GlassPanel className="min-h-[22rem] p-4 sm:p-5">
      <div className="mb-4">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">{title}</h2>
          <p className="text-sm text-label-secondary">{description}</p>
        </div>
      </div>
      <div className="h-72 min-w-0 rounded-xl bg-fill p-3">
        {chartData.length > 0 ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${title} chart`}>
            <defs>
              <linearGradient id="moonTrendSvg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[20, 40, 60, 80].map((y) => (
              <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="0.25" />
            ))}
            {paths.line ? (
              <>
                <path d={paths.area} fill="url(#moonTrendSvg)" />
                <path d={paths.line} fill="none" stroke="var(--chart-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              </>
            ) : null}
          </svg>
        ) : (
          <div className="grid h-full place-items-center px-4 text-center" role="status">
            <div>
              <p className="text-sm font-medium text-label">No trend data yet</p>
              <p className="mt-1 text-xs leading-5 text-muted">Connect or sync this source to populate the chart.</p>
            </div>
          </div>
        )}
      </div>
      {chartData.length > 0 ? (
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>{first}</span>
          <span>{last}</span>
        </div>
      ) : null}
    </GlassPanel>
  );
}

export function SourceComparisonChart({
  data,
}: {
  data: { sourceId: string; sourceType: string; page_views: number; signups: number; custom_events: number }[];
}) {
  const max = Math.max(...data.flatMap((item) => [item.page_views, item.custom_events, item.signups]), 1);
  return (
    <GlassPanel className="p-4 sm:p-5">
      <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">Source comparison</h2>
      <p className="mb-4 text-sm text-label-secondary">Website and Supabase are primary in this MVP.</p>
      <div className="grid h-64 min-w-0 grid-cols-2 items-end gap-4 rounded-xl bg-fill p-4">
        {data.slice(0, 4).map((item) => {
          const total = item.page_views + item.custom_events + item.signups;
          return (
            <div key={item.sourceId} className="flex h-full min-w-0 flex-col justify-end gap-2">
              <div className="flex min-h-0 flex-1 items-end gap-1">
                <span className="block w-full rounded-t bg-tint" style={{ height: `${Math.max(4, (item.page_views / max) * 100)}%` }} />
                <span className="block w-full rounded-t bg-teal" style={{ height: `${Math.max(4, (item.custom_events / max) * 100)}%` }} />
                <span className="block w-full rounded-t bg-indigo" style={{ height: `${Math.max(4, (item.signups / max) * 100)}%` }} />
              </div>
              <div>
                <p className="truncate text-xs font-medium text-label">{item.sourceType}</p>
                <p className="text-xs text-muted">{new Intl.NumberFormat("en-US").format(total)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
