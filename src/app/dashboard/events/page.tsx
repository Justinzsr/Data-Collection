import { Activity, ShieldAlert } from "lucide-react";
import { generateReactHelper, generateTrackingSnippet } from "@/collection/tracking/snippet-generator";
import { getMetricTimeseries } from "@/aggregation/services/timeseries-service";
import { listWebEvents } from "@/storage/repositories/events-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { MetricTrendChart } from "@/presentation/charts/metric-trend-chart";
import { SnippetCard } from "@/presentation/dashboard/snippet-card";

export default async function EventsPage() {
  const [sources, events, trend] = await Promise.all([listSources(), listWebEvents(30), getMetricTimeseries({ metricKey: "page_views" })]);
  const website = sources.find((source) => source.source_type_key === "website");
  const trackingKey = String(website?.metadata.public_tracking_key ?? "mq_demo_public_website");
  const endpoint = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100"}/api/track`;
  const snippet = generateTrackingSnippet({ endpoint, publicTrackingKey: trackingKey });
  const helper = generateReactHelper({ endpoint, publicTrackingKey: trackingKey });
  const byPath = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.path] = (acc[event.path] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Website connector"
        title="Event dashboard"
        description="First-party tracking works on Vercel or any website. It does not use private Vercel Analytics APIs."
      />
      <MetricTrendChart data={trend} title="Website page views" />
      <div className="grid gap-5 lg:grid-cols-3">
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-3 text-base font-semibold text-white">Setup steps</h2>
          <ol className="grid gap-2 text-sm leading-6 text-slate-300">
            <li>1. Save or open a Website / Vercel Site source.</li>
            <li>2. Copy the JavaScript snippet or React helper into that website.</li>
            <li>3. Use <span className="text-cyan-100">window.moonarqTrack</span> for custom events.</li>
          </ol>
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
            Allowed origins
          </h2>
          <p className="text-sm leading-6 text-slate-300">
            Configure allowed origins on the Website source before production. Unknown origins should not be able to send events into your private data base.
          </p>
        </GlassPanel>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <SnippetCard title="Lightweight JavaScript snippet" description="Auto page_view plus window.moonarqTrack(eventName, properties)." code={snippet} />
        <SnippetCard title="React / Next.js helper" description="usePageViewTracking() and trackEvent(name, properties)." code={helper} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-4 text-base font-semibold text-white">Events by path</h2>
          <div className="grid gap-2">
            {Object.entries(byPath).map(([path, count]) => (
              <div key={path} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                <span className="truncate text-slate-300">{path}</span>
                <Badge tone="cyan">{count}</Badge>
              </div>
            ))}
          </div>
        </GlassPanel>
        <GlassPanel className="p-4 sm:p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white"><Activity className="h-4 w-4 text-cyan-200" />Event stream</h2>
          <div className="grid max-h-[30rem] gap-2 overflow-auto pr-1">
            {events.map((event) => (
              <div key={event.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-white">{event.event_name}</p>
                  <Badge tone={event.event_name === "page_view" ? "cyan" : "indigo"}>{event.device_type ?? "unknown"}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">{event.path} · {event.referrer ?? "direct"} · {event.occurred_at}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
