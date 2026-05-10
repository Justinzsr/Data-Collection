import { createHash } from "node:crypto";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { INSTAGRAM_OAUTH_SCOPES } from "@/collection/connectors/instagram/constants";

export type InstagramMetaAppProfileKey = "default" | "moonarq";

export type InstagramOAuthConfig = {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  redirectUri: string;
  profileKey: InstagramMetaAppProfileKey;
  profileLabel: string;
  appIdEnvKey: string;
};

export type InstagramTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

export type InstagramAccountProfile = {
  id: string;
  username: string;
  followers_count: number;
  media_count: number;
  page_id?: string | null;
};

export type InstagramAccountLookupOptions = {
  preferredAccountId?: string | null;
  preferredUsername?: string | null;
};

export type InstagramMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

export type InstagramMediaInsight = {
  id: string;
  name: string;
  values?: Array<{ value?: number }>;
};

export type InstagramInsightFailure = {
  mediaId: string;
  metric: string;
  message: string;
};

export type InstagramSyncSnapshot = {
  kind: "instagram_sync_snapshot";
  account: InstagramAccountProfile;
  media: Array<InstagramMedia & { insights: Record<string, number>; insightErrors?: InstagramInsightFailure[] }>;
  graphApiVersion: string;
  fetchedAt: string;
};

export class InstagramConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramConfigError";
  }
}

export class InstagramGraphApiError extends Error {
  status: number;
  code?: number;
  errorType?: string;
  constructor(message: string, options: { status: number; code?: number; errorType?: string }) {
    super(message);
    this.name = "InstagramGraphApiError";
    this.status = options.status;
    this.code = options.code;
    this.errorType = options.errorType;
  }
}

type MetaAppProfileDefinition = {
  key: InstagramMetaAppProfileKey;
  label: string;
  appIdEnvKey: string;
  appSecretEnvKey: string;
  graphApiVersionEnvKey: string;
  redirectUriEnvKey: string;
};

export type InstagramMetaAppDisplay = Omit<MetaAppProfileDefinition, "appSecretEnvKey"> & {
  appSecretEnvKey: string;
  appIdConfigured: boolean;
  redirectUriConfigured: boolean;
  graphApiVersion: string;
};

const META_APP_PROFILES: Record<InstagramMetaAppProfileKey, MetaAppProfileDefinition> = {
  default: {
    key: "default",
    label: "Default / Auto Lab Meta app",
    appIdEnvKey: "META_APP_ID",
    appSecretEnvKey: "META_APP_SECRET",
    graphApiVersionEnvKey: "META_GRAPH_API_VERSION",
    redirectUriEnvKey: "META_REDIRECT_URI",
  },
  moonarq: {
    key: "moonarq",
    label: "MoonArq Meta app",
    appIdEnvKey: "MOONARQ_META_APP_ID",
    appSecretEnvKey: "MOONARQ_META_APP_SECRET",
    graphApiVersionEnvKey: "MOONARQ_META_GRAPH_API_VERSION",
    redirectUriEnvKey: "MOONARQ_META_REDIRECT_URI",
  },
};

function requiredEnv(env: NodeJS.ProcessEnv, key: keyof NodeJS.ProcessEnv & string) {
  const value = env[key]?.trim();
  if (!value) throw new InstagramConfigError(`${key} is required for Instagram OAuth.`);
  return value;
}

