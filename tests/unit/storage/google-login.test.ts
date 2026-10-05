// @vitest-environment node

import { createHash } from "node:crypto";
import { LoginTicket, OAuth2Client, type TokenPayload } from "google-auth-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as googleCallbackRoute } from "@/app/api/auth/google/callback/route";
import { POST as googleStartRoute } from "@/app/api/auth/google/start/route";
import {
  DEFAULT_DASHBOARD_PATH,
  getDashboardSessionCookieName,
  verifyDashboardSession,
} from "@/storage/auth/dashboard-session";
import {
  getGoogleLoginSetup,
  handleGoogleLoginCallback,
  handleGoogleLoginStart,
  safeGoogleLoginNextPath,
} from "@/storage/auth/google-login";

const NOW = Date.UTC(2026, 9, 5, 12);
const APP_ORIGIN = "https://datahub.example.test";
const SYNTHETIC_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DEV_AUTH_BYPASS: "false",
  DASHBOARD_ADMIN_PASSWORD: "synthetic-password",
  DASHBOARD_SESSION_SECRET: "synthetic-session-secret-for-google-tests",
  GOOGLE_CLIENT_ID: "synthetic-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
  GOOGLE_ALLOWED_EMAIL: "synthetic.owner@gmail.com",
  NEXT_PUBLIC_APP_URL: APP_ORIGIN,
};
const FLOW_COOKIE = "__Host-datahub_google_login";
const VERIFIER = "a".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

function startRequest(next = "/w/moonarq/dashboard?range=7d") {
  return new Request(`${APP_ORIGIN}/api/auth/google/start`, {
    method: "POST",
    headers: { origin: APP_ORIGIN },
    body: new URLSearchParams({ next }),
  });
}

async function begin(next?: string, env = SYNTHETIC_ENV) {
  const response = await handleGoogleLoginStart(startRequest(next), env);
  expect(response.status).toBe(303);
  const authorization = new URL(response.headers.get("location")!);
  const value = response.cookies.get(FLOW_COOKIE)!.value;
  return {
    response,
    authorization,
    state: authorization.searchParams.get("state")!,
    nonce: authorization.searchParams.get("nonce")!,
    cookie: `${FLOW_COOKIE}=${value}`,
  };
}

function callbackRequest(state: string, cookie?: string, extra: Record<string, string> = {}) {
  const url = new URL("/api/auth/google/callback", APP_ORIGIN);
  url.searchParams.set("state", state);
  url.searchParams.set("code", "synthetic-authorization-code");
  for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);
  return new Request(url, { headers: cookie ? { cookie } : undefined });
}

function tokenPayload(nonce: string, overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    iss: "https://accounts.google.com",
    sub: "synthetic-google-subject",
    aud: SYNTHETIC_ENV.GOOGLE_CLIENT_ID!,
    iat: Math.floor(NOW / 1000),
    exp: Math.floor(NOW / 1000) + 3600,
    email: SYNTHETIC_ENV.GOOGLE_ALLOWED_EMAIL!,
    email_verified: true,
    nonce,
    ...overrides,
  };
}

function mockVerifiedIdentity(payload: TokenPayload) {
  return vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockImplementation(async () => new LoginTicket("", payload));
}

