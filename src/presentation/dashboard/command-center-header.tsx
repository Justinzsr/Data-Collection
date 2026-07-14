import { Plus, RadioTower } from "lucide-react";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import type { PlatformModule } from "@/aggregation/services/platform-modules-service";
import { LinkButton } from "@/presentation/components/ui/button";
import { RunAllDueButton } from "@/presentation/dashboard/sync-action-button";

const ranges: Array<{ key: DateRangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

export function CommandCenterHeader({
  modules,
  range,
  dataSpaceName = "MoonArq",
  dataSpaceSlug,
  basePath = "/w/moonarq/dashboard",
}: {
  modules: PlatformModule[];
  range: DateRangeKey;
  dataSpaceName?: string;
  dataSpaceSlug?: string;
  basePath?: string;
}) {
  const active = modules.filter((module) => module.sourceId && module.status !== "disabled").length;
  const warnings = modules.filter((module) => ["needs_credentials", "warning", "error"].includes(module.status)).length;
  return (
    <header
      className="glass flex flex-col gap-3 overflow-hidden rounded-xl p-3 lg:flex-row lg:items-center lg:justify-between"
      data-testid="dashboard-overview"
    >
      <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-start">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-100/65">Live performance</p>
          <h1 className="mt-0.5 truncate text-lg font-semibold tracking-[-0.025em] text-white sm:text-xl">{dataSpaceName} command center</h1>
        </div>
        <p className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] text-slate-400 lg:hidden">
          <RadioTower className="h-3.5 w-3.5 text-cyan-200" />
          <span><span className="text-slate-100">{active}</span> live · <span className={warnings ? "text-amber-200" : "text-slate-100"}>{warnings}</span> alerts</span>
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:justify-center">
        <nav className="flex rounded-lg border border-white/10 bg-black/20 p-1" aria-label="Dashboard date range">
          {ranges.map((item) => (
            <LinkButton
              key={item.key}
              href={`${basePath}?range=${item.key}`}
              variant={range === item.key ? "primary" : "ghost"}
              className="min-h-8 rounded-md border-0 px-2.5 py-1 text-xs"
              aria-current={range === item.key ? "page" : undefined}
            >
              {item.label}
            </LinkButton>
          ))}
        </nav>
        <p className="hidden items-center gap-1.5 text-xs text-slate-400 lg:flex">
          <RadioTower className="h-3.5 w-3.5 text-cyan-200" />
          <span><span className="text-slate-100">{active}</span> live · <span className={warnings ? "text-amber-200" : "text-slate-100"}>{warnings}</span> alerts</span>
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <RunAllDueButton dataSpaceSlug={dataSpaceSlug} compact />
        <LinkButton href={`${basePath}/sources/new`} variant="primary" className="min-h-9 px-3 text-xs">
          <Plus className="h-3.5 w-3.5" />
          Add Source
        </LinkButton>
      </div>
    </header>
  );
}
