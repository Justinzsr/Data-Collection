import {
  Braces,
  Camera,
  DatabaseZap,
  ExternalLink,
  FileSpreadsheet,
  Globe2,
  Play,
  Rocket,
  ShoppingBag,
  Video,
} from "lucide-react";
import type { PlatformModule } from "@/aggregation/services/platform-modules-service";
import { SparklineChart } from "@/presentation/charts/sparkline-chart";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";

const icons = {
  website: Globe2,
  supabase: DatabaseZap,
  vercel_project: Rocket,
  shopify: ShoppingBag,
  tiktok: Video,
  instagram: Camera,
  custom_api: Braces,
  custom_csv: FileSpreadsheet,
};

const tones = {
  website: "cyan",
  supabase: "teal",
  vercel_project: "indigo",
  shopify: "amber",
  tiktok: "rose",
  instagram: "indigo",
  custom_api: "cyan",
  custom_csv: "teal",
} as const;

function formatMetric(value: number | string, unit: string) {
  if (typeof value === "string") return value;
  if (unit === "usd") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }
  if (unit === "percent") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTime(value: string | null) {
  if (!value) return "not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function PlatformModuleCard({ module }: { module: PlatformModule }) {
  const Icon = icons[module.sourceTypeKey];
  const tone = tones[module.sourceTypeKey];
  return (
    <article className="glass group grid min-h-[27rem] min-w-0 gap-4 rounded-lg p-4 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-200/30 hover:shadow-[0_24px_90px_rgba(8,145,178,0.18)]">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] shadow-[inset_0_0_24px_rgba(255,255,255,0.04)]">
            <Icon className="h-5 w-5 text-cyan-100" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{module.platformLabel}</p>
            <p className="truncate text-xs text-slate-500">{module.displayName}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge tone={statusTone(module.status)}>{module.status}</Badge>
          <Badge tone="slate">{module.sourceModeLabel}</Badge>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{module.primaryMetric.label}</p>
            <p className="mt-1 truncate text-3xl font-semibold text-white">{formatMetric(module.primaryMetric.value, module.primaryMetric.unit)}</p>
          </div>
          <Badge tone={module.primaryMetric.deltaPercent === null ? "slate" : module.primaryMetric.deltaPercent >= 0 ? "green" : "rose"}>
            {module.primaryMetric.deltaLabel}
          </Badge>
        </div>
      </div>

      <SparklineChart data={module.sparkline} tone={tone} label={module.platformLabel} />

      <div className="grid grid-cols-2 gap-2">
        {module.secondaryMetrics.map((metric) => (
          <div key={metric.key} className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="truncate text-[11px] uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-100">{formatMetric(metric.value, metric.unit)}</p>
          </div>
        ))}
      </div>

      {module.insights.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {module.insights.slice(0, 4).map((insight) => (
            <div key={`${insight.label}-${insight.value}`} className="min-w-0 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
              <p className="truncate text-[11px] uppercase tracking-[0.12em] text-slate-500">{insight.label}</p>
              <p className="mt-1 truncate text-sm text-slate-200">{insight.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={module.setupState.severity === "ok" ? "green" : module.setupState.severity === "error" ? "rose" : module.setupState.severity === "warning" ? "amber" : "cyan"}>
            {module.setupState.label}
          </Badge>
          <span className="text-xs capitalize text-slate-500">{module.syncMode} sync</span>
        </div>
        <p className="line-clamp-2 text-xs leading-5 text-slate-400">{module.setupState.message}</p>
      </div>

      <div className="grid gap-1 text-xs text-slate-500">
        <p>Last sync: <span className="text-slate-300">{formatTime(module.lastSyncAt)}</span></p>
        <p>Next sync: <span className="text-slate-300">{formatTime(module.nextSyncAt)}</span></p>
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        {module.sourceId && module.actions.canRunSync ? <SyncActionButton sourceId={module.sourceId} compact /> : (
          <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300/15 bg-slate-900/50 px-3 py-2 text-sm text-slate-500" disabled>
            <Play className="h-4 w-4" />
            Sync
          </button>
        )}
        {module.sourceId && module.actions.canViewDetails ? (
          <LinkButton href={`/dashboard/sources/${module.sourceId}`} variant="secondary" className="px-3">
            <ExternalLink className="h-4 w-4" />
            Details
          </LinkButton>
        ) : (
          <LinkButton href="/dashboard/sources/new" variant="ghost" className="px-3">
            Configure
          </LinkButton>
        )}
      </div>
    </article>
  );
}
