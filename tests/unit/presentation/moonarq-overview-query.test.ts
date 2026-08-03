import { describe, expect, it } from "vitest";
import {
  buildMoonArqOverviewHref,
  DEFAULT_MOONARQ_OVERVIEW_QUERY,
  MOONARQ_OVERVIEW_FILTER_LIMITS,
  parseMoonArqOverviewQuery,
  type MoonArqOverviewQuery,
  type MoonArqOverviewQueryPatch,
} from "@/presentation/dashboard/moonarq-overview-query";

const malformedRawCanary = "private-person%25ZZ%2540example.invalid";
const malformedIntermediateCanary = "private-person%ZZ%40example.invalid";
const malformedDecodedCanary = "private-person%ZZ@example.invalid";
const syntheticPaymentDigits = ["7000", "0000", "0000", "0005"].join("");
const dottedPaymentCandidate = syntheticPaymentDigits.match(/.{1,4}/gu)!.join(".");
const alternativeIpv4Host = "0xc633642a";
const paddedSensitiveKey = `email${"x".repeat(121)}=synthetic`;

const paymentFilterCases = [
  { key: "utm_source", value: dottedPaymentCandidate },
  { key: "utm_medium", value: dottedPaymentCandidate },
  { key: "utm_campaign", value: dottedPaymentCandidate },
  { key: "landing_path", value: `/campaign/${dottedPaymentCandidate}` },
  { key: "referrer_host", value: `${dottedPaymentCandidate}.invalid` },
] as const;

