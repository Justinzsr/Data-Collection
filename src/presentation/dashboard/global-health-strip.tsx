import { Activity, CheckCircle2, Clock3, DatabaseZap, ShieldAlert } from "lucide-react";
import type { getGlobalPlatformHealth } from "@/aggregation/services/platform-modules-service";
import { Badge } from "@/presentation/components/ui/badge";
import { formatAppDateTime } from "@/storage/runtime/app-time";

type Health = Awaited<ReturnType<typeof getGlobalPlatformHealth>>;

function formatTime(value: string | null) {
  return formatAppDateTime(value, "No sync yet");
}

const iconTone = {
  cyan: "bg-tint/12 text-tint",
  amber: "bg-warning-fill/15 text-warning",
  green: "bg-positive-fill/15 text-positive",
  indigo: "bg-indigo-fill/14 text-indigo",
} as const;

export function GlobalHealthStrip({ health }: { health: Health }) {
  const items = [
    { label: "Active sources", value: health.activeSources, icon: DatabaseZap, tone: "cyan" as const },
    { label: "Sync errors", value: health.syncErrors, icon: ShieldAlert, tone: health.syncErrors > 0 ? ("amber" as const) : ("green" as const) },
    { label: "Last successful sync", value: formatTime(health.lastSuccessfulSync), icon: CheckCircle2, tone: "green" as const },
    { label: "Data freshness", value: health.dataFreshness, icon: Clock3, tone: "indigo" as const },
  ];
  return (
    <section className="glass min-w-0 rounded-3xl p-2.5 sm:p-3" aria-label="Collection health overview">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 items-center gap-3 rounded-2xl px-2.5 py-2.5 transition hover:bg-fill" data-testid="overview-kpi">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${iconTone[item.tone]}`}>
              <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted">{item.label}</p>
              <p className="tabular truncate text-[15px] font-semibold tracking-[-0.01em] text-label">{item.value}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-separator px-2.5 pt-2.5 text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-teal" aria-hidden="true" />
          {new Intl.NumberFormat("en-US").format(health.trackedEvents)} tracked website signals in selected range
        </span>
        <Badge tone={health.modeLabel.includes("Demo") ? "cyan" : "green"} dot>{health.modeLabel}</Badge>
      </div>
    </section>
  );
}
