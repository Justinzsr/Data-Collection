import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlatformModule } from "@/aggregation/services/platform-modules-service";
import { CommerceOutcomes } from "@/presentation/dashboard/commerce-outcomes";

function shopifyModule(): PlatformModule {
  return {
    sourceId: "synthetic-shopify-source",
    sourceTypeKey: "shopify",
    displayName: "MoonArq Commerce",
    platformLabel: "MoonArq Commerce",
    status: "healthy",
    syncMode: "webhook",
    sourceModeLabel: "Shopify authoritative commerce",
    rangeLabel: "Last 30 days",
    primaryMetric: {
      key: "orders",
      label: "Orders",
      value: 12,
      unit: "count",
      deltaPercent: 20,
      deltaLabel: "+20.0%",
    },
    secondaryMetrics: [
      { key: "net_payment", label: "Net payment", value: 1_200.5, unit: "usd" },
      { key: "gross_sales", label: "Gross sales", value: 1_350, unit: "usd" },
      { key: "refunds", label: "Refunds", value: 149.5, unit: "usd" },
    ],
    sparkline: [],
    insights: [],
    lastSyncAt: "2026-07-29T18:00:00.000Z",
    nextSyncAt: null,
    lastError: null,
    setupState: {
      label: "Healthy",
      severity: "ok",
      message: "Shopify is connected.",
    },
    actions: {
      canRunSync: true,
      canConfigure: true,
      canViewDetails: true,
    },
  };
}

describe("CommerceOutcomes", () => {
  it("keeps authoritative Shopify outcomes separate from the Website session funnel", () => {
    const markup = renderToStaticMarkup(<CommerceOutcomes shopify={shopifyModule()} />);

    expect(markup).toContain("Shopify");
    expect(markup).toContain("Orders");
    expect(markup).toContain("Net payment");
    expect(markup).toContain("$1,200.50");
    expect(markup).toContain(
      "Shopify outcomes are reported separately and are not session-linked to the first-party Website funnel.",
    );
    expect(markup).not.toContain("synthetic-shopify-source");
    expect(markup).not.toMatch(/fifth stage|session conversion/iu);
  });

  it("does not present placeholder zeroes as commerce outcomes before Shopify is connected", () => {
    const disconnected = {
      ...shopifyModule(),
      sourceId: null,
      status: "needs_credentials" as const,
      primaryMetric: {
        ...shopifyModule().primaryMetric,
        value: 0,
      },
      secondaryMetrics: shopifyModule().secondaryMetrics.map((metric) => ({
        ...metric,
        value: 0,
      })),
    };
    const markup = renderToStaticMarkup(<CommerceOutcomes shopify={disconnected} />);

    expect(markup).toContain("Shopify · not connected");
    expect(markup).toContain("Shopify commerce is not connected.");
    expect(markup).toContain("Orders and recognized revenue will remain unavailable");
    expect(markup).not.toContain("<dl");
    expect(markup).not.toContain("$0.00");
  });
});
