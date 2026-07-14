import { Activity, CheckCircle2, Clock3, DatabaseZap, ShieldAlert } from "lucide-react";
import type { getGlobalPlatformHealth } from "@/aggregation/services/platform-modules-service";
import { Badge } from "@/presentation/components/ui/badge";
import { formatAppDateTime } from "@/storage/runtime/app-time";

type Health = Awaited<ReturnType<typeof getGlobalPlatformHealth>>;

function formatTime(value: string | null) {
  return formatAppDateTime(value, "No sync yet");
}

export function GlobalHealthStrip({ health }: { health: Health }) {
  const items = [
    { label: "Active sources", value: health.activeSources, icon: DatabaseZap, tone: "cyan" as const },
    { label: "Sync errors", value: health.syncErrors, icon: ShieldAlert, tone: health.syncErrors > 0 ? ("amber" as const) : ("green" as const) },
    { label: "Last successful sync", value: formatTime(health.lastSuccessfulSync), icon: CheckCircle2, tone: "green" as const },
    { label: "Data freshness", value: health.dataFreshness, icon: Clock3, tone: "indigo" as const },
  ];
  return (
    <section className="glass min-w-0 rounded-xl p-2.5" aria-label="Collection health overview">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0 rounded-lg px-2.5 py-2 hover:bg-white/[0.025]" data-testid="overview-kpi">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="truncate text-[10px] uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
              <item.icon className="h-3.5 w-3.5 text-cyan-200" />
            </div>
            <p className="truncate text-base font-semibold text-white">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-2.5 pt-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-teal-200" />
          {new Intl.NumberFormat("en-US").format(health.trackedEvents)} tracked website signals in selected range
        </span>
        <Badge tone={health.modeLabel.includes("Demo") ? "cyan" : "green"}>{health.modeLabel}</Badge>
      </div>
    </section>
  );
}
