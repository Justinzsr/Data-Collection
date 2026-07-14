import {
  Braces,
  BookOpen,
  Camera,
  ChevronDown,
  DatabaseZap,
  ExternalLink,
  FileSpreadsheet,
  Globe2,
  Rocket,
  ShoppingBag,
  Video,
} from "lucide-react";
import type { PlatformModule } from "@/aggregation/services/platform-modules-service";
import { SparklineChart } from "@/presentation/charts/sparkline-chart";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { formatAppDateTime } from "@/storage/runtime/app-time";

const icons = {
  website: Globe2,
  supabase: DatabaseZap,
  vercel_project: Rocket,
  shopify: ShoppingBag,
  tiktok: Video,
  instagram: Camera,
  xiaohongshu: BookOpen,
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
  xiaohongshu: "rose",
  custom_api: "cyan",
  custom_csv: "teal",
} as const;

const compactPlatformLabels: Partial<Record<keyof typeof icons, string>> = {
  website: "Website",
  supabase: "Supabase",
  tiktok: "TikTok",
  instagram: "Instagram",
  shopify: "Shopify",
};

function compactStatusLabel(status: PlatformModule["status"]) {
  if (status === "needs_credentials") return "setup";
  return status.replaceAll("_", " ");
}

function formatMetric(value: number | string, unit: string) {
  if (typeof value === "string") return value;
  if (/^[a-z]{3}$/i.test(unit)) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: unit.toUpperCase() }).format(value);
  }
  if (unit === "percent") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTime(value: string | null) {
  return formatAppDateTime(value, "not scheduled");
}

export function PlatformModuleCard({ module, basePath = "/w/moonarq/dashboard", dataSpaceSlug }: { module: PlatformModule; basePath?: string; dataSpaceSlug?: string }) {
  const Icon = icons[module.sourceTypeKey];
  const tone = tones[module.sourceTypeKey];
  const detailCount = module.secondaryMetrics.length + module.insights.length;

  return (
    <article
      className="overview-module-card glass min-w-0 overflow-hidden rounded-xl transition duration-200 hover:border-cyan-200/20"
      data-platform-type={module.sourceTypeKey}
    >
      <details className="group" data-testid={`overview-module-${module.sourceTypeKey}`}>
        <summary
          className="cursor-pointer p-3 transition hover:bg-white/[0.025]"
          data-testid={`overview-module-summary-${module.sourceTypeKey}`}
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
                <Icon className="h-4 w-4 text-cyan-100" />
              </span>
              <div className="min-w-0">
                <h2 aria-label={module.platformLabel} title={module.platformLabel} className="truncate text-sm font-semibold text-white">
                  {compactPlatformLabels[module.sourceTypeKey] ?? module.platformLabel}
                </h2>
                <p title={module.displayName} className="truncate text-[11px] text-slate-500">{module.displayName}</p>
              </div>
            </div>
            <span title={module.status.replaceAll("_", " ")}>
              <Badge tone={statusTone(module.status)}>{compactStatusLabel(module.status)}</Badge>
            </span>
          </div>

          <div className="mt-2.5 flex min-w-0 items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[10px] uppercase tracking-[0.14em] text-slate-500">{module.primaryMetric.label}</p>
              <p className="mt-0.5 truncate text-2xl font-semibold tracking-[-0.03em] text-white">{formatMetric(module.primaryMetric.value, module.primaryMetric.unit)}</p>
            </div>
            <span className={module.primaryMetric.deltaPercent !== null && module.primaryMetric.deltaPercent < 0 ? "truncate text-[10px] text-rose-200" : "truncate text-[10px] text-emerald-200"}>
              {module.primaryMetric.deltaLabel}
            </span>
          </div>

          <div className="mt-1.5">
            <SparklineChart data={module.sparkline} tone={tone} label={module.platformLabel} compact />
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-2 text-[10px] text-slate-500">
            <span className="truncate">{detailCount} detail signals · {module.sourceModeLabel}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-slate-400">
              Details
              <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
            </span>
          </div>
        </summary>

        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-t border-white/10 p-3 sm:p-4"
          data-testid={`overview-module-detail-${module.sourceTypeKey}`}
        >
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {module.secondaryMetrics.map((metric) => (
              <div key={metric.key} className="min-w-0 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
                <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-100">{formatMetric(metric.value, metric.unit)}</p>
              </div>
            ))}
          </div>

          {module.insights.length > 0 ? (
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {module.insights.map((insight) => (
                <div key={`${insight.label}-${insight.value}`} className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{insight.label}</p>
                  <p className="mt-1 break-words text-xs leading-5 text-slate-200">{insight.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={module.setupState.severity === "ok" ? "green" : module.setupState.severity === "error" ? "rose" : module.setupState.severity === "warning" ? "amber" : "cyan"}>
                  {module.setupState.label}
                </Badge>
                <span className="text-xs capitalize text-slate-500">{module.syncMode} sync</span>
              </div>
              <p className="text-xs leading-5 text-slate-400">{module.setupState.message}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>Last: <span className="text-slate-300">{formatTime(module.lastSyncAt)}</span></span>
                <span>Next: <span className="text-slate-300">{formatTime(module.nextSyncAt)}</span></span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {module.sourceId && module.actions.canRunSync ? <SyncActionButton sourceId={module.sourceId} dataSpaceSlug={dataSpaceSlug} compact /> : null}
              {module.sourceId && module.actions.canViewDetails ? (
                <LinkButton href={`${basePath}/sources/${module.sourceId}`} variant="secondary" className="min-h-9 px-3 text-xs">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Source
                </LinkButton>
              ) : (
                <LinkButton
                  href={module.sourceTypeKey === "shopify" ? `${basePath}/sources/new?template=shopify` : `${basePath}/sources/new`}
                  variant="ghost"
                  className="min-h-9 px-3 text-xs"
                >
                  Configure
                </LinkButton>
              )}
            </div>
          </div>
        </div>
      </details>
    </article>
  );
}
