import { createHmac, randomBytes } from "node:crypto";

export const INSTAGRAM_OAUTH_STATE_COOKIE = "moonarq_instagram_oauth";
export const SECURE_INSTAGRAM_OAUTH_STATE_COOKIE = "__Host-moonarq_instagram_oauth";
export const INSTAGRAM_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

type InstagramMetaAppProfileKey = "default" | "moonarq";

type InstagramOAuthStatePayload = {
  v: 1;
  sourceId: string;
  dataSpaceSlug: string;
  returnPath: string;
  metaAppProfile?: InstagramMetaAppProfileKey;
  nonce: string;
  iat: number;
  exp: number;
};

export class InstagramOAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramOAuthStateError";
  }
}

export function getInstagramOAuthStateCookieName(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production" ? SECURE_INSTAGRAM_OAUTH_STATE_COOKIE : INSTAGRAM_OAUTH_STATE_COOKIE;
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signingSecret(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.DASHBOARD_SESSION_SECRET?.trim();
  if (!secret) throw new InstagramOAuthStateError("DASHBOARD_SESSION_SECRET is required for Instagram OAuth state.");
  return secret;
}

function sign(payloadPart: string, secret: string) {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function verifySignedState(state: string | null | undefined, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  if (!state) throw new InstagramOAuthStateError("Missing Instagram OAuth state.");
  const [payloadPart, signature] = state.split(".");
  if (!payloadPart || !signature) throw new InstagramOAuthStateError("Invalid Instagram OAuth state.");
  if (sign(payloadPart, signingSecret(env)) !== signature) throw new InstagramOAuthStateError("Invalid Instagram OAuth state.");
  let payload: Partial<InstagramOAuthStatePayload>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart)) as Partial<InstagramOAuthStatePayload>;
  } catch {
    throw new InstagramOAuthStateError("Invalid Instagram OAuth state.");
  }
  if (
    payload.v !== 1 ||
    typeof payload.sourceId !== "string" ||
    !payload.sourceId ||
    typeof payload.dataSpaceSlug !== "string" ||
    !payload.dataSpaceSlug ||
    typeof payload.returnPath !== "string" ||
    !payload.returnPath.startsWith("/") ||
    (payload.metaAppProfile !== undefined && payload.metaAppProfile !== "default" && payload.metaAppProfile !== "moonarq")
  ) {
    throw new InstagramOAuthStateError("Invalid Instagram OAuth state.");
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now / 1000)) {
    throw new InstagramOAuthStateError("Instagram OAuth state expired.");
  }
  return payload as InstagramOAuthStatePayload;
}

export function createInstagramOAuthState(
  input: { sourceId: string; dataSpaceSlug: string; returnPath: string; metaAppProfile?: InstagramMetaAppProfileKey } | string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const issuedAt = Math.floor(now / 1000);
  const payloadInput = typeof input === "string"
    ? { sourceId: input, dataSpaceSlug: "auto-lab", returnPath: `/w/auto-lab/dashboard/sources/${input}` }
    : input;
  const payload: InstagramOAuthStatePayload = {
    v: 1,
    sourceId: payloadInput.sourceId,
    dataSpaceSlug: payloadInput.dataSpaceSlug,
    returnPath: payloadInput.returnPath,
    metaAppProfile: payloadInput.metaAppProfile,
    nonce: randomBytes(16).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + INSTAGRAM_OAUTH_STATE_MAX_AGE_SECONDS,
  };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  return `${payloadPart}.${sign(payloadPart, signingSecret(env))}`;
}

export function validateSignedInstagramOAuthState(state: string | null | undefined, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  return verifySignedState(state, env, now);
}

export function validateInstagramOAuthState(state: string | null | undefined, cookieValue: string | null | undefined, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  if (!state) throw new InstagramOAuthStateError("Missing Instagram OAuth state.");
  if (!cookieValue) throw new InstagramOAuthStateError("Missing Instagram OAuth state cookie.");
  if (state !== cookieValue) throw new InstagramOAuthStateError("Invalid Instagram OAuth state.");
  return verifySignedState(state, env, now);
}
