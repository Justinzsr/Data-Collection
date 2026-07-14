import { beforeEach, describe, expect, it } from "vitest";
import { POST as createSourceRoute } from "@/app/api/sources/route";
import { POST as syncSourceRoute } from "@/app/api/sources/[id]/sync/route";
import { POST as testSourceRoute } from "@/app/api/sources/[id]/test/route";
import { getConnector } from "@/collection/connectors/registry";
import { enqueueSyncRun } from "@/collection/sync/engine";
import { instagramNormalizer } from "@/aggregation/normalizers/instagram-normalizer";
import { instagramConnector } from "@/collection/connectors/instagram/connector";
import type { Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

const XIAOHONGSHU_SOURCE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function addPlannedXiaohongshuSource(): Source {
  const store = getDemoStore();
  const website = store.sources.find((source) => source.id === DEMO_SOURCE_IDS.website);
  if (!website) throw new Error("Demo website source missing.");
  const source: Source = {
    ...website,
    id: XIAOHONGSHU_SOURCE_ID,
    source_type_key: "xiaohongshu",
    display_name: "小红书 / Xiaohongshu placeholder",
    input_url: "https://www.xiaohongshu.com/user/profile/example",
    normalized_url: "https://www.xiaohongshu.com/user/profile/example",
    account_name: null,
    status: "demo",
    sync_mode: "manual",
    supports_webhook: false,
    webhook_url: null,
    last_success_at: null,
    next_sync_at: null,
    metadata: { planned: true },
  };
  store.sources.push(source);
  return source;
}

describe("planned connector safety", () => {
  beforeEach(() => resetDemoStore());

  it("rejects source creation for Xiaohongshu without saving a source", async () => {
    const before = getDemoStore().sources.length;
    const response = await createSourceRoute(
      new Request("https://app.example.com/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_type_key: "xiaohongshu",
          display_name: "MoonArq Xiaohongshu",
          input_url: "https://www.xiaohongshu.com/user/profile/example",
          sync_mode: "manual",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "connector_planned" });
    expect(getDemoStore().sources).toHaveLength(before);
    expect(getDemoStore().sources.some((source) => source.source_type_key === "xiaohongshu")).toBe(false);
  });

  it("returns unsupported directly and never normalizes fake metrics", async () => {
    const source = addPlannedXiaohongshuSource();
    const connector = getConnector("xiaohongshu");
    const result = await connector.testConnection({ source, credentials: {}, isDemoMode: true });

    expect(result).toMatchObject({ ok: false, status: "unsupported" });
    await expect(connector.sync({ source, credentials: {}, isDemoMode: true, trigger: "manual" })).rejects.toThrow("cannot sync data");
    await expect(connector.normalize([], source)).resolves.toEqual({ metrics: [] });
  });

  it("keeps every future connector planned and credential-free", () => {
    for (const key of ["vercel_project", "shopify", "custom_api", "custom_csv"] as const) {
      const connector = getConnector(key);
      expect(connector.availability).toBe("planned");
      expect(connector.requiredFields).toEqual([]);
      expect(connector.optionalFields).toEqual([]);
      expect(connector.capabilities).toMatchObject({
        supportsWebhook: false,
        supportsPolling: false,
        supportsManualSync: false,
        canTestConnection: false,
      });
    }
  });

  it("points the Instagram normalizer facade at the live connector", () => {
    expect(instagramNormalizer).toBe(instagramConnector);
    expect(instagramNormalizer.availability).toBe("live");
  });

  it("rejects planned test and sync routes before a sync run is created", async () => {
    addPlannedXiaohongshuSource();
    const beforeRuns = getDemoStore().syncRuns.length;
    const testResponse = await testSourceRoute(
      new Request(`https://app.example.com/api/sources/${XIAOHONGSHU_SOURCE_ID}/test`, { method: "POST" }),
      { params: Promise.resolve({ id: XIAOHONGSHU_SOURCE_ID }) },
    );
    const syncResponse = await syncSourceRoute(
      new Request(`https://app.example.com/api/sources/${XIAOHONGSHU_SOURCE_ID}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id: XIAOHONGSHU_SOURCE_ID }) },
    );

    expect(testResponse.status).toBe(409);
    expect(syncResponse.status).toBe(409);
    expect(getDemoStore().syncRuns).toHaveLength(beforeRuns);
  });

  it("shared sync engine skips planned sources without raw or metric writes", async () => {
    const source = addPlannedXiaohongshuSource();
    const store = getDemoStore();
    const rawBefore = store.rawIngestions.length;
    const metricsBefore = store.metricsDaily.length;
    const run = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });

    expect(run.status).toBe("skipped");
    expect(run.error_message).toContain("planned");
    expect(store.rawIngestions).toHaveLength(rawBefore);
    expect(store.metricsDaily).toHaveLength(metricsBefore);
    expect(store.sources.find((item) => item.id === source.id)?.status).toBe("demo");
  });

  it("rejects disabled live sources in test and sync routes", async () => {
    const website = getDemoStore().sources.find((source) => source.id === DEMO_SOURCE_IDS.website);
    if (!website) throw new Error("Demo website source missing.");
    website.status = "disabled";
    const testResponse = await testSourceRoute(
      new Request(`https://app.example.com/api/sources/${website.id}/test`, { method: "POST" }),
      { params: Promise.resolve({ id: website.id }) },
    );
    const syncResponse = await syncSourceRoute(
      new Request(`https://app.example.com/api/sources/${website.id}/sync`, { method: "POST" }),
      { params: Promise.resolve({ id: website.id }) },
    );

    expect(testResponse.status).toBe(409);
    expect(syncResponse.status).toBe(409);
  });
});
