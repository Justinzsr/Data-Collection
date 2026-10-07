import { describe, expect, it } from "vitest";
import {
  connectorRegistry,
  detectSource,
  getConnector,
  getInitialSourceStatus,
  listSourceTypes,
} from "@/collection/connectors/registry";

describe("connector detection", () => {
  it("detects Supabase URLs", () => {
    const [result] = detectSource("https://xxxxx.supabase.co");
    expect(result.sourceTypeKey).toBe("supabase");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("detects website URLs as first-party tracking", () => {
    const [result] = detectSource("https://example.com");
    expect(result.sourceTypeKey).toBe("website");
    expect(result.possibleMetrics).toContain("page_views");
  });

  it("detects live and explicitly planned connectors", () => {
    const shopify = detectSource("https://your-store.myshopify.com")[0];
    expect(shopify.sourceTypeKey).toBe("shopify");
    expect(shopify.availability).toBe("live");
    expect(shopify.setupKind).toBe("credentials");
    expect(shopify.normalizedUrl).toBe("https://your-store.myshopify.com");
    expect(shopify.demoAvailable).toBe(false);
    expect(detectSource("https://admin.shopify.com/store/your-store/orders")[0]).toMatchObject({
      sourceTypeKey: "shopify",
      normalizedUrl: "https://your-store.myshopify.com",
      availability: "live",
    });
    expect(detectSource("https://www.tiktok.com/@account")[0].sourceTypeKey).toBe("tiktok");
    expect(detectSource("https://www.instagram.com/account")[0].sourceTypeKey).toBe("instagram");
    expect(detectSource("https://vercel.com/team/project")[0].sourceTypeKey).toBe("vercel_project");
  });

  it("detects Xiaohongshu and xhslink URLs as planned instead of Website Tracker", () => {
    for (const input of [
      "https://www.xiaohongshu.com/user/profile/abc123",
      "https://xhslink.com/a1b2c3",
    ]) {
      const [result] = detectSource(input);
      expect(result).toMatchObject({
        sourceTypeKey: "xiaohongshu",
        displayName: "小红书 / Xiaohongshu",
        availability: "planned",
        setupKind: "planned",
        demoAvailable: false,
        possibleMetrics: [],
      });
      expect(result.requiredSetup.join(" ")).toContain("does not collect");
    }
  });

  it("detects Etsy shops as the live Etsy connector, named after the shop", () => {
    const [result] = detectSource("https://www.etsy.com/uk/shop/MoonArqStudio?ref=shop_sugg");
    expect(result).toMatchObject({
      sourceTypeKey: "etsy",
      availability: "live",
      setupKind: "oauth",
      normalizedUrl: "https://www.etsy.com/shop/MoonArqStudio",
      accountName: "MoonArqStudio",
      demoAvailable: false,
    });
    expect(result.possibleMetrics).toEqual(expect.arrayContaining(["etsy_orders", "etsy_sales", "etsy_refunds", "etsy_active_listings"]));
    expect(result.requiredSetup.join(" ")).toContain("callback URL");
  });

  it("detects Facebook Pages and GA4 properties as planned, credential-free connectors", () => {
    const cases = [
      { input: "https://www.facebook.com/moonarqstudio/about", key: "facebook_page", normalizedUrl: "https://www.facebook.com/moonarqstudio", accountName: "moonarqstudio" },
      { input: "https://m.facebook.com/profile.php?id=61550000000000", key: "facebook_page", normalizedUrl: "https://www.facebook.com/profile.php?id=61550000000000", accountName: "61550000000000" },
      { input: "https://analytics.google.com/analytics/web/#/p123456789/reports/intelligenthome", key: "google_analytics", normalizedUrl: "https://analytics.google.com/analytics/web/#/p123456789/", accountName: "GA4 property 123456789" },
    ] as const;
    for (const { input, key, normalizedUrl, accountName } of cases) {
      const [result] = detectSource(input);
      expect(result, input).toMatchObject({
        sourceTypeKey: key,
        availability: "planned",
        setupKind: "planned",
        normalizedUrl,
        accountName,
        demoAvailable: false,
      });
      expect(result.requiredSetup.join(" ")).toContain("does not collect");
      expect(result.requiredSetup.join(" ")).toContain("official");
    }
  });

  it("keeps Meta Ads Manager and Facebook feature URLs off the Facebook Page connector", () => {
    expect(detectSource("https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123")[0].sourceTypeKey).toBe("meta_ads");
    expect(detectSource("https://www.facebook.com/adsmanager/manage/campaigns")[0].sourceTypeKey).toBe("meta_ads");
    for (const input of ["https://www.facebook.com/groups/123", "https://www.facebook.com/marketplace/item/1", "https://www.facebook.com/"]) {
      expect(detectSource(input).some((result) => result.sourceTypeKey === "facebook_page"), input).toBe(false);
    }
  });

  it("lists source types with capabilities", () => {
    const keys = listSourceTypes().map((sourceType) => sourceType.key);
    expect(keys).toContain("supabase");
    expect(keys).toContain("website");
    expect(keys).toContain("xiaohongshu");
    expect(new Set(keys).size).toBe(keys.length);

    const xiaohongshu = listSourceTypes().find((sourceType) => sourceType.key === "xiaohongshu");
    expect(xiaohongshu).toMatchObject({
      enabled: false,
      availability: "planned",
      setup_kind: "planned",
      default_sync_mode: "manual",
      required_fields: [],
      optional_fields: [],
      supported_metrics: [],
      capabilities: {
        supportsWebhook: false,
        supportsPolling: false,
        supportsManualSync: false,
        canTestConnection: false,
      },
    });
  });

  it("asks for only service_role_key in Supabase admin fallback mode", () => {
    const connector = getConnector("supabase");
    const fields = [...connector.requiredFields, ...connector.optionalFields].map((field) => field.key);
    expect(fields).toContain("service_role_key");
    expect(fields).not.toContain("anon_key");
  });

  it("lists Shopify as a live encrypted-credential connector", () => {
    const shopify = listSourceTypes().find((sourceType) => sourceType.key === "shopify");
    expect(shopify).toMatchObject({
      enabled: true,
      availability: "live",
      setup_kind: "credentials",
      default_sync_mode: "hourly",
      auth_type: "shopify_client_credentials",
      capabilities: {
        supportsPolling: true,
        supportsManualSync: true,
        canTestConnection: true,
      },
    });
    expect(shopify?.required_fields.map((field) => field.key)).toEqual([
      "shopify_client_id",
      "shopify_client_secret",
    ]);
  });

  it("derives the initial lifecycle without changing non-Website connector behavior", () => {
    const website = getConnector("website");
    expect(getInitialSourceStatus(website, true)).toBe("healthy");
    expect(getInitialSourceStatus(website, false)).toBe("demo");

    for (const connector of connectorRegistry.filter((item) => item.key !== "website" && item.setupKind !== "upload")) {
      const expected =
        connector.requiredFields.some((field) => field.required) || connector.key === "supabase"
          ? "needs_credentials"
          : "demo";
      expect(getInitialSourceStatus(connector, true), connector.key).toBe(expected);
      expect(getInitialSourceStatus(connector, false), connector.key).toBe(expected);
    }
  });

  it("starts report-upload sources ready for their first report", () => {
    // A demo status would stick after real imports, so with a database they start healthy.
    for (const connector of connectorRegistry.filter((item) => item.setupKind === "upload")) {
      expect(connector.requiredFields, connector.key).toEqual([]);
      expect(getInitialSourceStatus(connector, true), connector.key).toBe("healthy");
      expect(getInitialSourceStatus(connector, false), connector.key).toBe("demo");
    }
    expect(connectorRegistry.filter((item) => item.setupKind === "upload").map((item) => item.key)).toEqual(["whatnot"]);
  });
});
