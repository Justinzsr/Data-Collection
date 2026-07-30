import { ArrowRight, Bookmark, Camera, Car, ChevronDown, ExternalLink, Eye, FileText, Heart, MessageCircle, Plus, Share2, TableProperties, Video } from "lucide-react";
import { notFound } from "next/navigation";
import { getDailyReport } from "@/aggregation/services/daily-report-service";
import { getInstagramDashboardSummary, type InstagramDashboardSummary } from "@/aggregation/services/instagram-dashboard-service";
import { getInstagramPaidAdsSummary, type InstagramPaidAdsSummary, type PaidMetricValue } from "@/aggregation/services/meta-ads-attribution-service";
import { getTikTokDashboardSummary, type TikTokDashboardSummary } from "@/aggregation/services/tiktok-dashboard-service";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import { getGlobalPlatformHealth, getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { getWebsiteFunnelOverview } from "@/aggregation/services/website-funnel-service";
import { getDataSpaceBySlug, isAutoLabDataSpace } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { addDaysToDateKey, dateKeyInAppTimeZone, formatAppDateTime } from "@/storage/runtime/app-time";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { PlatformTrendChart } from "@/presentation/charts/platform-trend-chart";
import { CommerceOutcomes } from "@/presentation/dashboard/commerce-outcomes";
import { CommandCenterHeader } from "@/presentation/dashboard/command-center-header";
import { GlobalHealthStrip } from "@/presentation/dashboard/global-health-strip";
import { PlatformModuleCard } from "@/presentation/dashboard/platform-module-card";
import { InstagramPaidAdsPanel } from "@/presentation/dashboard/instagram-paid-ads-panel";
import { MoonArqOverviewHeader } from "@/presentation/dashboard/moonarq-overview-header";
import { parseMoonArqOverviewQuery } from "@/presentation/dashboard/moonarq-overview-query";
import { StorefrontBreakdowns } from "@/presentation/dashboard/storefront-breakdowns";
import { StorefrontConversionTrend } from "@/presentation/dashboard/storefront-conversion-trend";
import { StorefrontFunnel } from "@/presentation/dashboard/storefront-funnel";
import { StorefrontJourneys } from "@/presentation/dashboard/storefront-journeys";
import { WebsiteBusinessPulse } from "@/presentation/dashboard/website-business-pulse";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

function parseRange(value: string | undefined): DateRangeKey {
  if (value === "today" || value === "7d" || value === "30d") return value;
  return "30d";
}

function moduleSeries(modules: Awaited<ReturnType<typeof getPlatformModules>>) {
  const preferred = [
    { key: "website", color: "#38bdf8" },
    { key: "supabase", color: "#2dd4bf" },
    { key: "tiktok", color: "#fb7185" },
    { key: "instagram", color: "#818cf8" },
  ] as const;
  return preferred
    .map((item) => {
      const platformModule = modules.find((candidate) => candidate.sourceTypeKey === item.key);
      if (!platformModule) return null;
      return { key: platformModule.sourceTypeKey, label: platformModule.platformLabel, color: item.color, data: platformModule.sparkline };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function displayCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "Waiting";
  return new Intl.NumberFormat("en-US").format(value);
}

function displayPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "Waiting";
  return `${value.toFixed(1)}%`;
}

function displayWaitingCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "Waiting for scope/data";
  return new Intl.NumberFormat("en-US").format(value);
}

function displayWaitingPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "Waiting for scope/data";
  return `${value.toFixed(1)}%`;
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function paidStateLabel(state: InstagramPaidAdsSummary["state"]) {
  if (state === "not_connected") return "Connect Ads";
  if (state === "needs_account") return "Select account";
  if (state === "first_sync") return "First sync pending";
  if (state === "no_delivery") return "No matching delivery";
  if (state === "ready") return "Live";
  if (state === "stale") return "Source warning";
  return "Sync error";
}

function compactPaidMetric(metric: PaidMetricValue) {
  if (metric.state !== "ready" || metric.value === null) return "—";
  if (metric.unit === "ratio") return `${metric.value.toFixed(2)}×`;
  if (metric.unit === "percent") return `${metric.value.toFixed(1)}%`;
  if (/^[a-z]{3}$/i.test(metric.unit)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: metric.unit.toUpperCase(),
        maximumFractionDigits: 2,
      }).format(metric.value);
    } catch {
      return `${metric.unit.toUpperCase()} ${metric.value.toFixed(2)}`;
    }
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(metric.value);
}

function InstagramMetricTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}

function TikTokMetricTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  const waiting = value === "Waiting for scope/data";
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-2 break-words font-semibold ${waiting ? "text-sm leading-5 text-amber-100" : "text-2xl text-white"}`}>{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}

function InstagramInsightsPanel({ summary, paid, basePath, dataSpaceSlug }: {
  summary: InstagramDashboardSummary;
  paid: InstagramPaidAdsSummary | null;
  basePath: string;
  dataSpaceSlug: string;
}) {
  if (summary.sources.length === 0) return null;
  const primary = summary.sources[0];
  const media = primary.media;

  return (
    <details className="overview-social-card group glass min-w-0 overflow-hidden rounded-xl">
      <summary className="cursor-pointer p-3 transition hover:bg-white/[0.025]">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/10">
              <Camera className="h-4 w-4 text-fuchsia-100" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-200/75">Instagram Graph API</p>
              <h2 className="mt-0.5 truncate text-sm font-semibold text-white">
                {primary.username ? `@${primary.username}` : primary.displayName}
              </h2>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {displayCount(primary.stats.followers)} followers · {displayCount(primary.stats.reach)} reach · {media.length} posts
              </p>
              {paid ? (
                <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5 text-[10px] text-slate-400">
                  <span className="rounded border border-fuchsia-300/15 bg-fuchsia-300/[0.05] px-1.5 py-0.5 text-fuchsia-100">Ads: {paidStateLabel(paid.state)}</span>
                  <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5">Spend {compactPaidMetric(paid.outcomes.spend)}</span>
                  <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5">Revenue {compactPaidMetric(paid.outcomes.attributedNetRevenue)}</span>
                  <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5">ROAS {compactPaidMetric(paid.outcomes.shopifyRoas)}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={primary.status === "healthy" ? "green" : primary.status === "error" ? "rose" : "amber"}>{statusLabel(primary.status)}</Badge>
            <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
          </div>
        </div>
      </summary>

      <div className="grid gap-4 border-t border-white/10 p-3 sm:p-4">
        {paid ? (
          <InstagramPaidAdsPanel
            summary={paid}
            instagramSourceId={primary.sourceId}
            dataSpaceSlug={dataSpaceSlug}
            returnPath={`${basePath}/sources/${primary.sourceId}`}
          />
        ) : null}

        <details className="group rounded-xl border border-white/10 bg-black/10">
          <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-xs font-medium text-slate-300">
            <span>Organic account &amp; media details</span>
            <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="grid gap-4 border-t border-white/10 p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InstagramMetricTile label="Followers" value={displayCount(primary.stats.followers)} detail="Account snapshot" />
          <InstagramMetricTile label="Account media" value={displayCount(primary.stats.accountMediaCount)} detail={`${displayCount(primary.stats.fetchedMediaCount)} fetched`} />
          <InstagramMetricTile label="Media reach" value={displayCount(primary.stats.reach)} detail="Available insights summed" />
          <InstagramMetricTile label="Engagement rate" value={displayPercent(primary.stats.engagementRate)} detail="Interactions / reach" />
          <InstagramMetricTile label="Likes" value={displayCount(primary.stats.likes)} />
          <InstagramMetricTile label="Comments" value={displayCount(primary.stats.comments)} />
          <InstagramMetricTile label="Saved" value={displayCount(primary.stats.saved)} />
          <InstagramMetricTile label="Interactions" value={displayCount(primary.stats.totalInteractions)} />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/15 p-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Last sync: <span className="text-slate-200">{primary.lastSyncedAt ? formatAppDateTime(primary.lastSyncedAt) : "No sync yet"}</span></span>
            {primary.graphApiVersion ? <span>Graph API: <span className="text-slate-200">{primary.graphApiVersion}</span></span> : null}
            {primary.accountId ? <span>IG account: <span className="text-slate-200">{primary.accountId}</span></span> : null}
            {primary.pageId ? <span>Page: <span className="text-slate-200">{primary.pageId}</span></span> : null}
            {primary.tokenExpiresAt ? <span>Token expires: <span className="text-slate-200">{formatAppDateTime(primary.tokenExpiresAt)}</span></span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`${basePath}/sources/${primary.sourceId}`} variant="secondary" className="min-h-9 px-3 text-xs">
              Source
              <ArrowRight className="h-3.5 w-3.5" />
            </LinkButton>
            <LinkButton href={`${basePath}/data?tab=raw_ingestions&sourceId=${primary.sourceId}`} variant="ghost" className="min-h-9 px-3 text-xs">
              Raw sync
              <ArrowRight className="h-3.5 w-3.5" />
            </LinkButton>
          </div>
        </div>

        <div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-200/75">Media performance</p>
              <h3 className="mt-1 text-base font-semibold text-white">Latest synced posts and reels</h3>
            </div>
            <Badge tone="slate">{media.length} visible media rows</Badge>
          </div>

          {media.length > 0 ? (
            <div className="grid gap-3">
              {media.map((item) => (
                <div key={`${item.sourceId}-${item.externalContentId}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge tone="indigo">{item.mediaType}</Badge>
                        {item.publishedAt ? <Badge tone="slate">{formatAppDateTime(item.publishedAt)}</Badge> : null}
                      </div>
                      <p className="break-words text-sm leading-6 text-slate-200">{item.captionPreview}</p>
                    </div>
                    {item.url ? (
                      <LinkButton href={item.url} variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" target="_blank" rel="noreferrer">
                        Open post
                        <ExternalLink className="h-3.5 w-3.5" />
                      </LinkButton>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Reach</p>
                      <p className="mt-1 text-sm font-semibold text-white">{displayCount(item.reach)}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-500"><Heart className="h-3 w-3" /> Likes</p>
                      <p className="mt-1 text-sm font-semibold text-white">{displayCount(item.likes)}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-500"><MessageCircle className="h-3 w-3" /> Comments</p>
                      <p className="mt-1 text-sm font-semibold text-white">{displayCount(item.comments)}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-500"><Bookmark className="h-3 w-3" /> Saved</p>
                      <p className="mt-1 text-sm font-semibold text-white">{displayCount(item.saved)}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Interactions</p>
                      <p className="mt-1 text-sm font-semibold text-white">{displayCount(item.totalInteractions)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-4">
              <p className="text-sm font-medium text-amber-100">No synced Instagram media metrics yet</p>
              <p className="mt-2 text-sm leading-6 text-amber-50/75">Open the Instagram source and run a manual sync to populate account and media insights.</p>
            </div>
          )}
        </div>
          </div>
        </details>
      </div>
    </details>
  );
}

