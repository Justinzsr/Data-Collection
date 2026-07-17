import type { Source, SourceTypeKey } from "@/storage/db/schema";

export const WEBSITE_SOURCE_KEYS = ["vercel_web_analytics_drain", "website"] as const;

export type WebsiteSourceKey = (typeof WEBSITE_SOURCE_KEYS)[number];

const statusPreference: Record<Source["status"], number> = {
  healthy: 0,
  warning: 1,
  error: 2,
  needs_credentials: 3,
  demo: 4,
  disabled: 5,
};

export function isWebsiteSourceKey(value: SourceTypeKey): value is WebsiteSourceKey {
  return WEBSITE_SOURCE_KEYS.includes(value as WebsiteSourceKey);
}

export function getWebsiteSourceRole(sourceTypeKey: WebsiteSourceKey) {
  return sourceTypeKey === "website" ? "authoritative" as const : "auxiliary" as const;
}

export function normalizeAllowedOrigins(value: string) {
  const candidates = value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean);
  if (candidates.length === 0 || candidates.length > 20) {
    throw new Error("Provide between 1 and 20 allowed HTTP(S) origins.");
  }
  return [...new Set(candidates.map((candidate) => {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== candidate) {
      throw new Error("Allowed origins must be exact HTTP(S) origins without paths or query strings.");
    }
    return url.origin;
  }))];
}

export function getWebsiteModeLabel(source: Pick<Source, "source_type_key" | "status"> | null | undefined) {
  if (!source) return "Demo";
  if (source.source_type_key === "vercel_web_analytics_drain") return "Vercel Drain";
  if (source.status === "demo") return "Demo";
  return "Website Tracker";
}

export function resolvePrimaryWebsiteSource(sources: Source[]) {
  return sources
    .filter((source): source is Source & { source_type_key: "website" } => source.source_type_key === "website" && source.status !== "disabled")
    .sort((left, right) => statusPreference[left.status] - statusPreference[right.status])[0] ?? null;
}

export function listSecondaryWebsiteSources(sources: Source[]) {
  const primary = resolvePrimaryWebsiteSource(sources);
  return sources.filter(
    (source): source is Source & { source_type_key: WebsiteSourceKey } => isWebsiteSourceKey(source.source_type_key) && source.id !== primary?.id,
  );
}
