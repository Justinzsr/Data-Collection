import { ArrowRight, Bookmark, Car, ChevronDown, ExternalLink, Eye, FileText, Heart, MessageCircle, Plus, Share2, TableProperties, Video } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getDailyReport } from "@/aggregation/services/daily-report-service";
import { getInstagramDashboardSummary, type InstagramDashboardSummary } from "@/aggregation/services/instagram-dashboard-service";
import { getInstagramPaidAdsSummary, type InstagramPaidAdsSummary, type PaidMetricValue } from "@/aggregation/services/meta-ads-attribution-service";
import { getTikTokDashboardSummary, type TikTokDashboardSummary } from "@/aggregation/services/tiktok-dashboard-service";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import {
  getGlobalPlatformHealth,
  getPlatformModules,
  type PlatformModule,
} from "@/aggregation/services/platform-modules-service";
import { getWebsiteFunnelOverview } from "@/aggregation/services/website-funnel-service";
import { WEBSITE_COMMERCE_FUNNEL_V2_UI_FLAG } from "@/aggregation/services/website-commerce-funnel-v2-service";
import { getDataSpaceBySlug, isAutoLabDataSpace } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { isRuntimeDatabaseConfigured } from "@/storage/db/client";
import { addDaysToDateKey, dateKeyInAppTimeZone, formatAppDateTime } from "@/storage/runtime/app-time";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { Callout, GlassPanel, StatTile } from "@/presentation/components/ui/panel";
import { IconTile, PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { PlatformTrendChart } from "@/presentation/charts/platform-trend-chart";
import { CommerceOutcomes } from "@/presentation/dashboard/commerce-outcomes";
import { ConnectionHealthPanel } from "@/presentation/dashboard/connection-health-panel";
import { CommandCenterHeader } from "@/presentation/dashboard/command-center-header";
import { GlobalHealthStrip } from "@/presentation/dashboard/global-health-strip";
import { PlatformModuleCard } from "@/presentation/dashboard/platform-module-card";
import { InstagramPaidAdsPanel } from "@/presentation/dashboard/instagram-paid-ads-panel";
import { MoonArqOverviewHeader } from "@/presentation/dashboard/moonarq-overview-header";
import {
  buildMoonArqOverviewHref,
  parseMoonArqOverviewQuery,
  type MoonArqOverviewQuery,
} from "@/presentation/dashboard/moonarq-overview-query";
import { StorefrontBreakdowns } from "@/presentation/dashboard/storefront-breakdowns";
import { StorefrontConversionTrend } from "@/presentation/dashboard/storefront-conversion-trend";
import { StorefrontFunnel } from "@/presentation/dashboard/storefront-funnel";
import { StorefrontJourneys } from "@/presentation/dashboard/storefront-journeys";
import { WebsiteBusinessPulse } from "@/presentation/dashboard/website-business-pulse";
import { WebsiteCommerceFunnelV2 } from "@/presentation/dashboard/website-commerce-funnel-v2";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

function parseRange(value: string | undefined): DateRangeKey {
  if (value === "today" || value === "7d" || value === "30d") return value;
  return "30d";
}

const overviewDisplayFilterKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "landing_path",
  "referrer_host",
] as const satisfies readonly (keyof MoonArqOverviewQuery)[];

function requiresSanitizedOverviewRedirect(
  raw: Record<string, string | string[] | undefined>,
  normalized: MoonArqOverviewQuery,
) {
  return overviewDisplayFilterKeys.some((key) => {
    const value = raw[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value !== "string") return false;
    return value.trim() !== normalized[key];
  });
}

function localShopifyFixture(
  demoState: "shopify-awaiting" | "shopify-zero",
): PlatformModule {
  const synced = demoState === "shopify-zero";
  return {
    sourceId: "local-shopify-fixture",
    sourceTypeKey: "shopify",
    displayName: "Shopify local fixture",
    platformLabel: "Shopify",
    status: synced ? "healthy" : "warning",
    syncMode: "webhook",
    sourceModeLabel: "Shopify authoritative commerce",
    rangeLabel: "Last 30 days",
    primaryMetric: {
      key: "orders",
      label: "Orders",
      value: 0,
      unit: "count",
      deltaPercent: null,
      deltaLabel: "—",
    },
    secondaryMetrics: [
      { key: "net_payment", label: "Net payment", value: 0, unit: "usd" },
      { key: "gross_sales", label: "Gross sales", value: 0, unit: "usd" },
      { key: "refunds", label: "Refunds", value: 0, unit: "usd" },
    ],
    sparkline: [],
    insights: [],
    lastSyncAt: synced ? "2026-07-29T18:00:00.000Z" : null,
    lastSuccessfulSyncAt: synced ? "2026-07-29T18:00:00.000Z" : null,
    nextSyncAt: null,
    lastError: null,
    setupState: {
      label: synced ? "Healthy" : "Awaiting first sync",
      severity: synced ? "ok" : "warning",
      message: synced
        ? "Deterministic local Shopify fixture is synced."
        : "Deterministic local Shopify fixture is awaiting its first successful sync.",
    },
    actions: {
      canRunSync: true,
      canConfigure: true,
      canViewDetails: true,
    },
  };
}

