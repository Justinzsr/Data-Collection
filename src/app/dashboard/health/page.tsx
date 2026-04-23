import { getSystemHealth } from "@/aggregation/services/health-service";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";

export default async function HealthPage() {
  const health = await getSystemHealth();
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader eyebrow="System health" title="Connector events and sync errors" description="Operational events are recorded instead of disappearing into logs." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Sources</p><p className="mt-2 text-3xl font-semibold text-white">{health.sourcesTotal}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Healthy</p><p className="mt-2 text-3xl font-semibold text-white">{health.healthySources}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Warnings</p><p className="mt-2 text-3xl font-semibold text-white">{health.warningSources}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Errors</p><p className="mt-2 text-3xl font-semibold text-white">{health.errorSources}</p></GlassPanel>
      </div>
      <GlassPanel className="p-4 sm:p-5">
        <h2 className="mb-4 text-base font-semibold text-white">Recent connector events</h2>
        <div className="grid gap-3">
          {health.recentEvents.map((event) => (
            <div key={event.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-white">{event.event_type}</p>
                <Badge tone={statusTone(event.severity)}>{event.severity}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-400">{event.message}</p>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
