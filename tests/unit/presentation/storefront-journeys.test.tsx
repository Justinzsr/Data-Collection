import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorefrontJourneys } from "@/presentation/dashboard/storefront-journeys";
import { createWebsiteFunnelOverview } from "./website-funnel-overview-fixture";

describe("StorefrontJourneys", () => {
  it("groups every builder term and definition directly within one list item", () => {
    const markup = renderToStaticMarkup(
      <StorefrontJourneys overview={createWebsiteFunnelOverview()} />,
    );
    const root = document.createElement("div");
    root.innerHTML = markup;
    const builderList = [...root.querySelectorAll("dl")].find(
      (list) => list.textContent?.includes("Build completions"),
    );

    expect(builderList).toBeTruthy();
    expect(builderList!.querySelectorAll(":scope > div")).toHaveLength(3);
    for (const item of builderList!.querySelectorAll(":scope > div")) {
      expect(item.querySelector(":scope > dt")).not.toBeNull();
      expect(item.querySelector(":scope > dd")).not.toBeNull();
    }
  });

  it("does not render unavailable or pre-coverage journey values as measured zero", () => {
    for (const dataState of ["source_unavailable", "pre_coverage"] as const) {
      const overview = createWebsiteFunnelOverview();
      overview.dataState = dataState;
      const markup = renderToStaticMarkup(<StorefrontJourneys overview={overview} />);

      expect(markup).toContain("Journey data unavailable");
      expect(markup).not.toContain("Ready-made session journey");
      expect(markup).not.toContain("Build starts</span>");
    }
  });
});
