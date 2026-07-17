import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTrackingSnippet } from "@/collection/tracking/snippet-generator";

type TrackingWindow = Window & typeof globalThis & {
  moonarqConsent?: { analytics?: "granted" | "denied" | "unknown"; marketing?: "granted" | "denied" | "unknown" };
  moonarqTrack?: (eventName: string, properties?: Record<string, unknown>) => void;
};

const snippet = generateTrackingSnippet({
  endpoint: "https://app.example.com/api/track",
  publicTrackingKey: "mq_public",
  sourceId: "11111111-1111-4111-8111-111111111111",
}).replace(/^<script>\s*/u, "").replace(/\s*<\/script>$/u, "");

describe("generated tracking snippet consent gating", () => {
  const trackingWindow = window as TrackingWindow;
  let consentDescriptor: PropertyDescriptor | undefined;
  let navigatorDntDescriptor: PropertyDescriptor | undefined;
  let windowDntDescriptor: PropertyDescriptor | undefined;
  let originalPath = "/";

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    consentDescriptor = Object.getOwnPropertyDescriptor(trackingWindow, "moonarqConsent");
    navigatorDntDescriptor = Object.getOwnPropertyDescriptor(navigator, "doNotTrack");
    windowDntDescriptor = Object.getOwnPropertyDescriptor(trackingWindow, "doNotTrack");
    originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  });

  afterEach(() => {
    if (consentDescriptor) Object.defineProperty(trackingWindow, "moonarqConsent", consentDescriptor);
    else Reflect.deleteProperty(trackingWindow, "moonarqConsent");
    if (navigatorDntDescriptor) Object.defineProperty(navigator, "doNotTrack", navigatorDntDescriptor);
    else Reflect.deleteProperty(navigator, "doNotTrack");
    if (windowDntDescriptor) Object.defineProperty(trackingWindow, "doNotTrack", windowDntDescriptor);
    else Reflect.deleteProperty(trackingWindow, "doNotTrack");
    Reflect.deleteProperty(trackingWindow, "moonarqTrack");
    history.replaceState(null, "", originalPath);
    vi.restoreAllMocks();
  });

  it.each([
    ["explicit analytics denial", { analytics: "denied" as const }, "0"],
    ["Do Not Track", undefined, "1"],
    ["Do Not Track over an explicit grant", { analytics: "granted" as const }, "1"],
  ])("checks %s before reading or writing browser storage", (_label, consent, doNotTrack) => {
    Object.defineProperty(trackingWindow, "moonarqConsent", { configurable: true, value: consent });
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: doNotTrack });
    Object.defineProperty(trackingWindow, "doNotTrack", { configurable: true, value: doNotTrack });
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchMock = vi.fn();

    runInNewContext(snippet, {
      Blob,
      document,
      fetch: fetchMock,
      navigator,
      URL,
      URLSearchParams,
      window: trackingWindow,
    });

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps generated page URLs query-free while retaining explicit campaign attribution", () => {
    history.replaceState(null, "", "/shop?utm_source=instagram&customerEmail=private-person%40example.com#account");
    Object.defineProperty(trackingWindow, "moonarqConsent", {
      configurable: true,
      value: { analytics: "granted" },
    });
    const fetchMock = vi.fn();

    runInNewContext(snippet, {
      Blob,
      document,
      fetch: fetchMock,
      navigator: {
        doNotTrack: "0",
        language: navigator.language,
        userAgent: navigator.userAgent,
      },
      URL,
      URLSearchParams,
      window: trackingWindow,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
    const payload = JSON.parse(request?.body ?? "{}") as {
      url?: string;
      attribution?: { utm?: { source?: string } };
    };
    expect(payload.url).toBe(`${window.location.origin}/shop`);
    expect(payload.attribution?.utm?.source).toBe("instagram");
    expect(JSON.stringify(payload)).not.toContain("private-person");
  });
});
