// @vitest-environment node
// The OAuth routes build NextResponse redirects and read cookies with Node's Request and Headers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callbackRoute } from "@/app/api/oauth/etsy/callback/route";
import { GET as startRoute } from "@/app/api/oauth/etsy/start/route";
import {
  buildEtsyAuthorizationUrl,
  createEtsyOAuthState,
  createPkcePair,
  etsyReturnPathFromState,
  openEtsyOAuthCookie,
  pkceChallenge,
  safeEtsyReturnPath,
  sealEtsyOAuthCookie,
  validateEtsyCallback,
  verifyEtsyOAuthState,
} from "@/collection/connectors/etsy/oauth";
import { etsyOAuthErrorMessage, ETSY_OAUTH_REASONS } from "@/collection/connectors/etsy/oauth-results";
import { DASHBOARD_SESSION_COOKIE, signDashboardSession, verifyDashboardSession } from "@/storage/auth/dashboard-session";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";
import { getDecryptedCredentialMap, saveCredential } from "@/storage/repositories/credentials-repository";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { createSource, getSource } from "@/storage/repositories/sources-repository";

const ORIGINAL_ENV = { ...process.env };
const SESSION_SECRET = "session-secret-with-enough-entropy-for-tests";
const KEYSTRING = "testkeystring0123456789abc";
const SHARED_SECRET = "testsharedsecret9876";
const ACCESS_TOKEN = "12345678.test-access-token-value-0123456789";
const REFRESH_TOKEN = "12345678.test-refresh-token-value-9876543210";
const ORIGIN = "https://hub.example.com";
const CALLBACK_URL = `${ORIGIN}/api/oauth/etsy/callback`;

async function etsySource(): Promise<Source> {
  return createSource({
    data_space_id: DATA_SPACE_IDS.moonarq,
    source_type_key: "etsy",
    display_name: "Etsy: MoonArqStudio",
    input_url: "https://www.etsy.com/shop/MoonArqStudio",
    normalized_url: "https://www.etsy.com/shop/MoonArqStudio",
    account_name: "MoonArqStudio",
    sync_mode: "hourly",
    status: "needs_credentials",
  });
}

async function saveAppKeys(sourceId: string, keystring = KEYSTRING, sharedSecret = SHARED_SECRET) {
  await saveCredential(sourceId, "etsy_keystring", keystring);
  await saveCredential(sourceId, "etsy_shared_secret", sharedSecret);
}

