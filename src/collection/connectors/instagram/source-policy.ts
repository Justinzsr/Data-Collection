import {
  AUTO_LAB_INSTAGRAM_ACCOUNT_ID,
  AUTO_LAB_INSTAGRAM_SOURCE_ID,
  AUTO_LAB_INSTAGRAM_USERNAME,
} from "@/collection/connectors/instagram/constants";
import type { InstagramAccountProfile } from "@/collection/connectors/instagram/graph-api";
import { AUTO_LAB_DATA_SPACE_SLUG, DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";

export type InstagramAccountSelection = {
  preferredAccountId: string | null;
  preferredUsername: string | null;
};

function metadataString(source: Source, key: string) {
  const value = source.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isAutoLabInstagramSource(source: Source) {
  return source.source_type_key === "instagram" && source.data_space_id === DATA_SPACE_IDS.autoLab && source.id === AUTO_LAB_INSTAGRAM_SOURCE_ID;
}

export function defaultInstagramReturnPath(dataSpaceSlug: string, sourceId: string) {
  return `/w/${dataSpaceSlug}/dashboard/sources/${sourceId}`;
}

export function safeInstagramReturnPath(input: string | null | undefined, dataSpaceSlug: string, sourceId: string) {
  const fallback = defaultInstagramReturnPath(dataSpaceSlug, sourceId);
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

export function getExpectedInstagramAccount(source: Source): InstagramAccountSelection {
  if (isAutoLabInstagramSource(source)) {
    return {
      preferredAccountId: AUTO_LAB_INSTAGRAM_ACCOUNT_ID,
      preferredUsername: AUTO_LAB_INSTAGRAM_USERNAME,
    };
  }
  return {
    preferredAccountId: metadataString(source, "expected_account_id"),
    preferredUsername: metadataString(source, "expected_username"),
  };
}

export function getInstagramAccountSelection(source: Source, credentials: Record<string, string> = {}): InstagramAccountSelection {
  const expected = getExpectedInstagramAccount(source);
  return {
    preferredAccountId: expected.preferredAccountId ?? credentials.instagram_account_id ?? source.external_account_id ?? null,
    preferredUsername: expected.preferredUsername,
  };
}

export function validateInstagramAccountForSource(source: Source, profile: InstagramAccountProfile) {
  const expected = getExpectedInstagramAccount(source);
  if (expected.preferredAccountId && profile.id !== expected.preferredAccountId) {
    throw new Error(
      isAutoLabInstagramSource(source)
        ? "Connected Instagram account ID does not match Auto Lab."
        : "Connected Instagram account ID does not match this source.",
    );
  }
  if (expected.preferredUsername && profile.username !== expected.preferredUsername) {
    throw new Error(
      isAutoLabInstagramSource(source)
        ? "Connected Instagram username does not match just.4is."
        : "Connected Instagram username does not match this source.",
    );
  }
}

export function instagramSourceLabel(source: Source) {
  if (isAutoLabInstagramSource(source)) return "Auto Lab just.4is Instagram";
  return source.display_name || "Instagram source";
}

export function expectedInstagramCopy(source: Source) {
  const expected = getExpectedInstagramAccount(source);
  if (isAutoLabInstagramSource(source)) return "just.4is";
  return expected.preferredUsername ?? expected.preferredAccountId ?? "Discovered during OAuth";
}

export function dataSpaceSlugForSource(source: Source, fallback = "moonarq") {
  if (source.data_space_id === DATA_SPACE_IDS.autoLab) return AUTO_LAB_DATA_SPACE_SLUG;
  if (source.data_space_id === DATA_SPACE_IDS.moonarq) return "moonarq";
  return fallback;
}
