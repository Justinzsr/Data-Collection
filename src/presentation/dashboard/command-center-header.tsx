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

export function CommandCenterHeader({ modules, range }: { modules: PlatformModule[]; range: DateRangeKey }) {
  const active = modules.filter((module) => module.sourceId && module.status !== "disabled").length;
  const warnings = modules.filter((module) => ["needs_credentials", "warning", "error"].includes(module.status)).length;
  return (
    <header className="grid gap-5 rounded-lg border border-cyan-200/15 bg-[linear-gradient(135deg,rgba(8,47,73,0.65),rgba(15,23,42,0.7)_48%,rgba(20,83,45,0.24))] p-4 shadow-[0_24px_90px_rgba(8,145,178,0.16)] sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100/75">Internal platform command center</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">MoonArq Data Command Center</h1>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
            Source modules for official APIs, webhooks, manual sync, cron sync, and first-party website tracking. Links identify sources; private metrics need credentials, webhooks, or tracking snippets.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <RunAllDueButton />
          <LinkButton href="/dashboard/sources/new" variant="primary">
            <Plus className="h-4 w-4" />
            Add Source
          </LinkButton>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {ranges.map((item) => (
            <LinkButton key={item.key} href={`/dashboard?range=${item.key}`} variant={range === item.key ? "primary" : "secondary"} className="px-3">
              {item.label}
            </LinkButton>
          ))}
          <button className="inline-flex min-h-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-400" disabled>
            Custom
          </button>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <select className="min-h-10 min-w-0 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-200">
            <option>All sources</option>
            {modules
              .filter((module) => module.sourceId)
              .map((module) => (
                <option key={module.sourceId ?? module.sourceTypeKey}>{module.displayName}</option>
              ))}
          </select>
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <RadioTower className="h-4 w-4 text-cyan-200" />
            {active} active source{active === 1 ? "" : "s"} · {warnings} setup signal{warnings === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </header>
  );
}
