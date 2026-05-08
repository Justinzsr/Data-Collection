import { beforeEach, describe, expect, it } from "vitest";
import { enqueueSyncRun, runDueSources } from "@/collection/sync/engine";
import { acquireSourceLock, releaseSourceLock } from "@/collection/sync/locks";
import { POST as syncSourceRoute } from "@/app/api/sources/[id]/sync/route";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";
import { resetDemoStore } from "@/storage/repositories/demo-store";

describe("sync engine", () => {
  beforeEach(() => resetDemoStore());

  it("manual sync creates a sync_run", async () => {
    const run = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.website, trigger: "manual" });
    expect(run.trigger).toBe("manual");
    expect(["success", "skipped"]).toContain(run.status);
  });

  it("manual syncs do not share an hourly idempotency key", async () => {
    const first = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.supabase, trigger: "manual" });
    const second = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.supabase, trigger: "manual" });
    expect(first.id).not.toBe(second.id);
    expect(first.idempotency_key).toBeNull();
    expect(second.idempotency_key).toBeNull();
  });

  it("keeps cron sync idempotent within the current hour", async () => {
    const run = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.supabase, trigger: "cron" });
    expect(run.idempotency_key).toContain(`${DEMO_SOURCE_IDS.supabase}:cron:`);
  });

  it("cron only syncs due enabled sources", async () => {
    const runs = await runDueSources("cron");
    expect(runs.every((run) => run.trigger === "cron")).toBe(true);
    expect(runs.every((run) => run.source_type_key !== "shopify")).toBe(true);
  });

  it("source lock prevents concurrent syncs", async () => {
    const first = await acquireSourceLock(DEMO_SOURCE_IDS.website, "run-one", 60_000);
    const second = await acquireSourceLock(DEMO_SOURCE_IDS.website, "run-two", 60_000);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await releaseSourceLock(DEMO_SOURCE_IDS.website, "run-one");
  });

  it("manual sync API returns a structured sanitized error response", async () => {
    const response = await syncSourceRoute(
      new Request("https://app.example.com/api/sources/missing/sync", { method: "POST" }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      ok: false,
      error: "Source not found.",
    });
    expect(JSON.stringify(body)).not.toContain("service_role");
    expect(JSON.stringify(body)).not.toContain("error_stack");
  });

  it("manual sync API returns structured success data for the toast and refresh path", async () => {
    const response = await syncSourceRoute(
      new Request(`https://app.example.com/api/sources/${DEMO_SOURCE_IDS.supabase}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id: DEMO_SOURCE_IDS.supabase }) },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      error: null,
      run: {
        source_id: DEMO_SOURCE_IDS.supabase,
        trigger: "manual",
        status: "success",
      },
    });
    expect(body.run.records_fetched).toBeGreaterThan(0);
  });
});
