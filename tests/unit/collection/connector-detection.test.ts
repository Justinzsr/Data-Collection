import { describe, expect, it } from "vitest";
import { detectSource, getConnector, listSourceTypes } from "@/collection/connectors/registry";

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
    expect(shopify.availability).toBe("planned");
    expect(shopify.demoAvailable).toBe(false);
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
});
