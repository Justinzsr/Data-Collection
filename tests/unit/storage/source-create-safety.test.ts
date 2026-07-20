import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createSourceRoute } from "@/app/api/sources/route";
import { staticDataSpaces } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";

function request(body: unknown) {
  return new Request("http://localhost:4000/api/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("source creation safety", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    globalThis.__moonarqPool = undefined;
    resetDemoStore();
  });

  afterEach(() => {
    globalThis.__moonarqPool = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

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
    const injectedStatus = await createSourceRoute(request({
      source_type_key: "website",
      display_name: "Injected status",
      input_url: "https://example.com",
      status: "healthy",
    }));
    const missingWebsiteUrl = await createSourceRoute(request({
      source_type_key: "website",
      display_name: "Missing origin",
    }));

    expect(unknownField.status).toBe(400);
    expect(unsafeUrl.status).toBe(400);
    expect(injectedStatus.status).toBe(400);
    expect(missingWebsiteUrl.status).toBe(400);
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
      sync_mode: "manual",
      metadata: {
        demo: false,
        public_tracking_key: "mq_client_chosen_key",
        allowed_origins: ["https://attacker.example"],
      },
    }));
    const body = await valid.json();
    expect(valid.status).toBe(201);
    expect(body.source).toMatchObject({
      source_type_key: "website",
      status: "demo",
      sync_mode: "webhook",
      metadata: { demo: true },
    });
    expect(body.source.metadata.public_tracking_key).toMatch(/^mq_[0-9a-f]{20}$/u);
    expect(body.source.metadata.public_tracking_key).not.toBe("mq_client_chosen_key");
    expect(body.source.metadata.allowed_origins).toEqual(["https://example.com"]);
  });

  it("atomically creates a database-backed Website Tracker as healthy", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/moonarq_source_lifecycle_test");
    const logged = [
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
    ];
    const dataSpace = staticDataSpaces()[0];
    const persisted: Source[] = [];
    const fakePool = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        if (text.includes("from data_spaces")) {
          return { rows: [dataSpace] };
        }
        if (text.includes("insert into source_types")) {
          return { rows: [] };
        }
        if (text.includes("insert into sources")) {
          const source: Source = {
            id: String(values[0]),
            data_space_id: String(values[1]),
            source_type_key: values[2] as Source["source_type_key"],
            display_name: String(values[3]),
            input_url: values[4] as string | null,
            normalized_url: values[5] as string | null,
            external_account_id: values[6] as string | null,
            account_name: values[7] as string | null,
            status: values[8] as Source["status"],
            sync_mode: values[9] as Source["sync_mode"],
            sync_frequency_minutes: Number(values[10]),
            supports_webhook: Boolean(values[11]),
            webhook_url: values[12] as string | null,
            webhook_secret_hint: values[13] as string | null,
            last_manual_sync_at: values[14] as string | null,
            last_cron_sync_at: values[15] as string | null,
            last_webhook_sync_at: values[16] as string | null,
            last_success_at: values[17] as string | null,
            last_error_at: values[18] as string | null,
            last_error: values[19] as string | null,
            next_sync_at: values[20] as string | null,
            metadata: JSON.parse(String(values[21])) as Source["metadata"],
            created_at: String(values[22]),
            updated_at: String(values[23]),
          };
          persisted.push(source);
          return { rows: [source] };
        }
        throw new Error("Unexpected database query in source lifecycle test.");
      }),
    };
    globalThis.__moonarqPool = fakePool as unknown as Pool;

    const response = await createSourceRoute(request({
      data_space_slug: "moonarq",
      source_type_key: "website",
      display_name: "MoonArq Website Tracker",
      input_url: "https://www.example.com/products/example?campaign=test#details",
      normalized_url: "https://attacker.example",
      metadata: {
        demo: true,
        public_tracking_key: "mq_client_chosen_key",
        allowed_origins: ["https://attacker.example"],
        monitored_source: "moonarq_website",
        website_mode: "website",
      },
    }));
    const { source } = await response.json() as { source: Source };

    expect(response.status).toBe(201);
    expect(persisted).toHaveLength(1);
    expect(source).toEqual(persisted[0]);
    expect(source).toMatchObject({
      source_type_key: "website",
      status: "healthy",
      sync_mode: "webhook",
      metadata: {
        demo: false,
        monitored_source: "moonarq_website",
        website_mode: "website",
        allowed_origins: ["https://www.example.com"],
      },
    });
    expect(source.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(source.metadata.public_tracking_key).toMatch(/^mq_[0-9a-f]{20}$/u);
    expect(source.metadata.public_tracking_key).not.toBe("mq_client_chosen_key");
    expect(source.normalized_url).toBe("https://www.example.com");
    expect(source.webhook_url).toBe(`/api/webhooks/website/${source.id}`);
    for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  });

  it("preserves the existing non-Website lifecycle and metadata behavior", async () => {
    const response = await createSourceRoute(request({
      source_type_key: "tiktok",
      display_name: "TikTok lifecycle fixture",
      input_url: "https://www.tiktok.com/@lifecycle_fixture",
      normalized_url: "https://www.tiktok.com/@lifecycle_fixture",
      metadata: { demo: false, scaffoldOnly: true },
    }));
    const { source } = await response.json() as { source: Source };

    expect(response.status).toBe(201);
    expect(source).toMatchObject({
      source_type_key: "tiktok",
      status: "needs_credentials",
      metadata: { demo: false, scaffoldOnly: true },
    });
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
