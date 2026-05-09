import { ArrowRight, Bookmark, Camera, Car, DatabaseZap, ExternalLink, FileText, Heart, MessageCircle, Plus, TableProperties, Video } from "lucide-react";
import { notFound } from "next/navigation";
import { getDailyReport } from "@/aggregation/services/daily-report-service";
import { getInstagramDashboardSummary, type InstagramDashboardSummary } from "@/aggregation/services/instagram-dashboard-service";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import { getGlobalPlatformHealth, getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { getDataSpaceBySlug, isAutoLabDataSpace } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { addDaysToDateKey, dateKeyInAppTimeZone, formatAppDateTime } from "@/storage/runtime/app-time";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { PlatformTrendChart } from "@/presentation/charts/platform-trend-chart";
import { CommandCenterHeader } from "@/presentation/dashboard/command-center-header";
import { GlobalHealthStrip } from "@/presentation/dashboard/global-health-strip";
import { PlatformModuleCard } from "@/presentation/dashboard/platform-module-card";
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

function compactMetric(value: number | string, unit: string) {
  if (typeof value === "string") return value;
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "usd") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat("en-US").format(value);
}

function displayCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "Waiting";
  return new Intl.NumberFormat("en-US").format(value);
}

function displayPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "Waiting";
  return `${value.toFixed(1)}%`;
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

