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
import { Callout, GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
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
    <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-5">
      <SectionHeader
        eyebrow="Website connector"
        title={`${dataSpace.display_name} Event dashboard`}
        description="Authoritative first-party event reads are scoped to this data space. Vercel Drain remains retained as auxiliary request evidence."
      />
      {publicAppUrlWarning ? (
        <Callout tone="warning" title="Public app URL warning" icon={<ShieldAlert className="h-4 w-4" />}>
          {publicAppUrlWarning}
        </Callout>
      ) : null}
      <MetricTrendChart
        data={trend}
        title="Website page views"
        description={website ? `${dataSpace.display_name} first-party tracker metrics` : "First-party tracker setup required; Drain remains auxiliary"}
      />
      <details className="group glass min-w-0 overflow-hidden rounded-3xl">
        <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-3xl p-4 transition hover:bg-fill sm:p-5">
          <div>
            <p className="eyebrow">Installation</p>
            <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">Endpoints, tracking snippets, and setup</h2>
            <p className="mt-1 text-sm text-muted">Expand when configuring or troubleshooting website collection.</p>
          </div>
          <ChevronDown className="h-5 w-5 shrink-0 text-muted transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid min-w-0 gap-5 border-t border-separator p-4 sm:p-5">
      <div className="grid min-w-0 gap-5 lg:grid-cols-3">
        <div className="inset-surface rounded-[18px] p-4 sm:p-5">
          <h2 className="mb-3 text-[17px] font-semibold tracking-[-0.018em] text-label">Setup steps</h2>
          {sources.length ? (
            <ol className="grid gap-2 text-sm leading-6 text-label-secondary">
              <li>1. Save a website source in this data space.</li>
              <li>2. Install the Website Tracker for authoritative funnel events; keep Drain optional and auxiliary.</li>
              <li>3. Keep source credentials isolated by source and server-side.</li>
            </ol>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm leading-6 text-label-secondary">{dataSpace.display_name} has no website source yet, so this view is intentionally empty.</p>
              <LinkButton href={`${basePath}/sources/new`} variant="secondary">Add Source</LinkButton>
            </div>
          )}
        </div>
        <div className="inset-surface rounded-[18px] p-4 sm:p-5">
          <h2 className="mb-3 text-[17px] font-semibold tracking-[-0.018em] text-label">What it collects</h2>
          <div className="flex flex-wrap gap-2">
            {["page_view", "anonymous_id", "session_id", "path", "url", "referrer", "custom properties"].map((item) => (
              <Badge key={item} tone="cyan">{item}</Badge>
            ))}
          </div>
        </div>
        <div className="inset-surface rounded-[18px] p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.018em] text-label">
            <ShieldAlert className="h-4 w-4 text-warning" />
            Data-space boundary
          </h2>
          <p className="text-sm leading-6 text-label-secondary">
            Events are joined through sources assigned to {dataSpace.display_name}. Rows without a safe source mapping are not shown here.
          </p>
        </div>
      </div>
      <div className="inset-surface rounded-[18px] p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Webhook className="h-4 w-4 text-tint-text" />
          <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">Current {dataSpace.display_name} website mode</h2>
          <Badge tone="cyan">{website ? getWebsiteModeLabel(website) : "Needs tracker"}</Badge>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
          <div className="rounded-[14px] bg-fill-strong p-3">
            <p className="text-xs font-medium text-muted">Vercel Drain endpoint</p>
            <p className="mt-2 break-all font-mono text-xs text-label">
              {drainSource ? `${publicAppUrl ?? "http://localhost:4000"}${drainSource.webhook_url ?? `/api/webhooks/vercel/analytics-drain/${drainSource.id}`}` : "No Vercel Drain source in this data space"}
            </p>
          </div>
          <p className="text-sm leading-6 text-label-secondary">
            Vercel Drain ingestion still infers the data space from its source id. This page does not expose MoonArq drain details in other spaces.
          </p>
        </div>
      </div>
      {snippet && helper ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <SnippetCard title="Lightweight JavaScript snippet" description="Authoritative v1 page_view tracking plus window.moonarqTrack(eventName, properties)." code={snippet} />
          <SnippetCard title="React / Next.js helper" description="Authoritative v1 usePageViewTracking() and trackEvent(name, properties)." code={helper} />
        </div>
      ) : (
        <div className="inset-surface rounded-[18px] p-4 sm:p-5">
          <h2 className="mb-2 text-[17px] font-semibold tracking-[-0.018em] text-label">Website Tracker is not installed</h2>
          <p className="text-sm leading-6 text-label-secondary">
            Create or enable a Website Tracker source inside {dataSpace.display_name} before installing a snippet. No tracking key from another data space is shown here.
          </p>
        </div>
      )}
        </div>
      </details>
      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-4 text-[17px] font-semibold tracking-[-0.018em] text-label">First-party events by path</h2>
          {Object.entries(byPath).length ? (
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(byPath).map(([path, count]) => (
                <div key={path} className="inset-surface flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-label-secondary">{path}</span>
                  <Badge tone="cyan">{count}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-6 text-label-secondary">No events are visible for {dataSpace.display_name} yet.</p>
          )}
        </GlassPanel>
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-4 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.018em] text-label"><Activity className="h-4 w-4 text-tint-text" />First-party event stream</h2>
          {events.length ? (
            <div className="grid max-h-[30rem] grid-cols-1 gap-2 overflow-auto pr-1">
              {events.map((event) => (
                <div key={event.id} className="inset-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[13px] font-medium text-label">{event.event_name}</p>
                    <Badge tone={event.event_name === "page_view" ? "cyan" : "indigo"}>{event.device_type ?? "unknown"}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">{event.path} · {event.referrer ?? "direct"} · {formatAppDateTime(event.occurred_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-6 text-label-secondary">The stream is empty for this data space.</p>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
