import { GlassPanel } from "@/presentation/components/ui/panel";

function areaPath(data: { value: number }[]) {
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

export function MetricTrendChart({ data, title = "Primary trend" }: { data: { date: string; value: number }[]; title?: string }) {
  const paths = areaPath(data);
  const first = data[0]?.date.slice(5) ?? "";
  const last = data.at(-1)?.date.slice(5) ?? "";
  return (
    <GlassPanel className="min-h-[22rem] p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="text-sm text-slate-400">30-day signal from demo metrics</p>
        </div>
        <select className="h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-200">
          <option>Page views</option>
          <option>Unique visitors</option>
          <option>Signups</option>
          <option>Custom events</option>
        </select>
      </div>
      <div className="h-72 min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${title} chart`}>
          <defs>
            <linearGradient id="moonTrendSvg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          {[20, 40, 60, 80].map((y) => (
            <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="rgba(148,163,184,0.13)" strokeWidth="0.25" />
          ))}
          <path d={paths.area} fill="url(#moonTrendSvg)" />
          <path d={paths.line} fill="none" stroke="#38bdf8" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>{first}</span>
        <span>{last}</span>
      </div>
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
      <h2 className="text-base font-semibold text-white">Source comparison</h2>
      <p className="mb-4 text-sm text-slate-400">Website and Supabase are primary in this MVP.</p>
      <div className="grid h-64 min-w-0 grid-cols-2 items-end gap-4 rounded-lg border border-white/10 bg-black/20 p-4">
        {data.slice(0, 4).map((item) => {
          const total = item.page_views + item.custom_events + item.signups;
          return (
            <div key={item.sourceId} className="flex h-full min-w-0 flex-col justify-end gap-2">
              <div className="flex min-h-0 flex-1 items-end gap-1">
                <span className="block w-full rounded-t bg-cyan-300/80" style={{ height: `${Math.max(4, (item.page_views / max) * 100)}%` }} />
                <span className="block w-full rounded-t bg-teal-300/80" style={{ height: `${Math.max(4, (item.custom_events / max) * 100)}%` }} />
                <span className="block w-full rounded-t bg-indigo-300/80" style={{ height: `${Math.max(4, (item.signups / max) * 100)}%` }} />
              </div>
              <div>
                <p className="truncate text-xs font-medium text-slate-200">{item.sourceType}</p>
                <p className="text-xs text-slate-500">{new Intl.NumberFormat("en-US").format(total)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
