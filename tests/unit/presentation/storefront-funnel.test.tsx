import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorefrontFunnel } from "@/presentation/dashboard/storefront-funnel";
import { createWebsiteFunnelOverview } from "./website-funnel-overview-fixture";

function stageComparisons(markup: string) {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return [...root.querySelectorAll("[data-comparison-state]")]
    .map((element) => ({
      kind: element.getAttribute("data-comparison-state"),
      label: element.textContent,
      className: element.getAttribute("class"),
    }));
}

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
    expect(stageComparisons(markup)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unmeasured", label: "Not measured" }),
    ]));
    expect(markup).not.toContain("Added to cart: 0 sessions");
    expect(markup).not.toContain("Checkout started: 0 sessions");
  });

  it.each([
    {
      name: "the viewer turns comparison off",
      update: (overview: ReturnType<typeof createWebsiteFunnelOverview>) => {
        overview.comparison.mode = "off";
      },
      expectedKind: "off",
      expectedLabel: "Comparison off",
    },
    {
      name: "comparison history is globally unavailable",
      update: (overview: ReturnType<typeof createWebsiteFunnelOverview>) => {
        overview.comparison.available = false;
        overview.comparison.reason = "Comparison coverage is unavailable.";
      },
      expectedKind: "unavailable",
      expectedLabel: "Comparison unavailable",
    },
  ])("renders neutral stage comparison states when $name", ({
    update,
    expectedKind,
    expectedLabel,
  }) => {
    const overview = createWebsiteFunnelOverview();
    update(overview);

    const states = stageComparisons(
      renderToStaticMarkup(<StorefrontFunnel overview={overview} />),
    );

    expect(states).toHaveLength(4);
    expect(states.every((state) => state.kind === expectedKind)).toBe(true);
    expect(states.every((state) => state.label === expectedLabel)).toBe(true);
    expect(states.every((state) => state.className?.includes("text-[var(--muted)]"))).toBe(true);
  });

  it("distinguishes no baseline and exact zero from positive and negative deltas", () => {
    const overview = createWebsiteFunnelOverview();
    overview.stages = overview.stages.map((stage) => {
      if (stage.key === "visit") {
        return { ...stage, previousSessions: null, deltaPercent: null };
      }
      if (stage.key === "product_intent") {
        return { ...stage, previousSessions: 60, deltaPercent: 0 };
      }
      if (stage.key === "add_to_cart") {
        return { ...stage, previousSessions: 20, deltaPercent: -12.34 };
      }
      return { ...stage, previousSessions: 10, deltaPercent: 12.34 };
    });

    const states = stageComparisons(
      renderToStaticMarkup(<StorefrontFunnel overview={overview} />),
    );

    expect(states).toEqual([
      expect.objectContaining({
        kind: "no_baseline",
        label: "No baseline",
        className: expect.stringContaining("text-[var(--muted)]"),
      }),
      expect.objectContaining({
        kind: "zero",
        label: "0.0% vs previous",
        className: expect.stringContaining("text-[var(--muted)]"),
      }),
      expect.objectContaining({
        kind: "negative",
        label: "-12.3% vs previous",
        className: expect.stringContaining("text-rose-200"),
      }),
      expect.objectContaining({
        kind: "positive",
        label: "+12.3% vs previous",
        className: expect.stringContaining("text-emerald-200"),
      }),
    ]);
  });
});
