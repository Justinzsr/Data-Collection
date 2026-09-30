"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartGridStroke, chartTick, chartTooltipLabelStyle, chartTooltipStyle } from "@/presentation/charts/chart-theme";

type PaidAttributionPoint = {
  date: string;
  spend: number;
  metaPurchaseValue: number | null;
  shopifyNetRevenue: number | null;
};

const tooltipStyle = { ...chartTooltipStyle, maxWidth: "210px" } as const;

function formatMoney(value: unknown, currency: string, compact = false) {
  const amount = Number(value);
  const fallback = `${currency.toUpperCase()} ${Number.isFinite(amount) ? amount.toFixed(compact ? 0 : 2) : "0.00"}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    }).format(amount);
  } catch {
    return fallback;
  }
}

export function PaidAttributionChart({
  data,
  metaCurrency,
  shopifyCurrency,
  showShopify,
}: {
  data: PaidAttributionPoint[];
  metaCurrency: string;
  shopifyCurrency: string | null;
  showShopify: boolean;
}) {
  const chartData = data.map((point) => ({
    ...point,
    dateLabel: point.date.slice(5),
    shopifyNetRevenue: showShopify ? point.shopifyNetRevenue : null,
  }));
  const accessibleSummary = data.map((point) =>
    `${point.date}: Meta spend ${formatMoney(point.spend, metaCurrency)}, Meta purchase value ${point.metaPurchaseValue == null ? "not reported" : formatMoney(point.metaPurchaseValue, metaCurrency)}${showShopify ? `, Shopify net revenue ${point.shopifyNetRevenue == null ? "not reported" : formatMoney(point.shopifyNetRevenue, shopifyCurrency ?? metaCurrency)}` : ""}`,
  ).join("; ");

  return (
    <div className="inset-surface min-w-0 rounded-[18px] p-2.5" role="group" aria-label="Daily paid Story attribution chart">
      <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-label-secondary" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[3px] bg-[var(--chart-1)]" /> Meta spend</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t-2 border-dashed border-[var(--chart-2)]" /> Meta purchase value</span>
        {showShopify ? <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-[var(--chart-3)]" /> Shopify net revenue</span> : null}
      </div>
      <div className="h-36 min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 720, height: 144 }}>
          <ComposedChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="dateLabel" axisLine={false} tickLine={false} minTickGap={24} tick={chartTick} />
            <YAxis axisLine={false} tickLine={false} width={48} tick={chartTick} tickFormatter={(value) => formatMoney(value, metaCurrency, true)} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={chartTooltipLabelStyle}
              cursor={{ fill: "var(--fill-hover)" }}
              wrapperStyle={{ maxWidth: "min(210px, calc(100vw - 48px))" }}
              formatter={(value, name) => [
                formatMoney(value, name === "shopifyNetRevenue" ? shopifyCurrency ?? metaCurrency : metaCurrency),
                name === "spend" ? "Meta spend" : name === "shopifyNetRevenue" ? "Shopify net revenue" : "Meta purchase value",
              ]}
            />
            <Bar dataKey="spend" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
            {showShopify ? <Line type="monotone" dataKey="shopifyNetRevenue" stroke="var(--chart-3)" strokeWidth={2} dot={false} isAnimationActive={false} /> : null}
            <Line type="monotone" dataKey="metaPurchaseValue" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="sr-only">{accessibleSummary || "No daily paid Story attribution data is available yet."}</p>
    </div>
  );
}