function expectLoginFailure(response: Awaited<ReturnType<typeof handleGoogleLoginCallback>>, error: string) {
  expect(response.status).toBe(303);
  const destination = new URL(response.headers.get("location")!);
  expect(destination.origin).toBe(APP_ORIGIN);
  expect(destination.pathname).toBe("/login");
  expect(destination.searchParams.get("error")).toBe(error);
  expect(response.cookies.get(FLOW_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  const dashboardCookie = response.cookies.get(getDashboardSessionCookieName(SYNTHETIC_ENV));
  expect(dashboardCookie?.value ?? "").toBe("");
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("location")).not.toContain(SYNTHETIC_ENV.GOOGLE_ALLOWED_EMAIL);
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(OAuth2Client.prototype, "generateCodeVerifierAsync").mockResolvedValue({ codeVerifier: VERIFIER, codeChallenge: CHALLENGE });
  vi.spyOn(OAuth2Client.prototype, "getToken").mockImplementation(async () => ({ tokens: { id_token: "synthetic-id-token" }, res: null }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("optional owner Google login configuration", () => {
  it("is disabled when unconfigured without exposing configuration values", () => {
    const setup = getGoogleLoginSetup({ NODE_ENV: "production" });
    expect(setup.enabled).toBe(false);
    expect(setup.missing).toContain("GOOGLE_CLIENT_ID");
    expect(getGoogleLoginSetup(SYNTHETIC_ENV)).toEqual({ enabled: true, configured: true, missing: [] });
    expect(JSON.stringify(getGoogleLoginSetup(SYNTHETIC_ENV))).not.toContain("synthetic");
  });

  it.each([
    { NEXT_PUBLIC_APP_URL: "http://datahub.example.test" },
    { NEXT_PUBLIC_APP_URL: "https://datahub.example.test/path" },
    { NEXT_PUBLIC_APP_URL: "https://user:password@datahub.example.test" },
    { NEXT_PUBLIC_APP_URL: "https://datahub.example.test/?redirect=elsewhere" },
    { GOOGLE_ALLOWED_EMAIL: "*" },
    { GOOGLE_ALLOWED_EMAIL: "owner@gmail.com,other@gmail.com" },
    { GOOGLE_ALLOWED_EMAIL: "owner@example.test" },
    { DASHBOARD_SESSION_SECRET: "" },
    { DASHBOARD_ADMIN_PASSWORD: "" },
  ])("fails closed for invalid setup %j", (invalid) => {
    expect(getGoogleLoginSetup({ ...SYNTHETIC_ENV, ...invalid }).enabled).toBe(false);
  });

  it("permits the exact local QA origin and trims the owner mailbox", () => {
    expect(getGoogleLoginSetup({ ...SYNTHETIC_ENV, NEXT_PUBLIC_APP_URL: "http://localhost:4000", GOOGLE_ALLOWED_EMAIL: " SYNTHETIC.OWNER@gmail.com " }).enabled).toBe(true);
    expect(getGoogleLoginSetup({ ...SYNTHETIC_ENV, NEXT_PUBLIC_APP_URL: "http://localhost:4001" }).enabled).toBe(false);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/api/auth/google/start", "/privacy", "/w/moonarq/dashboard/../../../login"])("rejects unsafe or public return path %s", (value) => {
    expect(safeGoogleLoginNextPath(value)).toBe(DEFAULT_DASHBOARD_PATH);
  });

  it("preserves private destinations and their query strings", () => {
    expect(safeGoogleLoginNextPath("/w/auto-lab/dashboard?range=7d")).toBe("/w/auto-lab/dashboard?range=7d");
    expect(safeGoogleLoginNextPath("/settings")).toBe("/settings");
    expect(safeGoogleLoginNextPath(`/w/moonarq/dashboard?large=${"a".repeat(2048)}`)).toBe(DEFAULT_DASHBOARD_PATH);
  });
});

describe("Google authorization start", () => {
  it("requests identity scopes with PKCE and random state/nonce in a signed secure cookie", async () => {
    const flow = await begin();
    const params = flow.authorization.searchParams;
    expect(flow.authorization.origin).toBe("https://accounts.google.com");
    expect(params.get("scope")).toBe("openid email");
    expect(params.get("access_type")).toBe("online");
    expect(params.get("redirect_uri")).toBe(`${APP_ORIGIN}/api/auth/google/callback`);
    expect(params.get("code_challenge")).toBe(CHALLENGE);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(params.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(flow.state).not.toBe(flow.nonce);
    expect(flow.response.cookies.get(FLOW_COOKIE)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    expect(flow.authorization.href).not.toContain(SYNTHETIC_ENV.GOOGLE_ALLOWED_EMAIL);
    expect(flow.authorization.href).not.toContain(VERIFIER);
    expect(flow.authorization.href).not.toContain(SYNTHETIC_ENV.GOOGLE_CLIENT_SECRET);
    expect(flow.response.cookies.get(getDashboardSessionCookieName(SYNTHETIC_ENV))).toBeUndefined();
    const other = await begin();
    expect(other.state).not.toBe(flow.state);
    expect(other.nonce).not.toBe(flow.nonce);
  });

  it.each(["https://evil.example", "null", ""])("rejects a POST with untrusted origin %s", async (origin) => {
    const request = new Request(`${APP_ORIGIN}/api/auth/google/start`, { method: "POST", headers: { origin }, body: new URLSearchParams() });
    const response = await handleGoogleLoginStart(request, SYNTHETIC_ENV);
    expect(response.status).toBe(403);
    expect(response.cookies.get(FLOW_COOKIE)?.maxAge).toBe(0);
    expect(OAuth2Client.prototype.generateCodeVerifierAsync).not.toHaveBeenCalled();
  });

  it("does not start from a GET or an untrusted request host", async () => {
    const getResponse = await handleGoogleLoginStart(new Request(`${APP_ORIGIN}/api/auth/google/start`, { headers: { origin: APP_ORIGIN } }), SYNTHETIC_ENV);
    expect(getResponse.status).toBe(403);
    const foreign = new Request("https://evil.example/api/auth/google/start", { method: "POST", headers: { origin: APP_ORIGIN }, body: new URLSearchParams() });
    expect((await handleGoogleLoginStart(foreign, SYNTHETIC_ENV)).status).toBe(403);
  });

  it("returns to password login when Google is unconfigured", async () => {
    const response = await handleGoogleLoginStart(startRequest(), { ...SYNTHETIC_ENV, GOOGLE_CLIENT_SECRET: "" });
    expectLoginFailure(response, "google_unavailable");
    expect(OAuth2Client.prototype.getToken).not.toHaveBeenCalled();
  });
});

describe("Google callback authorization", () => {
  it("issues the existing private session only for the verified owner and uses the saved PKCE verifier", async () => {
    const flow = await begin("/w/auto-lab/dashboard?range=7d");
    const verification = mockVerifiedIdentity(tokenPayload(flow.nonce));
    const response = await handleGoogleLoginCallback(callbackRequest(flow.state, flow.cookie), SYNTHETIC_ENV);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP_ORIGIN}/w/auto-lab/dashboard?range=7d`);
    expect(OAuth2Client.prototype.getToken).toHaveBeenCalledWith({ code: "synthetic-authorization-code", codeVerifier: VERIFIER, redirect_uri: `${APP_ORIGIN}/api/auth/google/callback` });
    expect(verification).toHaveBeenCalledWith({ idToken: "synthetic-id-token", audience: SYNTHETIC_ENV.GOOGLE_CLIENT_ID });
    const cookie = response.cookies.get(getDashboardSessionCookieName(SYNTHETIC_ENV));
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 43200 });
    await expect(verifyDashboardSession(cookie!.value, SYNTHETIC_ENV.DASHBOARD_SESSION_SECRET, NOW)).resolves.toBe(true);
    expect(response.cookies.get(FLOW_COOKIE)?.maxAge).toBe(0);
    expect(response.headers.get("set-cookie")).not.toContain("synthetic-id-token");
    expect(response.headers.get("location")).not.toContain("synthetic-authorization-code");
  });

  it("denies another verified account and removes any previous private session", async () => {
    const flow = await begin();
    mockVerifiedIdentity(tokenPayload(flow.nonce, { email: "synthetic.other@gmail.com" }));
    const previous = `${getDashboardSessionCookieName(SYNTHETIC_ENV)}=previous-session`;
    const response = await handleGoogleLoginCallback(callbackRequest(flow.state, `${flow.cookie}; ${previous}`), SYNTHETIC_ENV);
    expectLoginFailure(response, "google_not_allowed");
    expect(response.cookies.get(getDashboardSessionCookieName(SYNTHETIC_ENV))).toMatchObject({ value: "", maxAge: 0 });
    expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/w/moonarq/dashboard?range=7d");
  });

  it.each([
    { email_verified: false },
    { email: undefined },
    { nonce: "wrong-nonce" },
    { nonce: undefined },
    { iss: "https://evil.example" },
    { aud: "another-client" },
    { azp: "another-client" },
    { exp: Math.floor(NOW / 1000) },
    { sub: "" },
  ])("denies invalid verified claims %j", async (claims) => {
    const flow = await begin();
    mockVerifiedIdentity(tokenPayload(flow.nonce, claims));
    const response = await handleGoogleLoginCallback(callbackRequest(flow.state, flow.cookie), SYNTHETIC_ENV);
    expectLoginFailure(response, "google_invalid");
  });

  it("rejects a string truthy email_verified claim", async () => {
    const flow = await begin();
    mockVerifiedIdentity(tokenPayload(flow.nonce, { email_verified: "true" as unknown as boolean }));
    expectLoginFailure(await handleGoogleLoginCallback(callbackRequest(flow.state, flow.cookie), SYNTHETIC_ENV), "google_invalid");
  });

  it.each(["missing", "wrong-state", "tampered", "malformed", "expired"])("rejects %s flow before token exchange", async (failure) => {
    const flow = await begin();
    let cookie: string | undefined = flow.cookie;
    let state = flow.state;
    if (failure === "missing") cookie = undefined;
    if (failure === "wrong-state") state = "attacker-state";
    if (failure === "tampered") cookie = `${flow.cookie}x`;
    if (failure === "malformed") cookie = `${FLOW_COOKIE}=%zz`;
    if (failure === "expired") vi.mocked(Date.now).mockReturnValue(NOW + 600_000);
    expectLoginFailure(await handleGoogleLoginCallback(callbackRequest(state, cookie), SYNTHETIC_ENV), "google_invalid");
    expect(OAuth2Client.prototype.getToken).not.toHaveBeenCalled();
  });

  it("does not accept the state cookie from another simultaneous browser flow", async () => {
    const first = await begin();
    const second = await begin();
    expectLoginFailure(await handleGoogleLoginCallback(callbackRequest(first.state, second.cookie), SYNTHETIC_ENV), "google_invalid");
    expect(OAuth2Client.prototype.getToken).not.toHaveBeenCalled();
  });

  it("requires the configured callback origin and rejects a replay after the cookie is cleared", async () => {
    const flow = await begin();
    const foreignCallback = callbackRequest(flow.state, flow.cookie);
    const foreign = new Request(foreignCallback.url.replace(APP_ORIGIN, "https://evil.example"), { headers: foreignCallback.headers });
    expectLoginFailure(await handleGoogleLoginCallback(foreign, SYNTHETIC_ENV), "google_invalid");
    mockVerifiedIdentity(tokenPayload(flow.nonce));
    const completed = await handleGoogleLoginCallback(callbackRequest(flow.state, flow.cookie), SYNTHETIC_ENV);
    expect(completed.cookies.get(FLOW_COOKIE)?.maxAge).toBe(0);
    vi.mocked(OAuth2Client.prototype.getToken).mockClear();
    expectLoginFailure(await handleGoogleLoginCallback(callbackRequest(flow.state), SYNTHETIC_ENV), "google_invalid");
    expect(OAuth2Client.prototype.getToken).not.toHaveBeenCalled();
  });

  it("handles cancellation and missing code without exposing provider errors", async () => {
    const flow = await begin();
    const cancelled = await handleGoogleLoginCallback(callbackRequest(flow.state, flow.cookie, { error: "access_denied", error_description: "private-provider-detail" }), SYNTHETIC_ENV);
    expectLoginFailure(cancelled, "google_cancelled");
    expect(cancelled.headers.get("location")).not.toContain("private-provider-detail");
    const missing = await handleGoogleLoginCallback(callbackRequest(flow.state, flow.cookie, { code: "" }), SYNTHETIC_ENV);
    expectLoginFailure(missing, "google_invalid");
    expect(OAuth2Client.prototype.getToken).not.toHaveBeenCalled();
  });

  it("requires an ID token and a successful library verification", async () => {
    const flow = await begin();
    vi.mocked(OAuth2Client.prototype.getToken).mockImplementationOnce(async () => ({ tokens: {}, res: null }));
    expectLoginFailure(await handleGoogleLoginCallback(callbackRequest(flow.state, flow.cookie), SYNTHETIC_ENV), "google_invalid");
    vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockImplementation(async () => { throw new Error("invalid-signature-private-detail"); });
    const response = await handleGoogleLoginCallback(callbackRequest(flow.state, flow.cookie), SYNTHETIC_ENV);
    expectLoginFailure(response, "google_failed");
    expect(response.headers.get("location")).not.toContain("invalid-signature-private-detail");
  });

  it("sanitizes provider failures and deletes the transient cookie", async () => {
    const flow = await begin();
    vi.mocked(OAuth2Client.prototype.getToken).mockImplementation(async () => { throw new Error("provider-client-secret-and-token"); });
    const response = await handleGoogleLoginCallback(callbackRequest(flow.state, flow.cookie), SYNTHETIC_ENV);
    expectLoginFailure(response, "google_failed");
    expect(response.headers.get("location")).not.toContain("provider-client-secret-and-token");
  });

  it("the route wrappers use runtime server configuration", async () => {
    for (const [name, value] of Object.entries(SYNTHETIC_ENV)) vi.stubEnv(name, value!);
    const response = await googleStartRoute(startRequest());
    const authorization = new URL(response.headers.get("location")!);
    const state = authorization.searchParams.get("state")!;
    mockVerifiedIdentity(tokenPayload(authorization.searchParams.get("nonce")!));
    const cookie = `${FLOW_COOKIE}=${response.cookies.get(FLOW_COOKIE)!.value}`;
    const callback = await googleCallbackRoute(callbackRequest(state, cookie));
    expect(callback.headers.get("location")).toBe(`${APP_ORIGIN}/w/moonarq/dashboard?range=7d`);
    expect(callback.cookies.get(getDashboardSessionCookieName(SYNTHETIC_ENV))?.value).toBeTruthy();
  });
});
