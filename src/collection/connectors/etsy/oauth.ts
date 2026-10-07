import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ETSY_AUTHORIZE_URL, ETSY_SCOPES } from "@/collection/connectors/etsy/constants";
import { ETSY_CALLBACK_PATH } from "@/collection/connectors/etsy/paths";
import { decryptSecret, encryptSecret } from "@/storage/credentials/encryption";

/*
 * OAuth 2.0 authorization code flow with PKCE (S256), which Etsy requires on
 * every authorization. The state sent to Etsy is signed so the callback can
 * trust which source it belongs to; the PKCE verifier never leaves this server:
 * it travels only inside an encrypted, HttpOnly cookie.
 */

export const ETSY_OAUTH_COOKIE = "moonarq_etsy_oauth";
export const SECURE_ETSY_OAUTH_COOKIE = "__Host-moonarq_etsy_oauth";
export const ETSY_OAUTH_MAX_AGE_SECONDS = 10 * 60;

export class EtsyOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EtsyOAuthError";
  }
}

export type EtsyOAuthStatePayload = {
  v: 1;
  sourceId: string;
  dataSpaceSlug: string;
  returnPath: string;
  /** The redirect URI sent to Etsy, which the token request must repeat exactly. */
  redirectUri: string;
  nonce: string;
  iat: number;
  exp: number;
};

export function etsyOAuthCookieName(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production" ? SECURE_ETSY_OAUTH_COOKIE : ETSY_OAUTH_COOKIE;
}

/** RFC 7636: a 43-character verifier from 32 random bytes, and its SHA-256 challenge. */
export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * A key of its own, derived from the session secret, so an Etsy state (which
 * travels in URLs) can never pass as a dashboard session signed with that secret.
 */
function signingSecret(env: NodeJS.ProcessEnv) {
  const secret = env.DASHBOARD_SESSION_SECRET?.trim();
  if (!secret) throw new EtsyOAuthError("DASHBOARD_SESSION_SECRET is required for Etsy OAuth.");
  return createHmac("sha256", secret).update("moonarq:etsy-oauth-state:v1").digest();
}

function sign(payloadPart: string, key: Buffer) {
  return createHmac("sha256", key).update(payloadPart).digest("base64url");
}

