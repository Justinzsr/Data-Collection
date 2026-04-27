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

  it("detects scaffolded future connectors", () => {
    expect(detectSource("https://your-store.myshopify.com")[0].sourceTypeKey).toBe("shopify");
    expect(detectSource("https://www.tiktok.com/@account")[0].sourceTypeKey).toBe("tiktok");
    expect(detectSource("https://www.instagram.com/account")[0].sourceTypeKey).toBe("instagram");
    expect(detectSource("https://vercel.com/team/project")[0].sourceTypeKey).toBe("vercel_project");
  });

  it("lists source types with capabilities", () => {
    const keys = listSourceTypes().map((sourceType) => sourceType.key);
    expect(keys).toContain("supabase");
    expect(keys).toContain("website");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("asks for only service_role_key in Supabase admin fallback mode", () => {
    const connector = getConnector("supabase");
    const fields = [...connector.requiredFields, ...connector.optionalFields].map((field) => field.key);
    expect(fields).toContain("service_role_key");
    expect(fields).not.toContain("anon_key");
  });
});
