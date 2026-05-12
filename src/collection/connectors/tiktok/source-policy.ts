import { AUTO_LAB_TIKTOK_SOURCE_ID } from "@/collection/connectors/tiktok/constants";
import { AUTO_LAB_DATA_SPACE_SLUG, DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";

export function isAutoLabTikTokSource(source: Source) {
  return source.source_type_key === "tiktok" && source.data_space_id === DATA_SPACE_IDS.autoLab && source.id === AUTO_LAB_TIKTOK_SOURCE_ID;
}

export function assertAutoLabTikTokSource(source: Source) {
  if (!isAutoLabTikTokSource(source)) {
    throw new Error("TikTok OAuth is currently enabled only for the Auto Lab TikTok source.");
  }
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