async function dashboardCookie() {
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(await signDashboardSession(SESSION_SECRET))}`;
}

function sourcePath(sourceId: string) {
  return `/w/moonarq/dashboard/sources/${sourceId}`;
}

function startRequest(sourceId: string, cookie: string | null) {
  const url = `${ORIGIN}/api/oauth/etsy/start?sourceId=${sourceId}&dataSpaceSlug=moonarq&returnPath=${encodeURIComponent(sourcePath(sourceId))}`;
  return startRoute(new Request(url, { headers: cookie ? { cookie } : {} }));
}

function cookieFrom(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /moonarq_etsy_oauth=([^;]*)/u.exec(header);
  return { header, value: match ? decodeURIComponent(match[1]) : null };
}

/** Starts the flow for real, then returns what Etsy would send back plus the browser's sealed cookie. */
async function beginFlow(sourceId: string) {
  const response = await startRequest(sourceId, await dashboardCookie());
  const location = new URL(response.headers.get("location") ?? "");
  const cookie = cookieFrom(response).value;
  if (!cookie) throw new Error("The start route did not set the Etsy sign-in cookie.");
  return { state: location.searchParams.get("state") ?? "", cookie, verifier: openEtsyOAuthCookie(cookie).verifier, authorizeUrl: location };
}

function callbackRequest(query: Record<string, string>, cookie: string | null) {
  const url = new URL(CALLBACK_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return callbackRoute(new Request(url, { headers: cookie ? { cookie: `moonarq_etsy_oauth=${encodeURIComponent(cookie)}` } : {} }));
}

type Call = { url: URL; method: string; headers: Headers; body: string | null };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Stands in for Etsy: the token endpoint, getMe, and getShop. */
function stubEtsy(options: {
  token?: () => Response;
  me?: unknown;
  shop?: unknown;
  api?: (url: URL) => Response | null;
} = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body === undefined || init.body === null ? null : String(init.body) });
    if (url.toString() === "https://api.etsy.com/v3/public/oauth/token") {
      return options.token?.() ?? jsonResponse({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: 3600, token_type: "Bearer" });
    }
    const custom = options.api?.(url);
    if (custom) return custom;
    if (url.pathname === "/v3/application/users/me") return jsonResponse(options.me ?? { user_id: 12345678, shop_id: 98765432 });
    if (url.pathname === "/v3/application/shops/98765432") {
      return jsonResponse(options.shop ?? { shop_id: 98765432, shop_name: "MoonArqStudio", currency_code: "USD", url: "https://www.etsy.com/shop/MoonArqStudio", listing_active_count: 42 });
    }
    throw new Error(`Unexpected Etsy request: ${url}`);
  }));
  return calls;
}

function failOnFetch() {
  const fetchSpy = vi.fn(async () => {
    throw new Error("Etsy must not be called on this path.");
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function eventMessages(sourceId: string) {
  return getDemoStore().connectorEvents.filter((event) => event.source_id === sourceId);
}

describe("Etsy OAuth helpers", () => {
  const env = { ...process.env, DASHBOARD_SESSION_SECRET: SESSION_SECRET } as NodeJS.ProcessEnv;

  it("derives the PKCE challenge as RFC 7636 specifies", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const pair = createPkcePair();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(pair.challenge).toBe(pkceChallenge(pair.verifier));
    expect(createPkcePair().verifier).not.toBe(pair.verifier);
  });

  it("signs the state, rejects tampering, and expires it after ten minutes", () => {
    const now = Date.parse("2026-10-06T12:00:00.000Z");
    const input = { sourceId: "source-1", dataSpaceSlug: "moonarq", returnPath: sourcePath("source-1"), redirectUri: CALLBACK_URL };
    const state = createEtsyOAuthState(input, env, now);
    expect(verifyEtsyOAuthState(state, env, now + 9 * 60_000)).toMatchObject(input);
    expect(() => verifyEtsyOAuthState(`${state.slice(0, -2)}xx`, env, now)).toThrow("Invalid Etsy OAuth state.");
    expect(() => verifyEtsyOAuthState(`${state}.extra`, env, now)).toThrow("Invalid Etsy OAuth state.");
    expect(() => verifyEtsyOAuthState(state, { ...env, DASHBOARD_SESSION_SECRET: "another-secret-entirely" }, now)).toThrow("Invalid Etsy OAuth state.");
    expect(() => verifyEtsyOAuthState(state, env, now + 11 * 60_000)).toThrow("took too long");
    expect(() => createEtsyOAuthState(input, { ...env, DASHBOARD_SESSION_SECRET: "" }, now)).toThrow("DASHBOARD_SESSION_SECRET");
  });

  it("never lets a state, which travels in URLs, pass as a dashboard session", async () => {
    const state = createEtsyOAuthState({ sourceId: "source-1", dataSpaceSlug: "moonarq", returnPath: sourcePath("source-1"), redirectUri: CALLBACK_URL }, env);
    await expect(verifyDashboardSession(state, SESSION_SECRET)).resolves.toBe(false);
  });

  it("seals the verifier in a cookie only this server can open", () => {
    const { verifier } = createPkcePair();
    const sealed = sealEtsyOAuthCookie({ state: "state-value", verifier });
    expect(sealed).not.toContain(verifier);
    expect(sealed).not.toContain("state-value");
    expect(openEtsyOAuthCookie(sealed)).toEqual({ state: "state-value", verifier });
    const [iv, tag, data] = sealed.split(".");
    expect(() => openEtsyOAuthCookie(`${iv}.${tag}.${data.slice(0, -2)}AA`)).toThrow("invalid");
    expect(() => openEtsyOAuthCookie(null)).toThrow("missing");
    expect(() => openEtsyOAuthCookie(sealEtsyOAuthCookie({ state: "state-value", verifier: "short" }))).toThrow("invalid");
  });

  it("accepts a callback only when its state matches the sealed cookie", () => {
    const input = { sourceId: "source-1", dataSpaceSlug: "moonarq", returnPath: sourcePath("source-1"), redirectUri: CALLBACK_URL };
    const state = createEtsyOAuthState(input, env);
    const other = createEtsyOAuthState(input, env);
    const { verifier } = createPkcePair();
    const cookie = sealEtsyOAuthCookie({ state, verifier });
    expect(validateEtsyCallback(state, cookie, env)).toMatchObject({ payload: input, verifier });
    expect(() => validateEtsyCallback(other, cookie, env)).toThrow("Invalid Etsy OAuth state.");
    expect(() => validateEtsyCallback(null, cookie, env)).toThrow("Missing");
  });

  it("returns only to the source's own page or the sources list", () => {
    const fallback = sourcePath("source-1");
    expect(safeEtsyReturnPath(null, "moonarq", "source-1")).toBe(fallback);
    expect(safeEtsyReturnPath(`${fallback}?tab=keys`, "moonarq", "source-1")).toBe(`${fallback}?tab=keys`);
    expect(safeEtsyReturnPath("/w/moonarq/dashboard/sources", "moonarq", "source-1")).toBe("/w/moonarq/dashboard/sources");
    for (const unsafe of ["https://evil.example/w/moonarq/dashboard/sources/source-1", "//evil.example/x", sourcePath("source-2"), "/w/auto-lab/dashboard/sources/source-1", "/api/sources"]) {
      expect(safeEtsyReturnPath(unsafe, "moonarq", "source-1"), unsafe).toBe(fallback);
    }
  });

  it("recovers the return page from a signed state that expired, and nothing from a forged one", () => {
    const state = createEtsyOAuthState({ sourceId: "source-1", dataSpaceSlug: "moonarq", returnPath: sourcePath("source-1"), redirectUri: CALLBACK_URL }, env, Date.parse("2020-01-01T00:00:00.000Z"));
    expect(etsyReturnPathFromState(state, env)).toBe(sourcePath("source-1"));
    expect(etsyReturnPathFromState(`${state.slice(0, -2)}xx`, env)).toBeNull();
    expect(etsyReturnPathFromState(state, { ...env, DASHBOARD_SESSION_SECRET: "" })).toBeNull();
  });

  it("asks Etsy for read-only scopes with an S256 challenge", () => {
    const url = buildEtsyAuthorizationUrl({ keystring: KEYSTRING, redirectUri: CALLBACK_URL, state: "abc", challenge: "xyz" });
    expect(`${url.origin}${url.pathname}`).toBe("https://www.etsy.com/oauth/connect");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: KEYSTRING,
      redirect_uri: CALLBACK_URL,
      scope: "shops_r listings_r transactions_r",
      state: "abc",
      code_challenge: "xyz",
      code_challenge_method: "S256",
    });
  });

  it("has a fixed sentence for every result code", () => {
    for (const reason of ETSY_OAUTH_REASONS) {
      expect(etsyOAuthErrorMessage(reason, "MoonArqStudio").length, reason).toBeGreaterThan(20);
    }
    expect(etsyOAuthErrorMessage("different_shop", "MoonArqStudio")).toContain("MoonArqStudio");
    expect(etsyOAuthErrorMessage("different_shop", null)).not.toContain("null");
  });
});

describe("Etsy OAuth routes", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env = {
      ...ORIGINAL_ENV,
      APP_ENCRYPTION_KEY: "test-key-32-bytes-long-for-aes!!",
      DASHBOARD_ADMIN_PASSWORD: "dashboard-password-for-tests",
      DASHBOARD_SESSION_SECRET: SESSION_SECRET,
      DEV_AUTH_BYPASS: "false",
    };
    delete process.env.DATABASE_URL;
    resetDemoStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("sends a signed-out visitor to the login page", async () => {
    const source = await etsySource();
    const response = await startRequest(source.id, null);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toContain("/api/oauth/etsy/start");
    expect(cookieFrom(response).value).toBeNull();
  });

  it("sends the seller back with a reason code when the app keys are missing or malformed", async () => {
    const source = await etsySource();
    const missing = await startRequest(source.id, await dashboardCookie());
    expect(missing.status).toBe(303);
    expect(Object.fromEntries(new URL(missing.headers.get("location") ?? "").searchParams)).toEqual({ etsy_oauth: "error", reason: "app_keys_missing" });

    await saveAppKeys(source.id, `${KEYSTRING}:${SHARED_SECRET}`, SHARED_SECRET);
    const malformed = await startRequest(source.id, await dashboardCookie());
    expect(new URL(malformed.headers.get("location") ?? "").searchParams.get("reason")).toBe("app_keys_malformed");
  });

  it("refuses sources that are not Etsy, and disabled ones", async () => {
    const source = await etsySource();
    const whatnot = await createSource({ data_space_id: DATA_SPACE_IDS.moonarq, source_type_key: "whatnot", display_name: "Whatnot", sync_mode: "manual" });
    const wrongType = await startRequest(whatnot.id, await dashboardCookie());
    expect(wrongType.status).toBe(403);
    const elsewhere = await startRoute(new Request(`${ORIGIN}/api/oauth/etsy/start?sourceId=${source.id}&dataSpaceSlug=auto-lab`, { headers: { cookie: await dashboardCookie() } }));
    expect(elsewhere.status).toBe(404);

    await saveAppKeys(source.id);
    getDemoStore().sources.find((item) => item.id === source.id)!.status = "disabled";
    const disabled = await startRequest(source.id, await dashboardCookie());
    expect(new URL(disabled.headers.get("location") ?? "").searchParams.get("reason")).toBe("disabled");
  });

  it("sends the seller to Etsy with PKCE, keeping the verifier and secret on the server", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    const response = await startRequest(source.id, await dashboardCookie());
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe("https://www.etsy.com/oauth/connect");
    expect(location.searchParams.get("client_id")).toBe(KEYSTRING);
    expect(location.searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");

    const cookie = cookieFrom(response);
    expect(cookie.header).toMatch(/HttpOnly/iu);
    expect(cookie.header).toMatch(/SameSite=lax/iu);
    expect(cookie.header).toMatch(/Max-Age=600/u);
    expect(cookie.header).toMatch(/Path=\//u);
    const sealed = openEtsyOAuthCookie(cookie.value);
    expect(sealed.state).toBe(location.searchParams.get("state"));
    expect(location.searchParams.get("code_challenge")).toBe(pkceChallenge(sealed.verifier));
    for (const text of [location.toString(), cookie.header]) {
      expect(text).not.toContain(SHARED_SECRET);
      expect(text).not.toContain(sealed.verifier);
    }
  });

  it("exchanges the code, saves encrypted tokens, and marks the shop connected", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    // A reconnect after Etsy stopped accepting the old authorization.
    Object.assign(getDemoStore().sources.find((item) => item.id === source.id)!, { status: "error", last_error: "Etsy authorization expired or was revoked. Reconnect Etsy." });
    const flow = await beginFlow(source.id);
    const calls = stubEtsy();

    const response = await callbackRequest({ code: "authorization-code-123", state: flow.state }, flow.cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${sourcePath(source.id)}?etsy_oauth=connected`);
    expect(cookieFrom(response).header).toMatch(/Max-Age=0/u);

    const tokenCall = calls.find((call) => call.url.pathname === "/v3/public/oauth/token")!;
    expect(tokenCall.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(tokenCall.body ?? ""))).toEqual({
      grant_type: "authorization_code",
      client_id: KEYSTRING,
      redirect_uri: CALLBACK_URL,
      code: "authorization-code-123",
      code_verifier: flow.verifier,
    });
    for (const call of calls.filter((item) => item.url.pathname.startsWith("/v3/application/"))) {
      expect(call.headers.get("x-api-key")).toBe(`${KEYSTRING}:${SHARED_SECRET}`);
      expect(call.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    }

    const credentials = await getDecryptedCredentialMap(source.id);
    expect(credentials).toMatchObject({
      etsy_access_token: ACCESS_TOKEN,
      etsy_refresh_token: REFRESH_TOKEN,
      etsy_shop_id: "98765432",
      etsy_user_id: "12345678",
    });
    const stored = JSON.stringify(getDemoStore().credentials.filter((item) => item.source_id === source.id));
    expect(stored).not.toContain(ACCESS_TOKEN);
    expect(stored).not.toContain(REFRESH_TOKEN);
    expect(stored).not.toContain(SHARED_SECRET);

    const updated = await getSource(source.id);
    expect(updated).toMatchObject({
      status: "healthy",
      last_error: null,
      external_account_id: "98765432",
      account_name: "MoonArqStudio",
      normalized_url: "https://www.etsy.com/shop/MoonArqStudio",
    });
    expect(updated?.metadata).toMatchObject({ oauth_connected: true, etsy_shop_id: "98765432", etsy_shop_name: "MoonArqStudio", etsy_currency: "usd" });
    const refreshDays = (Date.parse(String(updated?.metadata.refresh_expires_at)) - Date.now()) / 86_400_000;
    expect(refreshDays).toBeGreaterThan(89.9);
    expect(refreshDays).toBeLessThan(90.1);
    const events = JSON.stringify(eventMessages(source.id));
    expect(events).toContain("etsy_oauth_connected");
    expect(events).not.toContain(ACCESS_TOKEN);
  });

  it("changes nothing when the seller declines on Etsy", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    const flow = await beginFlow(source.id);
    const fetchSpy = failOnFetch();
    const response = await callbackRequest({ error: "access_denied", error_description: "The user denied access", state: flow.state }, flow.cookie);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${sourcePath(source.id)}?etsy_oauth=error&reason=denied`);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await getSource(source.id))?.metadata.oauth_connected).not.toBe(true);
  });

  it("sends a sign-in that outlived its cookie back to the source page without using the code", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    const flow = await beginFlow(source.id);
    const fetchSpy = failOnFetch();
    const response = await callbackRequest({ code: "authorization-code-123", state: flow.state }, null);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${sourcePath(source.id)}?etsy_oauth=error&reason=expired`);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getDecryptedCredentialMap(source.id)).not.toHaveProperty("etsy_access_token");
  });

  it("answers a forged state with an error instead of a redirect", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    const flow = await beginFlow(source.id);
    failOnFetch();
    const forged = await callbackRequest({ code: "authorization-code-123", state: `${flow.state.slice(0, -2)}xx` }, flow.cookie);
    expect(forged.status).toBe(400);
    expect(forged.headers.get("location")).toBeNull();
  });

  it("leaves a source that was disabled during the sign-in disabled, with nothing stored", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    const flow = await beginFlow(source.id);
    getDemoStore().sources.find((item) => item.id === source.id)!.status = "disabled";
    const fetchSpy = failOnFetch();
    const response = await callbackRequest({ code: "authorization-code-123", state: flow.state }, flow.cookie);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("reason")).toBe("disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getSource(source.id)).toMatchObject({ status: "disabled" });
    expect(await getDecryptedCredentialMap(source.id)).not.toHaveProperty("etsy_access_token");
  });

  it("uses a Secure, host-only cookie in production", async () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    const source = await etsySource();
    await saveAppKeys(source.id);
    const session = await signDashboardSession(SESSION_SECRET);
    const response = await startRequest(source.id, `__Host-moonarq_dashboard=${encodeURIComponent(session)}`);
    expect(response.status).toBe(307);
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/^__Host-moonarq_etsy_oauth=/u);
    expect(header).toMatch(/Secure/iu);
    expect(header).toMatch(/Path=\//u);
    expect(header).not.toMatch(/Domain=/iu);

    // The callback reads the same cookie back.
    const sealed = /__Host-moonarq_etsy_oauth=([^;]*)/u.exec(header)?.[1] ?? "";
    const state = new URL(response.headers.get("location") ?? "").searchParams.get("state") ?? "";
    stubEtsy();
    const callback = await callbackRoute(new Request(`${CALLBACK_URL}?code=authorization-code-123&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `__Host-moonarq_etsy_oauth=${sealed}` },
    }));
    expect(callback.headers.get("location")).toBe(`${ORIGIN}${sourcePath(source.id)}?etsy_oauth=connected`);
    expect(callback.headers.get("set-cookie") ?? "").toMatch(/__Host-moonarq_etsy_oauth=;.*Max-Age=0/iu);
  });

  it("refuses a shop other than the one the source is connected to", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    getDemoStore().sources.find((item) => item.id === source.id)!.external_account_id = "11111111";
    const flow = await beginFlow(source.id);
    stubEtsy();
    const response = await callbackRequest({ code: "authorization-code-123", state: flow.state }, flow.cookie);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("reason")).toBe("different_shop");
    expect(await getDecryptedCredentialMap(source.id)).not.toHaveProperty("etsy_access_token");
    expect((await getSource(source.id))?.external_account_id).toBe("11111111");
    expect(eventMessages(source.id).some((event) => event.event_type === "etsy_oauth_shop_mismatch")).toBe(true);
  });

  it("refuses a shop whose name differs from the one the source was added for", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    const flow = await beginFlow(source.id);
    stubEtsy({ shop: { shop_id: 98765432, shop_name: "SomeOtherShop", currency_code: "USD" } });
    const response = await callbackRequest({ code: "authorization-code-123", state: flow.state }, flow.cookie);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("reason")).toBe("different_shop");
    expect((await getSource(source.id))?.metadata.oauth_connected).not.toBe(true);
  });

  it("refuses an Etsy account without a shop", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    const flow = await beginFlow(source.id);
    stubEtsy({ me: { user_id: 12345678, shop_id: null } });
    const response = await callbackRequest({ code: "authorization-code-123", state: flow.state }, flow.cookie);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("reason")).toBe("no_shop");
  });

  it("explains a rejected code and keeps the verifier and code out of the event log", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    const flow = await beginFlow(source.id);
    stubEtsy({
      token: () => jsonResponse({ error: "invalid_grant", error_description: `code_verifier ${flow.verifier} does not match code authorization-code-123` }, 400),
    });
    const response = await callbackRequest({ code: "authorization-code-123", state: flow.state }, flow.cookie);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("reason")).toBe("callback_mismatch");
    const events = JSON.stringify(eventMessages(source.id));
    expect(events).toContain("etsy_oauth_error");
    expect(events).not.toContain(flow.verifier);
    expect(events).not.toContain("authorization-code-123");
  });

  it("tells the seller when Etsy rejects the app keys, without logging the secret", async () => {
    const source = await etsySource();
    await saveAppKeys(source.id);
    const flow = await beginFlow(source.id);
    stubEtsy({
      api: (url) => (url.pathname === "/v3/application/users/me"
        ? jsonResponse({ error: `Invalid API key: ${KEYSTRING}:${SHARED_SECRET}` }, 403)
        : null),
    });
    const response = await callbackRequest({ code: "authorization-code-123", state: flow.state }, flow.cookie);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("reason")).toBe("app_keys_rejected");
    const events = JSON.stringify(eventMessages(source.id));
    expect(events).not.toContain(SHARED_SECRET);
    expect(events).not.toContain(ACCESS_TOKEN);
  });
});
