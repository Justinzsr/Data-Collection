import { notFound } from "next/navigation";
import { getContentDashboard } from "@/aggregation/services/content-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export const dynamic = "force-dynamic";

function displayCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return new Intl.NumberFormat("en-US").format(value);
}

function displayPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "0.0%";
  return `${value.toFixed(1)}%`;
}

function latestMetric(metrics: Awaited<ReturnType<typeof getContentDashboard>>["metrics"], contentItemId: string, metricKey: string) {
  return metrics
    .filter((metric) => metric.content_item_id === contentItemId && metric.metric_key === metricKey)
    .sort((left, right) => `${left.date}:${left.updated_at}`.localeCompare(`${right.date}:${right.updated_at}`))
    .at(-1)?.metric_value ?? null;
}

function contentMetricTiles(content: Awaited<ReturnType<typeof getContentDashboard>>, itemId: string, sourceTypeKey: string) {
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

export default async function ContentPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const content = await getContentDashboard({ dataSpaceId: dataSpace.id });
  const basePath = dashboardPath(dataSpace.slug);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Aggregation layer"
        title={`${dataSpace.display_name} Content performance`}
        description="Official API media rows and per-content metrics scoped through sources in the current data space."
      />
      {content.items.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {content.items.map((item) => (
            <GlassPanel key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{item.title ?? item.external_content_id}</p>
                  <p className="mt-1 text-sm text-slate-400">{item.caption}</p>
                </div>
                <Badge tone={item.source_type_key === "tiktok" ? "rose" : item.source_type_key === "instagram" ? "indigo" : "slate"}>{item.source_type_key}</Badge>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {contentMetricTiles(content, item.id, item.source_type_key).map((metric) => (
                  <div key={metric.label} className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
                    <p className="mt-1 text-sm font-semibold text-white">{metric.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>{item.content_type}</Badge>
                {item.published_at ? <Badge tone="slate">{formatAppDateTime(item.published_at)}</Badge> : null}
                <Badge>{dataSpace.display_name}</Badge>
                {item.url ? (
                  <LinkButton href={item.url} variant="ghost" className="min-h-8 px-2 text-xs" target="_blank" rel="noreferrer">
                    Open
                  </LinkButton>
                ) : null}
              </div>
            </GlassPanel>
          ))}
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
