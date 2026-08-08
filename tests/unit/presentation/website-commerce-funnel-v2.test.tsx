import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hookMock } = vi.hoisted(() => ({ hookMock: vi.fn() }));

vi.mock("@/presentation/dashboard/use-website-commerce-funnel-v2-data", () => ({
  useWebsiteCommerceFunnelV2Data: hookMock,
}));

import { getWebsiteCommerceFunnelV2Snapshot } from "@/aggregation/services/website-commerce-funnel-v2-service";
import type { WebsiteCommerceFunnelV2Snapshot } from "@/aggregation/services/website-commerce-funnel-v2-types";
import { WebsiteCommerceFunnelV2 } from "@/presentation/dashboard/website-commerce-funnel-v2";

let disabledSnapshot: WebsiteCommerceFunnelV2Snapshot;

beforeAll(async () => {
  disabledSnapshot = await getWebsiteCommerceFunnelV2Snapshot(
    { dataSpaceId: "data-space-moonarq" },
    { env: { NODE_ENV: "test" }, now: new Date("2026-08-07T18:00:00.000Z") },
  );
});

function measuredSnapshot(): WebsiteCommerceFunnelV2Snapshot {
  const countMetric = (
    value: number | null,
    authority: "website" | "shopify" | "meta" | "derived",
  ) => ({ value, state: "partial" as const, authority, note: "Aggregate fixture." });
  return {
    ...disabledSnapshot,
    state: "partial",
    reasonCode: "coverage_incomplete",
    reason: "Meta coverage is incomplete; the exact Website-to-Shopify bridge is measured.",
    range: {
      ...disabledSnapshot.range,
      startAt: "2026-07-09T07:00:00.000Z",
      endExclusive: "2026-08-07T18:00:00.000Z",
    },
    sources: {
      website: {
        ...disabledSnapshot.sources.website,
        state: "healthy",
        freshness: "fresh",
        coverage: "complete",
        asOf: "2026-08-07T17:59:00.000Z",
      },
      shopify: {
        ...disabledSnapshot.sources.shopify,
        state: "healthy",
        freshness: "fresh",
        coverage: "complete",
        asOf: "2026-08-07T17:30:00.000Z",
      },
      meta: disabledSnapshot.sources.meta,
    },
    funnel: disabledSnapshot.funnel.map((stage, index) => ({
      ...stage,
      count: [120, 60, 24, 12, 0][index],
      state: "partial",
      note: "Aggregate fixture.",
    })),
    commerce: {
      eligibleCheckoutEvents: countMetric(12, "website"),
      linkedOrdersPlaced: countMetric(0, "shopify"),
      activeLinkedOrders: countMetric(0, "shopify"),
      cancelledLinkedOrders: countMetric(0, "shopify"),
      linkedOrderRatePercent: countMetric(0, "derived"),
      linkCoveragePercent: countMetric(75, "derived"),
      money: [{
        currency: "USD",
        orders: 0,
        grossSales: "0",
        currentTotal: "0",
        netPayment: "0",
        refunds: "0",
        state: "partial",
      }],
    },
    builder: {
      linkedOrderLines: countMetric(null, "shopify"),
      itemLinkCoveragePercent: countMetric(null, "derived"),
    },
    diagnostics: {
      excludedBotSessions: countMetric(5, "website"),
      excludedNonProductionSessions: countMetric(3, "website"),
      eligibleShopifyOrders: countMetric(0, "shopify"),
      bridgeMatchedOrders: countMetric(0, "shopify"),
      bridgeMissingOrders: countMetric(0, "shopify"),
      bridgeInvalidOrders: countMetric(0, "shopify"),
      bridgeAmbiguousOrders: countMetric(0, "shopify"),
      consentBlockedOrders: countMetric(0, "derived"),
      reversedTimestampOrders: countMetric(0, "derived"),
      preCoverageOrders: countMetric(0, "shopify"),
    },
    meta: {
      ...disabledSnapshot.meta,
      impressions: countMetric(null, "meta"),
      linkClicks: countMetric(null, "meta"),
      platformPurchases: countMetric(null, "meta"),
    },
  };
}

beforeEach(() => {
  hookMock.mockReset();
});

function render(snapshot: WebsiteCommerceFunnelV2Snapshot) {
  hookMock.mockReturnValue({
    snapshot,
    isLoading: false,
    isRefreshing: false,
    isStale: false,
    isAuthLocked: false,
    error: null,
    refresh: vi.fn(async () => undefined),
  });
  return renderToStaticMarkup(
    <WebsiteCommerceFunnelV2 dataSpaceSlug="moonarq" range="30d" segment="all" />,
  );
}

describe("Website commerce funnel V2 presentation", () => {
  it("renders a compact fail-closed state without fabricated metrics when the feature is off", () => {
    const html = render(disabledSnapshot);

    expect(html).toContain("Order linkage is not measured");
    expect(html).toContain("Fail closed");
    expect(html).toContain("No missing source, table, sync, or coverage interval is converted into a numeric zero");
    expect(html).not.toContain("Currency-separated money");
  });

  it("shows measured zero only when the aggregate carries an explicit value and keeps Meta unavailable", () => {
    const html = render(measuredSnapshot());

    expect(html).toContain("Website behavior to Shopify order");
    expect(html).toContain("Meta delivery · Website → Shopify");
    expect(html).toContain("Linked Shopify order");
    expect(html).toContain("Shopify-authoritative outcomes");
    expect(html).toContain("$0.00");
    expect(html).toContain("Meta platform view");
    expect(html).toContain("Not measured");
    expect(html).toContain("Real-time events");
    expect(html).toContain("Hourly sync");
    expect(html).toContain("Excluded bots");
    expect(html).toContain("Excluded non-production");
    expect(html).not.toContain("75.00%");
  });

  it("contains responsive one-to-many grids and never renders identity or PII fields", () => {
    const html = render(measuredSnapshot());

    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("xl:grid-cols-5");
    expect(html).toContain("min-w-0");
    expect(html).not.toMatch(
      /event_id|order_id|source_id|session_id|anonymous_id|checkout_event_id_hash|item_instance_id_hash|email|customer_id/i,
    );
  });
});
