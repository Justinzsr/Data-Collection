import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as postVercelDrain } from "@/app/api/webhooks/vercel/analytics-drain/[sourceId]/route";
import { vercelWebAnalyticsDrainConnector } from "@/collection/connectors/vercel-web-analytics-drain/connector";
import type { SourceStatus } from "@/storage/db/schema";
import { saveCredential } from "@/storage/repositories/credentials-repository";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { listWebEvents } from "@/storage/repositories/events-repository";
import { listMetrics } from "@/storage/repositories/metrics-repository";
import { createSource } from "@/storage/repositories/sources-repository";

const SIGNATURE_SECRET = "vercel-drain-signature-test-secret";
const RAW_BODY = JSON.stringify({
  schema: "vercel.analytics.v2",
  eventType: "pageview",
  timestamp: Date.parse("2026-04-22T12:00:00.000Z"),
  projectId: "prj_test",
  deviceId: "device-test",
  sessionId: "session-test",
  origin: "https://moonarqstudio.com",
  path: "/security-test",
});

function signature(rawBody = RAW_BODY, secret = SIGNATURE_SECRET) {
  return createHmac("sha1", secret).update(Buffer.from(rawBody, "utf8")).digest("hex");
}

async function createDrainSource(status: SourceStatus = "warning") {
  return createSource({
    source_type_key: "vercel_web_analytics_drain",
    display_name: "Secure Vercel Analytics Drain",
    input_url: "https://moonarqstudio.com",
    normalized_url: "https://moonarqstudio.com",
    status,
    sync_mode: "webhook",
    supports_webhook: true,
    metadata: { monitored_source: "moonarq_website" },
  });
}

async function postDrain(sourceId: string, requestSignature?: string, rawBody = RAW_BODY) {
  const headers = new Headers({ "content-type": "application/json" });
  if (requestSignature) headers.set("x-vercel-signature", requestSignature);
  return postVercelDrain(
    new Request(`http://localhost:4000/api/webhooks/vercel/analytics-drain/${sourceId}`, {
      method: "POST",
      headers,
      body: rawBody,
    }),
    { params: Promise.resolve({ sourceId }) },
  );
}

