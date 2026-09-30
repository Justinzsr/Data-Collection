import Link from "next/link";
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
      className="glass flex flex-col gap-4 rounded-[28px] p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between"
      data-testid="dashboard-overview"
    >
      <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-start">
        <div className="min-w-0">
          <p className="eyebrow">Live performance</p>
          <h1 className="mt-0.5 truncate text-[26px] font-bold tracking-[-0.028em] text-label sm:text-[30px]">{dataSpaceName} command center</h1>
          <p className="mt-1 hidden items-center gap-1.5 text-[13px] text-label-secondary sm:flex">
            <RadioTower className="h-3.5 w-3.5 text-tint" aria-hidden="true" />
            <span><span className="font-semibold text-label">{active}</span> live · <span className={warnings ? "font-semibold text-warning" : "font-semibold text-label"}>{warnings}</span> {warnings === 1 ? "alert" : "alerts"}</span>
          </p>
        </div>
        <p className="flex shrink-0 items-center gap-1.5 rounded-full bg-fill-strong px-2.5 py-1 text-xs text-label-secondary sm:hidden">
          <RadioTower className="h-3.5 w-3.5 text-tint" aria-hidden="true" />
          <span><span className="text-label">{active}</span> live · <span className={warnings ? "text-warning" : "text-label"}>{warnings}</span> {warnings === 1 ? "alert" : "alerts"}</span>
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
        <nav className="segmented" aria-label="Dashboard date range">
          {ranges.map((item) => (
            <Link
              key={item.key}
              href={`${basePath}?range=${item.key}`}
              className="segmented-item min-h-9"
              aria-current={range === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          <RunAllDueButton dataSpaceSlug={dataSpaceSlug} compact />
          <LinkButton href={`${basePath}/sources/new`} variant="primary" className="min-h-10 px-4">
            <Plus className="h-4 w-4" />
            Add Source
          </LinkButton>
        </div>
      </div>
    </header>
  );
}
