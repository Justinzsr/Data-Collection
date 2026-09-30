import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, Eye, Heart, MessageCircle, Share2, Video } from "lucide-react";
import type { ReactNode } from "react";
import { getContentDashboard } from "@/aggregation/services/content-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { IconTile, PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export const dynamic = "force-dynamic";

const PLATFORM_FILTER_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  xiaohongshu: "Xiaohongshu",
};

type ContentDashboard = Awaited<ReturnType<typeof getContentDashboard>>;
type ContentItemRow = ContentDashboard["items"][number];
type BadgeTone = "cyan" | "green" | "amber" | "rose" | "slate" | "indigo";

function displayCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "Waiting for scope/data";
  return new Intl.NumberFormat("en-US").format(value);
}

function displayPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "Waiting for scope/data";
  return `${value.toFixed(1)}%`;
}

function latestMetric(metrics: ContentDashboard["metrics"], contentItemId: string, metricKey: string) {
  return metrics
    .filter((metric) => metric.content_item_id === contentItemId && metric.metric_key === metricKey)
    .sort((left, right) => `${left.date}:${left.updated_at}`.localeCompare(`${right.date}:${right.updated_at}`))
    .at(-1)?.metric_value ?? null;
}

function contentMetricTiles(content: ContentDashboard, itemId: string, sourceTypeKey: string) {
  if (sourceTypeKey === "tiktok") {
    return [
      { label: "Views", value: displayCount(latestMetric(content.metrics, itemId, "tiktok_video_views")) },
      { label: "Likes", value: displayCount(latestMetric(content.metrics, itemId, "tiktok_likes")) },
      { label: "Comments", value: displayCount(latestMetric(content.metrics, itemId, "tiktok_comments")) },
      { label: "Shares", value: displayCount(latestMetric(content.metrics, itemId, "tiktok_shares")) },
      { label: "Engagement", value: displayPercent(latestMetric(content.metrics, itemId, "tiktok_engagement_rate")) },
    ];
  }
  if (sourceTypeKey === "instagram") {
    return [
      { label: "Reach", value: displayCount(latestMetric(content.metrics, itemId, "instagram_media_reach")) },
      { label: "Likes", value: displayCount(latestMetric(content.metrics, itemId, "instagram_media_likes")) },
      { label: "Comments", value: displayCount(latestMetric(content.metrics, itemId, "instagram_media_comments")) },
      { label: "Saved", value: displayCount(latestMetric(content.metrics, itemId, "instagram_media_saved")) },
      { label: "Interactions", value: displayCount(latestMetric(content.metrics, itemId, "instagram_media_total_interactions")) },
    ];
  }
  return [];
}

function platformMeta(sourceTypeKey: string): { eyebrow: string; title: string; tone: BadgeTone; icon: ReactNode } {
  if (sourceTypeKey === "tiktok") {
    return {
      eyebrow: "Official TikTok API",
      title: "TikTok videos",
      tone: "indigo",
      icon: <PlatformIcon sourceTypeKey="tiktok" size="lg" />,
    };
  }
  if (sourceTypeKey === "instagram") {
    return {
      eyebrow: "Instagram Graph API",
      title: "Instagram media",
      tone: "indigo",
      icon: <PlatformIcon sourceTypeKey="instagram" size="lg" />,
    };
  }
  return {
    eyebrow: "Content source",
    title: "Other content",
    tone: "slate",
    icon: <PlatformIcon sourceTypeKey={sourceTypeKey} size="lg" />,
  };
}

function orderedContentGroups(items: ContentItemRow[]) {
  const groups = items.reduce<Record<string, ContentItemRow[]>>((acc, item) => {
    acc[item.source_type_key] ??= [];
    acc[item.source_type_key].push(item);
    return acc;
  }, {});
  const order = new Map([["tiktok", 0], ["instagram", 1]]);
  return Object.entries(groups).sort(([left], [right]) => (order.get(left) ?? 9) - (order.get(right) ?? 9) || left.localeCompare(right));
}

function MetricIcon({ label }: { label: string }) {
  if (label === "Views" || label === "Reach") return <Eye className="h-3 w-3" />;
  if (label === "Likes") return <Heart className="h-3 w-3" />;
  if (label === "Comments") return <MessageCircle className="h-3 w-3" />;
  if (label === "Shares") return <Share2 className="h-3 w-3" />;
  return null;
}

const PAGE_SIZE = 6;

