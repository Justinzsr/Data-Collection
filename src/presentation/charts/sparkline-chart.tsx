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

const legacyTones = {
  cyan: "var(--chart-1)",
  teal: "var(--chart-2)",
  indigo: "var(--chart-7)",
  amber: "var(--chart-4)",
  rose: "var(--chart-3)",
} as const;

export function SparklineChart({
  data,
  tone = "cyan",
  color,
  label,
  compact = false,
}: {
  data: { date: string; value: number }[];
  tone?: keyof typeof legacyTones;
  color?: string;
  label: string;
  compact?: boolean;
}) {
  const stroke = color ?? legacyTones[tone];
  const path = buildSparklinePath(data);
  const area = path && data.length > 1 ? `${path} L 100.00 100.00 L 0.00 100.00 Z` : "";
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
      className={compact ? "h-11 min-w-0" : "h-20 min-w-0 rounded-xl bg-fill px-2 py-2"}
      data-testid="platform-sparkline"
      data-overview-chart={compact ? "true" : undefined}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img" aria-label={`${label} sparkline${dateDescription}${rangeDescription}`}>
        {(compact ? [50] : [28, 52, 76]).map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="0.3" />
        ))}
        {area ? <path d={area} fill={stroke} fillOpacity={0.1} stroke="none" /> : null}
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
