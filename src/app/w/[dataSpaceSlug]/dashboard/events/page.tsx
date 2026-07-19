import { Activity, ChevronDown, ShieldAlert, Webhook } from "lucide-react";
import { notFound } from "next/navigation";
import { generateReactHelper, generateTrackingSnippet } from "@/collection/tracking/snippet-generator";
import { getWebsiteModeLabel, resolvePrimaryWebsiteSource } from "@/collection/tracking/website-sources";
import { getMetricTimeseries } from "@/aggregation/services/timeseries-service";
import { findWebEvents } from "@/storage/repositories/events-repository";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { getPublicAppUrl, getPublicAppUrlWarning } from "@/storage/runtime/app-config";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { LinkButton } from "@/presentation/components/ui/button";
import { MetricTrendChart } from "@/presentation/charts/metric-trend-chart";
import { SnippetCard } from "@/presentation/dashboard/snippet-card";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export const dynamic = "force-dynamic";

export default async function EventsPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();

  const [sources, trend] = await Promise.all([
    listSources({ dataSpaceId: dataSpace.id }),
    getMetricTimeseries({ metricKey: "page_views", dataSpaceId: dataSpace.id }),
  ]);
  const basePath = dashboardPath(dataSpace.slug);
  const website = resolvePrimaryWebsiteSource(sources);
  const events = website
    ? await findWebEvents({ sourceId: website.id, dataSpaceId: dataSpace.id, limit: 30 })
    : [];
  const drainSource = sources.find((source) => source.source_type_key === "vercel_web_analytics_drain");
  const trackerSource = sources.find((source) => source.source_type_key === "website" && typeof source.metadata.public_tracking_key === "string" && source.status !== "disabled");
  const trackingKey = typeof trackerSource?.metadata.public_tracking_key === "string" ? trackerSource.metadata.public_tracking_key : null;
  const publicAppUrl = getPublicAppUrl();
  const publicAppUrlWarning = getPublicAppUrlWarning();
  const endpoint = `${publicAppUrl ?? "http://localhost:4000"}/api/track`;
  const snippet = trackingKey && trackerSource
    ? generateTrackingSnippet({ endpoint, publicTrackingKey: trackingKey, sourceId: trackerSource.id })
    : null;
  const helper = trackingKey && trackerSource
    ? generateReactHelper({ endpoint, publicTrackingKey: trackingKey, sourceId: trackerSource.id })
    : null;
  const byPath = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.path] = (acc[event.path] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Website connector"
        title={`${dataSpace.display_name} Event dashboard`}
        description="Authoritative first-party event reads are scoped to this data space. Vercel Drain remains retained as auxiliary request evidence."
      />
      {publicAppUrlWarning ? (
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-2 flex items-center gap-2 text-base font-semibold text-white">
            <ShieldAlert className="h-4 w-4 text-amber-200" />
            Public app URL warning
          </div>
          <p className="text-sm leading-6 text-amber-100">{publicAppUrlWarning}</p>
        </GlassPanel>
      ) : null}
      <MetricTrendChart
        data={trend}
        title="Website page views"
        description={website ? `${dataSpace.display_name} first-party tracker metrics` : "First-party tracker setup required; Drain remains auxiliary"}
      />
      <details className="group glass min-w-0 overflow-hidden rounded-2xl">
        <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 transition hover:bg-white/[0.025] sm:p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/70">Installation</p>
            <h2 className="mt-1 text-base font-semibold text-white">Endpoints, tracking snippets, and setup</h2>
            <p className="mt-1 text-sm text-slate-500">Expand when configuring or troubleshooting website collection.</p>
          </div>
          <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid min-w-0 gap-5 border-t border-white/10 p-4 sm:p-5">
      <div className="grid min-w-0 gap-5 lg:grid-cols-3">
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-3 text-base font-semibold text-white">Setup steps</h2>
          {sources.length ? (
            <ol className="grid gap-2 text-sm leading-6 text-slate-300">
              <li>1. Save a website source in this data space.</li>
              <li>2. Install the Website Tracker for authoritative funnel events; keep Drain optional and auxiliary.</li>
              <li>3. Keep source credentials isolated by source and server-side.</li>
            </ol>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm leading-6 text-slate-300">{dataSpace.display_name} has no website source yet, so this view is intentionally empty.</p>
              <LinkButton href={`${basePath}/sources/new`} variant="secondary">Add Source</LinkButton>
            </div>
          )}
        </GlassPanel>
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-3 text-base font-semibold text-white">What it collects</h2>
          <div className="flex flex-wrap gap-2">
            {["page_view", "anonymous_id", "session_id", "path", "url", "referrer", "custom properties"].map((item) => (
              <Badge key={item} tone="cyan">{item}</Badge>
            ))}
          </div>
        </GlassPanel>
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
            <ShieldAlert className="h-4 w-4 text-amber-200" />
            Data-space boundary
          </h2>
          <p className="text-sm leading-6 text-slate-300">
            Events are joined through sources assigned to {dataSpace.display_name}. Rows without a safe source mapping are not shown here.
          </p>
        </GlassPanel>
      </div>
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Webhook className="h-4 w-4 text-cyan-200" />
          <h2 className="text-base font-semibold text-white">Current {dataSpace.display_name} website mode</h2>
          <Badge tone="cyan">{website ? getWebsiteModeLabel(website) : "Needs tracker"}</Badge>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Vercel Drain endpoint</p>
            <p className="mt-2 break-all font-mono text-xs text-cyan-50">
              {drainSource ? `${publicAppUrl ?? "http://localhost:4000"}${drainSource.webhook_url ?? `/api/webhooks/vercel/analytics-drain/${drainSource.id}`}` : "No Vercel Drain source in this data space"}
            </p>
          </div>
          <p className="text-sm leading-6 text-slate-300">
            Vercel Drain ingestion still infers the data space from its source id. This page does not expose MoonArq drain details in other spaces.
          </p>
        </div>
      </GlassPanel>
      {snippet && helper ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <SnippetCard title="Lightweight JavaScript snippet" description="Authoritative v1 page_view tracking plus window.moonarqTrack(eventName, properties)." code={snippet} />
          <SnippetCard title="React / Next.js helper" description="Authoritative v1 usePageViewTracking() and trackEvent(name, properties)." code={helper} />
        </div>
      ) : (
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-2 text-base font-semibold text-white">Website Tracker is not installed</h2>
          <p className="text-sm leading-6 text-slate-300">
            Create or enable a Website Tracker source inside {dataSpace.display_name} before installing a snippet. No tracking key from another data space is shown here.
          </p>
        </GlassPanel>
      )}
        </div>
      </details>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-4 text-base font-semibold text-white">First-party events by path</h2>
          {Object.entries(byPath).length ? (
            <div className="grid gap-2">
              {Object.entries(byPath).map(([path, count]) => (
                <div key={path} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                  <span className="truncate text-slate-300">{path}</span>
                  <Badge tone="cyan">{count}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-6 text-slate-400">No events are visible for {dataSpace.display_name} yet.</p>
          )}
        </GlassPanel>
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white"><Activity className="h-4 w-4 text-cyan-200" />First-party event stream</h2>
          {events.length ? (
            <div className="grid max-h-[30rem] gap-2 overflow-auto pr-1">
              {events.map((event) => (
                <div key={event.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{event.event_name}</p>
                    <Badge tone={event.event_name === "page_view" ? "cyan" : "indigo"}>{event.device_type ?? "unknown"}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{event.path} · {event.referrer ?? "direct"} · {formatAppDateTime(event.occurred_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-6 text-slate-400">The stream is empty for this data space.</p>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
