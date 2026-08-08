import "server-only";

export const SHOPIFY_COMMERCE_FACTS_V2_FLAG = "ENABLE_SHOPIFY_COMMERCE_FACTS_V2";

export function isShopifyCommerceFactsV2Enabled() {
  return process.env[SHOPIFY_COMMERCE_FACTS_V2_FLAG]?.trim() === "true";
}
