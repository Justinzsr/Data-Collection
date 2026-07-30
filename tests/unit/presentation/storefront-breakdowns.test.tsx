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

import { StorefrontBreakdowns } from "@/presentation/dashboard/storefront-breakdowns";
import {
  DEFAULT_MOONARQ_OVERVIEW_QUERY,
  type MoonArqOverviewQuery,
} from "@/presentation/dashboard/moonarq-overview-query";
import { createWebsiteFunnelOverview } from "./website-funnel-overview-fixture";

function paginationUrl(
  markup: string,
  label: string,
  relation: "prev" | "next",
) {
  const root = document.createElement("div");
  root.innerHTML = markup;
  const navigation = [...root.querySelectorAll("nav")].find(
    (candidate) => candidate.getAttribute("aria-label") === `${label} pagination`,
  );
  const href = navigation?.querySelector(`a[rel="${relation}"]`)?.getAttribute("href");
  expect(href).toBeTruthy();
  return new URL(href!, "https://data-hub.example");
}

describe("StorefrontBreakdowns", () => {
  it("discloses unknown and mismatched product identity without inferring commerce", () => {
    const overview = createWebsiteFunnelOverview();
    overview.quality.unknownEventTotalRows = 3;
    const query: MoonArqOverviewQuery = {
      ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
      range: "7d",
      segment: "builder",
      device: "mobile",
      utm_source: "newsletter",
      product_page: 2,
    };

    const markup = renderToStaticMarkup(
      <StorefrontBreakdowns overview={overview} query={query} basePath="/w/moonarq/dashboard" />,
    );

    expect(markup).toContain("Unknown / unmapped identity");
    expect(markup).toContain("View-only identity — cart rate unavailable");
    expect(markup).toContain("Showing 1 of 3 unknown event names.");
    expect(markup).toContain("Example necklace");
    expect(markup).not.toMatch(/product revenue|product checkout/iu);
    expect(markup).not.toContain("private-source");
  });

  it("preserves active filters in deterministic product pagination links", () => {
    const query: MoonArqOverviewQuery = {
      ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
      range: "7d",
      segment: "builder",
      device: "mobile",
      utm_source: "newsletter",
      collection_page: 4,
      product_page: 2,
      acquisition_page: 5,
    };

    const markup = renderToStaticMarkup(
      <StorefrontBreakdowns
        overview={createWebsiteFunnelOverview()}
        query={query}
        basePath="/w/moonarq/dashboard"
      />,
    );

    expect(Object.fromEntries(paginationUrl(markup, "Product performance", "prev").searchParams)).toEqual({
      range: "7d",
      segment: "builder",
      device: "mobile",
      utm_source: "newsletter",
      collection_page: "4",
      acquisition_page: "5",
    });
    expect(Object.fromEntries(paginationUrl(markup, "Product performance", "next").searchParams)).toEqual({
      range: "7d",
      segment: "builder",
      device: "mobile",
      utm_source: "newsletter",
      collection_page: "4",
      product_page: "3",
      acquisition_page: "5",
    });
  });

  it("renders independent collection and acquisition pagination without losing other table pages", () => {
    const overview = createWebsiteFunnelOverview();
    overview.collections = {
      ...overview.collections,
      page: 2,
      pageSize: 2,
      totalRows: 6,
      hasPreviousPage: true,
      hasNextPage: true,
    };
    overview.acquisition = {
      ...overview.acquisition,
      page: 3,
      pageSize: 2,
      totalRows: 8,
      hasPreviousPage: true,
      hasNextPage: true,
    };
    const query: MoonArqOverviewQuery = {
      ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
      range: "7d",
      segment: "builder",
      collection_page: 2,
      product_page: 2,
      acquisition_page: 3,
    };

    const markup = renderToStaticMarkup(
      <StorefrontBreakdowns overview={overview} query={query} basePath="/w/moonarq/dashboard" />,
    );

    expect(Object.fromEntries(paginationUrl(markup, "Collection performance", "prev").searchParams)).toEqual({
      range: "7d",
      segment: "builder",
      product_page: "2",
      acquisition_page: "3",
    });
    expect(Object.fromEntries(paginationUrl(markup, "Collection performance", "next").searchParams)).toEqual({
      range: "7d",
      segment: "builder",
      collection_page: "3",
      product_page: "2",
      acquisition_page: "3",
    });
    expect(Object.fromEntries(paginationUrl(markup, "Acquisition performance", "prev").searchParams)).toEqual({
      range: "7d",
      segment: "builder",
      collection_page: "2",
      product_page: "2",
      acquisition_page: "2",
    });
    expect(Object.fromEntries(paginationUrl(markup, "Acquisition performance", "next").searchParams)).toEqual({
      range: "7d",
      segment: "builder",
      collection_page: "2",
      product_page: "2",
      acquisition_page: "4",
    });
    expect(markup).toContain('aria-label="Previous collection performance page"');
    expect(markup).toContain('aria-label="Next acquisition performance page"');
  });

  it("does not present unavailable quality diagnostics as measured zero", () => {
    const overview = createWebsiteFunnelOverview();
    overview.dataState = "source_unavailable";

    const markup = renderToStaticMarkup(
      <StorefrontBreakdowns
        overview={overview}
        query={DEFAULT_MOONARQ_OVERVIEW_QUERY}
        basePath="/w/moonarq/dashboard"
      />,
    );

    expect(markup).toContain("Quality diagnostics unavailable");
    expect(markup).not.toContain("0 co-timed session progressions");
    expect(markup).not.toContain("Completed-day raw page views");
  });
});