describe("MoonArq Overview query state", () => {
  it("defaults invalid, repeated, and unsupported values safely", () => {
    expect(parseMoonArqOverviewQuery({
      range: "90d",
      compare: ["previous", "off"],
      segment: "purchase",
      trend: "revenue",
      device: "watch",
      collection_page: "0",
      product_page: "-2",
      acquisition_page: "1.5",
      demo_state: "production",
      ignored: "value",
    })).toEqual(DEFAULT_MOONARQ_OVERVIEW_QUERY);

    expect(parseMoonArqOverviewQuery(new URLSearchParams("range=7d&range=30d"))).toEqual(
      DEFAULT_MOONARQ_OVERVIEW_QUERY,
    );
  });

  it("accepts every supported enum and bounded positive table pages", () => {
    expect(parseMoonArqOverviewQuery(new URLSearchParams({
      range: "today",
      compare: "off",
      segment: "ready-made",
      trend: "visit_to_checkout_rate",
      device: "bot",
      collection_page: "21",
      product_page: "42",
      acquisition_page: "63",
      demo_state: "low-volume",
    }))).toMatchObject({
      range: "today",
      compare: "off",
      segment: "ready-made",
      trend: "visit_to_checkout_rate",
      device: "bot",
      collection_page: 21,
      product_page: 42,
      acquisition_page: 63,
      demo_state: "low-volume",
    });

    const capped = parseMoonArqOverviewQuery({
      collection_page: "999999",
      product_page: "999999",
      acquisition_page: "999999",
    });
    expect(capped.collection_page).toBe(MOONARQ_OVERVIEW_FILTER_LIMITS.productPage);
    expect(capped.product_page).toBe(MOONARQ_OVERVIEW_FILTER_LIMITS.productPage);
    expect(capped.acquisition_page).toBe(MOONARQ_OVERVIEW_FILTER_LIMITS.productPage);
    expect(parseMoonArqOverviewQuery({ product_page: "1.5" }).product_page).toBe(1);
    expect(parseMoonArqOverviewQuery({ product_page: "0" }).product_page).toBe(1);
  });

  it("trims supported safe text filters", () => {
    const parsed = parseMoonArqOverviewQuery({
      utm_source: "  Newsletter  ",
      utm_medium: "  paid social  ",
      utm_campaign: "  lunar launch  ",
      landing_path: "  /collections/build-your-own  ",
      referrer_host: "  Search.Example  ",
    });

    expect(parsed.utm_source).toBe("newsletter");
    expect(parsed.utm_medium).toBe("paid social");
    expect(parsed.utm_campaign).toBe("lunar launch");
    expect(parsed.landing_path).toBe("/collections/build-your-own");
    expect(parsed.referrer_host).toBe("search.example");
  });

  it("does not confuse ordinary hyphenated campaign words with credentials", () => {
    const parsed = parseMoonArqOverviewQuery({
      utm_source: "secret-case",
      utm_medium: "token-drop",
      utm_campaign: "credential-free-editorial",
    });

    expect(parsed.utm_source).toBe("secret-case");
    expect(parsed.utm_medium).toBe("token-drop");
    expect(parsed.utm_campaign).toBe("credential-free-editorial");
  });

  it("rejects overlong and privacy-unsafe filter values instead of reflecting them", () => {
    const unsafe = parseMoonArqOverviewQuery({
      utm_source: "synthetic.user%2540example.invalid",
      utm_medium: "token=synthetic-not-a-secret",
      utm_campaign: "4111111111111111",
      landing_path: "/checkout?authorization=synthetic",
      referrer_host: "127.0.0.1",
    });
    const overlong = parseMoonArqOverviewQuery({
      utm_source: "s".repeat(MOONARQ_OVERVIEW_FILTER_LIMITS.utm + 1),
      utm_medium: "m".repeat(MOONARQ_OVERVIEW_FILTER_LIMITS.utm + 1),
      utm_campaign: "c".repeat(MOONARQ_OVERVIEW_FILTER_LIMITS.utm + 1),
      landing_path: `/${"p".repeat(MOONARQ_OVERVIEW_FILTER_LIMITS.landingPath)}`,
      referrer_host: "r".repeat(MOONARQ_OVERVIEW_FILTER_LIMITS.referrerHost + 1),
    });

    expect(unsafe).toMatchObject({
      utm_source: "",
      utm_medium: "",
      utm_campaign: "",
      landing_path: "",
      referrer_host: "",
    });
    expect(overlong).toMatchObject({
      utm_source: "",
      utm_medium: "",
      utm_campaign: "",
      landing_path: "",
      referrer_host: "",
    });

    const href = buildMoonArqOverviewHref("/w/moonarq/dashboard", {
      ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
      ...unsafe,
    });
    expect(href).toBe("/w/moonarq/dashboard");
  });

  it.each([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "landing_path",
    "referrer_host",
  ] as const)("fails closed on malformed percent encoding in %s", (key) => {
    const parsed = parseMoonArqOverviewQuery(
      new URLSearchParams(`range=7d&${key}=${malformedRawCanary}`),
    );
    const href = buildMoonArqOverviewHref("/w/moonarq/dashboard", parsed);
    const canonical = new URL(href, "https://data-hub.invalid");

    expect(parsed.range).toBe("7d");
    expect(parsed[key]).toBe("");
    expect(canonical.searchParams.get("range")).toBe("7d");
    expect(canonical.searchParams.has(key)).toBe(false);
    for (const canary of [
      malformedRawCanary,
      malformedIntermediateCanary,
      malformedDecodedCanary,
    ]) {
      expect(href).not.toContain(canary);
    }
  });

  it.each(paymentFilterCases)("removes embedded payment data from $key query state and hrefs", ({
    key,
    value,
  }) => {
    const parsed = parseMoonArqOverviewQuery(
      new URLSearchParams(`range=7d&${key}=${value}`),
    );
    const href = buildMoonArqOverviewHref("/w/moonarq/dashboard", parsed);
    const canonical = new URL(href, "https://data-hub.invalid");

    expect(parsed.range).toBe("7d");
    expect(parsed[key]).toBe("");
    expect(canonical.searchParams.get("range")).toBe("7d");
    expect(canonical.searchParams.has(key)).toBe(false);
    for (const canary of [value, dottedPaymentCandidate, syntheticPaymentDigits]) {
      expect(href).not.toContain(canary);
      expect(decodeURIComponent(href)).not.toContain(canary);
    }
  });

  it("removes an alternative IPv4 host from query state and generated hrefs", () => {
    const parsed = parseMoonArqOverviewQuery(new URLSearchParams({
      range: "7d",
      referrer_host: alternativeIpv4Host,
      acquisition_page: "2",
    }));
    const href = buildMoonArqOverviewHref("/w/moonarq/dashboard", parsed);
    const canonical = new URL(href, "https://data-hub.invalid");

    expect(parsed).toMatchObject({
      range: "7d",
      referrer_host: "",
      acquisition_page: 2,
    });
    expect(canonical.searchParams.get("range")).toBe("7d");
    expect(canonical.searchParams.get("acquisition_page")).toBe("2");
    expect(canonical.searchParams.has("referrer_host")).toBe(false);
    expect(href).not.toContain(alternativeIpv4Host);
  });

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
  ])("removes $label from query state and generated hrefs", ({ value }) => {
    const parsed = parseMoonArqOverviewQuery(new URLSearchParams({
      range: "7d",
      utm_source: value,
      acquisition_page: "2",
    }));
    const href = buildMoonArqOverviewHref("/w/moonarq/dashboard", parsed);
    const canonical = new URL(href, "https://data-hub.invalid");

    expect(parsed).toMatchObject({ range: "7d", utm_source: "", acquisition_page: 2 });
    expect(canonical.searchParams.get("range")).toBe("7d");
    expect(canonical.searchParams.get("acquisition_page")).toBe("2");
    expect(canonical.searchParams.has("utm_source")).toBe(false);
    expect(href.toLowerCase()).not.toContain(value.toLowerCase());
  });

  it.each([
    "://example.invalid/path",
    "0://example.invalid/path",
    "+://example.invalid/path",
    "_://example.invalid/path",
    ".-://example.invalid/path",
  ])("preserves the safe pseudo-scheme UTM control %s", (value) => {
    const parsed = parseMoonArqOverviewQuery(new URLSearchParams({
      range: "7d",
      utm_source: value,
    }));
    const href = buildMoonArqOverviewHref("/w/moonarq/dashboard", parsed);
    const canonical = new URL(href, "https://data-hub.invalid");

    expect(parsed.utm_source).toBe(value);
    expect(canonical.searchParams.get("utm_source")).toBe(value);
  });

  it("preserves supported state, omits defaults, and URL-encodes values", () => {
    const current = parseMoonArqOverviewQuery({
      range: "7d",
      compare: "off",
      segment: "builder",
      trend: "add_to_cart",
      device: "mobile",
      utm_source: "Instagram stories",
      utm_medium: "paid/social",
      utm_campaign: "Moon & stars",
      landing_path: "/collections/build your own",
      referrer_host: "example.com",
      collection_page: "2",
      product_page: "3",
      acquisition_page: "4",
      demo_state: "empty",
    });
    const href = buildMoonArqOverviewHref("/w/moonarq/dashboard", current);
    const url = new URL(href, "https://data-hub.example");

    expect(url.pathname).toBe("/w/moonarq/dashboard");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      range: "7d",
      compare: "off",
      segment: "builder",
      trend: "add_to_cart",
      device: "mobile",
      utm_source: "instagram stories",
      utm_medium: "paid/social",
      utm_campaign: "Moon & stars",
      landing_path: "/collections/build your own",
      referrer_host: "example.com",
      collection_page: "2",
      product_page: "3",
      acquisition_page: "4",
      demo_state: "empty",
    });
    expect(href).toContain("utm_campaign=Moon+%26+stars");
    expect(buildMoonArqOverviewHref("/w/moonarq/dashboard", DEFAULT_MOONARQ_OVERVIEW_QUERY)).toBe(
      "/w/moonarq/dashboard",
    );
  });

  it("keeps every table page when the patch does not change an analytic filter", () => {
    const current: MoonArqOverviewQuery = {
      ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
      range: "7d",
      collection_page: 7,
      product_page: 8,
      acquisition_page: 9,
    };

    const unchanged = new URL(
      buildMoonArqOverviewHref("/w/moonarq/dashboard", current, { range: "7d" }),
      "https://data-hub.example",
    );
    expect(Object.fromEntries(unchanged.searchParams)).toMatchObject({
      collection_page: "7",
      product_page: "8",
      acquisition_page: "9",
    });

    const collectionChanged = new URL(
      buildMoonArqOverviewHref("/w/moonarq/dashboard", current, { collection_page: 10 }),
      "https://data-hub.example",
    );
    expect(Object.fromEntries(collectionChanged.searchParams)).toMatchObject({
      collection_page: "10",
      product_page: "8",
      acquisition_page: "9",
    });
  });

  it.each<[keyof MoonArqOverviewQueryPatch, MoonArqOverviewQueryPatch]>([
    ["range", { range: "today" }],
    ["compare", { compare: "off" }],
    ["segment", { segment: "builder" }],
    ["trend", { trend: "checkout" }],
    ["device", { device: "tablet" }],
    ["utm_source", { utm_source: "instagram" }],
    ["utm_medium", { utm_medium: "paid_social" }],
    ["utm_campaign", { utm_campaign: "lunar_launch" }],
    ["landing_path", { landing_path: "/products/lunar-bracelet" }],
    ["referrer_host", { referrer_host: "search.example" }],
    ["demo_state", { demo_state: "low-volume" }],
  ])("resets all table pagination when %s changes", (_key, patch) => {
    const current: MoonArqOverviewQuery = {
      ...DEFAULT_MOONARQ_OVERVIEW_QUERY,
      collection_page: 7,
      product_page: 8,
      acquisition_page: 9,
    };
    const href = buildMoonArqOverviewHref("/w/moonarq/dashboard", current, {
      ...patch,
      collection_page: 16,
      product_page: 17,
      acquisition_page: 18,
    });
    const params = new URL(href, "https://data-hub.example").searchParams;

    expect(params.has("collection_page")).toBe(false);
    expect(params.has("product_page")).toBe(false);
    expect(params.has("acquisition_page")).toBe(false);
  });
});
