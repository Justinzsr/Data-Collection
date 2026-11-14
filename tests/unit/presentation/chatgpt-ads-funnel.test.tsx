import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatgptAdsFunnelSnapshot } from "@/aggregation/services/chatgpt-ads-funnel-types";
import { ChatgptAdsFunnel } from "@/presentation/dashboard/chatgpt-ads-funnel";
import { DailyMetricChart } from "@/presentation/charts/daily-metric-chart";
import { formatAxisValue, formatMetricValue } from "@/presentation/components/ui/format";

vi.mock("@/presentation/dashboard/sync-action-button", () => ({ SyncActionButton: () => null }));

function snapshot(): ChatgptAdsFunnelSnapshot {
  return {
    range: { key: "7d", label: "Last 7 days", startDate: "2026-11-07", endDate: "2026-11-13" },
    connection: { state: "not_connected", sourceId: null, accountName: null, updatedAt: null, note: "Connect the reporting key." },
    delivery: {
      currency: "USD", timeZone: "America/Los_Angeles", coverage: "partial", daily: [{ date: "2026-11-13", spend: 4, clicks: 10, conversions: 0.4 }], note: "Official account reports.",
      totals: { spend: 4, impressions: 100, clicks: 10, conversions: 0.4, clickThroughConversions: 0.3, viewThroughConversions: 0.1, purchaseValue: null, ctrPercent: 10, cpc: 0.4, cpm: 40, postClickCvrPercent: 3, platformRoas: null },
    },
    website: { stages: [{ key: "shopify_order", label: "Linked Shopify order", count: null, state: "not_measured", authority: "shopify", fromPrevious: null, note: "Exact checkout bridge unavailable." }], orderState: "not_measured", visitToOrderRatePercent: null, checkoutToOrderRatePercent: null, note: "Only chatgpt / paid visits enter this cohort." },
    fixture: false,
  };
}

describe("ChatGPT Ads reporting presentation", () => {
  it.each([
    { name: "reported zeros", values: [0, 0], message: "All reported values are 0." },
    { name: "zeros mixed with missing days", values: [null, 0, null], message: "All reported values are 0." },
    { name: "missing days only", values: [null, null], message: "No values in this period yet." },
    { name: "empty period", values: [], message: "No values in this period yet." },
  ])("distinguishes $name in the daily chart status", ({ values, message }) => {
    const html = renderToStaticMarkup(<DailyMetricChart title="Daily ad spend" unit="USD" color="var(--tint)"
      data={values.map((value, index) => ({ date: `2026-11-${String(index + 1).padStart(2, "0")}`, value }))} />);
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector('[role="status"]')?.textContent).toBe(message);
    if (values.some((value) => value === null)) expect(html).toContain("No data");
  });

  it("keeps the existing zero-valued multi-point line chart instead of replacing it with a placeholder", () => {
    const html = renderToStaticMarkup(<DailyMetricChart title="Daily level" unit="count" color="var(--tint)" kind="line"
      data={[{ date: "2026-11-12", value: 0 }, { date: "2026-11-13", value: 0 }]} />);
    expect(html).not.toContain("All reported values are 0.");
    expect(html).not.toContain("No values in this period yet.");
  });

  it("preserves fractional goal attribution in totals, chart values, and small axis values", () => {
    expect(formatMetricValue(0.4, "attributed_goal")).toBe("0.4");
    expect(formatMetricValue(0.0000001, "attributed_goal")).not.toBe("0");
    expect(formatAxisValue(0.4, "attributed_goal")).toBe("0.4");
    const html = renderToStaticMarkup(<ChatgptAdsFunnel snapshot={snapshot()} basePath="/w/moonarq/dashboard" dataSpaceSlug="moonarq" detailed />);
    expect(html).toContain("0.4");
    expect(html).toContain("0.3");
    expect(html).toContain("0.1");
    expect(html).toContain("Not measured");
    expect(html).toContain("utm_source=chatgpt&amp;utm_medium=paid");
    expect(html).toContain("Platform-attributed sales");
  });

  it("keeps a missing Shopify outcome unavailable instead of using platform goals", () => {
    const html = renderToStaticMarkup(<ChatgptAdsFunnel snapshot={snapshot()} basePath="/w/moonarq/dashboard" dataSpaceSlug="moonarq" />);
    expect(html).toContain("Linked Shopify order");
    expect(html).toContain("Not measured");
    expect(html).toContain("Connect ChatGPT Ads");
    expect(html).not.toContain("Sample data");
  });
});
