import { notFound } from "next/navigation";
import { getSystemHealth } from "@/aggregation/services/health-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export const dynamic = "force-dynamic";

export default async function HealthPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const health = await getSystemHealth({ dataSpaceId: dataSpace.id });
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <SectionHeader eyebrow="System health" title={`${dataSpace.display_name} health`} description="Operational events are scoped to this data space and recorded instead of disappearing into logs." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Sources</p><p className="mt-2 text-3xl font-semibold text-white">{health.sourcesTotal}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Healthy</p><p className="mt-2 text-3xl font-semibold text-white">{health.healthySources}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Warnings</p><p className="mt-2 text-3xl font-semibold text-white">{health.warningSources}</p></GlassPanel>
        <GlassPanel className="p-4"><p className="text-sm text-slate-400">Errors</p><p className="mt-2 text-3xl font-semibold text-white">{health.errorSources}</p></GlassPanel>
      </div>
      <GlassPanel className="p-4 sm:p-5">
        <h2 className="mb-4 text-base font-semibold text-white">Recent connector events</h2>
        <div className="grid gap-3">
          {health.recentEvents.length === 0 ? <p className="text-sm text-slate-500">No connector events in this data space yet.</p> : null}
          {health.recentEvents.map((event) => (
            <div key={event.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium capitalize text-white">{event.event_type.replaceAll("_", " ")}</p>
                <Badge tone={statusTone(event.severity)}>{event.severity.replaceAll("_", " ")}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-400">{event.message}</p>
              <p className="mt-2 text-xs text-slate-500">{formatAppDateTime(event.created_at)}</p>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
