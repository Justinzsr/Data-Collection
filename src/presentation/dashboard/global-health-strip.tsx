import { Activity, CheckCircle2, Clock3, DatabaseZap, ShieldAlert } from "lucide-react";
import type { getGlobalPlatformHealth } from "@/aggregation/services/platform-modules-service";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { Badge } from "@/presentation/components/ui/badge";

type Health = Awaited<ReturnType<typeof getGlobalPlatformHealth>>;

function formatTime(value: string | null) {
  if (!value) return "No sync yet";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function GlobalHealthStrip({ health }: { health: Health }) {
  const items = [
    { label: "Active sources", value: health.activeSources, icon: DatabaseZap, tone: "cyan" as const },
    { label: "Sync errors", value: health.syncErrors, icon: ShieldAlert, tone: health.syncErrors > 0 ? ("amber" as const) : ("green" as const) },
    { label: "Last successful sync", value: formatTime(health.lastSuccessfulSync), icon: CheckCircle2, tone: "green" as const },
    { label: "Data freshness", value: health.dataFreshness, icon: Clock3, tone: "indigo" as const },
  ];
  return (
    <GlassPanel className="p-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-xs uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
              <item.icon className="h-4 w-4 text-cyan-200" />
            </div>
            <p className="truncate text-lg font-semibold text-white">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
        <span className="inline-flex items-center gap-2">
          <Activity className="h-4 w-4 text-teal-200" />
          {new Intl.NumberFormat("en-US").format(health.trackedEvents)} tracked website signals in selected range
        </span>
        <Badge tone={health.modeLabel.includes("Demo") ? "cyan" : "green"}>{health.modeLabel}</Badge>
      </div>
    </GlassPanel>
  );
}
