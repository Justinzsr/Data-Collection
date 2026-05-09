export const DASHBOARD_SESSION_COOKIE = "__Host-moonarq_dashboard";
export const DASHBOARD_SESSION_TTL_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  v: 1;
  iat: number;
  exp: number;
};

export type DashboardAuthSetup = {
  bypass: boolean;
  configured: boolean;
  missing: string[];
};

const encoder = new TextEncoder();

function base64UrlEncode(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function getDashboardAuthSetup(env: NodeJS.ProcessEnv = process.env): DashboardAuthSetup {
  const bypass = env.DEV_AUTH_BYPASS === "true" && env.NODE_ENV !== "production";
  const missing = [];
  if (!env.DASHBOARD_ADMIN_PASSWORD) missing.push("DASHBOARD_ADMIN_PASSWORD");
  if (!env.DASHBOARD_SESSION_SECRET) missing.push("DASHBOARD_SESSION_SECRET");
  return {
    bypass,
    configured: missing.length === 0,
    missing,
  };
}

export async function signDashboardSession(secret: string, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload: SessionPayload = {
    v: 1,
    iat: issuedAt,
    exp: issuedAt + DASHBOARD_SESSION_TTL_SECONDS,
  };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(await hmacSha256(secret, payloadPart));
  return `${payloadPart}.${signature}`;
}

export async function verifyDashboardSession(cookieValue: string | undefined | null, secret: string | undefined, now = Date.now()) {
  if (!cookieValue || !secret) return false;
  const [payloadPart, signature] = cookieValue.split(".");
  if (!payloadPart || !signature) return false;
  const expected = base64UrlEncode(await hmacSha256(secret, payloadPart));
  if (!timingSafeEqual(signature, expected)) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as Partial<SessionPayload>;
    return payload.v === 1 && typeof payload.exp === "number" && payload.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

function parseCookieHeader(cookieHeader: string | null) {
  return Object.fromEntries(
    (cookieHeader ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [key, decodeURIComponent(value.join("="))];
      }),
  );
}

export async function isDashboardRequestAuthenticated(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const setup = getDashboardAuthSetup(env);
  if (setup.bypass) return true;
  if (!setup.configured) return false;
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return verifyDashboardSession(cookies[DASHBOARD_SESSION_COOKIE], env.DASHBOARD_SESSION_SECRET);
}

export function isProtectedUiPath(pathname: string) {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    /^\/w\/[^/]+\/dashboard(?:\/|$)/u.test(pathname) ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/")
  );
}

export function isPublicIngestionOrAuthPath(pathname: string) {
  return (
    pathname === "/api/track" ||
    pathname === "/api/cron/sync" ||
    pathname === "/api/cron/daily-report" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/webhooks/vercel/analytics-drain/")
  );
}

export function isPrivateApiPath(pathname: string) {
  if (!pathname.startsWith("/api/")) return false;
  if (isPublicIngestionOrAuthPath(pathname)) return false;
  return (
    pathname === "/api/source-types" ||
    pathname === "/api/events" ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/sources") ||
    pathname.startsWith("/api/sync") ||
    pathname.startsWith("/api/metrics") ||
    pathname.startsWith("/api/reports") ||
    pathname.startsWith("/api/content") ||
    pathname.startsWith("/api/webhooks/supabase/")
  );
}