function metadataString(source: Source, key: string) {
  const value = source.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function moonarqProfileConfigured(env: NodeJS.ProcessEnv) {
  return Boolean(
    env.MOONARQ_META_APP_ID?.trim() ||
      env.MOONARQ_META_APP_SECRET?.trim() ||
      env.MOONARQ_META_GRAPH_API_VERSION?.trim() ||
      env.MOONARQ_META_REDIRECT_URI?.trim(),
  );
}

function profileKeyForSource(source: Source, env: NodeJS.ProcessEnv = process.env): InstagramMetaAppProfileKey {
  const explicitProfile = metadataString(source, "meta_app_profile");
  if (explicitProfile === "default" || explicitProfile === "moonarq") return explicitProfile;
  if (explicitProfile) throw new InstagramConfigError(`Unsupported Instagram Meta app profile "${explicitProfile}".`);
  if (source.data_space_id === DATA_SPACE_IDS.moonarq && moonarqProfileConfigured(env)) return "moonarq";
  return "default";
}

export function getInstagramMetaAppProfileForSource(source: Source, env: NodeJS.ProcessEnv = process.env) {
  return META_APP_PROFILES[profileKeyForSource(source, env)];
}

export function getInstagramMetaAppDisplay(source: Source, env: NodeJS.ProcessEnv = process.env): InstagramMetaAppDisplay {
  const profile = getInstagramMetaAppProfileForSource(source, env);
  return {
    ...profile,
    appIdConfigured: Boolean(env[profile.appIdEnvKey]?.trim()),
    redirectUriConfigured: Boolean(env[profile.redirectUriEnvKey]?.trim()),
    graphApiVersion: env[profile.graphApiVersionEnvKey]?.trim() || env.META_GRAPH_API_VERSION?.trim() || "v25.0",
  };
}

function validateRedirectUri(redirectUri: string, envKey: string) {
  try {
    const parsed = new URL(redirectUri);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid protocol");
  } catch {
    throw new InstagramConfigError(`${envKey} must be a valid absolute URL.`);
  }
}

export function getInstagramOAuthConfig(env: NodeJS.ProcessEnv = process.env): InstagramOAuthConfig {
  const profile = META_APP_PROFILES.default;
  const config: InstagramOAuthConfig = {
    appId: requiredEnv(env, "META_APP_ID"),
    appSecret: requiredEnv(env, "META_APP_SECRET"),
    graphApiVersion: env.META_GRAPH_API_VERSION?.trim() || "v25.0",
    redirectUri: requiredEnv(env, "META_REDIRECT_URI"),
    profileKey: profile.key,
    profileLabel: profile.label,
    appIdEnvKey: profile.appIdEnvKey,
  };
  validateRedirectUri(config.redirectUri, profile.redirectUriEnvKey);
  return config;
}

export function getInstagramOAuthConfigForSource(
  source: Source,
  env: NodeJS.ProcessEnv = process.env,
  expectedProfileKey?: InstagramMetaAppProfileKey,
): InstagramOAuthConfig {
  const profile = getInstagramMetaAppProfileForSource(source, env);
  if (expectedProfileKey && profile.key !== expectedProfileKey) {
    throw new InstagramConfigError(`Instagram OAuth state was issued for ${expectedProfileKey} Meta app profile, but this source now resolves to ${profile.key}.`);
  }
  const config: InstagramOAuthConfig = {
    appId: requiredEnv(env, profile.appIdEnvKey),
    appSecret: requiredEnv(env, profile.appSecretEnvKey),
    graphApiVersion: env[profile.graphApiVersionEnvKey]?.trim() || env.META_GRAPH_API_VERSION?.trim() || "v25.0",
    redirectUri: requiredEnv(env, profile.redirectUriEnvKey),
    profileKey: profile.key,
    profileLabel: profile.label,
    appIdEnvKey: profile.appIdEnvKey,
  };
  validateRedirectUri(config.redirectUri, profile.redirectUriEnvKey);
  return config;
}

export function buildInstagramAuthorizationUrl(config: Pick<InstagramOAuthConfig, "appId" | "graphApiVersion" | "redirectUri">, state: string) {
  const url = new URL(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_OAUTH_SCOPES.join(","));
  return url;
}

function graphUrl(config: Pick<InstagramOAuthConfig, "graphApiVersion">, path: string) {
  return new URL(`https://graph.facebook.com/${config.graphApiVersion}${path.startsWith("/") ? path : `/${path}`}`);
}

function sanitizeGraphMessage(value: unknown) {
  const message = typeof value === "string" && value.trim() ? value.trim() : "Instagram Graph API request failed.";
  return message
    .replace(/access_token=[^&\s]+/giu, "access_token=[redacted]")
    .replace(/client_secret=[^&\s]+/giu, "client_secret=[redacted]")
    .replace(/fb_exchange_token=[^&\s]+/giu, "fb_exchange_token=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gu, "Bearer [redacted]");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function readGraphJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text } };
  }
}

async function graphFetch<T>(url: URL, accessToken?: string, init?: RequestInit): Promise<T> {
  if (accessToken) url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, init);
  const body = await readGraphJson(response);
  if (!response.ok || (isRecord(body) && isRecord(body.error))) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    throw new InstagramGraphApiError(sanitizeGraphMessage(error.message), {
      status: response.status,
      code: typeof error.code === "number" ? error.code : undefined,
      errorType: typeof error.type === "string" ? error.type : undefined,
    });
  }
  return body as T;
}

