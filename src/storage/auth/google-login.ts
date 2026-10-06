import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { NextResponse } from "next/server";
import {
  DASHBOARD_SESSION_TTL_SECONDS,
  DEFAULT_DASHBOARD_PATH,
  getDashboardAuthSetup,
  getDashboardSessionCookieName,
  isProtectedUiPath,
  safeDashboardRedirectPath,
  signDashboardSession,
} from "@/storage/auth/dashboard-session";

const GOOGLE_FLOW_TTL_SECONDS = 10 * 60;
const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};

type GoogleLoginConfig = {
  clientId: string;
  clientSecret: string;
  allowedEmail: string;
  appOrigin: string;
  sessionSecret: string;
};

type GoogleLoginFlow = {
  v: 1;
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  iat: number;
  exp: number;
};

type GoogleLoginError = "google_unavailable" | "google_invalid" | "google_cancelled" | "google_not_allowed" | "google_failed";

function googleAppOrigin(env: NodeJS.ProcessEnv) {
  try {
    const url = new URL(env.NEXT_PUBLIC_APP_URL?.trim() ?? "");
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    // The explicit local origin also supports the production-mode E2E server.
    if (url.origin === "http://localhost:4000") return url.origin;
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function googleConfig(env: NodeJS.ProcessEnv): GoogleLoginConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const allowedEmail = env.GOOGLE_ALLOWED_EMAIL?.trim().toLowerCase();
  const appOrigin = googleAppOrigin(env);
  if (!getDashboardAuthSetup(env).configured || !clientId || !clientSecret || !allowedEmail ||
      !/^[a-z0-9.]+@gmail\.com$/u.test(allowedEmail) || !appOrigin || !env.DASHBOARD_SESSION_SECRET) return null;
  return { clientId, clientSecret, allowedEmail, appOrigin, sessionSecret: env.DASHBOARD_SESSION_SECRET };
}

export function getGoogleLoginSetup(env: NodeJS.ProcessEnv = process.env) {
  const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ALLOWED_EMAIL", "NEXT_PUBLIC_APP_URL"]
    .filter((name) => !env[name]?.trim());
  const configured = googleConfig(env) !== null;
  return { enabled: configured, configured, missing };
}

export function safeGoogleLoginNextPath(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return DEFAULT_DASHBOARD_PATH;
  const path = safeDashboardRedirectPath(value);
  const url = new URL(path, "https://dashboard.moonarq.invalid");
  return isProtectedUiPath(url.pathname) ? path : DEFAULT_DASHBOARD_PATH;
}

function flowCookieName(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV === "production" ? "__Host-datahub_google_login" : "datahub_google_login";
}

function flowCookieOptions(env: NodeJS.ProcessEnv) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

function clearFlow(response: NextResponse, env: NodeJS.ProcessEnv) {
  response.cookies.set({ name: flowCookieName(env), value: "", ...flowCookieOptions(env), maxAge: 0 });
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(name, value);
  return response;
}

function loginError(request: Request, env: NodeJS.ProcessEnv, error: GoogleLoginError, next = DEFAULT_DASHBOARD_PATH) {
  const destination = new URL("/login", googleAppOrigin(env) ?? request.url);
  destination.searchParams.set("error", error);
  destination.searchParams.set("next", safeGoogleLoginNextPath(next));
  const response = clearFlow(NextResponse.redirect(destination, { status: 303 }), env);
  if (error === "google_not_allowed") {
    response.cookies.set({ name: getDashboardSessionCookieName(env), value: "", ...flowCookieOptions(env), maxAge: 0 });
  }
  return response;
}

function signFlow(flow: GoogleLoginFlow, secret: string) {
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`datahub-google-login:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

function sameValue(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function readFlow(request: Request, config: GoogleLoginConfig, env: NodeJS.ProcessEnv): GoogleLoginFlow | null {
  try {
    const name = flowCookieName(env);
    const cookie = (request.headers.get("cookie") ?? "").split(";")
      .map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    if (!cookie) return null;
    const value = decodeURIComponent(cookie.slice(name.length + 1));
    if (value.length > 4096) return null;
    const parts = value.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payload, signature] = parts;
    const expected = createHmac("sha256", config.sessionSecret).update(`datahub-google-login:${payload}`).digest("base64url");
    if (!sameValue(signature, expected)) return null;
    const flow = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<GoogleLoginFlow>;
    const now = Math.floor(Date.now() / 1000);
    if (flow.v !== 1 || typeof flow.state !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(flow.state) ||
        typeof flow.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(flow.nonce) ||
        typeof flow.verifier !== "string" || flow.verifier.length < 43 || flow.verifier.length > 128 ||
        typeof flow.next !== "string" || typeof flow.iat !== "number" || typeof flow.exp !== "number" ||
        !Number.isSafeInteger(flow.iat) || !Number.isSafeInteger(flow.exp) || flow.iat > now ||
        flow.exp <= now || flow.exp - flow.iat !== GOOGLE_FLOW_TTL_SECONDS) return null;
    return flow as GoogleLoginFlow;
  } catch {
    return null;
  }
}

function createClient(config: GoogleLoginConfig) {
  return new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: `${config.appOrigin}${GOOGLE_CALLBACK_PATH}`,
  });
}

export async function handleGoogleLoginStart(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const config = googleConfig(env);
  if (!config) return loginError(request, env, "google_unavailable");
  if (request.method !== "POST" || request.headers.get("origin") !== config.appOrigin || new URL(request.url).origin !== config.appOrigin) {
    return clearFlow(NextResponse.json({ error: "Google sign-in must start from this site." }, { status: 403 }), env);
  }
  try {
    const form = await request.formData();
    const client = createClient(config);
    const pkce = await client.generateCodeVerifierAsync();
    if (!pkce.codeChallenge) return loginError(request, env, "google_failed");
    const issuedAt = Math.floor(Date.now() / 1000);
    const flow: GoogleLoginFlow = {
      v: 1,
      state: randomBytes(32).toString("base64url"),
      nonce: randomBytes(32).toString("base64url"),
      verifier: pkce.codeVerifier,
      next: safeGoogleLoginNextPath(form.get("next")),
      iat: issuedAt,
      exp: issuedAt + GOOGLE_FLOW_TTL_SECONDS,
    };
    const authorizationUrl = client.generateAuthUrl({
      scope: ["openid", "email"],
      access_type: "online",
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    const response = NextResponse.redirect(authorizationUrl, { status: 303 });
    response.cookies.set({
      name: flowCookieName(env),
      value: signFlow(flow, config.sessionSecret),
      ...flowCookieOptions(env),
      maxAge: GOOGLE_FLOW_TTL_SECONDS,
    });
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(name, value);
    return response;
  } catch {
    return loginError(request, env, "google_failed");
  }
}

export async function handleGoogleLoginCallback(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const config = googleConfig(env);
  if (!config) return loginError(request, env, "google_unavailable");
  const url = new URL(request.url);
  const flow = readFlow(request, config, env);
  if (url.origin !== config.appOrigin || !flow || !sameValue(url.searchParams.get("state") ?? "", flow.state)) {
    return loginError(request, env, "google_invalid");
  }
  if (url.searchParams.has("error")) return loginError(request, env, "google_cancelled", flow.next);
  const code = url.searchParams.get("code");
  if (!code || code.length > 8192) return loginError(request, env, "google_invalid", flow.next);
  try {
    const client = createClient(config);
    const { tokens } = await client.getToken({ code, codeVerifier: flow.verifier, redirect_uri: `${config.appOrigin}${GOOGLE_CALLBACK_PATH}` });
    if (!tokens.id_token) return loginError(request, env, "google_invalid", flow.next);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
    const payload = ticket.getPayload();
    // verifyIdToken verifies the signature, issuer, audience and timestamps. Keep
    // the authorization policy explicit here, including strict token expiration.
    if (!payload || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss) ||
        payload.aud !== config.clientId || (payload.azp !== undefined && payload.azp !== config.clientId) ||
        !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000) ||
        typeof payload.nonce !== "string" || !sameValue(payload.nonce, flow.nonce) ||
        payload.email_verified !== true || typeof payload.email !== "string" || typeof payload.sub !== "string" || !payload.sub) {
      return loginError(request, env, "google_invalid", flow.next);
    }
    if (payload.email.toLowerCase() !== config.allowedEmail) return loginError(request, env, "google_not_allowed", flow.next);
    const response = clearFlow(NextResponse.redirect(new URL(safeGoogleLoginNextPath(flow.next), config.appOrigin), { status: 303 }), env);
    response.cookies.set({
      name: getDashboardSessionCookieName(env),
      value: await signDashboardSession(config.sessionSecret),
      ...flowCookieOptions(env),
      maxAge: DASHBOARD_SESSION_TTL_SECONDS,
    });
    return response;
  } catch {
    return loginError(request, env, "google_failed", flow.next);
  }
}
