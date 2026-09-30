import { ChevronDown, ExternalLink, MailPlus } from "lucide-react";
import type { PlatformModule } from "@/aggregation/services/platform-modules-service";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { SparklineChart } from "@/presentation/charts/sparkline-chart";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { formatAppDateTime } from "@/storage/runtime/app-time";

const compactPlatformLabels: Partial<Record<PlatformModule["sourceTypeKey"], string>> = {
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

export function PlatformModuleCard({
  module,
  basePath = "/w/moonarq/dashboard",
  dataSpaceSlug,
  surface = "glass",
}: {
  module: PlatformModule;
  basePath?: string;
  dataSpaceSlug?: string;
  /** "inset" when the card already sits inside another glass panel. */
  surface?: "glass" | "inset";
}) {
  const detailCount = module.secondaryMetrics.length + module.insights.length;
  const delta = module.primaryMetric.deltaPercent;
  const deltaClass = delta === null || delta === 0
    ? "text-[var(--muted)]"
    : delta < 0
      ? "text-negative"
      : "text-positive";

  return (
    <article
      className={`overview-module-card ${surface === "inset" ? "inset-surface" : "glass"} min-w-0 overflow-hidden rounded-3xl transition duration-200`}
      data-platform-type={module.sourceTypeKey}
    >
      <details className="group" data-testid={`overview-module-${module.sourceTypeKey}`}>
        <summary
          className="cursor-pointer p-4 transition hover:bg-fill"
          data-testid={`overview-module-summary-${module.sourceTypeKey}`}
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <PlatformIcon sourceTypeKey={module.sourceTypeKey} />
              <div className="min-w-0">
                <h2 aria-label={module.platformLabel} title={module.platformLabel} className="truncate text-[15px] font-semibold tracking-[-0.01em] text-label">
                  {compactPlatformLabels[module.sourceTypeKey] ?? module.platformLabel}
                </h2>
                <p title={module.displayName} className="truncate text-xs text-muted">{module.displayName}</p>
              </div>
            </div>
            <span title={module.status.replaceAll("_", " ")}>
              <Badge tone={statusTone(module.status)} dot>{compactStatusLabel(module.status)}</Badge>
            </span>
          </div>

          <div className="mt-3 flex min-w-0 items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs text-muted">{module.primaryMetric.label}</p>
              <p className="tabular mt-0.5 truncate text-[26px] font-semibold leading-8 tracking-[-0.03em] text-label">{formatMetric(module.primaryMetric.value, module.primaryMetric.unit)}</p>
            </div>
            <span className={`truncate text-xs font-semibold ${deltaClass}`}>
              {module.primaryMetric.deltaLabel}
            </span>
          </div>

          <div className="mt-2">
            <SparklineChart
              data={module.sparkline}
              color={platformSeriesColor(module.sourceTypeKey)}
              label={`${module.platformLabel} ${module.primaryMetric.label}, ${module.rangeLabel}`}
              compact
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-separator pt-2.5 text-xs text-muted">
            <span className="truncate" title={`${detailCount} detail signals`}>{module.rangeLabel} · {module.sourceModeLabel}</span>
            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-tint-text">
              Details
              <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
            </span>
          </div>
        </summary>

        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-t border-separator p-4"
          data-testid={`overview-module-detail-${module.sourceTypeKey}`}
        >
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {module.secondaryMetrics.map((metric) => (
              <div key={metric.key} className="inset-surface min-w-0 px-3 py-2.5">
                <p className="truncate text-xs text-muted">{metric.label}</p>
                <p className="tabular mt-0.5 truncate text-[15px] font-semibold text-label">{formatMetric(metric.value, metric.unit)}</p>
              </div>
            ))}
          </div>

          {module.insights.length > 0 ? (
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {module.insights.map((insight) => (
                <div key={`${insight.label}-${insight.value}`} className="inset-surface min-w-0 px-3 py-2.5">
                  <p className="truncate text-xs text-muted">{insight.label}</p>
                  <p className="mt-0.5 break-words text-[13px] leading-5 text-label">{insight.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="inset-surface min-w-0 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={module.setupState.severity === "ok" ? "green" : module.setupState.severity === "error" ? "rose" : module.setupState.severity === "warning" ? "amber" : "cyan"} dot>
                  {module.setupState.label}
                </Badge>
                <span className="text-xs capitalize text-muted">{module.syncMode} sync</span>
              </div>
              <p className="text-[13px] leading-5 text-label-secondary">{module.setupState.message}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>Last: <span className="text-label-secondary">{formatTime(module.lastSyncAt)}</span></span>
                <span>Next: <span className="text-label-secondary">{formatTime(module.nextSyncAt)}</span></span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {module.sourceId && module.actions.canRunSync ? <SyncActionButton sourceId={module.sourceId} dataSpaceSlug={dataSpaceSlug} compact /> : null}
              {module.sourceTypeKey === "supabase" && dataSpaceSlug === "moonarq" ? (
                <LinkButton href={`${basePath}/supabase/email-marketing`} variant="secondary" className="min-h-9 px-3.5 text-xs">
                  <MailPlus className="h-3.5 w-3.5" />
                  Email Marketing
                </LinkButton>
              ) : null}
              {module.sourceId && module.actions.canViewDetails ? (
                <LinkButton href={`${basePath}/sources/${module.sourceId}`} variant="secondary" className="min-h-9 px-3.5 text-xs">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Source
                </LinkButton>
              ) : (
                <LinkButton
                  href={module.sourceTypeKey === "shopify" ? `${basePath}/sources/new?template=shopify` : `${basePath}/sources/new`}
                  variant="ghost"
                  className="min-h-9 px-3.5 text-xs"
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
