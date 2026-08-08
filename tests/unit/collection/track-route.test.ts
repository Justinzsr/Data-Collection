import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/track/route";
import {
  MAX_EVENT_AGE_MS,
  MAX_EVENT_FUTURE_SKEW_MS,
} from "@/collection/tracking/website-event-contract";
import { resetWebsiteTrackingRateLimitForTests } from "@/collection/tracking/website-rate-limit";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";
import { resetDemoStore } from "@/storage/repositories/demo-store";
import { listWebEvents } from "@/storage/repositories/events-repository";
import { listMetrics } from "@/storage/repositories/metrics-repository";

const NOW = new Date("2026-07-17T19:00:00.000Z");
const ORIGIN = "https://moonarqstudio.com";
const PUBLIC_KEY = "mq_demo_public_website";

function v1Event(overrides: Record<string, unknown> = {}) {
  return {
    event_id: randomUUID(),
    schema_version: "1.0",
    source_id: DEMO_SOURCE_IDS.website,
    public_tracking_key: PUBLIC_KEY,
    anonymous_id: "anon-route-test",
    session_id: "session-route-test",
    event_name: "page_view",
    occurred_at: NOW.toISOString(),
    path: "/products/moon-bracelet",
    url: "https://moonarqstudio.com/products/moon-bracelet?utm_source=instagram",
    referrer: "https://instagram.com/",
    properties: { product_id: "moon-bracelet" },
    attribution: {
      utm: { source: "instagram", medium: "paid_social", campaign: "launch" },
      landing_page: "/products/moon-bracelet",
      touchpoint: "current",
    },
    consent: { analytics: "granted", marketing: "unknown" },
    client_context: {
      language: "en-US",
      currency: "usd",
      viewport_category: "large",
      device_category: "desktop",
      traffic_type: "production",
      page_type: "product",
    },
    ...overrides,
  };
}

async function postTrack(
  payload: unknown,
  options: { origin?: string; contentType?: string; ip?: string; rawBody?: string; userAgent?: string } = {},
) {
  const headers = new Headers({
    origin: options.origin ?? ORIGIN,
    "content-type": options.contentType ?? "application/json; charset=utf-8",
    "x-forwarded-for": options.ip ?? "203.0.113.9",
    "user-agent": options.userAgent ?? "MoonArq Route Test",
  });
  return POST(new Request("http://localhost:4000/api/track", {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(payload),
  }));
}

