import { createHmac, randomBytes } from "node:crypto";

export const TIKTOK_OAUTH_STATE_COOKIE = "moonarq_tiktok_oauth";
export const SECURE_TIKTOK_OAUTH_STATE_COOKIE = "__Host-moonarq_tiktok_oauth";
export const TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

type TikTokOAuthStatePayload = {
  v: 1;
  sourceId: string;
  dataSpaceSlug: string;
  returnPath: string;
  tiktokAppProfile?: "default" | "moonarq";
  nonce: string;
  iat: number;
  exp: number;
};

export class TikTokOAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokOAuthStateError";
  }
}

export function getTikTokOAuthStateCookieName(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production" ? SECURE_TIKTOK_OAUTH_STATE_COOKIE : TIKTOK_OAUTH_STATE_COOKIE;
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signingSecret(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.DASHBOARD_SESSION_SECRET?.trim();
  if (!secret) throw new TikTokOAuthStateError("DASHBOARD_SESSION_SECRET is required for TikTok OAuth state.");
  return secret;
}

function sign(payloadPart: string, secret: string) {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function verifySignedState(state: string | null | undefined, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  if (!state) throw new TikTokOAuthStateError("Missing TikTok OAuth state.");
  const [payloadPart, signature] = state.split(".");
  if (!payloadPart || !signature) throw new TikTokOAuthStateError("Invalid TikTok OAuth state.");
  if (sign(payloadPart, signingSecret(env)) !== signature) throw new TikTokOAuthStateError("Invalid TikTok OAuth state.");
  let payload: Partial<TikTokOAuthStatePayload>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart)) as Partial<TikTokOAuthStatePayload>;
  } catch {
    throw new TikTokOAuthStateError("Invalid TikTok OAuth state.");
  }
  if (
    payload.v !== 1 ||
    typeof payload.sourceId !== "string" ||
    !payload.sourceId ||
    typeof payload.dataSpaceSlug !== "string" ||
    !payload.dataSpaceSlug ||
    typeof payload.returnPath !== "string" ||
    !payload.returnPath.startsWith("/") ||
    (payload.tiktokAppProfile !== undefined && payload.tiktokAppProfile !== "default" && payload.tiktokAppProfile !== "moonarq") ||
    typeof payload.nonce !== "string" ||
    !payload.nonce
  ) {
    throw new TikTokOAuthStateError("Invalid TikTok OAuth state.");
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now / 1000)) {
    throw new TikTokOAuthStateError("TikTok OAuth state expired.");
  }
  return payload as TikTokOAuthStatePayload;
}

export function createTikTokOAuthState(
  input: { sourceId: string; dataSpaceSlug: string; returnPath: string; tiktokAppProfile?: "default" | "moonarq" },
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const issuedAt = Math.floor(now / 1000);
  const payload: TikTokOAuthStatePayload = {
    v: 1,
    sourceId: input.sourceId,
    dataSpaceSlug: input.dataSpaceSlug,
    returnPath: input.returnPath,
    tiktokAppProfile: input.tiktokAppProfile,
    nonce: randomBytes(16).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS,
  };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  return `${payloadPart}.${sign(payloadPart, signingSecret(env))}`;
}

export function validateSignedTikTokOAuthState(state: string | null | undefined, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  return verifySignedState(state, env, now);
}

export function validateTikTokOAuthState(state: string | null | undefined, cookieValue: string | null | undefined, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  if (!state) throw new TikTokOAuthStateError("Missing TikTok OAuth state.");
  if (!cookieValue) throw new TikTokOAuthStateError("Missing TikTok OAuth state cookie.");
  if (state !== cookieValue) throw new TikTokOAuthStateError("Invalid TikTok OAuth state.");
  return verifySignedState(state, env, now);
}
