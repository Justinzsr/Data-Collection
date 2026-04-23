import { Activity, Plus, RadioTower } from "lucide-react";
import { getDashboardSummary } from "@/aggregation/services/summary-service";
import { getMetricTimeseries, getSourceComparison } from "@/aggregation/services/timeseries-service";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { KpiCard } from "@/presentation/dashboard/kpi-card";
import { RunAllDueButton } from "@/presentation/dashboard/sync-action-button";
import { MetricTrendChart, SourceComparisonChart } from "@/presentation/charts/metric-trend-chart";

export default async function DashboardPage() {
  const [summary, trend, comparison] = await Promise.all([
    getDashboardSummary("30d"),
    getMetricTimeseries({ metricKey: "page_views", range: "30d" }),
    getSourceComparison(),
  ]);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader
        eyebrow="Executive overview"
        title="MoonArq Data Collection Base"
        description="A private internal data hub for source onboarding, official API/webhook collection, idempotent storage, metrics aggregation, and responsive visualization."
        action={
          <>
            <RunAllDueButton />
            <LinkButton href="/dashboard/sources/new" variant="primary">
              <Plus className="h-4 w-4" />
              Add Source
            </LinkButton>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {["Today", "7 days", "30 days", "Custom"].map((range) => (
          <button
            key={range}
            className={`rounded-lg border px-3 py-2 text-sm ${range === "30 days" ? "border-cyan-200/40 bg-cyan-300/12 text-cyan-50" : "border-white/10 bg-white/[0.03] text-slate-300"}`}
          >
            {range}
          </button>
        ))}
        <select className="min-h-10 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-200">
          <option>All sources</option>
          {summary.sources.map((source) => (
            <option key={source.id}>{source.display_name}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {summary.kpis.map((kpi) => (
          <KpiCard key={kpi.key} label={kpi.label} value={kpi.value} source={kpi.source} demo={kpi.demo} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.75fr)]">
        <MetricTrendChart data={trend} title="Page views trend" />
        <SourceComparisonChart data={comparison} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <RadioTower className="h-4 w-4 text-cyan-200" />
            <h2 className="text-base font-semibold text-white">Sync health strip</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {summary.sources
              .filter((source) => source.status !== "disabled")
              .map((source) => (
                <div key={source.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-white">{source.display_name}</p>
                    <Badge tone={statusTone(source.status)}>{source.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Last success: {source.last_success_at ?? "never"} · Next: {source.next_sync_at ?? "manual"}</p>
                </div>
              ))}
          </div>
        </GlassPanel>

        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-teal-200" />
            <h2 className="text-base font-semibold text-white">Future sources</h2>
          </div>
          <p className="text-sm leading-6 text-slate-300">
            Shopify, TikTok, Instagram, Vercel project metadata, custom APIs, and custom CSV are scaffolded but intentionally not dominant. Commerce KPIs stay off the main top row until Shopify is connected.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["Shopify", "TikTok", "Instagram", "Vercel Project", "Custom API", "Custom CSV"].map((item) => (
              <Badge key={item} tone="slate">{item}</Badge>
            ))}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
