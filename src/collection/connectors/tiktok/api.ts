import { createHash } from "node:crypto";
import { TIKTOK_OAUTH_SCOPES, TIKTOK_USER_FIELDS, TIKTOK_VIDEO_FIELDS } from "@/collection/connectors/tiktok/constants";
import type { JsonRecord } from "@/storage/db/schema";

export type TikTokOAuthConfig = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
  authBaseUrl: string;
};

export type TikTokTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
};

export type TikTokUserInfo = {
  open_id?: string;
  union_id?: string;
  avatar_url?: string;
  display_name?: string;
  bio_description?: string;
  profile_deep_link?: string;
  is_verified?: boolean;
  username?: string;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
};

export type TikTokVideo = {
  id: string;
  create_time?: number;
  cover_image_url?: string;
  share_url?: string;
  video_description?: string;
  duration?: number;
  height?: number;
  width?: number;
  title?: string;
  embed_link?: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
};

export type TikTokSyncSnapshot = {
  kind: "tiktok_sync_snapshot";
  sourceId: string;
  fetchedAt: string;
  account: TikTokUserInfo;
  videos: TikTokVideo[];
  scopes: string[];
  apiBaseUrl: string;
};

export class TikTokConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokConfigError";
  }
}

export class TikTokApiError extends Error {
  status: number;
  code?: string;
  logId?: string;
  constructor(message: string, options: { status: number; code?: string; logId?: string }) {
    super(message);
    this.name = "TikTokApiError";
    this.status = options.status;
    this.code = options.code;
    this.logId = options.logId;
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, key: keyof NodeJS.ProcessEnv & string) {
  const value = env[key]?.trim();
  if (!value) throw new TikTokConfigError(`${key} is required for TikTok OAuth.`);
  return value;
}

function optionalBaseUrl(value: string | undefined, fallback: string, envKey: string) {
  const raw = value?.trim() || fallback;
  try {
    const parsed = new URL(raw);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("invalid protocol");
    return parsed.origin;
  } catch {
    throw new TikTokConfigError(`${envKey} must be a valid absolute URL.`);
  }
}

function validateRedirectUri(redirectUri: string) {
  try {
    const parsed = new URL(redirectUri);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("invalid protocol");
  } catch {
    throw new TikTokConfigError("TIKTOK_REDIRECT_URI must be a valid absolute URL.");
  }
}

export function getTikTokOAuthConfig(env: NodeJS.ProcessEnv = process.env): TikTokOAuthConfig {
  const config = {
    clientKey: requiredEnv(env, "TIKTOK_CLIENT_KEY"),
    clientSecret: requiredEnv(env, "TIKTOK_CLIENT_SECRET"),
    redirectUri: requiredEnv(env, "TIKTOK_REDIRECT_URI"),
    apiBaseUrl: optionalBaseUrl(env.TIKTOK_API_BASE_URL, "https://open.tiktokapis.com", "TIKTOK_API_BASE_URL"),
    authBaseUrl: optionalBaseUrl(env.TIKTOK_AUTH_BASE_URL, "https://www.tiktok.com", "TIKTOK_AUTH_BASE_URL"),
  };
  validateRedirectUri(config.redirectUri);
  return config;
}

export function getTikTokOAuthDisplay(env: NodeJS.ProcessEnv = process.env) {
  return {
    label: "Auto Lab TikTok app",
    clientKeyEnvKey: "TIKTOK_CLIENT_KEY",
    redirectUriEnvKey: "TIKTOK_REDIRECT_URI",
    clientKeyConfigured: Boolean(env.TIKTOK_CLIENT_KEY?.trim()),
    redirectUriConfigured: Boolean(env.TIKTOK_REDIRECT_URI?.trim()),
    apiBaseUrl: env.TIKTOK_API_BASE_URL?.trim() || "https://open.tiktokapis.com",
  };
}

export function buildTikTokAuthorizationUrl(config: Pick<TikTokOAuthConfig, "authBaseUrl" | "clientKey" | "redirectUri">, state: string) {
  const url = new URL("/v2/auth/authorize/", config.authBaseUrl);
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", TIKTOK_OAUTH_SCOPES.join(","));
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url;
}

function apiUrl(config: Pick<TikTokOAuthConfig, "apiBaseUrl">, path: string) {
  return new URL(path.startsWith("/") ? path : `/${path}`, config.apiBaseUrl);
}

function sanitizeTikTokMessage(value: unknown) {
  const message = typeof value === "string" && value.trim() ? value.trim() : "TikTok API request failed.";
  return message
    .replace(/access_token=[^&\s]+/giu, "access_token=[redacted]")
    .replace(/refresh_token=[^&\s]+/giu, "refresh_token=[redacted]")
    .replace(/client_secret=[^&\s]+/giu, "client_secret=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gu, "Bearer [redacted]");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text } };
  }
}

function errorFromBody(body: unknown, status: number) {
  if (isRecord(body)) {
    const directCode = typeof body.error === "string" ? body.error : undefined;
    const directMessage = typeof body.error_description === "string" ? body.error_description : undefined;
    if (directCode || directMessage) {
      return new TikTokApiError(sanitizeTikTokMessage(directMessage ?? directCode), {
        status,
        code: directCode,
        logId: typeof body.log_id === "string" ? body.log_id : undefined,
      });
    }
    if (isRecord(body.error)) {
      return new TikTokApiError(sanitizeTikTokMessage(body.error.message), {
        status,
        code: typeof body.error.code === "string" ? body.error.code : undefined,
        logId: typeof body.error.log_id === "string" ? body.error.log_id : undefined,
      });
    }
  }
  return new TikTokApiError("TikTok API request failed.", { status });
}

async function tikTokFetch<T>(url: URL, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await readJson(response);
  if (!response.ok || (isRecord(body) && isRecord(body.error) && body.error.code !== "ok")) {
    throw errorFromBody(body, response.status);
  }
  return body as T;
}

export async function exchangeTikTokCodeForToken(code: string, config: TikTokOAuthConfig): Promise<TikTokTokenResponse> {
  const body = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
  return tikTokFetch<TikTokTokenResponse>(apiUrl(config, "/v2/oauth/token/"), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
    },
    body,
  });
}

