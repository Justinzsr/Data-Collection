import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdsAutoSync } from "@/presentation/overview/ads-auto-sync";

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

const MINUTE = 60_000;

let root: Root | null;
let container: HTMLDivElement;
let visibilityState: DocumentVisibilityState;
let refresh: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function runResponse(status: number, runStatus: "success" | "error" | "skipped") {
  return jsonResponse(status, { ok: runStatus === "success", run: { status: runStatus } });
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * MINUTE).toISOString();
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

async function mount(sourceId: string, lastSyncedAt: string | null) {
  const router = { refresh } as unknown as AppRouterInstance;
  await act(async () => {
    root?.render(
      <AppRouterContext.Provider value={router}>
        <AdsAutoSync sourceId={sourceId} dataSpaceSlug="moonarq" lastSyncedAt={lastSyncedAt} maxAgeMinutes={15} />
      </AppRouterContext.Provider>,
    );
    await flushMicrotasks();
  });
}

async function unmount() {
  await act(async () => {
    root?.unmount();
    await flushMicrotasks();
  });
  root = null;
}

beforeEach(() => {
  (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = true;
  visibilityState = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  });
  refresh = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await unmount();
  container.remove();
  Reflect.deleteProperty(document, "visibilityState");
  delete (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT;
  vi.restoreAllMocks();
});

// Each test uses its own source id: attempts are remembered per source for the life of the tab.
describe("AdsAutoSync", () => {
  it("asks the manual sync route to sync stale delivery, then re-reads the page", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    await mount("meta-stale", minutesAgo(20));
    expect(fetchMock).toHaveBeenCalledOnce();
    // The server only syncs when the source is still older than the allowed age.
    expect(fetchMock).toHaveBeenCalledWith("/api/sources/meta-stale/sync?dataSpaceSlug=moonarq&minAgeMinutes=15", { method: "POST" });
    expect(container.querySelector("[role='status']")?.textContent).toContain("Getting the latest delivery from Meta");

    await act(async () => {
      finish(runResponse(200, "success"));
      await flushMicrotasks();
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("");
  });

  it("leaves recently synced delivery alone", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await mount("meta-fresh", minutesAgo(5));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("waits until a hidden tab is visible", async () => {
    visibilityState = "hidden";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(runResponse(200, "success"));
    await mount("meta-hidden", minutesAgo(20));
    expect(fetchMock).not.toHaveBeenCalled();

    visibilityState = "visible";
    await act(async () => {
      document.dispatchEvent(new window.Event("visibilitychange"));
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("re-reads the page when another sync already refreshed the source", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, {
      ok: true,
      fresh: true,
      run: null,
      last_success_at: minutesAgo(2),
      retry_after_ms: 13 * MINUTE,
      error: null,
    }));
    await mount("meta-refreshed-elsewhere", minutesAgo(20));
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("");
  });

  it("does not re-read the page when the server has nothing newer, and waits for the server's retry time", async () => {
    // A browser clock running ahead of the server sees the data as stale early.
    const shown = minutesAgo(16);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, {
      ok: true,
      fresh: true,
      run: null,
      last_success_at: shown,
      retry_after_ms: 4 * MINUTE,
      error: null,
    }));
    await mount("meta-skewed-clock", shown);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();

    await unmount();
    root = createRoot(container);
    await mount("meta-skewed-clock", shown);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("waits quietly while another sync is running", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { ok: true, in_progress: true, run: null, error: null }));
    await mount("meta-in-progress", minutesAgo(20));
    expect(refresh).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("treats a run skipped by the source lock as another sync in progress", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(runResponse(409, "skipped"));
    await mount("meta-locked", minutesAgo(20));
    expect(refresh).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");

    // It checks again on a later tick, not on every navigation.
    await unmount();
    root = createRoot(container);
    await mount("meta-locked", minutesAgo(20));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("re-reads the page after a failed run so the sync error shows", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(runResponse(500, "error"));
    await mount("meta-error", minutesAgo(20));
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("");
  });

  it("explains an unfinished update and does not retry it on the next visit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await mount("meta-offline", minutesAgo(20));
    expect(container.textContent).toContain("The live update didn't finish, so these are the last synced numbers.");
    expect(refresh).not.toHaveBeenCalled();

    await unmount();
    root = createRoot(container);
    await mount("meta-offline", minutesAgo(20));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