function InstagramInsightsPanel({ summary, basePath }: { summary: InstagramDashboardSummary; basePath: string }) {
  if (summary.sources.length === 0) return null;
  const primary = summary.sources[0];
  const media = primary.media;

  return (
    <GlassPanel className="overflow-hidden">
      <div className="border-b border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/10">
              <Camera className="h-5 w-5 text-fuchsia-100" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200/80">Instagram Graph API</p>
              <h2 className="mt-1 break-words text-xl font-semibold text-white">
                {primary.username ? `@${primary.username}` : primary.displayName}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Direct view of the latest synced account profile, media totals, and per-post insights for this data space only.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={primary.status === "healthy" ? "green" : primary.status === "error" ? "rose" : "amber"}>{primary.status}</Badge>
            {primary.graphApiVersion ? <Badge tone="indigo">{primary.graphApiVersion}</Badge> : null}
            {primary.lastSyncedAt ? <Badge tone="slate">Synced {formatAppDateTime(primary.lastSyncedAt)}</Badge> : <Badge tone="amber">No sync yet</Badge>}
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5">
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
    </GlassPanel>
  );
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
  searchParams?: Promise<{ range?: string }>;
}) {
  const [{ dataSpaceSlug }, query] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const range = parseRange(query?.range);
  const basePath = dashboardPath(dataSpace.slug);
  const yesterday = addDaysToDateKey(dateKeyInAppTimeZone(), -1);
  const [modules, health, yesterdayReport, sources, instagramSummary] = await Promise.all([
    getPlatformModules(range, { dataSpaceId: dataSpace.id, dataSpaceName: dataSpace.display_name }),
    getGlobalPlatformHealth(range, { dataSpaceId: dataSpace.id, dataSpaceName: dataSpace.display_name }),
    getDailyReport(yesterday, dataSpace),
    listSources({ dataSpaceId: dataSpace.id }),
    getInstagramDashboardSummary({ dataSpaceId: dataSpace.id }),
  ]);
  const websiteModule = modules.find((platformModule) => platformModule.sourceTypeKey === "website");
  const supabaseModule = modules.find((platformModule) => platformModule.sourceTypeKey === "supabase");
  const socialModules = modules.filter((platformModule) => platformModule.sourceTypeKey === "tiktok" || platformModule.sourceTypeKey === "instagram");
  const futureModules = modules.filter((platformModule) => platformModule.sourceTypeKey === "shopify" || platformModule.sourceTypeKey === "custom_api" || platformModule.sourceTypeKey === "custom_csv");
  const autoLabEmpty = isAutoLabDataSpace(dataSpace) && sources.length === 0;
  const primaryModules = [websiteModule, supabaseModule].filter((module): module is NonNullable<typeof module> => Boolean(module?.sourceId || dataSpace.slug === "moonarq"));
  const hasDirectInstagramPanel = instagramSummary.sources.length > 0;
  const readinessModules = socialModules.filter((module) => !(hasDirectInstagramPanel && module.sourceTypeKey === "instagram"));
  const postureModules = [websiteModule, supabaseModule, ...readinessModules].filter((module): module is NonNullable<typeof module> => Boolean(module && (module.sourceId || dataSpace.slug === "moonarq")));
  const showOperationsOverview = dataSpace.slug === "moonarq" || postureModules.length > 0;

  return (
    <div className="mx-auto grid max-w-[1600px] gap-6">
      <CommandCenterHeader modules={modules} range={range} dataSpaceName={dataSpace.display_name} dataSpaceSlug={dataSpace.slug} basePath={basePath} />
      <GlobalHealthStrip health={health} />

      {autoLabEmpty ? <AutoLabEmptyState dataSpaceSlug={dataSpace.slug} /> : null}

      {!autoLabEmpty ? (
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10">
                <FileText className="h-5 w-5 text-cyan-100" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/75">Daily Morning Report</p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {yesterdayReport ? "Yesterday's report is ready" : "Yesterday's report has not been generated"}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  {yesterdayReport ? `Generated ${yesterdayReport.run.generated_at_pt}.` : "Generate a safe PT daily snapshot from this data space when you are ready."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`${basePath}/reports/daily`} variant="primary">
                <FileText className="h-4 w-4" />
                Open Report
              </LinkButton>
              <LinkButton href={`${basePath}/data`} variant="secondary">
                <TableProperties className="h-4 w-4" />
                Explore Data
              </LinkButton>
            </div>
          </div>
        </GlassPanel>
      ) : null}

      {!autoLabEmpty && hasDirectInstagramPanel ? <InstagramInsightsPanel summary={instagramSummary} basePath={basePath} /> : null}

      {!autoLabEmpty && primaryModules.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          {websiteModule && primaryModules.includes(websiteModule) ? (
            <div className="grid gap-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Primary source</p>
                  <h2 className="mt-1 text-xl font-semibold text-white">{websiteModule.platformLabel}</h2>
                </div>
                <Badge tone="cyan">{websiteModule.sourceModeLabel}</Badge>
              </div>
              <PlatformModuleCard module={websiteModule} basePath={basePath} dataSpaceSlug={dataSpace.slug} />
            </div>
          ) : null}
          {supabaseModule && primaryModules.includes(supabaseModule) ? (
            <div className="grid gap-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200/80">Second source</p>
                  <h2 className="mt-1 text-xl font-semibold text-white">{supabaseModule.platformLabel}</h2>
                </div>
                <Badge tone="green">{supabaseModule.sourceModeLabel}</Badge>
              </div>
              <PlatformModuleCard module={supabaseModule} basePath={basePath} dataSpaceSlug={dataSpace.slug} />
            </div>
          ) : null}
        </section>
      ) : null}

      {!autoLabEmpty && showOperationsOverview ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.75fr)]">
          <PlatformTrendChart series={moduleSeries(modules)} />
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-5 flex items-center gap-2">
              <DatabaseZap className="h-4 w-4 text-cyan-200" />
              <h2 className="text-base font-semibold text-white">{dataSpace.display_name} source posture</h2>
            </div>
            <div className="grid gap-3">
              {postureModules.map((platformModule) => (
                <div key={platformModule.sourceId ?? platformModule.sourceTypeKey} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-white">{platformModule.platformLabel}</p>
                    <Badge tone={platformModule.status === "healthy" ? "green" : platformModule.status === "error" ? "rose" : platformModule.status === "needs_credentials" ? "amber" : "cyan"}>
                      {platformModule.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{platformModule.primaryMetric.label}</p>
                  <p className="text-lg font-semibold text-slate-100">{compactMetric(platformModule.primaryMetric.value, platformModule.primaryMetric.unit)}</p>
                  <p className="mt-2 text-xs text-slate-500">{platformModule.sourceModeLabel}</p>
                </div>
              ))}
            </div>
          </GlassPanel>
        </div>
      ) : null}

      {readinessModules.length > 0 ? (
        <section className="grid gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Social accounts</p>
              <h2 className="mt-1 text-xl font-semibold text-white">{dataSpace.display_name} social account readiness</h2>
            </div>
            <LinkButton href={`${basePath}/content`} variant="secondary">
              Content dashboard
              <ArrowRight className="h-4 w-4" />
            </LinkButton>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {readinessModules.map((platformModule) => (
              <GlassPanel key={platformModule.sourceTypeKey} className="p-4 sm:p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
                      <Video className="h-5 w-5 text-cyan-100" />
                    </span>
                    <div>
                      <h3 className="font-semibold text-white">{platformModule.platformLabel}</h3>
                      <p className="text-xs text-slate-500">{platformModule.displayName}</p>
                    </div>
                  </div>
                  <Badge tone="cyan">{platformModule.setupState.label}</Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3 sm:col-span-1">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{platformModule.primaryMetric.label}</p>
                    <p className="mt-1 text-xl font-semibold text-white">{compactMetric(platformModule.primaryMetric.value, platformModule.primaryMetric.unit)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm leading-6 text-slate-300 sm:col-span-2">
                    {platformModule.setupState.message}
                  </div>
                </div>
              </GlassPanel>
            ))}
          </div>
        </section>
      ) : null}

      {!autoLabEmpty ? (
        <section className="grid gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Other future sources</p>
              <h2 className="mt-1 text-xl font-semibold text-white">Custom sources stay visible without taking over the command center</h2>
            </div>
            <LinkButton href={`${basePath}/sources`} variant="secondary">
              Source management
              <ArrowRight className="h-4 w-4" />
            </LinkButton>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {futureModules.map((module) => (
              <PlatformModuleCard key={module.sourceTypeKey} module={module} basePath={basePath} dataSpaceSlug={dataSpace.slug} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
