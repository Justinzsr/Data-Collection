import { AUTO_LAB_TIKTOK_SOURCE_ID } from "@/collection/connectors/tiktok/constants";
import type { TikTokAppProfileKey } from "@/collection/connectors/tiktok/api";
import { AUTO_LAB_DATA_SPACE_SLUG, DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";

function metadataString(source: Source, key: string) {
  const value = source.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedTikTokUsername(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^@+/, "");
  return normalized ? normalized.toLocaleLowerCase("en-US") : null;
}

export type TikTokOAuthIdentity = {
  openId: string | null | undefined;
  username: string | null | undefined;
};

export type TikTokOAuthIdentityCheck =
  | { ok: true }
  | { ok: false; reason: "open_id_mismatch" | "open_id_missing" | "username_mismatch" | "username_missing" };

/**
 * Protect an already-connected source from being silently rebound to another
 * TikTok account. open_id is stable across username changes, so a matching
 * open_id deliberately permits a rename and lets the callback refresh labels.
 */
export function checkTikTokOAuthIdentity(source: Source, candidate: TikTokOAuthIdentity): TikTokOAuthIdentityCheck {
  const expectedOpenId = source.external_account_id?.trim() || metadataString(source, "tiktok_open_id");
  const candidateOpenId = candidate.openId?.trim() || null;
  if (expectedOpenId) {
    if (!candidateOpenId) return { ok: false, reason: "open_id_missing" };
    return candidateOpenId === expectedOpenId ? { ok: true } : { ok: false, reason: "open_id_mismatch" };
  }

  const wasConnected = source.metadata.oauth_connected === true;
  if (!wasConnected) return { ok: true };

  const expectedUsername = normalizedTikTokUsername(
    metadataString(source, "tiktok_username") ?? source.account_name,
  );
  if (!expectedUsername) return { ok: true };
  const candidateUsername = normalizedTikTokUsername(candidate.username);
  if (!candidateUsername) return { ok: false, reason: "username_missing" };
  return candidateUsername === expectedUsername
    ? { ok: true }
    : { ok: false, reason: "username_mismatch" };
}

export function canonicalTikTokProfileUrl(username: string | null | undefined, profileDeepLink?: string | null) {
  const normalizedUsername = username?.trim().replace(/^@+/, "");
  if (normalizedUsername) return `https://www.tiktok.com/@${encodeURIComponent(normalizedUsername)}`;
  if (!profileDeepLink) return null;
  try {
    const parsed = new URL(profileDeepLink);
    const isTikTokHost = parsed.hostname === "tiktok.com" || parsed.hostname.endsWith(".tiktok.com");
    const profileSegment = parsed.pathname.split("/").filter(Boolean)[0];
    if (!isTikTokHost || !profileSegment?.startsWith("@")) return null;
    return `https://www.tiktok.com/${encodeURIComponent(profileSegment).replace("%40", "@")}`;
  } catch {
    return null;
  }
}

export function isAutoLabTikTokSource(source: Source) {
  return source.source_type_key === "tiktok" && source.data_space_id === DATA_SPACE_IDS.autoLab && source.id === AUTO_LAB_TIKTOK_SOURCE_ID;
}

export function isTikTokSource(source: Source) {
  return source.source_type_key === "tiktok";
}

export function assertAutoLabTikTokSource(source: Source) {
  if (!isAutoLabTikTokSource(source)) {
    throw new Error("This operation requires the existing Auto Lab TikTok source.");
  }
}

export function assertTikTokSource(source: Source) {
  if (!isTikTokSource(source)) {
    throw new Error("TikTok OAuth/API sync can only be used with TikTok sources.");
  }
}

export function getTikTokAppProfileKeyForSource(source: Source): TikTokAppProfileKey {
  const explicitProfile = metadataString(source, "tiktok_app_profile") ?? metadataString(source, "oauth_app_profile");
  if (explicitProfile === "default" || explicitProfile === "moonarq") return explicitProfile;
  if (explicitProfile) throw new Error(`Unsupported TikTok app profile "${explicitProfile}".`);
  if (
    source.data_space_id === DATA_SPACE_IDS.moonarq &&
    (process.env.MOONARQ_TIKTOK_CLIENT_KEY?.trim() ||
      process.env.MOONARQ_TIKTOK_CLIENT_SECRET?.trim() ||
      process.env.MOONARQ_TIKTOK_REDIRECT_URI?.trim() ||
      process.env.MOONARQ_TIKTOK_API_BASE_URL?.trim() ||
      process.env.MOONARQ_TIKTOK_AUTH_BASE_URL?.trim())
  ) {
    return "moonarq";
  }
  return "default";
}

export function defaultTikTokReturnPath(dataSpaceSlug: string, sourceId: string) {
  return `/w/${dataSpaceSlug}/dashboard/sources/${sourceId}`;
}

export function safeTikTokReturnPath(input: string | null | undefined, dataSpaceSlug: string, sourceId: string) {
  const fallback = defaultTikTokReturnPath(dataSpaceSlug, sourceId);
  if (!input) return fallback;
  try {
    const parsed = input.startsWith("/") ? new URL(input, "https://data-hub.local") : new URL(input);
    if (parsed.origin !== "https://data-hub.local") return fallback;
    const path = `${parsed.pathname}${parsed.search}`;
    return path === fallback || path.startsWith(`${fallback}?`) || path === `/w/${dataSpaceSlug}/dashboard/sources` ? path : fallback;
  } catch {
    return fallback;
  }
}

export function dataSpaceSlugForTikTokSource(source: Source, fallback = "moonarq") {
  if (source.data_space_id === DATA_SPACE_IDS.autoLab) return AUTO_LAB_DATA_SPACE_SLUG;
  if (source.data_space_id === DATA_SPACE_IDS.moonarq) return "moonarq";
  return fallback;
}

export function tiktokSourceLabel(source: Source) {
  if (isAutoLabTikTokSource(source)) return "Auto Lab TikTok";
  return source.display_name || "TikTok source";
}
