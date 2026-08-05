import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlatformModule } from "@/aggregation/services/platform-modules-service";
import {
  CommerceOutcomes,
  resolveShopifyCommerceState,
} from "@/presentation/dashboard/commerce-outcomes";

function shopifyModule(overrides: Partial<PlatformModule> = {}): PlatformModule {
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
    lastSuccessfulSyncAt: "2026-07-29T18:00:00.000Z",
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
    ...overrides,
  };
}

describe("CommerceOutcomes", () => {
  it.each([
    {
      name: "missing source",
      module: null,
      expected: "not_connected",
    },
    {
      name: "missing source identity",
      module: shopifyModule({ sourceId: null }),
      expected: "not_connected",
    },
    {
      name: "credentials required",
      module: shopifyModule({ status: "needs_credentials" }),
      expected: "needs_credentials",
    },
    {
      name: "credentials required with a stale error payload",
      module: shopifyModule({ status: "needs_credentials", lastError: "synthetic private failure detail" }),
      expected: "needs_credentials",
    },
    {
      name: "healthy source before its first successful sync",
      module: shopifyModule({ lastSuccessfulSyncAt: null }),
      expected: "awaiting_first_sync",
    },
    {
      name: "warning source",
      module: shopifyModule({ status: "warning" }),
      expected: "awaiting_first_sync",
    },
    {
      name: "latest sync error",
      module: shopifyModule({ status: "error" }),
      expected: "sync_error",
    },
    {
      name: "persisted latest error on an otherwise healthy source",
      module: shopifyModule({ lastError: "synthetic private failure detail" }),
      expected: "sync_error",
    },
    {
      name: "demo source",
      module: shopifyModule({ status: "demo" }),
      expected: "not_live",
    },
    {
      name: "disabled source",
      module: shopifyModule({ status: "disabled" }),
      expected: "not_live",
    },
    {
      name: "disabled source with a stale error payload",
      module: shopifyModule({ status: "disabled", lastError: "synthetic private failure detail" }),
      expected: "not_live",
    },
    {
      name: "successful live source",
      module: shopifyModule(),
      expected: "ready",
    },
  ])("resolves $name as $expected", ({ module, expected }) => {
    expect(resolveShopifyCommerceState(module).kind).toBe(expected);
  });

  it("keeps authoritative Shopify outcomes separate from the Website session funnel", () => {
    const markup = renderToStaticMarkup(<CommerceOutcomes shopify={shopifyModule()} />);

    expect(markup).toContain("Shopify");
    expect(markup).toContain("Orders");
    expect(markup).toContain("Net payment");
    expect(markup).toContain("$1,200.50");
    expect(markup).toContain("Selected range: Last 30 days");
    expect(markup).toContain("Data through:");
    expect(markup).toContain(
      "Shopify outcomes are reported separately and are not session-linked to the first-party Website funnel.",
    );
    expect(markup).not.toContain("synthetic-shopify-source");
    expect(markup).not.toMatch(/fifth stage|session conversion/iu);
  });

  it("does not present placeholder zeroes as commerce outcomes before Shopify is connected", () => {
    const disconnected = shopifyModule({
      sourceId: null,
      primaryMetric: {
        ...shopifyModule().primaryMetric,
        value: 0,
      },
      secondaryMetrics: shopifyModule().secondaryMetrics.map((metric) => ({
        ...metric,
        value: 0,
      })),
    });
    const markup = renderToStaticMarkup(<CommerceOutcomes shopify={disconnected} />);

    expect(markup).toContain("Shopify · not connected");
    expect(markup).toContain("Shopify commerce is not connected.");
    expect(markup).toContain("Orders and recognized revenue remain unavailable");
    expect(markup).not.toContain("<dl");
    expect(markup).not.toContain("$0.00");
  });

  it.each([
    {
      name: "credentials required",
      module: shopifyModule({ status: "needs_credentials" }),
      title: "Shopify credentials are required.",
    },
    {
      name: "awaiting first sync",
      module: shopifyModule({ lastSuccessfulSyncAt: null }),
      title: "Shopify is awaiting its first successful sync.",
    },
    {
      name: "latest sync error",
      module: shopifyModule({
        status: "error",
        lastError: "synthetic-secret@example.invalid token=do-not-render",
      }),
      title: "Shopify commerce metrics are unavailable because the latest sync failed.",
    },
    {
      name: "demo source",
      module: shopifyModule({ status: "demo" }),
      title: "Shopify commerce is not live.",
    },
  ])("withholds outcomes for $name", ({ module, title }) => {
    const markup = renderToStaticMarkup(<CommerceOutcomes shopify={module} />);

    expect(markup).toContain(title);
    expect(markup).not.toContain("<dl");
    expect(markup).not.toContain("$1,200.50");
    expect(markup).not.toContain("synthetic-shopify-source");
    expect(markup).not.toContain("synthetic-secret@example.invalid");
    expect(markup).not.toContain("token=do-not-render");
  });

  it("uses lastSuccessfulSyncAt for sync-error freshness without rendering the error payload", () => {
    const withPriorSuccess = renderToStaticMarkup(
      <CommerceOutcomes shopify={shopifyModule({
        status: "error",
        lastError: "synthetic private connector detail",
      })} />,
    );
    const withoutPriorSuccess = renderToStaticMarkup(
      <CommerceOutcomes shopify={shopifyModule({
        status: "error",
        lastSuccessfulSyncAt: null,
        lastError: "another synthetic private connector detail",
      })} />,
    );

    expect(withPriorSuccess).toContain("Last successful sync:");
    expect(withPriorSuccess).toContain("Current values are withheld until a successful sync.");
    expect(withPriorSuccess).not.toContain("synthetic private connector detail");
    expect(withoutPriorSuccess).toContain("No successful Shopify sync has completed yet.");
    expect(withoutPriorSuccess).not.toContain("another synthetic private connector detail");
  });

  it("renders a genuine successful zero-order period instead of an unavailable state", () => {
    const shopify = shopifyModule({
      primaryMetric: {
        ...shopifyModule().primaryMetric,
        value: 0,
        deltaPercent: null,
        deltaLabel: "—",
      },
      secondaryMetrics: shopifyModule().secondaryMetrics.map((metric) => ({
        ...metric,
        value: 0,
      })),
    });
    const markup = renderToStaticMarkup(<CommerceOutcomes shopify={shopify} />);

    expect(markup).toContain("Shopify · live");
    expect(markup).toContain("No Shopify orders were recorded in the selected period.");
    expect(markup).toContain("$0.00");
    expect(markup).toContain("<dl");
    expect(markup).not.toContain("awaiting first sync");
  });
});