export async function refreshTikTokAccessToken(refreshToken: string, config: TikTokOAuthConfig): Promise<TikTokTokenResponse> {
  const body = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return tikTokFetch<TikTokTokenResponse>(apiUrl(config, "/v2/oauth/token/"), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
    },
    body,
  });
}

export function tokenExpiresAt(expiresIn: number | undefined, now = new Date()) {
  return typeof expiresIn === "number" && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : null;
}

export function parseTikTokScopes(value: string | undefined | null) {
  return new Set((value ?? "").split(",").map((scope) => scope.trim()).filter(Boolean));
}

export function missingTikTokScopes(value: string | undefined | null, required = ["user.info.basic", "video.list"]) {
  const scopes = parseTikTokScopes(value);
  return required.filter((scope) => !scopes.has(scope));
}

function userFieldsForScopes(scopeValue: string | undefined | null) {
  const scopes = parseTikTokScopes(scopeValue);
  if (scopes.size === 0) return TIKTOK_USER_FIELDS;
  const fields = ["open_id", "union_id", "avatar_url", "display_name"];
  if (scopes.has("user.info.profile")) fields.push("bio_description", "profile_deep_link", "is_verified", "username");
  if (scopes.has("user.info.stats")) fields.push("follower_count", "following_count", "likes_count", "video_count");
  return fields;
}

function normalizeUser(value: unknown): TikTokUserInfo {
  if (!isRecord(value)) return {};
  return {
    open_id: stringValue(value.open_id),
    union_id: stringValue(value.union_id),
    avatar_url: stringValue(value.avatar_url),
    display_name: stringValue(value.display_name),
    bio_description: stringValue(value.bio_description),
    profile_deep_link: stringValue(value.profile_deep_link),
    is_verified: typeof value.is_verified === "boolean" ? value.is_verified : undefined,
    username: stringValue(value.username),
    follower_count: numberValue(value.follower_count),
    following_count: numberValue(value.following_count),
    likes_count: numberValue(value.likes_count),
    video_count: numberValue(value.video_count),
  };
}

function normalizeVideo(value: unknown): TikTokVideo | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  return {
    id,
    create_time: numberValue(value.create_time),
    cover_image_url: stringValue(value.cover_image_url),
    share_url: stringValue(value.share_url),
    video_description: stringValue(value.video_description),
    duration: numberValue(value.duration),
    height: numberValue(value.height),
    width: numberValue(value.width),
    title: stringValue(value.title),
    embed_link: stringValue(value.embed_link),
    like_count: numberValue(value.like_count),
    comment_count: numberValue(value.comment_count),
    share_count: numberValue(value.share_count),
    view_count: numberValue(value.view_count),
  };
}

export async function fetchTikTokUserInfo(accessToken: string, config: Pick<TikTokOAuthConfig, "apiBaseUrl">, scopeValue?: string | null) {
  const url = apiUrl(config, "/v2/user/info/");
  url.searchParams.set("fields", userFieldsForScopes(scopeValue).join(","));
  const body = await tikTokFetch<{ data?: { user?: unknown } }>(url, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return normalizeUser(body.data?.user);
}

export async function fetchTikTokVideos(accessToken: string, config: Pick<TikTokOAuthConfig, "apiBaseUrl">, options: { maxPages?: number } = {}) {
  const videos: TikTokVideo[] = [];
  let cursor: number | undefined;
  let hasMore = true;
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 5, 10));

  for (let page = 0; page < maxPages && hasMore; page += 1) {
    const url = apiUrl(config, "/v2/video/list/");
    url.searchParams.set("fields", TIKTOK_VIDEO_FIELDS.join(","));
    const body = await tikTokFetch<{ data?: { videos?: unknown[]; cursor?: number; has_more?: boolean } }>(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
    });
    videos.push(...(body.data?.videos ?? []).flatMap((item) => {
      const video = normalizeVideo(item);
      return video ? [video] : [];
    }));
    cursor = typeof body.data?.cursor === "number" ? body.data.cursor : undefined;
    hasMore = Boolean(body.data?.has_more && cursor);
  }

  return { videos, cursorAfter: cursor ?? null, hasMore };
}

export function selectTikTokAccessToken(credentials: Record<string, string>) {
  return credentials.tiktok_access_token || "";
}

export function isTikTokTokenExpired(credentials: Record<string, string>, now = new Date()) {
  const expiresAt = credentials.expires_at;
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= now.getTime());
}

export function isTikTokRefreshExpired(credentials: Record<string, string>, now = new Date()) {
  const expiresAt = credentials.refresh_expires_at;
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= now.getTime());
}

export function hashTikTokPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
