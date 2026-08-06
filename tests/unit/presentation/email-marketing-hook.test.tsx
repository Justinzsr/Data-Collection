import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMarketingSnapshot } from "@/aggregation/services/email-marketing-service";
import {
  EMAIL_MARKETING_REFRESH_INTERVAL_MS,
  useEmailMarketingData,
} from "@/presentation/email-marketing/use-email-marketing-data";

const protectedEmail = "hook-person@example.com";
const protectedShopifyId = "gid://shopify/Customer/hook-101";
const snapshot: EmailMarketingSnapshot = {
  rows: [
    {
      id: "hook-signup",
      email: protectedEmail,
      email_normalized: protectedEmail,
      source: "synthetic-test",
      discount_code: "EXAMPLE",
      consent_email_marketing: true,
      page_url: "https://store.example.com/newsletter",
      referrer: "https://referrer.example.com/",
      utm_source: "example",
      utm_medium: "test",
      utm_campaign: "hook-state",
      promo_email_sent: true,
      zapier_sent_at: "2026-07-18T17:02:00.000Z",
      shopify_customer_id: protectedShopifyId,
      created_at: "2026-07-18T17:00:00.000Z",
      updated_at: "2026-07-18T17:02:00.000Z",
    },
  ],
  kpis: {
    totalSignups: 1,
    consentedSignups: 1,
    promoEmailsSent: 1,
    pendingPromoEmails: 0,
    promoEmailSendRate: 100,
    shopifyLinkedCustomers: 1,
    signupsLast24Hours: 1,
    signupsLast7Days: 1,
  },
  fetchedAt: "2026-07-18T18:00:00.000Z",
  source: {
    project: "moonarq-web",
    schema: "public",
    table: "email_signups",
    connection: "direct_supabase",
  },
};

type HookState = ReturnType<typeof useEmailMarketingData>;

let root: Root | null;
let container: HTMLDivElement;
let stateCapture: { current: HookState | null };
let visibilityState: DocumentVisibilityState;

function HookHarness() {
  const state = useEmailMarketingData("moonarq");
  useEffect(() => {
    stateCapture.current = state;
  }, [state]);
  return null;
}

function currentState() {
  if (!stateCapture.current) throw new Error("Email marketing hook state was not captured.");
  return stateCapture.current;
}

function stubResponse(status: number, body: unknown) {
  const json = vi.fn(async () => body);
  return {
    response: {
      status,
      ok: status >= 200 && status < 300,
      json,
    } as unknown as Response,
    json,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mountHook() {
  await act(async () => {
    root?.render(<HookHarness />);
    await flushMicrotasks();
  });
}

async function refreshHook() {
  await act(async () => {
    await currentState().refresh();
    await flushMicrotasks();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  visibilityState = "visible";
  stateCapture = { current: null };
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
      await flushMicrotasks();
    });
  }
  root = null;
  container.remove();
  Reflect.deleteProperty(document, "visibilityState");
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useEmailMarketingData", () => {
  it("pauses interval polling while hidden and refreshes immediately when visible", async () => {
    const successful = stubResponse(200, { snapshot });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => successful.response);
    await mountHook();
    expect(fetchMock).toHaveBeenCalledOnce();

    visibilityState = "hidden";
    await act(async () => {
      vi.advanceTimersByTime(EMAIL_MARKETING_REFRESH_INTERVAL_MS);
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    visibilityState = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates manual, interval, and visibility refreshes while one request is active", async () => {
    let resolveRequest!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => pendingResponse);
    await mountHook();
    expect(fetchMock).toHaveBeenCalledOnce();

    let firstRefresh!: Promise<void>;
    let secondRefresh!: Promise<void>;
    await act(async () => {
      firstRefresh = currentState().refresh();
      secondRefresh = currentState().refresh();
      vi.advanceTimersByTime(EMAIL_MARKETING_REFRESH_INTERVAL_MS);
      document.dispatchEvent(new Event("visibilitychange"));
      await flushMicrotasks();
    });

    expect(firstRefresh).toBe(secondRefresh);
    expect(fetchMock).toHaveBeenCalledOnce();

    resolveRequest(stubResponse(200, { snapshot }).response);
    await act(async () => {
      await firstRefresh;
      await flushMicrotasks();
    });
    expect(currentState().snapshot).toEqual(snapshot);
  });

  it("aborts the active request and removes interval and visibility cleanup on unmount", async () => {
    let requestSignal: AbortSignal | undefined;
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const addListenerSpy = vi.spyOn(document, "addEventListener");
    const removeListenerSpy = vi.spyOn(document, "removeEventListener");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    await mountHook();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(false);

    const visibilityListener = addListenerSpy.mock.calls.find(([type]) => type === "visibilitychange")?.[1];
    expect(visibilityListener).toBeTypeOf("function");
    await act(async () => {
      root?.unmount();
      await flushMicrotasks();
    });
    root = null;

    expect(requestSignal?.aborted).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalledOnce();
    expect(removeListenerSpy).toHaveBeenCalledWith("visibilitychange", visibilityListener);

    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(EMAIL_MARKETING_REFRESH_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([401, 403])("clears protected data and locks after HTTP %s without parsing its body", async (status) => {
    const success = stubResponse(200, { snapshot });
    const authFailure = stubResponse(status, {
      error: "do-not-render-this-body@example.com",
      shopify_customer_id: "gid://shopify/Customer/do-not-render",
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(success.response)
      .mockResolvedValueOnce(authFailure.response);

    await mountHook();
    expect(currentState().snapshot?.rows[0]?.email).toBe(protectedEmail);
    await refreshHook();

    expect(currentState()).toMatchObject({
      snapshot: null,
      isStale: false,
      isAuthLocked: true,
      error: null,
    });
    expect(authFailure.json).not.toHaveBeenCalled();
    await refreshHook();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([408, 500])(
    "retains the last snapshot as stale after an HTTP %s without parsing its body",
    async (status) => {
      const success = stubResponse(200, { snapshot });
      const serverFailure = stubResponse(status, { error: "do-not-render-server-body@example.com" });
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(success.response)
        .mockResolvedValueOnce(serverFailure.response);

      await mountHook();
      await refreshHook();

      expect(currentState().snapshot).toEqual(snapshot);
      expect(currentState()).toMatchObject({ isStale: true, isAuthLocked: false });
      expect(serverFailure.json).not.toHaveBeenCalled();
    },
  );

  it("retains the last snapshot as stale after a network failure", async () => {
    const success = stubResponse(200, { snapshot });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(success.response)
      .mockRejectedValueOnce(new TypeError("Synthetic network failure"));

    await mountHook();
    await refreshHook();

    expect(currentState().snapshot).toEqual(snapshot);
    expect(currentState()).toMatchObject({ isStale: true, isAuthLocked: false });
  });

  it("clears the last snapshot for a non-transient non-auth response", async () => {
    const success = stubResponse(200, { snapshot });
    const conflict = stubResponse(409, { error: "do-not-render-conflict-body@example.com" });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(success.response)
      .mockResolvedValueOnce(conflict.response);

    await mountHook();
    await refreshHook();

    expect(currentState()).toMatchObject({
      snapshot: null,
      isStale: false,
      isAuthLocked: false,
    });
    expect(conflict.json).not.toHaveBeenCalled();
  });
});
