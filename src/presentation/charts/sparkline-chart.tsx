function buildPath(data: { value: number }[]) {
  const max = Math.max(...data.map((point) => point.value), 1);
  const min = Math.min(...data.map((point) => point.value), 0);
  const spread = Math.max(max - min, 1);
  const last = Math.max(data.length - 1, 1);
  return data
    .map((point, index) => {
      const x = (index / last) * 100;
      const y = 82 - ((point.value - min) / spread) * 64;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function SparklineChart({ data, tone = "cyan", label }: { data: { date: string; value: number }[]; tone?: "cyan" | "teal" | "indigo" | "amber" | "rose"; label: string }) {
  const stroke = {
    cyan: "#38bdf8",
    teal: "#2dd4bf",
    indigo: "#818cf8",
    amber: "#f59e0b",
    rose: "#fb7185",
  }[tone];
  const path = buildPath(data);
  return (
    <div className="h-20 min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-2" data-testid="platform-sparkline">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${label} sparkline`}>
        {[28, 52, 76].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="rgba(148,163,184,0.12)" strokeWidth="0.3" />
        ))}
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
