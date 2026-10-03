/*
 * Shared chart styling. Colors are CSS custom properties so every chart follows
 * the light/dark theme. Series slots come from the validated categorical order
 * (see globals.css); an entity always keeps its slot, never its rank.
 */
const PLATFORM_SERIES: Record<string, string> = {
  website: "var(--chart-1)",
  supabase: "var(--chart-2)",
  tiktok: "var(--chart-3)",
  instagram: "var(--chart-4)",
  shopify: "var(--chart-5)",
  // Meta Ads stays clear of the green used for "better" changes beside it.
  meta_ads: "var(--chart-7)",
  vercel_web_analytics_drain: "var(--chart-6)",
  vercel_project: "var(--chart-6)",
  xiaohongshu: "var(--chart-8)",
};

export function platformSeriesColor(sourceTypeKey: string) {
  return PLATFORM_SERIES[sourceTypeKey] ?? "var(--chart-1)";
}

export const chartGridStroke = "var(--chart-grid)";
export const chartTick = { fill: "var(--chart-axis)", fontSize: 11 } as const;
export const chartCursor = { stroke: "var(--chart-cursor)", strokeDasharray: "3 3" } as const;
export const chartTooltipStyle = {
  background: "var(--glass-strong)",
  border: "1px solid var(--glass-edge)",
  borderRadius: "14px",
  boxShadow: "var(--glass-shadow-lg)",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  color: "var(--label)",
  fontSize: "12px",
} as const;
export const chartTooltipLabelStyle = { color: "var(--muted)", marginBottom: "4px" } as const;
export const chartActiveDot = { r: 4.5, strokeWidth: 2, stroke: "var(--glass-selected)" } as const;
