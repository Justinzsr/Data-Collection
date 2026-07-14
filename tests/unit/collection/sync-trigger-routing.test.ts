import { beforeEach, describe, expect, it } from "vitest";
import { getConnector } from "@/collection/connectors/registry";
import { enqueueSyncRun, runDueSources } from "@/collection/sync/engine";
import { acquireSourceLock, releaseSourceLock } from "@/collection/sync/locks";
import { POST as syncSourceRoute } from "@/app/api/sources/[id]/sync/route";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";

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

  it("skips connectors whose required credentials have not been saved", async () => {
    const store = getDemoStore();
    const rawBefore = store.rawIngestions.length;
    const run = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.instagram, trigger: "manual" });

    expect(run.status).toBe("skipped");
    expect(run.error_message).toContain("required credentials");
    expect(store.rawIngestions).toHaveLength(rawBefore);
  });

  it("does not mark a source healthy when its connector skips the sync", async () => {
    const store = getDemoStore();
    const source = store.sources.find((item) => item.id === DEMO_SOURCE_IDS.website);
    if (!source) throw new Error("Missing website source");
    source.status = "warning";

    const connector = getConnector("website");
    const originalSync = connector.sync;
    connector.sync = async () => ({
      rawPayloads: [],
      recordsFetched: 0,
      skippedReason: "Waiting for webhook delivery.",
      message: "Waiting for webhook delivery.",
    });

    try {
      const run = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });
      expect(run).toMatchObject({
        status: "skipped",
        error_message: "Waiting for webhook delivery.",
      });
      expect(source.status).toBe("warning");
    } finally {
      connector.sync = originalSync;
    }
  });

  it("keeps cron sync idempotent within the current hour", async () => {
    const first = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.supabase, trigger: "cron" });
    const store = getDemoStore();
    const countsAfterFirst = {
      runs: store.syncRuns.length,
      raw: store.rawIngestions.length,
      metrics: store.metricsDaily.length,
    };
    const second = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.supabase, trigger: "cron" });

    expect(first.idempotency_key).toContain(`${DEMO_SOURCE_IDS.supabase}:cron:`);
    expect(second.id).toBe(first.id);
    expect(store.syncRuns.filter((run) => run.idempotency_key === first.idempotency_key)).toHaveLength(1);
    expect({
      runs: store.syncRuns.length,
      raw: store.rawIngestions.length,
      metrics: store.metricsDaily.length,
    }).toEqual(countsAfterFirst);
  });

  it("cron only syncs due enabled sources", async () => {
    const runs = await runDueSources("cron");
    expect(runs.every((run) => run.trigger === "cron")).toBe(true);
    expect(runs.every((run) => run.source_type_key !== "shopify")).toBe(true);
  });

  it("reports unique content inserts separately from metric upserts", async () => {
    const connector = getConnector("website");
    const originalSync = connector.sync;
    const originalNormalize = connector.normalize;
    let sequence = 0;
    connector.sync = async () => {
      sequence += 1;
      return {
        rawPayloads: [{
          externalId: `count-test-${sequence}`,
          fetchedAt: `2026-07-14T18:0${sequence}:00.000Z`,
          payload: { sequence },
        }],
        recordsFetched: 1,
        message: "Count test sync completed.",
      };
    };
    connector.normalize = async () => ({
      metrics: [],
      contentMetrics: [
        {
          date: "2026-07-14",
          sourceId: DEMO_SOURCE_IDS.website,
          sourceTypeKey: "website",
          externalContentId: "count-test-item",
          contentType: "page",
          title: "Count test",
          metricKey: "page_views",
          metricValue: 10 + sequence,
          unit: "count",
        },
        {
          date: "2026-07-14",
          sourceId: DEMO_SOURCE_IDS.website,
          sourceTypeKey: "website",
          externalContentId: "count-test-item",
          contentType: "page",
          title: "Count test",
          metricKey: "unique_visitors",
          metricValue: 5 + sequence,
          unit: "count",
        },
      ],
    });

    try {
      const first = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.website, trigger: "manual" });
      const second = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.website, trigger: "manual" });

      expect(first).toMatchObject({ records_inserted: 2, records_updated: 0, metrics_upserted: 2 });
      expect(second).toMatchObject({ records_inserted: 1, records_updated: 1, metrics_upserted: 2 });
    } finally {
      connector.sync = originalSync;
      connector.normalize = originalNormalize;
    }
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
