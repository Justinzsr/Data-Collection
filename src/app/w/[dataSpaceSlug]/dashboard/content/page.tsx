import { notFound } from "next/navigation";
import { Camera, ExternalLink, Eye, Heart, MessageCircle, Share2, Video } from "lucide-react";
import type { ReactNode } from "react";
import { getContentDashboard } from "@/aggregation/services/content-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export const dynamic = "force-dynamic";

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

function platformMeta(sourceTypeKey: string): { eyebrow: string; title: string; tone: BadgeTone; icon: ReactNode; sectionClass: string } {
  if (sourceTypeKey === "tiktok") {
    return {
      eyebrow: "Official TikTok API",
      title: "TikTok videos",
      tone: "rose",
      icon: <Video className="h-5 w-5 text-rose-100" />,
      sectionClass: "border-rose-200/10 bg-rose-300/[0.04]",
    };
  }
  if (sourceTypeKey === "instagram") {
    return {
      eyebrow: "Instagram Graph API",
      title: "Instagram media",
      tone: "indigo",
      icon: <Camera className="h-5 w-5 text-indigo-100" />,
      sectionClass: "border-indigo-200/10 bg-indigo-300/[0.04]",
    };
  }
  return {
    eyebrow: "Content source",
    title: "Other content",
    tone: "slate",
    icon: <Video className="h-5 w-5 text-slate-100" />,
    sectionClass: "border-white/10 bg-white/[0.03]",
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

export default async function ContentPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const content = await getContentDashboard({ dataSpaceId: dataSpace.id });
  const basePath = dashboardPath(dataSpace.slug);
  const contentGroups = orderedContentGroups(content.items);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Aggregation layer"
        title={`${dataSpace.display_name} Content performance`}
        description="Official API media rows and per-content metrics scoped through sources in the current data space."
      />
      {content.items.length ? (
        <div className="grid gap-6">
          {contentGroups.map(([sourceTypeKey, items]) => {
            const meta = platformMeta(sourceTypeKey);
            return (
              <section key={sourceTypeKey} className="grid gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
                      {meta.icon}
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{meta.eyebrow}</p>
                      <h2 className="mt-1 text-xl font-semibold text-white">{meta.title}</h2>
                    </div>
                  </div>
                  <Badge tone={meta.tone}>{items.length} content rows</Badge>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {items.map((item) => {
                    const title = item.title ?? item.external_content_id;
                    const description = item.caption ?? "Waiting for caption/description data";
                    return (
                      <GlassPanel key={item.id} className={`p-4 ${meta.sectionClass}`}>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap gap-2">
                              <Badge tone={meta.tone}>{item.source_type_key}</Badge>
                              <Badge>{item.content_type}</Badge>
                              {item.published_at ? <Badge tone="slate">{formatAppDateTime(item.published_at)}</Badge> : null}
                            </div>
                            <p className="break-words font-medium text-white">{title}</p>
                            <p className="mt-1 break-words text-sm leading-6 text-slate-300">{description}</p>
                          </div>
                          {item.url ? (
                            <LinkButton href={item.url} variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" target="_blank" rel="noreferrer">
                              {item.source_type_key === "tiktok" ? "Open video" : "Open post"}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </LinkButton>
                          ) : null}
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                          {contentMetricTiles(content, item.id, item.source_type_key).map((metric) => {
                            const waiting = metric.value === "Waiting for scope/data";
                            return (
                              <div key={metric.label} className="rounded-lg border border-white/10 bg-black/20 p-2">
                                <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                                  <MetricIcon label={metric.label} />
                                  {metric.label}
                                </p>
                                <p className={`mt-1 break-words font-semibold ${waiting ? "text-xs leading-4 text-amber-100" : "text-sm text-white"}`}>{metric.value}</p>
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
        </div>
      ) : (
        <GlassPanel className="p-5">
          <h2 className="text-lg font-semibold text-white">{dataSpace.display_name} has no content sources yet</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
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
