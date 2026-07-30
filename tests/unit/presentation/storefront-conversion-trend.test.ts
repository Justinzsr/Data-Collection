import { describe, expect, it } from "vitest";
import {
  buildStorefrontTrendData,
  formatStorefrontTrendValue,
  storefrontTrendText,
} from "@/presentation/dashboard/storefront-conversion-trend";
import { createWebsiteFunnelOverview } from "./website-funnel-overview-fixture";

describe("StorefrontConversionTrend data", () => {
  it("aligns selected and equal-length comparison values by display date", () => {
    const overview = createWebsiteFunnelOverview();

    expect(buildStorefrontTrendData(overview.trend, "checkout")).toEqual([
      {
        date: "2026-07-28",
        comparisonDate: "2026-06-28",
        current: 2,
        previous: 1,
      },
      {
        date: "2026-07-29",
        comparisonDate: "2026-06-29",
        current: 0,
        previous: null,
      },
    ]);
  });

  it("formats counts, rates, and unavailable values without invalid numbers", () => {
    expect(formatStorefrontTrendValue(1_204.4, "sessions")).toBe("1,204");
    expect(formatStorefrontTrendValue(16.666, "visit_to_checkout_rate")).toBe("16.7%");
    expect(formatStorefrontTrendValue(null, "checkout")).toBe("—");
    expect(formatStorefrontTrendValue(Number.NaN, "checkout")).toBe("—");
  });

  it("provides an accessible text equivalent with both dates and values", () => {
    expect(storefrontTrendText({
      date: "2026-07-28",
      comparisonDate: "2026-06-28",
      current: 12,
      previous: 10,
    }, "sessions")).toBe("2026-07-28: 12; 2026-06-28: 10");
  });
});
