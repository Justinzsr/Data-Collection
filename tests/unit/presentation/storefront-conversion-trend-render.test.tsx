import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, prefetch, ...props }: {
    children: ReactNode;
    prefetch?: boolean | "auto" | null;
    href: string;
  }) => createElement("a", {
    ...props,
    "data-prefetch": prefetch === undefined ? "default" : String(prefetch),
  }, children),
}));

vi.mock("recharts", () => ({
  CartesianGrid: () => null,
  Line: ({
    dataKey,
    dot,
    connectNulls,
  }: {
    dataKey: string;
    dot: unknown;
    connectNulls: boolean;
  }) => createElement("span", {
      "data-chart-line": dataKey,
      "data-dot": dot === false ? "none" : "single-point",
      "data-connect-nulls": String(connectNulls),
    }),
  LineChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => createElement(
    "div",
    { "data-chart-point-count": String(data.length) },
    children,
  ),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { StorefrontConversionTrend } from "@/presentation/dashboard/storefront-conversion-trend";
import { DEFAULT_MOONARQ_OVERVIEW_QUERY } from "@/presentation/dashboard/moonarq-overview-query";
import { createWebsiteFunnelOverview } from "./website-funnel-overview-fixture";

function renderTrend(
  overview = createWebsiteFunnelOverview(),
  query = DEFAULT_MOONARQ_OVERVIEW_QUERY,
) {
  return renderToStaticMarkup(
    <StorefrontConversionTrend
      overview={overview}
      query={query}
      basePath="/w/moonarq/dashboard"
    />,
  );
}

function chartLine(markup: string, dataKey: string) {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root.querySelector(`[data-chart-line="${dataKey}"]`);
}

describe("StorefrontConversionTrend comparison rendering", () => {
  it("removes all previous-period visual and text columns when comparison is off", () => {
    const overview = createWebsiteFunnelOverview();
    overview.comparison.mode = "off";
    const markup = renderTrend(overview);

    expect(markup).toContain('data-comparison-state="off"');
    expect(markup).toContain("Comparison off.");
    expect(markup).not.toContain("Previous period — dashed");
    expect(markup).not.toContain('data-chart-line="previous"');
    expect(markup).not.toContain("<th scope=\"col\" class=\"px-3 py-2.5\">Comparison date</th>");
    expect(markup).not.toContain("equal-length previous-period comparison");
    expect(markup).not.toContain("2026-06-28: 10");
  });

  it("explains globally unavailable history and suppresses previous values", () => {
    const overview = createWebsiteFunnelOverview();
    overview.comparison.available = false;
    overview.comparison.reason = "The selected range predates comparison coverage.";
    const markup = renderTrend(overview);

    expect(markup).toContain('data-comparison-state="unavailable"');
    expect(markup).toContain(
      "Comparison unavailable — The selected range predates comparison coverage.",
    );
    expect(markup).not.toContain("Previous period — dashed");
    expect(markup).not.toContain('data-chart-line="previous"');
    expect(markup).not.toContain("2026-06-28: 10");
  });

  it("renders a partial previous series without connecting unavailable days", () => {
    const overview = createWebsiteFunnelOverview();
    overview.trend.push({
      ...overview.trend[0]!,
      date: "2026-07-30",
      comparisonDate: "2026-06-30",
    });
    const markup = renderTrend(overview);

    expect(markup).toContain("Previous period — dashed");
    expect(chartLine(markup, "previous")?.getAttribute("data-dot")).toBe("none");
    expect(chartLine(markup, "previous")?.getAttribute("data-connect-nulls")).toBe("false");
    expect(markup).toContain("2026-06-28");
    expect(markup).toContain("2026-06-30");
    expect(markup).toContain("<td class=\"px-3 py-2.5 text-slate-300\">—</td>");
    expect(markup).toContain("equal-length previous-period comparison");
  });

  it("uses an explicit marker when only one previous-period point exists", () => {
    const markup = renderTrend();

    expect(chartLine(markup, "previous")?.getAttribute("data-dot")).toBe("single-point");
    expect(chartLine(markup, "previous")?.getAttribute("data-connect-nulls")).toBe("false");
    expect(markup).toContain("Previous period — dashed");
    expect(markup).toContain("2026-06-28: 10");
  });

  it("reports no baseline when no previous-period point exists", () => {
    const overview = createWebsiteFunnelOverview();
    overview.trend = overview.trend.map((point) => ({
      ...point,
      previous: null,
    }));
    const markup = renderTrend(overview);

    expect(markup).toContain('data-comparison-state="no_baseline"');
    expect(markup).toContain("No baseline for Website sessions.");
    expect(markup).not.toContain("Previous period — dashed");
    expect(markup).not.toContain('data-chart-line="previous"');
    expect(markup).not.toContain("equal-length previous-period comparison");
  });
});