export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<{ platform?: string; page?: string }>;
}) {
  const [{ dataSpaceSlug }, query] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const content = await getContentDashboard({ dataSpaceId: dataSpace.id });
  const basePath = dashboardPath(dataSpace.slug);
  const availablePlatforms: string[] = Array.from(new Set(content.items.map((item) => item.source_type_key)));
  const platform = query?.platform && availablePlatforms.includes(query.platform) ? query.platform : "all";
  const filteredItems = platform === "all" ? content.items : content.items.filter((item) => item.source_type_key === platform);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const requestedPage = Number.parseInt(query?.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) ? Math.min(Math.max(requestedPage, 1), totalPages) : 1;
  const pagedItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const contentGroups = orderedContentGroups(pagedItems);
  const filterHref = (nextPlatform: string, nextPage = 1) => `${basePath}/content?platform=${encodeURIComponent(nextPlatform)}&page=${nextPage}`;

  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <SectionHeader
        eyebrow="Aggregation layer"
        title={`${dataSpace.display_name} Content performance`}
        description="Official API media rows and per-content metrics scoped through sources in the current data space."
      />
      {content.items.length ? (
        <div className="grid gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <nav className="segmented max-w-full flex-nowrap overflow-x-auto" aria-label="Filter content by platform">
              {["all", ...availablePlatforms].map((key) => (
                <Link key={key} href={filterHref(key)} className="segmented-item min-h-9 shrink-0" aria-current={platform === key ? "page" : undefined}>
                  {key === "all" ? `All (${content.items.length})` : PLATFORM_FILTER_LABELS[key] ?? key}
                </Link>
              ))}
            </nav>
            <p className="px-1 text-xs text-muted">Showing {pagedItems.length} of {filteredItems.length}</p>
          </div>
          {contentGroups.map(([sourceTypeKey, items]) => {
            const meta = platformMeta(sourceTypeKey);
            return (
              <section key={sourceTypeKey} className="grid gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex items-start gap-3">
                    {meta.icon}
                    <div>
                      <p className="eyebrow">{meta.eyebrow}</p>
                      <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.022em] text-label">{meta.title}</h2>
                    </div>
                  </div>
                  <Badge tone={meta.tone} className="self-start">{items.length} content rows</Badge>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  {items.map((item) => {
                    const title = item.title ?? item.external_content_id;
                    const description = item.caption ?? "Waiting for caption/description data";
                    return (
                      <GlassPanel key={item.id} className="p-4 sm:p-5">
                        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap gap-2">
                              <Badge tone={meta.tone}>{item.source_type_key}</Badge>
                              <Badge>{item.content_type}</Badge>
                              {item.published_at ? <Badge tone="slate">{formatAppDateTime(item.published_at)}</Badge> : null}
                            </div>
                            <p className="break-words text-[15px] font-semibold tracking-[-0.01em] text-label">{title}</p>
                            <p className="mt-1 break-words text-sm leading-6 text-label-secondary">{description}</p>
                          </div>
                          {item.url ? (
                            <LinkButton href={item.url} variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" target="_blank" rel="noreferrer">
                              {item.source_type_key === "tiktok" ? "Open video" : "Open post"}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </LinkButton>
                          ) : null}
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2 2xl:grid-cols-5">
                          {contentMetricTiles(content, item.id, item.source_type_key).map((metric) => {
                            const waiting = metric.value === "Waiting for scope/data";
                            return (
                              <div key={metric.label} className="inset-surface p-2.5">
                                <p className="flex items-center gap-1 text-[11px] text-muted">
                                  <MetricIcon label={metric.label} />
                                  {metric.label}
                                </p>
                                <p className={`mt-1 break-words font-semibold ${waiting ? "text-xs leading-4 text-warning" : "text-sm text-label"}`}>{metric.value}</p>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Badge>{dataSpace.display_name}</Badge>
                        </div>
                      </GlassPanel>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-3 border-t border-separator pt-4" aria-label="Content pagination">
              {page > 1 ? (
                <LinkButton href={filterHref(platform, page - 1)} variant="secondary"><ChevronLeft className="h-4 w-4" /> Previous</LinkButton>
              ) : <span />}
              <p className="text-sm text-label-secondary">Page {page} of {totalPages}</p>
              {page < totalPages ? (
                <LinkButton href={filterHref(platform, page + 1)} variant="secondary">Next <ChevronRight className="h-4 w-4" /></LinkButton>
              ) : <span />}
            </nav>
          ) : null}
        </div>
      ) : (
        <GlassPanel className="p-6">
          <IconTile icon={Video} tone="pink" size="lg" className="mb-4" />
          <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">{dataSpace.display_name} has no content sources yet</h2>
          <p className="mt-2 text-sm leading-6 text-label-secondary">
            {dataSpace.slug === "auto-lab"
              ? "Use this space to test personal car/content TikTok and Instagram accounts."
              : "Connect a content source later with official APIs or webhooks before content metrics appear."}
          </p>
          {dataSpace.slug === "auto-lab" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href={`${basePath}/sources/new?template=tiktok`} variant="primary">Add Auto Lab TikTok</LinkButton>
              <LinkButton href={`${basePath}/sources/new?template=instagram`} variant="secondary">Add Auto Lab Instagram</LinkButton>
            </div>
          ) : null}
        </GlassPanel>
      )}
    </div>
  );
}
