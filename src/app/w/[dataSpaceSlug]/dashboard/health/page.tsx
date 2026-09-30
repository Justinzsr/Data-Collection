import { CheckCircle2, CircleAlert, DatabaseZap, OctagonAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { getSystemHealth } from "@/aggregation/services/health-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionHeader } from "@/presentation/components/ui/panel";
import { IconTile } from "@/presentation/components/ui/platform-icon";
import { currentTime, formatRelativeTime } from "@/presentation/components/ui/relative-time";
import { ConnectionHealthPanel } from "@/presentation/dashboard/connection-health-panel";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export const dynamic = "force-dynamic";

export default async function HealthPage({ params }: { params: Promise<{ dataSpaceSlug: string }> }) {
  const { dataSpaceSlug } = await params;
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const [health, sources] = await Promise.all([
    getSystemHealth({ dataSpaceId: dataSpace.id }),
    listSources({ dataSpaceId: dataSpace.id }),
  ]);
  const now = currentTime();
  const tiles = [
    { label: "Sources", value: health.sourcesTotal, icon: DatabaseZap, tone: "tint" as const },
    { label: "Healthy", value: health.healthySources, icon: CheckCircle2, tone: "positive" as const },
    { label: "Warnings", value: health.warningSources, icon: CircleAlert, tone: health.warningSources > 0 ? "warning" as const : "positive" as const },
    { label: "Errors", value: health.errorSources, icon: OctagonAlert, tone: health.errorSources > 0 ? "negative" as const : "positive" as const },
  ];
  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <SectionHeader eyebrow="System health" title={`${dataSpace.display_name} health`} description="Operational events are scoped to this data space and recorded instead of disappearing into logs." />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map((tile) => (
          <GlassPanel key={tile.label} className="flex flex-col items-start gap-2.5 rounded-[22px] p-3.5 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
            <IconTile icon={tile.icon} tone={tile.tone} />
            <div>
              <p className="text-[13px] font-medium text-label-secondary">{tile.label}</p>
              <p className="tabular text-[26px] font-semibold leading-8 tracking-[-0.03em] text-label">{tile.value}</p>
            </div>
          </GlassPanel>
        ))}
      </div>
      <ConnectionHealthPanel sources={sources} basePath={dashboardPath(dataSpace.slug)} now={now} />
      <GlassPanel className="p-4 sm:p-5">
        <h2 className="mb-4 text-[17px] font-semibold tracking-[-0.018em] text-label">Recent connector events</h2>
        <div className="grid gap-2">
          {health.recentEvents.length === 0 ? <p className="text-sm text-muted">No connector events in this data space yet.</p> : null}
          {health.recentEvents.map((event) => (
            <div key={event.id} className="inset-surface flex flex-col gap-1.5 p-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="font-semibold capitalize text-label">{event.event_type.replaceAll("_", " ")}</p>
                <p className="mt-0.5 break-words text-sm leading-6 text-label-secondary">{event.message}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
                <Badge tone={statusTone(event.severity)} dot>{event.severity.replaceAll("_", " ")}</Badge>
                <p className="text-xs text-muted" title={formatAppDateTime(event.created_at)}>{formatRelativeTime(event.created_at, { now })}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
