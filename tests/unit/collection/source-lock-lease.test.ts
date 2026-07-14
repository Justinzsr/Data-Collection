import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConnector } from "@/collection/connectors/registry";
import type { SyncResult } from "@/collection/connectors/types";
import { enqueueSyncRun } from "@/collection/sync/engine";
import {
  acquireSourceLock,
  releaseSourceLock,
  renewSourceLock,
  SOURCE_LOCK_LEASE_MS,
  SOURCE_LOCK_RENEW_INTERVAL_MS,
} from "@/collection/sync/locks";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

describe("source lock lease renewal", () => {
  beforeEach(() => resetDemoStore());

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("extends an active lease only for its exact owner and lock key", async () => {
    vi.useFakeTimers();
    const acquiredAt = new Date("2026-07-14T12:00:00.000Z");
    vi.setSystemTime(acquiredAt);

    const lock = await acquireSourceLock(DEMO_SOURCE_IDS.website, "run-one");
    expect(lock).not.toBeNull();
    if (!lock) throw new Error("Expected the source lock to be acquired.");
    const originalExpiry = new Date(lock.expires_at).getTime();

    vi.advanceTimersByTime(2 * 60_000);
    await expect(
      renewSourceLock(DEMO_SOURCE_IDS.website, "run-one", "stale-lock-key"),
    ).resolves.toBeNull();

    const renewed = await renewSourceLock(DEMO_SOURCE_IDS.website, "run-one", lock.lock_key);
    expect(renewed).not.toBeNull();
    expect(new Date(renewed?.expires_at ?? 0).getTime()).toBe(acquiredAt.getTime() + 2 * 60_000 + SOURCE_LOCK_LEASE_MS);

    vi.setSystemTime(new Date(originalExpiry + 1));
    await expect(
      acquireSourceLock(DEMO_SOURCE_IDS.website, "run-two"),
    ).resolves.toBeNull();

    await releaseSourceLock(DEMO_SOURCE_IDS.website, "run-one", lock.lock_key);
  });

  it("renews a long-running engine sync and clears the heartbeat before release", async () => {
    let heartbeat: (() => void) | undefined;
    const timerHandle = 42 as unknown as ReturnType<typeof setInterval>;
    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(((handler: () => void) => {
        heartbeat = handler;
        return timerHandle;
      }) as typeof setInterval);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    let finishSync: ((result: SyncResult) => void) | undefined;
    const connector = getConnector("website");
    vi.spyOn(connector, "sync").mockImplementation(
      () =>
        new Promise<SyncResult>((resolve) => {
          finishSync = resolve;
        }),
    );

    const runPromise = enqueueSyncRun({ sourceId: DEMO_SOURCE_IDS.website, trigger: "manual" });
    await vi.waitFor(() => {
      expect(heartbeat).toBeTypeOf("function");
      expect(finishSync).toBeTypeOf("function");
      expect(getDemoStore().sourceLocks).toHaveLength(1);
    });

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), SOURCE_LOCK_RENEW_INTERVAL_MS);
    const heldLock = getDemoStore().sourceLocks[0];
    heldLock.expires_at = new Date(Date.now() + 10_000).toISOString();

    heartbeat?.();
    await vi.waitFor(() => {
      expect(new Date(heldLock.expires_at).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    });
    await expect(
      acquireSourceLock(DEMO_SOURCE_IDS.website, "competing-run"),
    ).resolves.toBeNull();

    finishSync?.({
      rawPayloads: [],
      recordsFetched: 0,
      message: "Lease renewal test completed.",
    });
    const run = await runPromise;

    expect(run.status).toBe("success");
    expect(clearIntervalSpy).toHaveBeenCalledWith(timerHandle);
    expect(getDemoStore().sourceLocks).toHaveLength(0);
  });
});
