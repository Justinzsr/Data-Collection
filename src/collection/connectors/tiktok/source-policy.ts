import { AUTO_LAB_TIKTOK_SOURCE_ID } from "@/collection/connectors/tiktok/constants";
import type { TikTokAppProfileKey } from "@/collection/connectors/tiktok/api";
import { AUTO_LAB_DATA_SPACE_SLUG, DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";

function metadataString(source: Source, key: string) {
  const value = source.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
