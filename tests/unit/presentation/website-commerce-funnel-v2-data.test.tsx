import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getWebsiteCommerceFunnelV2Snapshot } from "@/aggregation/services/website-commerce-funnel-v2-service";
import type { WebsiteCommerceFunnelV2Snapshot } from "@/aggregation/services/website-commerce-funnel-v2-types";
import {
  INITIAL_WEBSITE_COMMERCE_FUNNEL_V2_STATE,
  WEBSITE_COMMERCE_FUNNEL_V2_REFRESH_INTERVAL_MS,
  reduceWebsiteCommerceFunnelV2LoadState,
  useWebsiteCommerceFunnelV2Data,
} from "@/presentation/dashboard/use-website-commerce-funnel-v2-data";

type HookState = ReturnType<typeof useWebsiteCommerceFunnelV2Data>;

let snapshot: WebsiteCommerceFunnelV2Snapshot;
let root: Root | null;
let container: HTMLDivElement;
let captured: { current: HookState | null };
let visibilityState: DocumentVisibilityState;

beforeAll(async () => {
  snapshot = await getWebsiteCommerceFunnelV2Snapshot(
    { dataSpaceId: "data-space-moonarq" },
    { env: { NODE_ENV: "test" }, now: new Date("2026-08-07T18:00:00.000Z") },
  );
});

function Harness() {
  const state = useWebsiteCommerceFunnelV2Data({
    dataSpaceSlug: "moonarq",
    range: "30d",
    segment: "all",
  });
  useEffect(() => {
    captured.current = state;
  }, [state]);
  return null;
}

function currentState() {
  if (!captured.current) throw new Error("V2 hook state was not captured.");
  return captured.current;
}

function response(status: number, body: unknown) {
  const json = vi.fn(async () => body);
  return {
    value: { status, ok: status >= 200 && status < 300, json } as unknown as Response,
    json,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  visibilityState = "visible";
  captured = { current: null };
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  root = null;
  container.remove();
  Reflect.deleteProperty(document, "visibilityState");
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Website commerce funnel V2 refresh state", () => {
  it("uses a one-minute visible-page cadence and retains only transient stale snapshots", () => {
    expect(WEBSITE_COMMERCE_FUNNEL_V2_REFRESH_INTERVAL_MS).toBe(60_000);
    const loaded = reduceWebsiteCommerceFunnelV2LoadState(
      INITIAL_WEBSITE_COMMERCE_FUNNEL_V2_STATE,
      { type: "success", snapshot },
    );
    const transient = reduceWebsiteCommerceFunnelV2LoadState(loaded, {
      type: "transientFailure",
      error: "Temporary failure.",
    });
    const fatal = reduceWebsiteCommerceFunnelV2LoadState(loaded, {
      type: "fatalFailure",
      error: "Unsafe response.",
    });
    const locked = reduceWebsiteCommerceFunnelV2LoadState(loaded, { type: "authFailure" });

    expect(transient).toMatchObject({ snapshot, isStale: true, error: "Temporary failure." });
    expect(fatal).toMatchObject({ snapshot: null, isStale: false, error: "Unsafe response." });
    expect(locked).toMatchObject({ snapshot: null, isStale: false, isAuthLocked: true });
  });

  it("pauses interval polling while hidden and refreshes immediately on visibility", async () => {
    const success = response(200, { snapshot });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(success.value);
    await act(async () => {
      root?.render(<Harness />);
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    visibilityState = "hidden";
    await act(async () => {
      vi.advanceTimersByTime(WEBSITE_COMMERCE_FUNNEL_V2_REFRESH_INTERVAL_MS);
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    visibilityState = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])("clears the snapshot and locks without parsing an HTTP %s body", async (status) => {
    const success = response(200, { snapshot });
    const authFailure = response(status, {
      event_id: "do-not-parse",
      email: "do-not-parse@example.com",
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(success.value)
      .mockResolvedValueOnce(authFailure.value);
    await act(async () => {
      root?.render(<Harness />);
      await flush();
    });
    expect(currentState().snapshot).toEqual(snapshot);

    await act(async () => {
      await currentState().refresh();
      await flush();
    });
    expect(currentState()).toMatchObject({ snapshot: null, isAuthLocked: true, isStale: false });
    expect(authFailure.json).not.toHaveBeenCalled();
  });
});