export async function exchangeCodeForToken(code: string, config: InstagramOAuthConfig): Promise<InstagramTokenResponse> {
  const url = graphUrl(config, "/oauth/access_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("code", code);
  return graphFetch<InstagramTokenResponse>(url);
}

export async function exchangeForLongLivedToken(accessToken: string, config: InstagramOAuthConfig): Promise<InstagramTokenResponse> {
  const url = graphUrl(config, "/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("fb_exchange_token", accessToken);
  return graphFetch<InstagramTokenResponse>(url);
}

export async function fetchInstagramAccountProfile(
  accessToken: string,
  config: Pick<InstagramOAuthConfig, "graphApiVersion">,
  options: InstagramAccountLookupOptions | string = {},
): Promise<InstagramAccountProfile> {
  const lookup = typeof options === "string" ? { preferredAccountId: options } : options;
  const accountsUrl = graphUrl(config, "/me/accounts");
  accountsUrl.searchParams.set("fields", "id,name,instagram_business_account{id,username,followers_count,media_count}");
  const accounts = await graphFetch<{ data?: Array<{ id?: string; instagram_business_account?: InstagramAccountProfile }> }>(accountsUrl, accessToken);
  const pages = accounts.data ?? [];
  const pageMatch = pages.find((page) => {
    const instagram = page.instagram_business_account;
    if (!instagram?.id) return false;
    if (lookup.preferredAccountId && instagram.id === lookup.preferredAccountId) return true;
    if (lookup.preferredUsername && instagram.username === lookup.preferredUsername) return true;
    return false;
  }) ?? (!lookup.preferredAccountId && !lookup.preferredUsername ? pages.find((page) => page.instagram_business_account?.id) : undefined);
  if (pageMatch?.instagram_business_account?.id) {
    return {
      ...pageMatch.instagram_business_account,
      followers_count: numberValue(pageMatch.instagram_business_account.followers_count),
      media_count: numberValue(pageMatch.instagram_business_account.media_count),
      page_id: pageMatch.id ?? null,
    };
  }

  if (!lookup.preferredAccountId) {
    throw new InstagramGraphApiError("No connected Instagram Business or Creator account was found for this Meta user.", { status: 404 });
  }

  const profileUrl = graphUrl(config, `/${lookup.preferredAccountId}`);
  profileUrl.searchParams.set("fields", "id,username,followers_count,media_count");
  const profile = await graphFetch<InstagramAccountProfile>(profileUrl, accessToken);
  return {
    id: profile.id,
    username: profile.username,
    followers_count: numberValue(profile.followers_count),
    media_count: numberValue(profile.media_count),
    page_id: profile.page_id ?? null,
  };
}

export async function fetchInstagramMedia(accessToken: string, config: Pick<InstagramOAuthConfig, "graphApiVersion">, instagramAccountId: string): Promise<InstagramMedia[]> {
  const url = graphUrl(config, `/${instagramAccountId}/media`);
  url.searchParams.set("fields", "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count");
  url.searchParams.set("limit", "25");
  const body = await graphFetch<{ data?: InstagramMedia[] }>(url, accessToken);
  return body.data ?? [];
}

async function fetchInsightMetric(accessToken: string, config: Pick<InstagramOAuthConfig, "graphApiVersion">, mediaId: string, metric: string): Promise<number> {
  const url = graphUrl(config, `/${mediaId}/insights`);
  url.searchParams.set("metric", metric);
  const body = await graphFetch<{ data?: InstagramMediaInsight[] }>(url, accessToken);
  return numberValue(body.data?.find((item) => item.name === metric)?.values?.[0]?.value);
}

export async function fetchMediaInsights(accessToken: string, config: Pick<InstagramOAuthConfig, "graphApiVersion">, mediaId: string): Promise<{ insights: Record<string, number>; failures: InstagramInsightFailure[] }> {
  const metrics = ["reach", "saved", "total_interactions"];
  const url = graphUrl(config, `/${mediaId}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  try {
    const body = await graphFetch<{ data?: InstagramMediaInsight[] }>(url, accessToken);
    return {
      insights: Object.fromEntries(metrics.map((metric) => [metric, numberValue(body.data?.find((item) => item.name === metric)?.values?.[0]?.value)])),
      failures: [],
    };
  } catch {
    const insights: Record<string, number> = {};
    const failures: InstagramInsightFailure[] = [];
    for (const metric of metrics) {
      try {
        insights[metric] = await fetchInsightMetric(accessToken, config, mediaId, metric);
      } catch (metricError) {
        failures.push({
          mediaId,
          metric,
          message: metricError instanceof Error ? metricError.message : "Unsupported Instagram insight metric.",
        });
      }
    }
    return { insights, failures };
  }
}

export function tokenExpiresAt(expiresIn: number | undefined, now = new Date()) {
  return typeof expiresIn === "number" && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : null;
}

export function selectInstagramAccessToken(credentials: Record<string, string>) {
  return credentials.instagram_long_lived_access_token || credentials.instagram_access_token || credentials.graph_api_access_token || "";
}

export function isTokenExpired(credentials: Record<string, string>, now = new Date()) {
  const expiresAt = credentials.expires_at;
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= now.getTime());
}

export function hashInstagramPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
