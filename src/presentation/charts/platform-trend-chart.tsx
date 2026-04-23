import { GlassPanel } from "@/presentation/components/ui/panel";

type Series = {
  key: string;
  label: string;
  color: string;
  data: { date: string; value: number }[];
};

function pathForSeries(data: { value: number }[], max: number) {
  const last = Math.max(data.length - 1, 1);
  return data
    .map((point, index) => {
      const x = (index / last) * 100;
      const y = 90 - (point.value / Math.max(max, 1)) * 76;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function PlatformTrendChart({ series }: { series: Series[] }) {
  const max = Math.max(...series.flatMap((item) => item.data.map((point) => point.value)), 1);
  const dates = series[0]?.data ?? [];
  return (
    <GlassPanel className="min-h-[24rem] p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Cross-platform trend</h2>
          <p className="mt-1 text-sm text-slate-400">Website, Supabase, and social scaffold signals in one view.</p>
        </div>
        <select className="h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-200">
          <option>Primary metrics</option>
          <option>Website page views</option>
          <option>Supabase signups</option>
          <option>Social reach/views</option>
        </select>
      </div>
      <div className="h-72 min-w-0 rounded-lg border border-white/10 bg-black/25 p-3">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Cross-platform trend chart">
          {[20, 40, 60, 80].map((y) => (
            <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="rgba(148,163,184,0.13)" strokeWidth="0.25" />
          ))}
          {series.map((item) => (
            <path
              key={item.key}
              d={pathForSeries(item.data, max)}
              fill="none"
              stroke={item.color}
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-3">
          {series.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-2 text-xs text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
        <div className="flex gap-4 text-xs text-slate-500">
          <span>{dates[0]?.date.slice(5) ?? ""}</span>
          <span>{dates.at(-1)?.date.slice(5) ?? ""}</span>
        </div>
      </div>
    </GlassPanel>
  );
}