describe("Vercel Analytics Drain ingress security", () => {
  beforeEach(() => resetDemoStore());

  it("declares the encrypted signature secret as required and fails connection tests without it", async () => {
    const source = await createDrainSource();
    const field = vercelWebAnalyticsDrainConnector.requiredFields.find((item) => item.key === "drain_signature_secret");
    expect(field).toMatchObject({ required: true, secret: true });

    const result = await vercelWebAnalyticsDrainConnector.testConnection({
      source,
      credentials: {},
      isDemoMode: true,
    });
    expect(result).toMatchObject({ ok: false, status: "needs_credentials" });
  });

  it("rejects a non-drain source without writing an event", async () => {
    const source = await createSource({
      source_type_key: "website",
      display_name: "Website Tracker",
      status: "healthy",
      sync_mode: "webhook",
      supports_webhook: true,
    });
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const before = (await listWebEvents(100)).length;

    const response = await postDrain(source.id, signature());

    expect(response.status).toBe(404);
    expect((await listWebEvents(100)).length).toBe(before);
  });

  it("rejects disabled drain sources without writing an event", async () => {
    const source = await createDrainSource("disabled");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const before = (await listWebEvents(100)).length;

    const response = await postDrain(source.id, signature());

    expect(response.status).toBe(409);
    expect((await listWebEvents(100)).length).toBe(before);
  });

  it("rejects a drain source without an encrypted signature secret", async () => {
    const source = await createDrainSource();
    const before = (await listWebEvents(100)).length;

    const response = await postDrain(source.id, signature());

    expect(response.status).toBe(503);
    expect((await listWebEvents(100)).length).toBe(before);
  });

  it("rejects missing and invalid signatures without writing events", async () => {
    const source = await createDrainSource();
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const before = (await listWebEvents(100)).length;

    const missing = await postDrain(source.id);
    const invalid = await postDrain(source.id, signature(RAW_BODY, "wrong-secret"));

    expect(missing.status).toBe(403);
    expect(invalid.status).toBe(403);
    expect((await listWebEvents(100)).length).toBe(before);
  });

  it("normalizes the exact paid Instagram UTM tuple without retaining arbitrary event or URL data", async () => {
    const source = await createDrainSource("healthy");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const queryParams =
      "utm_source=instagram&utm_medium=paid_social&utm_campaign=bracelet_grid_jul2026&utm_content=story_v1";
    const rawBody = JSON.stringify({
      ...JSON.parse(RAW_BODY),
      path: "/collections/bracelets?variant=moon",
      queryParams,
      eventData: JSON.stringify({
        attribution: { utm: { source: "untrusted-event-data" }, note: "preserved" },
        campaignMarker: "first-story",
      }),
    });

    const response = await postDrain(source.id, signature(rawBody), rawBody);

    expect(response.status).toBe(200);
    const event = (await listWebEvents(100)).find((item) => item.source_id === source.id);
    expect(event).toBeDefined();
    expect(event?.properties).toMatchObject({
      attribution: {
        utm: {
          source: "instagram",
          medium: "paid_social",
          campaign: "bracelet_grid_jul2026",
          content: "story_v1",
        },
      },
      vercel: {
        query_parameters: { received: 4, retained: 4, discarded: 0, malformed: false },
        event_data_discarded: true,
      },
    });
    expect(event?.properties).not.toHaveProperty("campaignMarker");
    expect(event?.properties.vercel).not.toHaveProperty("query_params");
    const url = new URL(event?.url ?? "https://invalid.local");
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "bracelet_grid_jul2026",
      utm_content: "story_v1",
    });
    expect(event?.path).toBe("/collections/bracelets");
  });

  it("normalizes only allowlisted JSON-encoded UTM values", async () => {
    const source = await createDrainSource("healthy");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const queryParams = JSON.stringify({
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "bracelet_grid_jul2026",
      utm_content: "story_v1",
      utm_term: "pink_bracelet",
      preview: true,
    });
    const rawBody = JSON.stringify({
      ...JSON.parse(RAW_BODY),
      path: "/products/story-bracelet",
      queryParams,
    });

    const response = await postDrain(source.id, signature(rawBody), rawBody);

    expect(response.status).toBe(200);
    const event = (await listWebEvents(100)).find((item) => item.source_id === source.id);
    expect(event?.properties).toMatchObject({
      attribution: {
        utm: {
          source: "instagram",
          medium: "paid_social",
          campaign: "bracelet_grid_jul2026",
          content: "story_v1",
          term: "pink_bracelet",
        },
      },
      vercel: {
        query_parameters: { received: 6, retained: 5, discarded: 1, malformed: false },
      },
    });
    expect(event?.properties.vercel).not.toHaveProperty("query_params");
    const url = new URL(event?.url ?? "https://invalid.local");
    expect(url.searchParams.get("preview")).toBeNull();
    expect(url.searchParams.get("utm_term")).toBe("pink_bracelet");
  });

  it("discards malformed queryParams without persisting their contents", async () => {
    const source = await createDrainSource("healthy");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const queryParams = '{"utm_source":"instagram"';
    const rawBody = JSON.stringify({ ...JSON.parse(RAW_BODY), queryParams });

    const response = await postDrain(source.id, signature(rawBody), rawBody);

    expect(response.status).toBe(200);
    const event = (await listWebEvents(100)).find((item) => item.source_id === source.id);
    expect(event?.properties).not.toHaveProperty("attribution");
    expect(event?.properties).toMatchObject({
      vercel: { query_parameters: { received: 1, retained: 0, discarded: 1, malformed: true } },
    });
    expect(JSON.stringify(event?.properties)).not.toContain(queryParams);
    expect(new URL(event?.url ?? "https://invalid.local").search).toBe("");
  });

  it("discards ordinary non-UTM query params from every persisted URL", async () => {
    const source = await createDrainSource("healthy");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const queryParams = "ref=homepage&sort=featured";
    const rawBody = JSON.stringify({ ...JSON.parse(RAW_BODY), queryParams });

    const response = await postDrain(source.id, signature(rawBody), rawBody);

    expect(response.status).toBe(200);
    const event = (await listWebEvents(100)).find((item) => item.source_id === source.id);
    expect(event?.properties).not.toHaveProperty("attribution");
    expect(event?.properties).toMatchObject({
      vercel: { query_parameters: { received: 2, retained: 0, discarded: 2, malformed: false } },
    });
    const url = new URL(event?.url ?? "https://invalid.local");
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({});
  });

  it("sanitizes PII, secrets, high-entropy values, raw payloads, and diagnostic URLs before persistence", async () => {
    const source = await createDrainSource("healthy");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const email = "buyer@example.com";
    const encodedEmail = "buyer%40example.com";
    const phone = "+1 (415) 555-0199";
    const address = "123 Main Street";
    const bearer = "Bearer abcdefghijklmnopqrstuvwxyz123456";
    const highEntropyValue = "mJ7pQ2vX9cL4sN8wR6tY1uK5aD3fH0zB";
    const password = "MoonArq!private-password";
    const rawBody = JSON.stringify({
      ...JSON.parse(RAW_BODY),
      deviceId: email,
      sessionId: phone,
      origin: `https://moonarqstudio.com?authorization=${encodeURIComponent(bearer)}`,
      path: `/checkout/${encodedEmail}?token=${highEntropyValue}`,
      referrer: `https://referrer.example/${encodeURIComponent(address)}?cookie=session-cookie-value`,
      clientName: `Browser ${email}`,
      vercelUrl: `https://deployment.vercel.app/health?password=${encodeURIComponent(password)}`,
      queryParams: JSON.stringify({
        utm_source: "instagram",
        utm_medium: "paid_social",
        utm_campaign: highEntropyValue,
        utm_content: "story_v1",
        utm_term: encodedEmail,
        email,
        phone,
        address,
        authorization: bearer,
        cookie: "session-cookie-value",
        token: highEntropyValue,
        password,
      }),
      eventData: JSON.stringify({
        email,
        phone,
        shipping_address: address,
        cookie: "session-cookie-value",
        authorization: bearer,
        access_token: highEntropyValue,
        password,
        nested: { uncontrolled: { url: `https://example.com/?token=${highEntropyValue}` } },
      }),
      authorization: bearer,
      cookie: "session-cookie-value",
    });

    const response = await postDrain(source.id, signature(rawBody), rawBody);

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(highEntropyValue);
    const store = getDemoStore();
    const raw = store.rawIngestions.find((item) => item.source_id === source.id);
    const event = (await listWebEvents(100)).find((item) => item.source_id === source.id);
    const change = store.platformChangeEvents.find((item) => item.source_id === source.id);
    const persisted = JSON.stringify({
      rawPayload: raw?.payload,
      rawExternalId: raw?.external_id,
      webEvent: event,
      changePayload: change?.payload,
      changeExternalId: change?.external_record_id,
    });
    for (const sensitiveValue of [email, encodedEmail, phone, address, bearer, highEntropyValue, password, "session-cookie-value"]) {
      expect(persisted).not.toContain(sensitiveValue);
    }
    expect(raw?.payload).not.toHaveProperty("eventData");
    expect(raw?.payload).not.toHaveProperty("queryParams");
    expect(raw?.payload).not.toHaveProperty("sessionId");
    expect(raw?.payload.deviceId).toMatch(/^vercel-device-[a-f0-9]{32}$/u);
    expect(raw?.payload).toMatchObject({
      path: "/[redacted]",
      queryParameters: { received: 12, retained: 3, discarded: 9, malformed: false },
      eventDataDiscarded: true,
      utm: { source: "instagram", medium: "paid_social", content: "story_v1" },
    });
    expect(event?.anonymous_id).toMatch(/^vercel-device-[a-f0-9]{32}$/u);
    expect(event?.path).toBe("/[redacted]");
    expect(new URL(event?.referrer ?? "https://invalid.local")).toMatchObject({ search: "", pathname: "/[redacted]" });
    expect(Object.fromEntries(new URL(event?.url ?? "https://invalid.local").searchParams.entries())).toEqual({
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_content: "story_v1",
    });
    expect(event?.properties).not.toHaveProperty("eventData");
    expect(event?.properties.vercel).not.toHaveProperty("query_params");
    expect(event?.properties).toMatchObject({
      attribution: { utm: { source: "instagram", medium: "paid_social", content: "story_v1" } },
      vercel: {
        client_name: "[redacted]",
        query_parameters: { received: 12, retained: 3, discarded: 9, malformed: false },
        event_data_discarded: true,
      },
    });
  });

  it("removes IPv6 hosts and IPv4-with-port literals from every persisted surface", async () => {
    const source = await createDrainSource("healthy");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const ipLiterals = ["2001:db8::1", "2001:db8::2", "203.0.113.7", "203.0.113.8"];
    const rawBody = JSON.stringify({
      ...JSON.parse(RAW_BODY),
      origin: "https://[2001:db8::1]:8443/security",
      referrer: "https://[2001:db8::2]:9443/source",
      vercelUrl: "https://203.0.113.7:443/deployment",
      queryParams: "utm_source=203.0.113.8%3A443&utm_medium=paid_social",
    });

    const response = await postDrain(source.id, signature(rawBody), rawBody);

    expect(response.status).toBe(200);
    const store = getDemoStore();
    const raw = store.rawIngestions.find((item) => item.source_id === source.id);
    const event = (await listWebEvents(100)).find((item) => item.source_id === source.id);
    const change = store.platformChangeEvents.find((item) => item.source_id === source.id);
    const persisted = JSON.stringify({ raw: raw?.payload, event, change: change?.payload });
    for (const ipLiteral of ipLiterals) expect(persisted).not.toContain(ipLiteral);
    expect(event?.referrer).toBeNull();
    expect(event?.properties).toMatchObject({
      attribution: { utm: { medium: "paid_social" } },
      vercel: { vercel_url: null, query_parameters: { received: 2, retained: 1, discarded: 1 } },
    });
    expect(new URL(event?.url ?? "https://invalid.local").hostname).toBe("moonarqstudio.com");
  });

  it("rejects overly deep, key-heavy, and oversized embedded payloads before persistence", async () => {
    const source = await createDrainSource("healthy");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const store = getDemoStore();
    const before = {
      rawIngestions: store.rawIngestions.length,
      syncRuns: store.syncRuns.length,
      webEvents: store.webEvents.length,
    };
    const deeplyNestedBody = JSON.stringify({
      ...JSON.parse(RAW_BODY),
      diagnostic: { one: { two: { three: { four: { five: { six: { seven: true } } } } } } },
    });
    const keyHeavyBody = JSON.stringify({
      ...JSON.parse(RAW_BODY),
      queryParams: new URLSearchParams(
        Array.from({ length: 33 }, (_, index) => [`diagnostic_${index}`, String(index)]),
      ).toString(),
    });
    const embeddedOversizeBody = JSON.stringify({
      ...JSON.parse(RAW_BODY),
      eventData: "x".repeat(16 * 1024 + 1),
    });

    const responses = await Promise.all([
      postDrain(source.id, signature(deeplyNestedBody), deeplyNestedBody),
      postDrain(source.id, signature(keyHeavyBody), keyHeavyBody),
      postDrain(source.id, signature(embeddedOversizeBody), embeddedOversizeBody),
    ]);

    expect(responses.map((response) => response.status)).toEqual([413, 413, 413]);
    expect({
      rawIngestions: store.rawIngestions.length,
      syncRuns: store.syncRuns.length,
      webEvents: store.webEvents.length,
    }).toEqual(before);
  });

  it("rejects oversized raw bodies before creating a sync run", async () => {
    const source = await createDrainSource();
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const oversizedBody = JSON.stringify({ eventType: "pageview", payload: "x".repeat(1_000_000) });
    const store = getDemoStore();
    const before = {
      rawIngestions: store.rawIngestions.length,
      syncRuns: store.syncRuns.length,
      webEvents: store.webEvents.length,
    };

    const response = await postDrain(source.id, signature(oversizedBody), oversizedBody);

    expect(response.status).toBe(413);
    expect({
      rawIngestions: store.rawIngestions.length,
      syncRuns: store.syncRuns.length,
      webEvents: store.webEvents.length,
    }).toEqual(before);
  });

  it("rejects signed payloads with invalid analytics event shapes before creating a sync run", async () => {
    const source = await createDrainSource();
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const invalidBody = JSON.stringify([{ eventType: "pageview", timestamp: "not-a-number" }]);
    const before = getDemoStore().syncRuns.length;

    const response = await postDrain(source.id, signature(invalidBody), invalidBody);

    expect(response.status).toBe(400);
    expect(getDemoStore().syncRuns).toHaveLength(before);
  });

  it("routes a valid request through one idempotent webhook sync run", async () => {
    const source = await createDrainSource();
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    const store = getDemoStore();
    const before = {
      webEvents: store.webEvents.length,
      rawIngestions: store.rawIngestions.length,
      connectorEvents: store.connectorEvents.length,
      syncRuns: store.syncRuns.length,
      metrics: store.metricsDaily.length,
    };

    const firstResponse = await postDrain(source.id, signature());
    const first = await firstResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(first).toMatchObject({
      ok: true,
      count: 1,
      run: { trigger: "webhook", status: "success", records_fetched: 1 },
    });
    expect(JSON.stringify(first)).not.toContain("error_stack");
    expect(store.webEvents).toHaveLength(before.webEvents + 1);
    expect(store.rawIngestions).toHaveLength(before.rawIngestions + 1);
    expect(store.connectorEvents).toHaveLength(before.connectorEvents + 1);
    expect(store.syncRuns).toHaveLength(before.syncRuns + 1);

    const countsAfterFirst = {
      webEvents: store.webEvents.length,
      rawIngestions: store.rawIngestions.length,
      connectorEvents: store.connectorEvents.length,
      syncRuns: store.syncRuns.length,
      metrics: store.metricsDaily.length,
    };
    const secondResponse = await postDrain(source.id, signature());
    const second = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(second.run.id).toBe(first.run.id);
    expect({
      webEvents: store.webEvents.length,
      rawIngestions: store.rawIngestions.length,
      connectorEvents: store.connectorEvents.length,
      syncRuns: store.syncRuns.length,
      metrics: store.metricsDaily.length,
    }).toEqual(countsAfterFirst);
  });

  it("does not manufacture session totals from the Vercel Drain payload", async () => {
    const source = await createDrainSource("healthy");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);

    const response = await postDrain(source.id, signature());
    expect(response.status).toBe(200);

    const rows = await listMetrics({
      metricKeys: ["page_views", "unique_visitors", "sessions"],
      startDate: "2026-04-22",
      endDate: "2026-04-22",
    });
    const sourceRows = rows.filter((row) => row.source_id === source.id && row.dimensions.rollup === "daily");
    expect(sourceRows.find((row) => row.metric_key === "page_views")?.metric_value).toBe(1);
    expect(sourceRows.find((row) => row.metric_key === "unique_visitors")?.metric_value).toBe(1);
    expect(sourceRows.find((row) => row.metric_key === "sessions")).toBeUndefined();
  });

  it("does not ingest the same Drain event twice when it is retried in a different batch", async () => {
    const source = await createDrainSource("healthy");
    await saveCredential(source.id, "drain_signature_secret", SIGNATURE_SECRET);
    expect((await postDrain(source.id, signature())).status).toBe(200);

    const original = JSON.parse(RAW_BODY) as Record<string, unknown>;
    const secondBatch = JSON.stringify([
      original,
      {
        ...original,
        timestamp: Date.parse("2026-04-22T12:01:00.000Z"),
        deviceId: "device-two",
        path: "/second-page",
      },
    ]);
    expect((await postDrain(source.id, signature(secondBatch), secondBatch)).status).toBe(200);

    const sourceEvents = (await listWebEvents(100)).filter((event) => event.source_id === source.id);
    const rows = await listMetrics({ metricKeys: ["page_views", "unique_visitors"], startDate: "2026-04-22", endDate: "2026-04-22" });
    const sourceRows = rows.filter((row) => row.source_id === source.id && row.dimensions.rollup === "daily");
    expect(sourceEvents).toHaveLength(2);
    expect(sourceRows.find((row) => row.metric_key === "page_views")?.metric_value).toBe(2);
    expect(sourceRows.find((row) => row.metric_key === "unique_visitors")?.metric_value).toBe(2);
  });
});
