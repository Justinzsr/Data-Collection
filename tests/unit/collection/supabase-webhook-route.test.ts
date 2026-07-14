import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/supabase/[sourceId]/route";
import { saveCredential } from "@/storage/repositories/credentials-repository";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

const secret = "test-supabase-webhook-secret";
const payload = {
  type: "INSERT",
  table: "profiles",
  record: {
    id: "profile-from-webhook",
    created_at: "2026-04-18T08:00:00.000Z",
    confirmed_at: "2026-04-18T08:03:00.000Z",
    provider: "github",
  },
};

function request(headers: Record<string, string> = {}) {
  return new Request(`http://localhost:4000/api/webhooks/supabase/${DEMO_SOURCE_IDS.supabase}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

function context(sourceId: string = DEMO_SOURCE_IDS.supabase) {
  return { params: Promise.resolve({ sourceId }) };
}

describe("Supabase webhook route", () => {
  beforeEach(() => resetDemoStore());

  it("fails closed until the per-source signing secret is configured", async () => {
    const response = await POST(request({ "x-moonarq-webhook-secret": secret }), context());
    expect(response.status).toBe(503);
  });

  it("rejects invalid signatures without recording the payload", async () => {
    await saveCredential(DEMO_SOURCE_IDS.supabase, "webhook_secret", secret);
    const before = getDemoStore().rawIngestions.length;
    const response = await POST(request({ "x-moonarq-webhook-secret": "wrong" }), context());
    expect(response.status).toBe(401);
    expect(getDemoStore().rawIngestions).toHaveLength(before);
  });

  it("rejects authenticated payloads that are not public.profiles inserts", async () => {
    await saveCredential(DEMO_SOURCE_IDS.supabase, "webhook_secret", secret);
    const before = getDemoStore().rawIngestions.length;
    const response = await POST(
      new Request(`http://localhost:4000/api/webhooks/supabase/${DEMO_SOURCE_IDS.supabase}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-moonarq-webhook-secret": secret },
        body: JSON.stringify({ type: "DELETE", table: "profiles", old_record: { id: "profile" } }),
      }),
      context(),
    );

    expect(response.status).toBe(422);
    expect(getDemoStore().rawIngestions).toHaveLength(before);
  });

  it("authenticates, stores, normalizes, and deduplicates webhook payloads", async () => {
    await saveCredential(DEMO_SOURCE_IDS.supabase, "webhook_secret", secret);
    const before = getDemoStore().rawIngestions.length;

    const firstResponse = await POST(request({ authorization: `Bearer ${secret}` }), context());
    const first = await firstResponse.json();
    expect(firstResponse.status).toBe(200);
    expect(first.run).toMatchObject({ trigger: "webhook", status: "success", records_fetched: 1 });
    expect(JSON.stringify(first)).not.toContain("error_stack");
    expect(getDemoStore().rawIngestions).toHaveLength(before + 1);
    expect(getDemoStore().rawIngestions.at(-1)?.payload).toEqual(payload);
    expect(
      getDemoStore().metricsDaily.some(
        (metric) => metric.source_id === DEMO_SOURCE_IDS.supabase && metric.metric_key === "signups" && metric.date === "2026-04-18",
      ),
    ).toBe(true);

    const secondResponse = await POST(request({ "x-moonarq-webhook-secret": secret }), context());
    const second = await secondResponse.json();
    expect(secondResponse.status).toBe(200);
    expect(second.run.id).toBe(first.run.id);
    expect(getDemoStore().rawIngestions).toHaveLength(before + 1);
  });

  it("does not accept a non-Supabase source id", async () => {
    const response = await POST(request({ "x-moonarq-webhook-secret": secret }), context(DEMO_SOURCE_IDS.website));
    expect(response.status).toBe(404);
  });
});
