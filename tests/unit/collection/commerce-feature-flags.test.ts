import { afterEach, describe, expect, it, vi } from "vitest";
import { assertCommerceFactsPersistenceGate } from "@/collection/sync/engine";
import {
  isShopifyCommerceFactsV2Enabled,
  SHOPIFY_COMMERCE_FACTS_V2_FLAG,
} from "@/storage/runtime/commerce-feature-flags";

describe("Shopify commerce facts V2 release gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled when the environment variable is absent", () => {
    vi.stubEnv(SHOPIFY_COMMERCE_FACTS_V2_FLAG, undefined);

    expect(isShopifyCommerceFactsV2Enabled()).toBe(false);
  });

  it.each([
    ["", false],
    ["false", false],
    ["FALSE", false],
    ["TRUE", false],
    ["1", false],
    [" true ", true],
  ] as const)("maps %j to enabled=%s", (value, expected) => {
    vi.stubEnv(SHOPIFY_COMMERCE_FACTS_V2_FLAG, value);

    expect(isShopifyCommerceFactsV2Enabled()).toBe(expected);
  });

  it("rejects an unexpected facts envelope while the writer is disabled", () => {
    expect(() => assertCommerceFactsPersistenceGate({
      sourceTypeKey: "shopify",
      hasCommerceFacts: true,
      hasCommerceWindow: true,
      enabled: false,
    })).toThrow("disabled for this release");
  });

  it("requires a complete Shopify-owned facts envelope when enabled", () => {
    expect(() => assertCommerceFactsPersistenceGate({
      sourceTypeKey: "shopify",
      hasCommerceFacts: true,
      hasCommerceWindow: false,
      enabled: true,
    })).toThrow("Shopify-owned replacement window");
    expect(() => assertCommerceFactsPersistenceGate({
      sourceTypeKey: "meta_ads",
      hasCommerceFacts: true,
      hasCommerceWindow: true,
      enabled: true,
    })).toThrow("Shopify-owned replacement window");
    expect(() => assertCommerceFactsPersistenceGate({
      sourceTypeKey: "shopify",
      hasCommerceFacts: true,
      hasCommerceWindow: true,
      enabled: true,
    })).not.toThrow();
  });
});