function sameText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createEtsyOAuthState(
  input: { sourceId: string; dataSpaceSlug: string; returnPath: string; redirectUri: string },
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const issuedAt = Math.floor(now / 1000);
  const payload: EtsyOAuthStatePayload = {
    v: 1,
    ...input,
    nonce: randomBytes(16).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + ETSY_OAUTH_MAX_AGE_SECONDS,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadPart}.${sign(payloadPart, signingSecret(env))}`;
}

/** The payload of a state this server signed, whether or not it has expired; null for anything else. */
function signedStatePayload(state: string | null | undefined, env: NodeJS.ProcessEnv): EtsyOAuthStatePayload | null {
  if (!state) return null;
  const [payloadPart, signature, extra] = state.split(".");
  if (!payloadPart || !signature || extra !== undefined || !sameText(sign(payloadPart, signingSecret(env)), signature)) return null;
  let payload: Partial<EtsyOAuthStatePayload>;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Partial<EtsyOAuthStatePayload>;
  } catch {
    return null;
  }
  if (
    payload.v !== 1
    || typeof payload.sourceId !== "string" || !payload.sourceId
    || typeof payload.dataSpaceSlug !== "string" || !payload.dataSpaceSlug
    || typeof payload.returnPath !== "string" || !payload.returnPath.startsWith("/")
    || typeof payload.redirectUri !== "string" || !/^https?:\/\//u.test(payload.redirectUri)
    || typeof payload.nonce !== "string" || !payload.nonce
    || typeof payload.exp !== "number"
  ) {
    return null;
  }
  return payload as EtsyOAuthStatePayload;
}

export function verifyEtsyOAuthState(state: string | null | undefined, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  if (!state) throw new EtsyOAuthError("Missing Etsy OAuth state.");
  const payload = signedStatePayload(state, env);
  if (!payload) throw new EtsyOAuthError("Invalid Etsy OAuth state.");
  if (payload.exp <= Math.floor(now / 1000)) {
    throw new EtsyOAuthError("The Etsy sign-in took too long. Start again from the source page.");
  }
  return payload;
}

/**
 * Where to send the seller back when the callback cannot be trusted to finish
 * (the sign-in took too long, or ended in another browser). The signature proves
 * this server chose the page; the code is never exchanged on this path.
 */
export function etsyReturnPathFromState(state: string | null | undefined, env: NodeJS.ProcessEnv = process.env) {
  try {
    const payload = signedStatePayload(state, env);
    return payload ? safeEtsyReturnPath(payload.returnPath, payload.dataSpaceSlug, payload.sourceId) : null;
  } catch {
    return null;
  }
}

/** The state and its PKCE verifier, sealed with the app encryption key so only this server can read them. */
export function sealEtsyOAuthCookie(value: { state: string; verifier: string }) {
  const sealed = encryptSecret(JSON.stringify(value));
  return [sealed.iv, sealed.authTag, sealed.encryptedValue].map((part) => Buffer.from(part, "base64").toString("base64url")).join(".");
}

export function openEtsyOAuthCookie(cookie: string | null | undefined): { state: string; verifier: string } {
  const parts = (cookie ?? "").split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new EtsyOAuthError("The Etsy sign-in cookie is missing. Start again from the source page.");
  const [iv, authTag, encryptedValue] = parts.map((part) => Buffer.from(part, "base64url").toString("base64"));
  let value: unknown;
  try {
    value = JSON.parse(decryptSecret({ iv, authTag, encryptedValue }));
  } catch {
    throw new EtsyOAuthError("The Etsy sign-in cookie is invalid. Start again from the source page.");
  }
  const record = value as { state?: unknown; verifier?: unknown };
  if (typeof record.state !== "string" || typeof record.verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/u.test(record.verifier)) {
    throw new EtsyOAuthError("The Etsy sign-in cookie is invalid. Start again from the source page.");
  }
  return { state: record.state, verifier: record.verifier };
}

/** Checks the state Etsy returned against the sealed cookie, and returns the trusted payload and the verifier. */
export function validateEtsyCallback(
  stateParam: string | null | undefined,
  cookie: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  if (!stateParam) throw new EtsyOAuthError("Missing Etsy OAuth state.");
  const sealed = openEtsyOAuthCookie(cookie);
  if (!sameText(sealed.state, stateParam)) throw new EtsyOAuthError("Invalid Etsy OAuth state.");
  return { payload: verifyEtsyOAuthState(stateParam, env, now), verifier: sealed.verifier };
}

/**
 * Where Etsy sends the seller back: this site, at the address the dashboard was
 * opened at, so the sign-in cookie is there when they return. It must match a
 * callback URL registered on the Etsy app exactly; the source page shows it.
 */
export function etsyRedirectUri(requestUrl: string) {
  return `${new URL(requestUrl).origin}${ETSY_CALLBACK_PATH}`;
}

export function buildEtsyAuthorizationUrl(input: { keystring: string; redirectUri: string; state: string; challenge: string }) {
  const url = new URL(ETSY_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.keystring);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", ETSY_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

/** Returns only to this source's page (or the sources list) in the same data space. */
export function safeEtsyReturnPath(input: string | null | undefined, dataSpaceSlug: string, sourceId: string) {
  const fallback = `/w/${dataSpaceSlug}/dashboard/sources/${sourceId}`;
  if (!input) return fallback;
  try {
    const parsed = new URL(input, "https://data-hub.local");
    if (parsed.origin !== "https://data-hub.local") return fallback;
    const path = `${parsed.pathname}${parsed.search}`;
    return path === fallback || path.startsWith(`${fallback}?`) || path === `/w/${dataSpaceSlug}/dashboard/sources` ? path : fallback;
  } catch {
    return fallback;
  }
}
