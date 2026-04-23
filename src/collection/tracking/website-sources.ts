import type { Source, SourceTypeKey } from "@/storage/db/schema";

export const WEBSITE_SOURCE_KEYS = ["vercel_web_analytics_drain", "website"] as const;

export type WebsiteSourceKey = (typeof WEBSITE_SOURCE_KEYS)[number];

const preference: Record<WebsiteSourceKey, number> = {
  vercel_web_analytics_drain: 0,
  website: 1,
};

export function isWebsiteSourceKey(value: SourceTypeKey): value is WebsiteSourceKey {
  return WEBSITE_SOURCE_KEYS.includes(value as WebsiteSourceKey);
}

export function getWebsiteModeLabel(source: Pick<Source, "source_type_key" | "status"> | null | undefined) {
  if (!source) return "Demo";
  if (source.source_type_key === "vercel_web_analytics_drain") return "Vercel Drain";
  if (source.status === "demo") return "Demo";
  return "Website Tracker";
}

export function resolvePrimaryWebsiteSource(sources: Source[]) {
  return sources
    .filter((source): source is Source & { source_type_key: WebsiteSourceKey } => isWebsiteSourceKey(source.source_type_key) && source.status !== "disabled")
    .sort((left, right) => preference[left.source_type_key] - preference[right.source_type_key])[0] ?? null;
}

export function listSecondaryWebsiteSources(sources: Source[]) {
  const primary = resolvePrimaryWebsiteSource(sources);
  return sources.filter(
    (source): source is Source & { source_type_key: WebsiteSourceKey } => isWebsiteSourceKey(source.source_type_key) && source.id !== primary?.id,
  );
}
