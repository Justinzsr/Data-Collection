import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EtsyConnectSteps } from "@/presentation/source-onboarding/etsy-connect-steps";

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

const FIELDS = [
  { key: "etsy_keystring", label: "Etsy app keystring", description: "", required: true, secret: true, type: "password" },
  { key: "etsy_shared_secret", label: "Etsy app shared secret", description: "", required: true, secret: true, type: "password" },
];

let root: Root | null = null;
let container: HTMLDivElement;

function savedHint(fieldKey: string) {
  return { field_key: fieldKey, value_hint: "••••abcd", created_at: "2026-10-06T00:00:00.000Z", updated_at: "2026-10-06T00:00:00.000Z" };
}

function stubCredentials(saved: string[]) {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fields: FIELDS, saved: saved.map(savedHint) }) }) as unknown as Response);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

async function mount(props: { connected?: boolean; initialKeysSaved?: boolean } = {}) {
  await act(async () => {
    root?.render(
      <EtsyConnectSteps
        sourceId="source-1"
        dataSpaceSlug="moonarq"
        returnPath="/w/moonarq/dashboard/sources/source-1"
        connected={props.connected ?? false}
        initialKeysSaved={props.initialKeysSaved ?? false}
      />,
    );
  });
  // The credential form loads its fields on the next tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
}

function connectControl() {
  return [...container.querySelectorAll("a, button")].find((element) => /Connect Etsy|Reconnect Etsy/u.test(element.textContent ?? "")) ?? null;
}

beforeEach(() => {
  (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
  delete (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT;
});

describe("EtsyConnectSteps", () => {
  it("shows this site's exact callback URL", async () => {
    stubCredentials([]);
    await mount();
    expect(container.querySelector("[data-testid='etsy-callback-url']")?.textContent).toBe(`${window.location.origin}/api/oauth/etsy/callback`);
    const etsyLink = container.querySelector("a[href='https://www.etsy.com/developers/your-apps']");
    expect(etsyLink?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps Connect unavailable until both app keys are saved", async () => {
    stubCredentials(["etsy_keystring"]);
    await mount();
    const control = connectControl();
    expect(control?.tagName).toBe("BUTTON");
    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("Save both keys first.");
  });

  it("links to the Etsy sign-in once the keys are saved", async () => {
    const fetchSpy = stubCredentials(["etsy_keystring", "etsy_shared_secret"]);
    await mount();
    expect(fetchSpy).toHaveBeenCalledWith("/api/sources/source-1/credentials?dataSpaceSlug=moonarq");
    const control = connectControl();
    expect(control?.tagName).toBe("A");
    const href = new URL(control?.getAttribute("href") ?? "", "https://hub.example.com");
    expect(href.pathname).toBe("/api/oauth/etsy/start");
    expect(Object.fromEntries(href.searchParams)).toEqual({ sourceId: "source-1", dataSpaceSlug: "moonarq", returnPath: "/w/moonarq/dashboard/sources/source-1" });
    expect(control?.textContent).toContain("Connect Etsy");
  });

  it("offers a reconnect for a connected shop", async () => {
    stubCredentials(["etsy_keystring", "etsy_shared_secret"]);
    await mount({ connected: true, initialKeysSaved: true });
    expect(connectControl()?.textContent).toContain("Reconnect Etsy");
  });
});
