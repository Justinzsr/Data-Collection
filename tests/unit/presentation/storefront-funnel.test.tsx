import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorefrontFunnel } from "@/presentation/dashboard/storefront-funnel";
import { createWebsiteFunnelOverview } from "./website-funnel-overview-fixture";

describe("StorefrontFunnel", () => {
  it("renders the four-stage session funnel without implying a purchase stage", () => {
    const markup = renderToStaticMarkup(
      <StorefrontFunnel overview={createWebsiteFunnelOverview()} />,
    );

    expect(markup).toContain("Website visits");
    expect(markup).toContain("Product intent");
    expect(markup).toContain("Added to cart");
    expect(markup).toContain("Checkout started");
    expect(markup).toContain("120");
    expect(markup).toContain("50.0% of visits");
    expect(markup).toContain(
      "First-party session funnel; ends at checkout started. Orders and revenue are reported separately by Shopify.",
    );
    expect(markup).not.toMatch(/purchase stage/iu);
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Infinity");
  });

  it("labels low-volume rates as directional", () => {
    const overview = createWebsiteFunnelOverview();
    overview.lowVolume = true;

    const markup = renderToStaticMarkup(<StorefrontFunnel overview={overview} />);

    expect(markup).toContain("Limited data — rates are directional.");
  });

  it("renders unmeasured builder commerce stages as unavailable instead of zero", () => {
    const overview = createWebsiteFunnelOverview();
    overview.filters.segment = "builder";
    overview.stages = overview.stages.map((stage) =>
      stage.key === "add_to_cart" || stage.key === "begin_checkout"
        ? {
            ...stage,
            measured: false,
            sessions: 0,
            events: 0,
            percentOfStart: null,
            fromPrevious: null,
            dropOff: null,
            previousSessions: null,
            deltaPercent: null,
          }
        : stage,
    );

    const markup = renderToStaticMarkup(<StorefrontFunnel overview={overview} />);

    expect(markup).toContain("Added to cart: not measured");
    expect(markup).toContain("Checkout started: not measured");
    expect(markup).toContain("Not measured");
    expect(markup).not.toContain("Added to cart: 0 sessions");
    expect(markup).not.toContain("Checkout started: 0 sessions");
  });
});
