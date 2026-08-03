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

const syntheticPaymentDigits = ["7000", "0000", "0000", "0005"].join("");
const dottedPaymentCandidate = syntheticPaymentDigits.match(/.{1,4}/gu)!.join(".");
const alternativeIpv4Host = "0xc633642a";
const paddedSensitiveKey = `email${"x".repeat(121)}=synthetic`;

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

  it("preserves complete long acquisition values and explicit mobile labels", () => {
    const overview = createWebsiteFunnelOverview();
    const longValues = {
      utmSource: "affiliate_partner_channel_with_extended_context",
      utmMedium: "creator_collaboration_and_editorial_placement",
      utmCampaign: "summer_lunar_collection_launch_with_extended_campaign_context",
      landingPath: "/collections/build-your-own/lunar-signature-series/extended-editorial-landing",
      referrerHost: "editorial-partnership.storefront-discovery.example",
    };
    overview.acquisition.rows = [{
      ...overview.acquisition.rows[0]!,
      ...longValues,
      key: "long-safe-acquisition-row",
    }];

    const markup = renderToStaticMarkup(
      <StorefrontBreakdowns
        overview={overview}
        query={DEFAULT_MOONARQ_OVERVIEW_QUERY}
        basePath="/w/moonarq/dashboard"
      />,
    );
    const root = document.createElement("div");
    root.innerHTML = markup;
    const acquisition = root.querySelector('[data-testid="acquisition-performance"]');
    const mobileRow = acquisition?.querySelector("[data-acquisition-mobile-row]");

    expect(acquisition).not.toBeNull();
    expect(mobileRow).not.toBeNull();
    expect([...mobileRow!.querySelectorAll("dt")].map((term) => term.textContent)).toEqual([
      "UTM source",
      "UTM medium",
      "Campaign",
      "Landing page",
      "Referrer",
      "Sessions",
      "Product intent",
      "Checkout started",
      "Visit-to-checkout rate",
    ]);
    expect([...mobileRow!.querySelectorAll("dd")].map((detail) => detail.textContent)).toEqual([
      longValues.utmSource,
      longValues.utmMedium,
      longValues.utmCampaign,
      longValues.landingPath,
      longValues.referrerHost,
      "20",
      "12",
      "3",
      "15.0%",
    ]);
    expect(acquisition?.querySelector(".truncate")).toBeNull();
    expect(acquisition?.querySelector("[title]")).toBeNull();
    for (const value of Object.values(longValues)) {
      expect(markup).toContain(value);
    }
  });

  it("does not reflect unsafe query filters or unsafe filter options into the page", () => {
    const overview = createWebsiteFunnelOverview();
    const unsafeValues = [
      "synthetic.user@example.invalid",
      "token=synthetic-not-a-secret",
      "4111111111111111",
      "/checkout?authorization=synthetic",
      "127.0.0.1",
    ] as const;
    overview.filterOptions = {
      ...overview.filterOptions,
      utmSources: ["newsletter", unsafeValues[0]],
      utmMediums: ["email", unsafeValues[1]],
      utmCampaigns: ["summer", unsafeValues[2]],
      landingPaths: ["/collections/new", unsafeValues[3]],
      referrerHosts: ["example.test", unsafeValues[4]],
    };
    const query: MoonArqOverviewQuery = {
      ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
      utm_source: unsafeValues[0],
      utm_medium: unsafeValues[1],
      utm_campaign: unsafeValues[2],
      landing_path: unsafeValues[3],
      referrer_host: unsafeValues[4],
    };

    const markup = renderToStaticMarkup(
      <StorefrontBreakdowns
        overview={overview}
        query={query}
        basePath="/w/moonarq/dashboard"
      />,
    );
    const root = document.createElement("div");
    root.innerHTML = markup;

    for (const value of unsafeValues) {
      expect(markup).not.toContain(value);
    }
    expect(root.querySelector<HTMLSelectElement>('select[name="utm_source"]')?.value).toBe("");
    expect(root.querySelector<HTMLSelectElement>('select[name="utm_medium"]')?.value).toBe("");
    expect(root.querySelector<HTMLSelectElement>('select[name="utm_campaign"]')?.value).toBe("");
    expect(root.querySelector<HTMLSelectElement>('select[name="landing_path"]')?.value).toBe("");
    expect(root.querySelector<HTMLSelectElement>('select[name="referrer_host"]')?.value).toBe("");
    expect(markup).toContain('<option value="newsletter">newsletter</option>');
    expect(markup).toContain('<option value="email">email</option>');
    expect(markup).toContain('<option value="summer">summer</option>');
    expect(markup).toContain('<option value="/collections/new">/collections/new</option>');
    expect(markup).toContain('<option value="example.test">example.test</option>');
  });

  it.each(["query", "options"] as const)(
    "removes an alternative IPv4 host from the %s before rendering",
    (injectionTarget) => {
      const overview = createWebsiteFunnelOverview();
      overview.filterOptions.referrerHosts = injectionTarget === "options"
        ? ["editorial.example.invalid", alternativeIpv4Host]
        : ["editorial.example.invalid"];
      const query: MoonArqOverviewQuery = {
        ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
        range: "7d",
        acquisition_page: 2,
        referrer_host: injectionTarget === "query" ? alternativeIpv4Host : "",
      };
      const markup = renderToStaticMarkup(
        <StorefrontBreakdowns
          overview={overview}
          query={query}
          basePath="/w/moonarq/dashboard"
        />,
      );
      const root = document.createElement("div");
      root.innerHTML = markup;
      const select = root.querySelector<HTMLSelectElement>('select[name="referrer_host"]');
      const attributeValues = [...root.querySelectorAll("*")].flatMap((element) =>
        [...element.attributes].map((attribute) => attribute.value));
      const paginationLinks = [...root.querySelectorAll<HTMLAnchorElement>("a[rel][href]")];

      expect(select?.value).toBe("");
      expect([...select!.options].some((option) => option.value === alternativeIpv4Host)).toBe(false);
      expect([...select!.options].some((option) =>
        option.value === "editorial.example.invalid")).toBe(true);
      expect(markup).not.toContain(alternativeIpv4Host);
      expect(attributeValues.some((value) => value.includes(alternativeIpv4Host))).toBe(false);
      expect(paginationLinks.length).toBeGreaterThan(0);
      for (const link of paginationLinks) {
        const url = new URL(link.href, "https://data-hub.invalid");
        expect(url.searchParams.get("range")).toBe("7d");
        expect(url.searchParams.has("referrer_host")).toBe(false);
      }
    },
  );

  it.each([
    { label: "an unpadded Basic credential", value: "Basic YTpiYQ" },
    { label: "a Unicode-decimal payment candidate", value: "٧٠٠٠.٠٠٠٠.٠٠٠٠.٠٠٠٥" },
    { label: "a slash-formatted phone number", value: "44/20/7946/0958" },
    { label: "a combining-mark-obfuscated phone number", value: "202\u0301 555\u0301 0100" },
    { label: "a compressed NANP phone number", value: "202-5550100" },
    { label: "a punctuation-only street address", value: "123/Main/Street" },
    { label: "a punctuation-only PO box", value: "P/O/Box/123" },
    { label: "an assigned alternative numeric authority", value: "redirect=//0xc633642a/path" },
    { label: "an obfuscated qualified email key", value: "e+m+a+i+l_hash=synthetic" },
    { label: "a concatenated qualified email key", value: "customeremailhash=synthetic" },
    { label: "a sensitive key beyond the former local window", value: paddedSensitiveKey },
    { label: "an encoded fragment delimiter", value: "archive%23control" },
    { label: "an encoded query delimiter", value: "archive%3Fcontrol" },
    { label: "an encoded at-sign delimiter", value: "archive%40control" },
    { label: "a fullwidth-percent-escaped email", value: "private-person％40example.invalid" },
    {
      label: "a pipe-delimited nested authority credential",
      value: "prefix|//alice:syntheticpass@localhost/path",
    },
    { label: "a contract-prohibited name field", value: "customer_name=Alice" },
  ])("removes $label from query state, options, markup, and links", ({ value }) => {
    for (const injectionTarget of ["query", "options"] as const) {
      const overview = createWebsiteFunnelOverview();
      overview.filterOptions.utmSources = injectionTarget === "options"
        ? ["newsletter", value]
        : ["newsletter"];
      const query: MoonArqOverviewQuery = {
        ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
        range: "7d",
        acquisition_page: 2,
        utm_source: injectionTarget === "query" ? value : "",
      };
      const markup = renderToStaticMarkup(
        <StorefrontBreakdowns
          overview={overview}
          query={query}
          basePath="/w/moonarq/dashboard"
        />,
      );
      const root = document.createElement("div");
      root.innerHTML = markup;
      const select = root.querySelector<HTMLSelectElement>('select[name="utm_source"]');
      const attributes = [...root.querySelectorAll("*")].flatMap((element) =>
        [...element.attributes].map((attribute) => attribute.value));
      const paginationLinks = [...root.querySelectorAll<HTMLAnchorElement>("a[rel][href]")];

      expect(select?.value).toBe("");
      expect([...select!.options].some((option) => option.value === value)).toBe(false);
      expect([...select!.options].some((option) => option.value === "newsletter")).toBe(true);
      expect(markup.toLowerCase()).not.toContain(value.toLowerCase());
      expect(attributes.some((attribute) => attribute.toLowerCase().includes(value.toLowerCase())))
        .toBe(false);
      expect(paginationLinks.length).toBeGreaterThan(0);
      for (const link of paginationLinks) {
        const url = new URL(link.href, "https://data-hub.invalid");
        expect(url.searchParams.get("range")).toBe("7d");
        expect(url.searchParams.has("utm_source")).toBe(false);
      }
    }
  });

  it.each([
    {
      queryKey: "utm_source",
      optionKey: "utmSources",
      safeOption: "newsletter",
    },
    {
      queryKey: "utm_medium",
      optionKey: "utmMediums",
      safeOption: "email",
    },
    {
      queryKey: "utm_campaign",
      optionKey: "utmCampaigns",
      safeOption: "summer",
    },
    {
      queryKey: "landing_path",
      optionKey: "landingPaths",
      safeOption: "/collections/new",
    },
    {
      queryKey: "referrer_host",
      optionKey: "referrerHosts",
      safeOption: "example.test",
    },
  ] as const)("removes malformed percent encoding from $queryKey state and options", ({
    queryKey,
    optionKey,
    safeOption,
  }) => {
    const rawCanary = "private-person%25ZZ%2540example.invalid";
    const intermediateCanary = "private-person%ZZ%40example.invalid";
    const decodedCanary = "private-person%ZZ@example.invalid";
    const canaries = [rawCanary, intermediateCanary, decodedCanary];
    for (const injectedCanary of [rawCanary, intermediateCanary]) {
      for (const injectionTarget of ["query", "options"] as const) {
        const overview = createWebsiteFunnelOverview();
        overview.filterOptions[optionKey] = injectionTarget === "options"
          ? [safeOption, injectedCanary]
          : [safeOption];
        const query = {
          ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
          range: "7d",
          [queryKey]: injectionTarget === "query" ? injectedCanary : "",
        } as MoonArqOverviewQuery;

        const markup = renderToStaticMarkup(
          <StorefrontBreakdowns
            overview={overview}
            query={query}
            basePath="/w/moonarq/dashboard"
          />,
        );
        const root = document.createElement("div");
        root.innerHTML = markup;
        const select = root.querySelector<HTMLSelectElement>(`select[name="${queryKey}"]`);
        const attributeValues = [...root.querySelectorAll("*")].flatMap((element) =>
          [...element.attributes].map((attribute) => attribute.value));
        const paginationLinks = [...root.querySelectorAll<HTMLAnchorElement>("a[rel][href]")];

        expect(select).not.toBeNull();
        expect(select?.value).toBe("");
        expect([...select!.options].some((option) => option.value === injectedCanary)).toBe(false);
        expect([...select!.options].some((option) => option.value === safeOption)).toBe(true);
        expect(paginationLinks.length).toBeGreaterThan(0);
        for (const link of paginationLinks) {
          const url = new URL(link.href, "https://data-hub.invalid");
          expect(url.searchParams.get("range")).toBe("7d");
          expect(url.searchParams.has(queryKey)).toBe(false);
        }
        for (const canary of canaries) {
          expect(markup).not.toContain(canary);
          expect(attributeValues.some((value) => value.includes(canary))).toBe(false);
          expect(paginationLinks.some((link) => link.href.includes(canary))).toBe(false);
        }
      }
    }
  });

  it.each([
    {
      queryKey: "utm_source",
      optionKey: "utmSources",
      safeOption: "newsletter",
      unsafeValue: dottedPaymentCandidate,
    },
    {
      queryKey: "utm_medium",
      optionKey: "utmMediums",
      safeOption: "email",
      unsafeValue: dottedPaymentCandidate,
    },
    {
      queryKey: "utm_campaign",
      optionKey: "utmCampaigns",
      safeOption: "summer",
      unsafeValue: dottedPaymentCandidate,
    },
    {
      queryKey: "landing_path",
      optionKey: "landingPaths",
      safeOption: "/collections/new",
      unsafeValue: `/campaign/${dottedPaymentCandidate}`,
    },
    {
      queryKey: "referrer_host",
      optionKey: "referrerHosts",
      safeOption: "example.test",
      unsafeValue: `${dottedPaymentCandidate}.invalid`,
    },
  ] as const)("removes embedded payment data from $queryKey state and options", ({
    queryKey,
    optionKey,
    safeOption,
    unsafeValue,
  }) => {
    for (const injectionTarget of ["query", "options"] as const) {
      const overview = createWebsiteFunnelOverview();
      overview.filterOptions[optionKey] = injectionTarget === "options"
        ? [safeOption, unsafeValue]
        : [safeOption];
      const query = {
        ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
        range: "7d",
        [queryKey]: injectionTarget === "query" ? unsafeValue : "",
      } as MoonArqOverviewQuery;

      const markup = renderToStaticMarkup(
        <StorefrontBreakdowns
          overview={overview}
          query={query}
          basePath="/w/moonarq/dashboard"
        />,
      );
      const root = document.createElement("div");
      root.innerHTML = markup;
      const select = root.querySelector<HTMLSelectElement>(`select[name="${queryKey}"]`);
      const attributeValues = [...root.querySelectorAll("*")].flatMap((element) =>
        [...element.attributes].map((attribute) => attribute.value));
      const paginationLinks = [...root.querySelectorAll<HTMLAnchorElement>("a[rel][href]")];
      const canaries = [
        unsafeValue,
        dottedPaymentCandidate,
        syntheticPaymentDigits,
        encodeURIComponent(unsafeValue),
      ];

      expect(select).not.toBeNull();
      expect(select?.value).toBe("");
      expect([...select!.options].some((option) => option.value === unsafeValue)).toBe(false);
      expect([...select!.options].some((option) => option.value === safeOption)).toBe(true);
      expect(paginationLinks.length).toBeGreaterThan(0);
      for (const link of paginationLinks) {
        const url = new URL(link.href, "https://data-hub.invalid");
        expect(url.searchParams.get("range")).toBe("7d");
        expect(url.searchParams.has(queryKey)).toBe(false);
      }
      for (const canary of canaries) {
        expect(markup).not.toContain(canary);
        expect(attributeValues.some((value) => value.includes(canary))).toBe(false);
        expect(paginationLinks.some((link) => link.href.includes(canary))).toBe(false);
      }
    }
  });
});
