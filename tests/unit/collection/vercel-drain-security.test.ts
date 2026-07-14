import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as postVercelDrain } from "@/app/api/webhooks/vercel/analytics-drain/[sourceId]/route";
import { vercelWebAnalyticsDrainConnector } from "@/collection/connectors/vercel-web-analytics-drain/connector";
import type { SourceStatus } from "@/storage/db/schema";
import { saveCredential } from "@/storage/repositories/credentials-repository";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { listWebEvents } from "@/storage/repositories/events-repository";
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
});
