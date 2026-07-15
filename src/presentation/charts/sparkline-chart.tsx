export function buildSparklinePath(data: { value: number }[]) {
  if (data.length === 0) return "";
  if (data.length === 1) return "M 0.00 50.00 L 100.00 50.00";

  const values = data.map((point) => point.value);
  const valueMax = Math.max(...values);
  const valueMin = Math.min(...values);
  const valueSpread = valueMax - valueMin;
  const magnitude = Math.max(...values.map((value) => Math.abs(value)));
  const displaySpread = Math.max(valueSpread * 1.3, magnitude * 0.1, 1);
  const midpoint = (valueMin + valueMax) / 2;
  let min = midpoint - displaySpread / 2;
  let max = midpoint + displaySpread / 2;
  if (valueSpread > 0 && valueMin >= 0 && min < 0) {
    max -= min;
    min = 0;
  }
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

export function SparklineChart({
  data,
  tone = "cyan",
  label,
  compact = false,
}: {
  data: { date: string; value: number }[];
  tone?: "cyan" | "teal" | "indigo" | "amber" | "rose";
  label: string;
  compact?: boolean;
}) {
  const stroke = {
    cyan: "#38bdf8",
    teal: "#2dd4bf",
    indigo: "#818cf8",
    amber: "#f59e0b",
    rose: "#fb7185",
  }[tone];
  const path = buildSparklinePath(data);
  const values = data.map((point) => point.value);
  const dateDescription = data.length > 1
    ? `, dates ${data[0].date} to ${data.at(-1)!.date}`
    : data.length === 1
      ? `, date ${data[0].date}`
      : "";
  const rangeDescription = values.length > 0
    ? `, started at ${values[0].toLocaleString()}, ended at ${values.at(-1)!.toLocaleString()}, range ${Math.min(...values).toLocaleString()} to ${Math.max(...values).toLocaleString()}`
    : ", no data in the selected range";
  return (
    <div
      className={compact ? "h-11 min-w-0" : "h-20 min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-2"}
      data-testid="platform-sparkline"
      data-overview-chart={compact ? "true" : undefined}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${label} sparkline${dateDescription}${rangeDescription}`}>
        {(compact ? [50] : [28, 52, 76]).map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="rgba(148,163,184,0.12)" strokeWidth="0.3" />
        ))}
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
