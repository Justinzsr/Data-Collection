import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WebsiteBusinessPulse } from "@/presentation/dashboard/website-business-pulse";
import { createWebsiteFunnelOverview } from "./website-funnel-overview-fixture";

function comparisonStates(markup: string) {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return [...root.querySelectorAll("[data-comparison-state]")]
    .map((element) => ({
      kind: element.getAttribute("data-comparison-state"),
      label: element.textContent,
      className: element.getAttribute("class"),
    }));
}

describe("WebsiteBusinessPulse", () => {
  it("renders measured deltas while keeping period-distinct visitors neutral", () => {
    const markup = renderToStaticMarkup(
      <WebsiteBusinessPulse overview={createWebsiteFunnelOverview()} />,
    );
    const states = comparisonStates(markup);

    expect(states).toHaveLength(5);
    expect(states[0]).toMatchObject({
      kind: "no_baseline",
      label: "No baseline",
    });
    expect(states.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "positive",
          label: "+20.0% vs previous",
          className: expect.stringContaining("text-emerald-200"),
        }),
      ]),
    );
  });

  it.each([
    {
      name: "comparison is disabled",
      update: (overview: ReturnType<typeof createWebsiteFunnelOverview>) => {
        overview.comparison.mode = "off";
      },
      expectedKind: "off",
      expectedLabel: "Comparison off",
    },
    {
      name: "comparison history is unavailable",
      update: (overview: ReturnType<typeof createWebsiteFunnelOverview>) => {
        overview.comparison.available = false;
        overview.comparison.reason = "The selected range predates comparison coverage.";
      },
      expectedKind: "unavailable",
      expectedLabel: "Comparison unavailable",
    },
  ])("renders every KPI comparison neutrally when $name", ({
    update,
    expectedKind,
    expectedLabel,
  }) => {
    const overview = createWebsiteFunnelOverview();
    update(overview);

    const states = comparisonStates(
      renderToStaticMarkup(<WebsiteBusinessPulse overview={overview} />),
    );

    expect(states).toHaveLength(5);
    expect(states.every((state) => state.kind === expectedKind)).toBe(true);
    expect(states.every((state) => state.label === expectedLabel)).toBe(true);
    expect(states.every((state) => state.className?.includes("text-[var(--muted)]"))).toBe(true);
  });

  it("renders zero, missing-baseline, and unmeasured values as distinct states", () => {
    const overview = createWebsiteFunnelOverview();
    overview.stages = overview.stages.map((stage) => {
      if (stage.key === "visit") return { ...stage, deltaPercent: 0 };
      if (stage.key === "product_intent") return { ...stage, deltaPercent: null };
      if (stage.key === "add_to_cart") return {
        ...stage,
        measured: false,
        deltaPercent: null,
        previousSessions: null,
      };
      return stage;
    });

    const states = comparisonStates(
      renderToStaticMarkup(<WebsiteBusinessPulse overview={overview} />),
    );

    expect(states).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "zero",
        label: "0.0% vs previous",
        className: expect.stringContaining("text-[var(--muted)]"),
      }),
      expect.objectContaining({ kind: "no_baseline", label: "No baseline" }),
      expect.objectContaining({ kind: "unmeasured", label: "Not measured" }),
    ]));
  });

  it("withholds KPI values when the authoritative Website source is unavailable", () => {
    const overview = createWebsiteFunnelOverview();
    overview.dataState = "source_unavailable";
    overview.comparison.available = false;
    overview.comparison.reason = "The authoritative source is unavailable.";
    overview.uniqueVisitors = 987_654;

    const markup = renderToStaticMarkup(<WebsiteBusinessPulse overview={overview} />);
    const root = document.createElement("div");
    root.innerHTML = markup;
    const cards = [...root.querySelectorAll('[data-testid^="business-pulse-"]')];

    expect(cards).toHaveLength(5);
    expect(cards.every((card) => card.textContent?.includes("—"))).toBe(true);
    expect(cards.every((card) =>
      card.querySelector("[data-comparison-state]")?.getAttribute("data-comparison-state")
        === "unavailable")).toBe(true);
    expect(markup).not.toContain("987,654");
  });
});