function moduleSeries(modules: Awaited<ReturnType<typeof getPlatformModules>>) {
  const preferred = ["website", "supabase", "tiktok", "instagram"] as const;
  return preferred
    .map((key) => {
      const platformModule = modules.find((candidate) => candidate.sourceTypeKey === key);
      if (!platformModule) return null;
      return { key: platformModule.sourceTypeKey, label: platformModule.platformLabel, color: platformSeriesColor(key), data: platformModule.sparkline };
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
  return <StatTile label={label} value={value} detail={detail} />;
}

function TikTokMetricTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  const waiting = value === "Waiting for scope/data";
  return <StatTile label={label} value={value} detail={detail} tone={waiting ? "warning" : "default"} />;
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
    <details className="overview-social-card group glass min-w-0 overflow-hidden rounded-3xl">
      <summary className="cursor-pointer p-4 transition hover:bg-fill">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PlatformIcon sourceTypeKey="instagram" size="lg" />
            <div className="min-w-0">
              <p className="eyebrow">Instagram Graph API</p>
              <h2 className="mt-0.5 truncate text-[15px] font-semibold tracking-[-0.01em] text-label">
                {primary.username ? `@${primary.username}` : primary.displayName}
              </h2>
              <p className="mt-0.5 truncate text-xs text-muted">
                {displayCount(primary.stats.followers)} followers · {displayCount(primary.stats.reach)} reach · {media.length} posts
              </p>
              {paid ? (
                <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-[11px] font-medium text-label-secondary">
                  <span className="rounded-full bg-pink-fill/12 px-2 py-0.5 font-semibold text-pink">Ads: {paidStateLabel(paid.state)}</span>
                  <span className="rounded-full bg-fill-strong px-2 py-0.5">Spend {compactPaidMetric(paid.outcomes.spend)}</span>
                  <span className="rounded-full bg-fill-strong px-2 py-0.5">Revenue {compactPaidMetric(paid.outcomes.attributedNetRevenue)}</span>
                  <span className="rounded-full bg-fill-strong px-2 py-0.5">ROAS {compactPaidMetric(paid.outcomes.shopifyRoas)}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={primary.status === "healthy" ? "green" : primary.status === "error" ? "rose" : "amber"} dot>{statusLabel(primary.status)}</Badge>
            <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" aria-hidden="true" />
          </div>
        </div>
      </summary>

      <div className="grid gap-4 border-t border-separator p-3 sm:p-4">
        {paid ? (
          <InstagramPaidAdsPanel
            summary={paid}
            instagramSourceId={primary.sourceId}
            dataSpaceSlug={dataSpaceSlug}
            returnPath={`${basePath}/sources/${primary.sourceId}`}
          />
        ) : null}

        <details className="group inset-surface rounded-[18px]">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[18px] px-3.5 py-2.5 text-[13px] font-semibold text-label transition hover:bg-fill-hover">
            <span>Organic account &amp; media details</span>
            <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="grid gap-4 border-t border-separator p-3">
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

        <div className="flex flex-col gap-2 rounded-2xl bg-fill-strong p-3 text-xs text-label-secondary sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Last sync: <span className="text-label">{primary.lastSyncedAt ? formatAppDateTime(primary.lastSyncedAt) : "No sync yet"}</span></span>
            {primary.graphApiVersion ? <span>Graph API: <span className="text-label">{primary.graphApiVersion}</span></span> : null}
            {primary.accountId ? <span>IG account: <span className="text-label">{primary.accountId}</span></span> : null}
            {primary.pageId ? <span>Page: <span className="text-label">{primary.pageId}</span></span> : null}
            {primary.tokenExpiresAt ? <span>Token expires: <span className="text-label">{formatAppDateTime(primary.tokenExpiresAt)}</span></span> : null}
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
              <p className="eyebrow">Media performance</p>
              <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">Latest synced posts and reels</h3>
            </div>
            <Badge tone="slate">{media.length} visible media rows</Badge>
          </div>

          {media.length > 0 ? (
            <div className="grid gap-3">
              {media.map((item) => (
                <div key={`${item.sourceId}-${item.externalContentId}`} className="rounded-2xl bg-fill-strong p-3.5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge tone="indigo">{item.mediaType}</Badge>
                        {item.publishedAt ? <Badge tone="slate">{formatAppDateTime(item.publishedAt)}</Badge> : null}
                      </div>
                      <p className="break-words text-sm leading-6 text-label">{item.captionPreview}</p>
                    </div>
                    {item.url ? (
                      <LinkButton href={item.url} variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" target="_blank" rel="noreferrer">
                        Open post
                        <ExternalLink className="h-3.5 w-3.5" />
                      </LinkButton>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="text-[11px] text-muted">Reach</p>
                      <p className="mt-1 text-sm font-semibold text-label">{displayCount(item.reach)}</p>
                    </div>
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="flex items-center gap-1 text-[11px] text-muted"><Heart className="h-3 w-3" /> Likes</p>
                      <p className="mt-1 text-sm font-semibold text-label">{displayCount(item.likes)}</p>
                    </div>
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="flex items-center gap-1 text-[11px] text-muted"><MessageCircle className="h-3 w-3" /> Comments</p>
                      <p className="mt-1 text-sm font-semibold text-label">{displayCount(item.comments)}</p>
                    </div>
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="flex items-center gap-1 text-[11px] text-muted"><Bookmark className="h-3 w-3" /> Saved</p>
                      <p className="mt-1 text-sm font-semibold text-label">{displayCount(item.saved)}</p>
                    </div>
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="text-[11px] text-muted">Interactions</p>
                      <p className="mt-1 text-sm font-semibold text-label">{displayCount(item.totalInteractions)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Callout tone="warning" title="No synced Instagram media metrics yet">
              Open the Instagram source and run a manual sync to populate account and media insights.
            </Callout>
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
    <details className="overview-social-card group glass min-w-0 overflow-hidden rounded-3xl">
      <summary className="cursor-pointer p-4 transition hover:bg-fill">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PlatformIcon sourceTypeKey="tiktok" size="lg" />
            <div className="min-w-0">
              <p className="eyebrow">TikTok official API</p>
              <h2 className="mt-0.5 truncate text-[15px] font-semibold tracking-[-0.01em] text-label">{accountLabel}</h2>
              <p className="mt-0.5 truncate text-xs text-muted">{displayWaitingCount(source.stats.videoViews)} views · {displayWaitingCount(source.stats.followers)} followers · {source.stats.fetchedVideoCount} fetched videos</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={source.status === "healthy" ? "green" : source.status === "error" ? "rose" : "amber"} dot>{statusLabel(source.status)}</Badge>
            <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" aria-hidden="true" />
          </div>
        </div>
      </summary>

      <div className="grid gap-4 border-t border-separator p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-label-secondary">
          <Badge tone="slate">Current snapshot</Badge>
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

        <div className="flex flex-col gap-2 rounded-2xl bg-fill p-3 text-xs text-label-secondary sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Last sync: <span className="text-label">{source.lastSyncedAt ? formatAppDateTime(source.lastSyncedAt) : "No sync yet"}</span></span>
            <span>Token: <span className={source.tokenExpiresAt ? "text-label" : "text-warning"}>{source.tokenExpiresAt ? `expires ${formatAppDateTime(source.tokenExpiresAt)}` : "expiry pending"}</span></span>
            {source.openId ? <span>Open ID: <span className="text-label">{source.openId}</span></span> : <span>Open ID: <span className="text-warning">Waiting for scope/data</span></span>}
            <span>Scopes: <span className="text-label">{source.scopes.length ? source.scopes.join(", ") : "Waiting for granted scopes"}</span></span>
            {source.lastError ? <span>Last error: <span className="text-negative">{source.lastError}</span></span> : null}
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
              <p className="eyebrow">Video performance</p>
              <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">Videos in the latest TikTok snapshot</h3>
            </div>
            <Badge tone="slate">{videos.length} visible video rows</Badge>
          </div>

          {videos.length > 0 ? (
            <div className="grid gap-3">
              {videos.map((item) => (
                <div key={`${item.sourceId}-${item.externalContentId}`} className="inset-surface rounded-2xl p-3.5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge tone="indigo">TikTok video</Badge>
                        {item.publishedAt ? <Badge tone="slate">{formatAppDateTime(item.publishedAt)}</Badge> : null}
                      </div>
                      <p className="break-words text-sm font-semibold text-label">{item.title}</p>
                      <p className="mt-1 break-words text-sm leading-6 text-label-secondary">{item.description}</p>
                    </div>
                    {item.url ? (
                      <LinkButton href={item.url} variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" target="_blank" rel="noreferrer">
                        Open video
                        <ExternalLink className="h-3.5 w-3.5" />
                      </LinkButton>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="flex items-center gap-1 text-[11px] text-muted"><Eye className="h-3 w-3" /> Views</p>
                      <p className="mt-1 break-words text-sm font-semibold text-label">{displayWaitingCount(item.views)}</p>
                    </div>
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="flex items-center gap-1 text-[11px] text-muted"><Heart className="h-3 w-3" /> Likes</p>
                      <p className="mt-1 break-words text-sm font-semibold text-label">{displayWaitingCount(item.likes)}</p>
                    </div>
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="flex items-center gap-1 text-[11px] text-muted"><MessageCircle className="h-3 w-3" /> Comments</p>
                      <p className="mt-1 break-words text-sm font-semibold text-label">{displayWaitingCount(item.comments)}</p>
                    </div>
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="flex items-center gap-1 text-[11px] text-muted"><Share2 className="h-3 w-3" /> Shares</p>
                      <p className="mt-1 break-words text-sm font-semibold text-label">{displayWaitingCount(item.shares)}</p>
                    </div>
                    <div className="rounded-xl bg-fill p-2.5">
                      <p className="text-[11px] text-muted">Engagement</p>
                      <p className="mt-1 break-words text-sm font-semibold text-label">{displayWaitingPercent(item.engagementRate)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Callout tone="warning" title="Waiting for TikTok video metrics">
              Run a manual sync after TikTok grants the video.list scope to populate video rows and performance metrics.
            </Callout>
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
          <IconTile icon={Car} tone="warning" size="lg" className="mb-4" />
          <p className="eyebrow">Isolated testing space</p>
          <h2 className="mt-1 text-[24px] font-bold tracking-[-0.025em] text-label">Auto Lab has no sources yet</h2>
          <p className="mt-3 text-sm leading-6 text-label-secondary">
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
  const websiteCommerceFunnelV2Enabled =
    process.env[WEBSITE_COMMERCE_FUNNEL_V2_UI_FLAG]?.trim() === "true";
  const overviewQuery = parseMoonArqOverviewQuery(query ?? {});
  const basePath = dashboardPath(dataSpace.slug);
  if (isMoonArq && requiresSanitizedOverviewRedirect(query ?? {}, overviewQuery)) {
    redirect(buildMoonArqOverviewHref(basePath, overviewQuery));
  }
  const range = isMoonArq
    ? overviewQuery.range
    : parseRange(typeof query?.range === "string" ? query.range : undefined);
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
  const localFixtureEnabled = process.env.MOONARQ_OVERVIEW_E2E_FIXTURES === "true"
    && !isRuntimeDatabaseConfigured();
  const shopifyModule = localFixtureEnabled
    && (overviewQuery.demo_state === "shopify-awaiting" || overviewQuery.demo_state === "shopify-zero")
    ? localShopifyFixture(overviewQuery.demo_state)
    : modules.find((module) => module.sourceTypeKey === "shopify") ?? null;
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
          {websiteCommerceFunnelV2Enabled ? (
            <WebsiteCommerceFunnelV2
              dataSpaceSlug={dataSpace.slug}
              range={overviewQuery.range}
              segment={overviewQuery.segment}
            />
          ) : null}
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

      {!autoLabEmpty ? <ConnectionHealthPanel sources={sources} basePath={basePath} /> : null}

      {!autoLabEmpty ? (
        <details className="group glass rounded-3xl" data-testid="daily-report-module">
          <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-3xl p-4 transition hover:bg-fill">
            <div className="flex min-w-0 items-center gap-3">
              <IconTile icon={FileText} tone="tint" />
              <div className="min-w-0">
                <p className="eyebrow">Daily Morning Report</p>
                <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-label">
                  {yesterdayReport ? "Yesterday's report is ready" : "Yesterday's report has not been generated"}
                </h2>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={yesterdayReport ? "green" : "amber"} dot>{yesterdayReport ? "Ready" : "Action"}</Badge>
              <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" aria-hidden="true" />
            </div>
          </summary>
          <div className="flex flex-col gap-3 border-t border-separator p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-label-secondary">
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
        <details className="group glass rounded-3xl" data-testid="more-integrations">
          <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-3xl p-4 transition hover:bg-fill">
            <div className="flex min-w-0 items-center gap-3">
              <IconTile icon={Plus} tone="neutral" />
              <div className="min-w-0">
                <p className="eyebrow">More integrations</p>
                <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.01em] text-label">Planned and custom sources</h2>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{futureModules.length} modules</span>
              <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" />
            </div>
          </summary>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-t border-separator p-4">
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
