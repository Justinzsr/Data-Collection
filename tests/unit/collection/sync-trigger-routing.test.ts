import { beforeEach, describe, expect, it } from "vitest";
import { enqueueSyncRun, runDueSources } from "@/collection/sync/engine";
import { acquireSourceLock, releaseSourceLock } from "@/collection/sync/locks";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";
import { resetDemoStore } from "@/storage/repositories/demo-store";

describe("sync engine", () => {
  beforeEach(() => resetDemoStore());

  it("manual sync creates a sync_run", async () => {
    const run = await enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.website, trigger: "manual" });
    expect(run.trigger).toBe("manual");
    expect(["success", "skipped"]).toContain(run.status);
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
});
