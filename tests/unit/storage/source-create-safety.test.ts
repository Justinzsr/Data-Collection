import { beforeEach, describe, expect, it } from "vitest";
import { POST as createSourceRoute } from "@/app/api/sources/route";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";

function request(body: unknown) {
  return new Request("http://localhost:4000/api/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("source creation safety", () => {
  beforeEach(() => resetDemoStore());

  it("rejects unknown fields and unsafe URLs without creating a source", async () => {
    const before = getDemoStore().sources.length;
    const unknownField = await createSourceRoute(request({
      source_type_key: "website",
      display_name: "Unsafe source",
      data_space_id: "attacker-controlled",
    }));
    const unsafeUrl = await createSourceRoute(request({
      source_type_key: "website",
      display_name: "Unsafe source",
      input_url: "javascript:alert(1)",
    }));

    expect(unknownField.status).toBe(400);
    expect(unsafeUrl.status).toBe(400);
    expect(getDemoStore().sources).toHaveLength(before);
  });

  it("rejects unsupported sync modes and uses the connector default otherwise", async () => {
    const unsupported = await createSourceRoute(request({
      source_type_key: "website",
      display_name: "Invalid polling website",
      input_url: "https://example.com",
      sync_mode: "hourly",
    }));
    expect(unsupported.status).toBe(400);

    const valid = await createSourceRoute(request({
      source_type_key: "website",
      display_name: "Valid website",
      input_url: "https://example.com",
      normalized_url: "https://example.com",
    }));
    const body = await valid.json();
    expect(valid.status).toBe(201);
    expect(body.source).toMatchObject({ source_type_key: "website", sync_mode: "webhook" });
  });

  it("accepts only canonical Shopify hosts and ignores a forged normalized URL", async () => {
    const before = getDemoStore().sources.length;
    for (const input_url of [
      "http://your-store.myshopify.com",
      "https://shop.example.com",
      "https://169.254.169.254/latest/meta-data",
      "https://your-store.myshopify.com.attacker.example",
    ]) {
      const response = await createSourceRoute(request({
        source_type_key: "shopify",
        display_name: "Unsafe Shopify",
        input_url,
      }));
      expect(response.status).toBe(400);
    }
    expect(getDemoStore().sources).toHaveLength(before);

    const response = await createSourceRoute(request({
      source_type_key: "shopify",
      display_name: "MoonArq Shopify",
      input_url: "https://admin.shopify.com/store/moonarq-store/orders",
      normalized_url: "https://attacker.example",
    }));
    expect(response.status).toBe(201);
    expect((await response.json()).source).toMatchObject({
      source_type_key: "shopify",
      input_url: "https://admin.shopify.com/store/moonarq-store/orders",
      normalized_url: "https://moonarq-store.myshopify.com",
      external_account_id: "moonarq-store.myshopify.com",
      account_name: "moonarq-store",
      sync_mode: "hourly",
      status: "needs_credentials",
    });
  });
});