function TikTokSourceInsightsPanel({ source, basePath }: { source: TikTokDashboardSummary["sources"][number]; basePath: string }) {
  const videos = source.videos;
  const accountLabel = source.username ? `@${source.username.replace(/^@/, "")}` : source.displayNameOnPlatform ?? source.displayName;

  return (
    <details className="overview-social-card group glass min-w-0 overflow-hidden rounded-xl">
      <summary className="cursor-pointer p-3 transition hover:bg-white/[0.025]">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-300/20 bg-rose-300/10">
              <Video className="h-4 w-4 text-rose-100" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-200/75">TikTok official API</p>
              <h2 className="mt-0.5 truncate text-sm font-semibold text-white">{accountLabel}</h2>
              <p className="mt-0.5 truncate text-xs text-slate-500">{displayWaitingCount(source.stats.videoViews)} views · {displayWaitingCount(source.stats.followers)} followers · {source.stats.fetchedVideoCount} fetched videos</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={source.status === "healthy" ? "green" : source.status === "error" ? "rose" : "amber"}>{statusLabel(source.status)}</Badge>
            <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
          </div>
        </div>
      </summary>

      <div className="grid gap-4 border-t border-white/10 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <Badge tone="rose">Current snapshot</Badge>
          <span>Cumulative account and fetched-video totals from the latest TikTok sync; not affected by the dashboard date range.</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TikTokMetricTile label="Video views" value={displayWaitingCount(source.stats.videoViews)} detail="Latest fetched-video total" />
          <TikTokMetricTile label="Likes" value={displayWaitingCount(source.stats.likes)} />
          <TikTokMetricTile label="Comments" value={displayWaitingCount(source.stats.comments)} />
          <TikTokMetricTile label="Shares" value={displayWaitingCount(source.stats.shares)} />
          <TikTokMetricTile label="Engagement rate" value={displayWaitingPercent(source.stats.engagementRate)} detail="Likes + comments + shares / views" />
          <TikTokMetricTile label="Followers" value={displayWaitingCount(source.stats.followers)} detail="Current account snapshot" />
          <TikTokMetricTile label="Video count" value={displayWaitingCount(source.stats.videoCount)} detail={`${displayWaitingCount(source.stats.fetchedVideoCount)} fetched now`} />
          <TikTokMetricTile label="Profile likes" value={displayWaitingCount(source.stats.profileLikes)} detail="Current account snapshot" />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/15 p-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Last sync: <span className="text-slate-200">{source.lastSyncedAt ? formatAppDateTime(source.lastSyncedAt) : "No sync yet"}</span></span>
            <span>Token: <span className={source.tokenExpiresAt ? "text-slate-200" : "text-amber-100"}>{source.tokenExpiresAt ? `expires ${formatAppDateTime(source.tokenExpiresAt)}` : "expiry pending"}</span></span>
            {source.openId ? <span>Open ID: <span className="text-slate-200">{source.openId}</span></span> : <span>Open ID: <span className="text-amber-100">Waiting for scope/data</span></span>}
            <span>Scopes: <span className="text-slate-200">{source.scopes.length ? source.scopes.join(", ") : "Waiting for granted scopes"}</span></span>
            {source.lastError ? <span>Last error: <span className="text-rose-200">{source.lastError}</span></span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`${basePath}/sources/${source.sourceId}`} variant="secondary" className="min-h-9 px-3 text-xs">
              Source
              <ArrowRight className="h-3.5 w-3.5" />
            </LinkButton>
            <LinkButton href={`${basePath}/data?tab=raw_ingestions&sourceId=${source.sourceId}`} variant="ghost" className="min-h-9 px-3 text-xs">
              Raw sync
              <ArrowRight className="h-3.5 w-3.5" />
            </LinkButton>
          </div>
        </div>

        <div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-200/75">Video performance</p>
              <h3 className="mt-1 text-base font-semibold text-white">Videos in the latest TikTok snapshot</h3>
            </div>
            <Badge tone="slate">{videos.length} visible video rows</Badge>
          </div>

          {videos.length > 0 ? (
            <div className="grid gap-3">
              {videos.map((item) => (
                <div key={`${item.sourceId}-${item.externalContentId}`} className="rounded-lg border border-rose-200/10 bg-rose-300/[0.04] p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge tone="rose">TikTok video</Badge>
                        {item.publishedAt ? <Badge tone="slate">{formatAppDateTime(item.publishedAt)}</Badge> : null}
                      </div>
                      <p className="break-words text-sm font-semibold text-white">{item.title}</p>
                      <p className="mt-1 break-words text-sm leading-6 text-slate-300">{item.description}</p>
                    </div>
                    {item.url ? (
                      <LinkButton href={item.url} variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" target="_blank" rel="noreferrer">
                        Open video
                        <ExternalLink className="h-3.5 w-3.5" />
                      </LinkButton>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-500"><Eye className="h-3 w-3" /> Views</p>
                      <p className="mt-1 break-words text-sm font-semibold text-white">{displayWaitingCount(item.views)}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-500"><Heart className="h-3 w-3" /> Likes</p>
                      <p className="mt-1 break-words text-sm font-semibold text-white">{displayWaitingCount(item.likes)}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-500"><MessageCircle className="h-3 w-3" /> Comments</p>
                      <p className="mt-1 break-words text-sm font-semibold text-white">{displayWaitingCount(item.comments)}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-slate-500"><Share2 className="h-3 w-3" /> Shares</p>
                      <p className="mt-1 break-words text-sm font-semibold text-white">{displayWaitingCount(item.shares)}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Engagement</p>
                      <p className="mt-1 break-words text-sm font-semibold text-white">{displayWaitingPercent(item.engagementRate)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-4">
              <p className="text-sm font-medium text-amber-100">Waiting for TikTok video metrics</p>
              <p className="mt-2 text-sm leading-6 text-amber-50/75">Run a manual sync after TikTok grants the video.list scope to populate video rows and performance metrics.</p>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function TikTokInsightsPanel({ summary, basePath }: { summary: TikTokDashboardSummary; basePath: string }) {
  if (summary.sources.length === 0) return null;

  return summary.sources.map((source) => <TikTokSourceInsightsPanel key={source.sourceId} source={source} basePath={basePath} />);
}

function AutoLabEmptyState({ dataSpaceSlug }: { dataSpaceSlug: string }) {
  const basePath = dashboardPath(dataSpaceSlug);
  return (
    <GlassPanel className="grid gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-rose-200/20 bg-rose-300/10">
            <Car className="h-6 w-6 text-rose-100" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-200/80">Isolated testing space</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Auto Lab has no sources yet</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Use this space to test personal car/content TikTok and Instagram accounts. Company sources are intentionally excluded from this workspace.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <LinkButton href={`${basePath}/sources/new?template=tiktok`} variant="primary">
            <Video className="h-4 w-4" />
            Add Auto Lab TikTok
          </LinkButton>
          <LinkButton href={`${basePath}/sources/new?template=instagram`} variant="secondary">
            <Plus className="h-4 w-4" />
            Add Auto Lab Instagram
          </LinkButton>
        </div>
      </div>
    </GlassPanel>
  );
}

export default async function DataSpaceDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ dataSpaceSlug }, query] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const isMoonArq = dataSpace.slug === "moonarq";
  const overviewQuery = parseMoonArqOverviewQuery(query ?? {});
  const range = isMoonArq
    ? overviewQuery.range
    : parseRange(typeof query?.range === "string" ? query.range : undefined);
  const basePath = dashboardPath(dataSpace.slug);
  const yesterday = addDaysToDateKey(dateKeyInAppTimeZone(), -1);
  const instagramSummaryPromise = getInstagramDashboardSummary({ dataSpaceId: dataSpace.id });
  const instagramPaidSummaryPromise = isMoonArq
    ? instagramSummaryPromise.then((summary) => {
        const primaryInstagramSourceId = summary.sources[0]?.sourceId;
        return primaryInstagramSourceId
          ? getInstagramPaidAdsSummary({ dataSpaceId: dataSpace.id, instagramSourceId: primaryInstagramSourceId, rangeKey: range })
          : null;
      })
    : Promise.resolve(null);
  const websiteOverviewPromise = isMoonArq
    ? getWebsiteFunnelOverview({
        dataSpaceId: dataSpace.id,
        range: overviewQuery.range,
        comparison: overviewQuery.compare,
        segment: overviewQuery.segment,
        device: overviewQuery.device,
        utmSource: overviewQuery.utm_source,
        utmMedium: overviewQuery.utm_medium,
        utmCampaign: overviewQuery.utm_campaign,
        landingPath: overviewQuery.landing_path,
        referrerHost: overviewQuery.referrer_host,
        collectionPage: overviewQuery.collection_page,
        productPage: overviewQuery.product_page,
        acquisitionPage: overviewQuery.acquisition_page,
        demoState: overviewQuery.demo_state,
      })
    : Promise.resolve(null);
  const [
    modules,
    health,
    yesterdayReport,
    sources,
    instagramSummary,
    tiktokSummary,
    instagramPaidSummary,
    websiteOverview,
  ] = await Promise.all([
    getPlatformModules(range, { dataSpaceId: dataSpace.id, dataSpaceName: dataSpace.display_name }),
    getGlobalPlatformHealth(range, { dataSpaceId: dataSpace.id, dataSpaceName: dataSpace.display_name }),
    getDailyReport(yesterday, dataSpace),
    listSources({ dataSpaceId: dataSpace.id }),
    instagramSummaryPromise,
    getTikTokDashboardSummary({ dataSpaceId: dataSpace.id }),
    instagramPaidSummaryPromise,
    websiteOverviewPromise,
  ]);
  const futureModules = modules.filter((platformModule) => platformModule.sourceTypeKey === "custom_api" || platformModule.sourceTypeKey === "custom_csv");
  const autoLabEmpty = isAutoLabDataSpace(dataSpace) && sources.length === 0;
  const overviewTypes = new Set(["website", "supabase", "tiktok", "instagram", "shopify"]);
  const overviewModules = modules.filter((module) => overviewTypes.has(module.sourceTypeKey) && Boolean(module.sourceId || dataSpace.slug === "moonarq"));
  const operationalModules = isMoonArq
    ? overviewModules.filter((module) => module.sourceTypeKey !== "website" && module.sourceTypeKey !== "shopify")
    : overviewModules;
  const operationalSeries = isMoonArq
    ? moduleSeries(modules.filter((module) => module.sourceTypeKey !== "website" && module.sourceTypeKey !== "shopify"))
    : moduleSeries(modules);
  const shopifyModule = modules.find((module) => module.sourceTypeKey === "shopify") ?? null;
  const hasDirectInstagramPanel = instagramSummary.sources.length > 0;
  const hasDirectTikTokPanel = tiktokSummary.sources.length > 0;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-4">
      {websiteOverview ? (
        <MoonArqOverviewHeader overview={websiteOverview} query={overviewQuery} basePath={basePath} />
      ) : (
        <CommandCenterHeader modules={modules} range={range} dataSpaceName={dataSpace.display_name} dataSpaceSlug={dataSpace.slug} basePath={basePath} />
      )}

      {autoLabEmpty ? <AutoLabEmptyState dataSpaceSlug={dataSpace.slug} /> : null}

      {websiteOverview ? (
        <>
          <WebsiteBusinessPulse overview={websiteOverview} />
          <section
            className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]"
            aria-label="Storefront funnel and conversion trend"
          >
            <StorefrontFunnel overview={websiteOverview} />
            <StorefrontConversionTrend overview={websiteOverview} query={overviewQuery} basePath={basePath} />
          </section>
          <StorefrontJourneys overview={websiteOverview} />
          <StorefrontBreakdowns overview={websiteOverview} query={overviewQuery} basePath={basePath} />
          <CommerceOutcomes shopify={shopifyModule} />
        </>
      ) : null}

      {!autoLabEmpty && !isMoonArq ? (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-testid="dashboard-data-stage" aria-label="Performance graphs and platform summaries">
          <PlatformTrendChart series={operationalSeries} />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="overview-module-grid">
            {operationalModules.map((module) => (
              <PlatformModuleCard key={module.sourceTypeKey} module={module} basePath={basePath} dataSpaceSlug={dataSpace.slug} />
            ))}
          </div>
        </section>
      ) : null}

      {!autoLabEmpty && !isMoonArq ? <GlobalHealthStrip health={health} /> : null}

      {!autoLabEmpty && (hasDirectInstagramPanel || hasDirectTikTokPanel) ? (
        <section
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 [&_a]:!min-h-11 [&_button]:!min-h-11 xl:grid-cols-2"
          data-testid="social-platform-detail-modules"
          aria-label="Social platform detail modules"
        >
          {hasDirectInstagramPanel ? <InstagramInsightsPanel summary={instagramSummary} paid={instagramPaidSummary} basePath={basePath} dataSpaceSlug={dataSpace.slug} /> : null}
          {hasDirectTikTokPanel ? <TikTokInsightsPanel summary={tiktokSummary} basePath={basePath} /> : null}
        </section>
      ) : null}

      {websiteOverview ? (
        <section
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
          data-testid="dashboard-data-stage"
          aria-label="Operational platform summaries"
        >
          <PlatformTrendChart series={operationalSeries} />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3 [&_a]:!min-h-11 [&_button]:!min-h-11" data-testid="overview-module-grid">
            {operationalModules.map((module) => (
              <PlatformModuleCard key={module.sourceTypeKey} module={module} basePath={basePath} dataSpaceSlug={dataSpace.slug} />
            ))}
          </div>
        </section>
      ) : null}

      {websiteOverview ? <GlobalHealthStrip health={health} /> : null}

      {!autoLabEmpty ? (
        <details className="group glass rounded-xl" data-testid="daily-report-module">
          <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 transition hover:bg-white/[0.025]">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10">
                <FileText className="h-4 w-4 text-cyan-100" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70">Daily Morning Report</p>
                <h2 className="truncate text-sm font-semibold text-white">
                  {yesterdayReport ? "Yesterday's report is ready" : "Yesterday's report has not been generated"}
                </h2>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={yesterdayReport ? "green" : "amber"}>{yesterdayReport ? "Ready" : "Action"}</Badge>
              <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
            </div>
          </summary>
          <div className="flex flex-col gap-3 border-t border-white/10 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-400">
              {yesterdayReport ? `Generated ${yesterdayReport.run.generated_at_pt}.` : "Generate a safe PT daily snapshot from this data space when you are ready."}
            </p>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`${basePath}/reports/daily`} variant="primary" className="min-h-11 px-3 text-xs">
                <FileText className="h-3.5 w-3.5" />
                Open Report
              </LinkButton>
              <LinkButton href={`${basePath}/data`} variant="secondary" className="min-h-11 px-3 text-xs">
                <TableProperties className="h-3.5 w-3.5" />
                Explore Data
              </LinkButton>
            </div>
          </div>
        </details>
      ) : null}

      {!autoLabEmpty ? (
        <details className="group glass rounded-xl" data-testid="more-integrations">
          <summary className="flex cursor-pointer items-center justify-between gap-4 p-3 transition hover:bg-white/[0.025]">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">More integrations</p>
              <h2 className="mt-0.5 text-sm font-semibold text-white">Planned and custom sources</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{futureModules.length} modules</span>
              <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" />
            </div>
          </summary>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-t border-white/10 p-3 sm:p-4">
            <div className="flex justify-end">
              <LinkButton href={`${basePath}/sources`} variant="secondary" className="min-h-11 px-3 text-xs">
                Source management
                <ArrowRight className="h-3.5 w-3.5" />
              </LinkButton>
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 [&_a]:!min-h-11 [&_button]:!min-h-11">
              {futureModules.map((module) => (
                <PlatformModuleCard key={module.sourceTypeKey} module={module} basePath={basePath} dataSpaceSlug={dataSpace.slug} />
              ))}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
