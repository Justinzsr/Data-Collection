import { Bookmark, ExternalLink, Eye, Heart, MessageCircle, Share2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InstagramMediaInsightRow } from "@/aggregation/services/instagram-dashboard-service";
import type { TikTokVideoInsightRow } from "@/aggregation/services/tiktok-dashboard-service";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { formatMetricValue } from "@/presentation/components/ui/format";
import { GlassPanel, SectionTitle } from "@/presentation/components/ui/panel";
import { formatAppDate } from "@/storage/runtime/app-time";

type ContentStat = { label: string; value: number | null; unit?: string; icon?: LucideIcon };

function ContentRow({
  kind,
  publishedAt,
  title,
  body,
  url,
  linkLabel,
  stats,
}: {
  kind: string;
  publishedAt: string | null;
  title: string | null;
  body: string;
  url: string | null;
  linkLabel: string;
  stats: ContentStat[];
}) {
  return (
    <li className="inset-surface min-w-0 p-3.5">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge tone="indigo">{kind}</Badge>
            {publishedAt ? <Badge tone="slate">{formatAppDate(publishedAt)}</Badge> : null}
          </div>
          {title ? <p className="break-words text-sm font-semibold text-label">{title}</p> : null}
          <p className="break-words text-sm leading-6 text-label-secondary">{body}</p>
        </div>
        {url ? (
          <LinkButton href={url} variant="ghost" className="min-h-11 shrink-0 px-3 text-xs sm:min-h-9" target="_blank" rel="noreferrer">
            {linkLabel}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </LinkButton>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0 rounded-xl bg-fill p-2.5">
            <dt className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
              {stat.icon ? <stat.icon className="h-3 w-3" aria-hidden="true" /> : null}
              {stat.label}
            </dt>
            <dd className="tabular mt-1 truncate text-sm font-semibold text-label">{formatMetricValue(stat.value, stat.unit ?? "count")}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

export function InstagramMediaList({ media }: { media: InstagramMediaInsightRow[] }) {
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="instagram-media-title" data-testid="instagram-media">
      <SectionTitle title="Recent posts" id="instagram-media-title" action={<span className="text-xs text-[var(--muted)]">Latest insights from the last sync</span>} />
      <GlassPanel className="min-w-0 p-3 sm:p-4">
        {media.length > 0 ? (
          <ul className="grid min-w-0 gap-3">
            {media.map((item) => (
              <ContentRow
                key={`${item.sourceId}-${item.externalContentId}`}
                kind={item.mediaType.replaceAll("_", " ").toLowerCase()}
                publishedAt={item.publishedAt}
                title={null}
                body={item.captionPreview}
                url={item.url}
                linkLabel="Open post"
                stats={[
                  { label: "Reach", value: item.reach, icon: Eye },
                  { label: "Likes", value: item.likes, icon: Heart },
                  { label: "Comments", value: item.comments, icon: MessageCircle },
                  { label: "Saved", value: item.saved, icon: Bookmark },
                  { label: "Interactions", value: item.totalInteractions },
                ]}
              />
            ))}
          </ul>
        ) : (
          <p className="p-1 text-sm text-label-secondary" role="status">No post insights yet. Run a sync from the source to load recent posts.</p>
        )}
      </GlassPanel>
    </section>
  );
}

export function TikTokVideoList({ videos }: { videos: TikTokVideoInsightRow[] }) {
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="tiktok-videos-title" data-testid="tiktok-videos">
      <SectionTitle title="Recent videos" id="tiktok-videos-title" action={<span className="text-xs text-[var(--muted)]">Cumulative counts from the last sync</span>} />
      <GlassPanel className="min-w-0 p-3 sm:p-4">
        {videos.length > 0 ? (
          <ul className="grid min-w-0 gap-3">
            {videos.map((item) => (
              <ContentRow
                key={`${item.sourceId}-${item.externalContentId}`}
                kind="video"
                publishedAt={item.publishedAt}
                title={item.title}
                body={item.description}
                url={item.url}
                linkLabel="Open video"
                stats={[
                  { label: "Views", value: item.views, icon: Eye },
                  { label: "Likes", value: item.likes, icon: Heart },
                  { label: "Comments", value: item.comments, icon: MessageCircle },
                  { label: "Shares", value: item.shares, icon: Share2 },
                  { label: "Engagement", value: item.engagementRate, unit: "percent" },
                ]}
              />
            ))}
          </ul>
        ) : (
          <p className="p-1 text-sm text-label-secondary" role="status">No video metrics yet. TikTok shares them after the video.list scope is granted and a sync runs.</p>
        )}
      </GlassPanel>
    </section>
  );
}