describe("POST /api/track", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("APP_ENCRYPTION_KEY", "test-only-tracking-hash-key");
    resetWebsiteTrackingRateLimitForTests();
    resetDemoStore();
  });

  afterEach(() => {
    resetWebsiteTrackingRateLimitForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("accepts and stores a canonical v1 event with distinct occurrence and receipt metadata", async () => {
    const eventId = randomUUID();
    const response = await postTrack(v1Event({
      event_id: eventId,
      occurred_at: new Date(NOW.getTime() - 30_000).toISOString(),
      url: "https://moonarqstudio.com/products/moon-bracelet?utm_source=instagram&customerEmail=redacted-before-storage",
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ ok: true, event_id: eventId, duplicate: false });
    const stored = (await listWebEvents(200)).find((event) => event.event_id === eventId);
    expect(stored).toMatchObject({
      schema_version: "1.0",
      event_source: "first_party_tracker",
      source_id: DEMO_SOURCE_IDS.website,
      attribution_context: { utm: { source: "instagram" } },
      consent_status: { analytics: "granted", marketing: "unknown" },
      client_context: {
        language: "en-US",
        currency: "USD",
        device_category: "desktop",
        traffic_type: "production",
      },
      user_agent: null,
      occurred_at: new Date(NOW.getTime() - 30_000).toISOString(),
      received_at: NOW.toISOString(),
    });
    expect(stored?.received_at).not.toBe(stored?.occurred_at);
    expect(stored?.url).not.toContain("customerEmail=");
    expect(stored?.ip_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored?.ip_hash).not.toContain("203.0.113.9");
    expect(JSON.stringify(body)).not.toContain("203.0.113.9");
  });

  it("accepts schema-validated opaque UUID identifiers without treating their digits as personal data", async () => {
    const response = await postTrack(v1Event({
      event_id: "41111111-1111-4111-8111-111111111111",
      anonymous_id: "41111111-1111-4111-8111-111111111112",
      session_id: "41111111-1111-4111-8111-111111111113",
      user_id: "41111111-1111-4111-8111-111111111114",
    }));

    expect(response.status).toBe(202);
  });

  it("allows explicit commerce identifier fields without treating numeric catalog IDs as contact or card data", async () => {
    const response = await postTrack(v1Event({
      event_id: randomUUID(),
      properties: {
        product_id: "4111111111111111",
        variant_id: 442071838750,
      },
    }));

    expect(response.status).toBe(202);
  });

  it("removes repeatedly encoded sensitive query keys from canonical URLs", async () => {
    const eventId = randomUUID();
    const response = await postTrack(v1Event({
      event_id: eventId,
      url: "https://moonarqstudio.com/products/moon-bracelet?%2561ccess_token=sensitive_example_value&utm_source=instagram",
    }));

    expect(response.status).toBe(202);
    const stored = (await listWebEvents(200)).find((event) => event.event_id === eventId);
    expect(stored?.url).not.toContain("ccess_token");
    expect(stored?.url).toBe("https://moonarqstudio.com/products/moon-bracelet");
  });

  it("keeps the legacy payload format valid and assigns a server event id", async () => {
    const response = await postTrack({
      public_tracking_key: PUBLIC_KEY,
      anonymous_id: "legacy-anonymous",
      session_id: "legacy-session",
      event_name: "page_view",
      path: "/legacy",
      referrer: null,
      user_agent: "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36",
      properties: { app_version: "1.2.3", reporting_date: "2026-07-17", sku: "1234-5678" },
      url: "https://moonarqstudio.com/legacy?variant=4111111111111111",
      occurred_at: NOW.toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.event_id).toMatch(/^[0-9a-f-]{36}$/u);
    const stored = (await listWebEvents(200)).find((event) => event.event_id === body.event_id);
    expect(stored?.schema_version).toBe("legacy");
    expect(stored?.event_source).toBe("first_party_tracker");
    expect(stored?.user_agent).toContain("Chrome/131.0.0.0");
  });

  it("drops malformed legacy attribution instead of bypassing canonical field limits", async () => {
    const response = await postTrack({
      public_tracking_key: PUBLIC_KEY,
      anonymous_id: "legacy-attribution-anonymous",
      session_id: "legacy-attribution-session",
      event_name: "page_view",
      path: "/legacy-attribution",
      url: "https://moonarqstudio.com/legacy-attribution",
      properties: { attribution: { utm: { source: "x".repeat(1_000) } } },
      occurred_at: NOW.toISOString(),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    const stored = (await listWebEvents(300)).find((event) => event.event_id === body.event_id);
    expect(stored?.attribution_context).toEqual({});
    expect(stored?.properties).not.toHaveProperty("attribution");
  });

  it("never persists an unvalidated HTTP User-Agent header", async () => {
    const sentinel = "private-person@example.com";
    const response = await postTrack({
      public_tracking_key: PUBLIC_KEY,
      anonymous_id: "legacy-header-anonymous",
      session_id: "legacy-header-session",
      event_name: "page_view",
      path: "/legacy-header",
      url: "https://moonarqstudio.com/legacy-header",
      properties: {},
      occurred_at: NOW.toISOString(),
    }, { userAgent: sentinel });
    const body = await response.json();

    expect(response.status).toBe(202);
    const stored = (await listWebEvents(300)).find((event) => event.event_id === body.event_id);
    expect(stored?.user_agent).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(sentinel);
  });

  it("does not collapse distinct legacy deliveries that happen to share content and a timestamp", async () => {
    const event = {
      public_tracking_key: PUBLIC_KEY,
      anonymous_id: "legacy-retry-anonymous",
      session_id: "legacy-retry-session",
      event_name: "legacy_retry_probe",
      path: "/legacy-retry",
      url: "https://moonarqstudio.com/legacy-retry",
      referrer: null,
      properties: { component: "legacy-retry-test" },
      occurred_at: new Date(NOW.getTime() - 15_000).toISOString(),
    };

    const first = await postTrack(event);
    const second = await postTrack(event);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(secondBody.event_id).not.toBe(firstBody.event_id);
    expect((await listWebEvents(300)).filter((row) => row.path === "/legacy-retry")).toHaveLength(2);
    const rows = await listMetrics({
      sourceId: DEMO_SOURCE_IDS.website,
      metricKeys: ["custom_events", "events_by_path"],
      startDate: "2026-07-17",
      endDate: "2026-07-17",
    });
    expect(rows.find((row) => row.metric_key === "custom_events" && row.dimensions.rollup === "daily")?.metric_value).toBe(2);
    expect(rows.find((row) => row.metric_key === "events_by_path" && row.dimensions.path === "/legacy-retry")?.metric_value).toBe(2);
  });

  it("uses independent random event ids for legacy payloads without occurred_at", async () => {
    const event = {
      public_tracking_key: PUBLIC_KEY,
      anonymous_id: "legacy-no-time-anonymous",
      session_id: "legacy-no-time-session",
      event_name: "legacy_no_time_probe",
      path: "/legacy-no-time",
      url: "https://moonarqstudio.com/legacy-no-time",
      referrer: null,
      properties: { component: "legacy-no-time-test" },
    };

    const first = await postTrack(event);
    const second = await postTrack(event);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(firstBody.event_id).not.toBe(secondBody.event_id);
    expect((await listWebEvents(300)).filter((row) => row.path === "/legacy-no-time")).toHaveLength(2);
  });

  it("deduplicates legacy retries when the client supplies a stable event id", async () => {
    const eventId = randomUUID();
    const event = {
      event_id: eventId,
      public_tracking_key: PUBLIC_KEY,
      anonymous_id: "legacy-stable-anonymous",
      session_id: "legacy-stable-session",
      event_name: "legacy_stable_probe",
      path: "/legacy-stable",
      url: "https://moonarqstudio.com/legacy-stable",
      properties: {},
      occurred_at: NOW.toISOString(),
    };

    const first = await postTrack(event);
    const duplicate = await postTrack(event);

    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ event_id: eventId, duplicate: true });
  });

  it("deduplicates a repeated source and event id without incrementing metrics twice", async () => {
    const event = v1Event({ event_id: randomUUID(), path: "/dedupe", anonymous_id: "dedupe-anon", session_id: "dedupe-session" });
    const first = await postTrack(event);
    const duplicate = await postTrack(event);

    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicate: true, event_id: event.event_id });
    expect((await listWebEvents(300)).filter((row) => row.event_id === event.event_id)).toHaveLength(1);
    const rows = await listMetrics({
      sourceId: DEMO_SOURCE_IDS.website,
      metricKeys: ["page_views", "events_by_path"],
      startDate: "2026-07-17",
      endDate: "2026-07-17",
    });
    expect(rows.find((row) => row.metric_key === "page_views" && row.dimensions.rollup === "daily")?.metric_value).toBe(1);
    expect(rows.find((row) => row.metric_key === "events_by_path" && row.dimensions.path === "/dedupe")?.metric_value).toBe(1);
  });

  it("rejects invalid origins, keys, and mismatched source/key pairs", async () => {
    const before = (await listWebEvents(300)).length;
    const invalidOrigin = await postTrack(v1Event(), { origin: "https://evil.example" });
    const invalidKey = await postTrack(v1Event({ public_tracking_key: "mq_unknown_public_key" }));
    const mismatchedPair = await postTrack(v1Event({ source_id: DEMO_SOURCE_IDS.supabase }));

    expect(invalidOrigin.status).toBe(403);
    expect(invalidKey.status).toBe(403);
    expect(mismatchedPair.status).toBe(403);
    expect((await listWebEvents(300)).length).toBe(before);
  });

  it("requires both the source id and public tracking key for v1 while legacy remains compatible", async () => {
    const missingSource = await postTrack(v1Event({ source_id: undefined }));
    const missingKey = await postTrack(v1Event({ public_tracking_key: undefined }));

    expect(missingSource.status).toBe(400);
    expect(missingKey.status).toBe(400);
  });

  it("enforces JSON content type and both properties and total-body size limits", async () => {
    const wrongType = await postTrack(v1Event(), { contentType: "text/plain" });
    const largeProperties = await postTrack(v1Event({ properties: { blob: "x".repeat(9_000) } }));
    const largeBody = await postTrack(null, { rawBody: JSON.stringify({ blob: "x".repeat(33_000) }) });

    expect(wrongType.status).toBe(415);
    expect(largeProperties.status).toBe(413);
    expect(largeBody.status).toBe(413);
  });

  it.each([
    ["event id", { event_id: "not-a-uuid" }],
    ["schema version", { schema_version: "2.0" }],
    ["event name", { event_name: "invalid event name" }],
    ["path", { path: "no-leading-slash" }],
    ["path query", { path: "/products?customer=123" }],
    ["URL protocol", { url: "ftp://moonarqstudio.com/file" }],
    ["client context", { client_context: { device_category: "television" } }],
    ["traffic type", { client_context: { traffic_type: "customer" } }],
    ["attribution landing page", { attribution: { landing_page: "javascript:alert(1)" } }],
    ["attribution first referrer", { attribution: { first_referrer: "javascript:alert(1)" } }],
  ])("rejects malformed %s fields", async (_label, override) => {
    const response = await postTrack(v1Event(override));
    expect(response.status).toBe(400);
  });

  it("accepts timestamp boundaries and rejects events beyond the allowed past/future window", async () => {
    const acceptedPast = await postTrack(v1Event({
      event_id: randomUUID(),
      occurred_at: new Date(NOW.getTime() - MAX_EVENT_AGE_MS).toISOString(),
    }));
    const acceptedFuture = await postTrack(v1Event({
      event_id: randomUUID(),
      occurred_at: new Date(NOW.getTime() + MAX_EVENT_FUTURE_SKEW_MS).toISOString(),
    }));
    const rejectedPast = await postTrack(v1Event({
      event_id: randomUUID(),
      occurred_at: new Date(NOW.getTime() - MAX_EVENT_AGE_MS - 1).toISOString(),
    }));
    const rejectedFuture = await postTrack(v1Event({
      event_id: randomUUID(),
      occurred_at: new Date(NOW.getTime() + MAX_EVENT_FUTURE_SKEW_MS + 1).toISOString(),
    }));

    expect(acceptedPast.status).toBe(202);
    expect(acceptedFuture.status).toBe(202);
    expect(rejectedPast.status).toBe(400);
    expect(rejectedFuture.status).toBe(400);
  });

  it("returns 429 with Retry-After after the privacy-safe per-client limit", async () => {
    vi.stubEnv("WEBSITE_TRACKING_RATE_LIMIT_PER_MINUTE", "2");
    resetWebsiteTrackingRateLimitForTests();
    const first = await postTrack(v1Event({ event_id: randomUUID() }));
    const second = await postTrack(v1Event({ event_id: randomUUID() }));
    const limited = await postTrack(v1Event({ event_id: randomUUID() }));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("rejects prohibited PII without storing or logging submitted values", async () => {
    const sentinel = "private-person@example.com";
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
    const before = JSON.stringify((await listWebEvents(300)));
    const response = await postTrack(v1Event({ properties: { customer_email: sentinel } }));
    const responseText = await response.text();
    const after = JSON.stringify((await listWebEvents(300)));

    expect(response.status).toBe(400);
    expect(responseText).not.toContain(sentinel);
    expect(after).toBe(before);
    expect(after).not.toContain(sentinel);
    for (const spy of consoleSpies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(sentinel);
    }
  });

  it.each([
    ["raw IP value", { properties: { diagnostic_value: "203.0.113.42" } }],
    ["camel-case phone field", { properties: { customerPhone: "555-0100" } }],
    ["shipping address field", { properties: { shippingAddress: "123 Example Street" } }],
    ["street address value", { properties: { diagnostic_value: "Deliver to 123 Example Street" } }],
    ["post-office box value", { properties: { diagnostic_value: "PO Box 1234" } }],
    ["payment card field", { properties: { creditCardNumber: "4111111111111111" } }],
    ["payment method field", { properties: { payment_method_id: "pm_example" } }],
    ["phone-like value", { properties: { diagnostic_value: "+1 (555) 010-2000" } }],
    ["generic phone value", { properties: { diagnostic_value: "202-555-0100" } }],
    ["generic payment-card value", { properties: { diagnostic_value: "4111111111111111" } }],
    ["JCB payment-card value", { properties: { diagnostic_value: "3530111333300000" } }],
    ["Diners payment-card value", { properties: { diagnostic_value: "30569309025904" } }],
    ["numeric phone value", { properties: { diagnostic_value: 2025550100 } }],
    ["numeric payment-card value", { properties: { diagnostic_value: 4111111111111111 } }],
    ["email used as a property key", { properties: { "private-person@example.com": true } }],
    ["phone used as a property key", { properties: { "202-555-0100": true } }],
    ["IP used as a property key", { properties: { "203.0.113.42": true } }],
    ["phone used as a URL parameter key", { url: "https://moonarqstudio.com/?202-555-0100=x" }],
    ["payment card used as a URL parameter key", { url: "https://moonarqstudio.com/?4111111111111111=x" }],
    ["IP disguised as an app version", { properties: { app_version: "203.0.113.42" } }],
    ["IP disguised as a legacy User-Agent", { user_agent: "203.0.113.42" }],
    ["embedded IP", { properties: { diagnostic_value: "client=203.0.113.42" } }],
    ["IP behind an arbitrary User-Agent token", { user_agent: "Mozilla/203.0.113.42" }],
    ["unformatted phone value", { properties: { diagnostic_value: "2025550100" } }],
    ["international phone value", { properties: { diagnostic_value: "+442071838750" } }],
    ["international phone without plus", { properties: { diagnostic_value: "442071838750" } }],
    ["domestic international phone", { properties: { diagnostic_value: "020 7183 8750" } }],
    ["unformatted domestic international phone", { properties: { diagnostic_value: "02071838750" } }],
    ["hyphenated international phone", { properties: { diagnostic_value: "81-3-1234-5678" } }],
    ["embedded payment-card value", { properties: { diagnostic_value: "card 4111111111111111" } }],
    ["sentence-final payment-card value", { properties: { diagnostic_value: "card 4111111111111111." } }],
    ["sentence-final phone value", { properties: { diagnostic_value: "call 202-555-0100." } }],
    ["encoded email property value", { properties: { diagnostic_value: "private-person%40example.com" } }],
    ["encoded IP property value", { properties: { diagnostic_value: "203%2E0%2E113%2E42" } }],
    ["encoded phone property value", { properties: { diagnostic_value: "202%2D555%2D0100" } }],
    ["encoded payment-card property value", { properties: { diagnostic_value: "%34%31%31%31%31%31%31%31%31%31%31%31%31%31%31%31" } }],
    ["phone in a relative URL", { path: "/?x=202-555-0100" }],
    ["payment card in a path segment", { path: "/4111111111111111" }],
    ["IP in a path segment", { path: "/203.0.113.42" }],
    ["IP in an absolute URL path", { url: "https://moonarqstudio.com/203.0.113.42" }],
    ["encoded email in a URL", { url: "https://moonarqstudio.com/?x=private-person%40example.com" }],
    ["credential parameter in attribution URL", { attribution: { first_referrer: "https://example.com/?access_token=sensitive_example_value" } }],
    ["payment token parameter in a nested property URL", { properties: { diagnostic_url: "https://example.com/?payment_token=tok_example" } }],
    ["authorization parameter in a nested property URL", { properties: { diagnostic_url: "https://example.com/?authorization=BearerExample" } }],
    ["fragment in a nested property URL", { properties: { diagnostic_url: "https://example.com/#access_token=sensitive_example_value" } }],
    ["credentials in a nested property URL", { properties: { diagnostic_url: "https://token:secret@example.com/path" } }],
  ])("rejects %s personal data variants", async (_label, override) => {
    const before = (await listWebEvents(300)).length;
    const response = await postTrack(v1Event(override));

    expect(response.status).toBe(400);
    expect((await listWebEvents(300)).length).toBe(before);
  });
});
