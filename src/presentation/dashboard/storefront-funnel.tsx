import type { WebsiteFunnelOverview, WebsiteFunnelStage } from "@/aggregation/services/website-funnel-types";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel } from "@/presentation/components/ui/panel";
import {
  comparisonToneClass,
  resolveComparisonDisplay,
} from "@/presentation/dashboard/comparison-display";

function count(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function percent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function stateCopy(overview: WebsiteFunnelOverview) {
  if (overview.dataState === "source_unavailable") {
    if (overview.source.state === "ambiguous") {
      return "Multiple authoritative Website sources were found. Funnel totals are unavailable until source ownership is unambiguous.";
    }
    return "The authoritative Website source is unavailable. Funnel totals are not being inferred from auxiliary traffic.";
  }
  if (overview.dataState === "pre_coverage") {
    return overview.coverage.firstOccurredAt
      ? "This range predates Website tracking coverage. Earlier dates are unavailable, not zero."
      : "Website tracking coverage has not started.";
  }
  if (overview.dataState === "filtered_empty") return "No Website events match the selected filters.";
  if (overview.dataState === "no_events") return "No tracked Website events in this period.";
  return null;
}

function FunnelStageRow({
  stage,
  startingSessions,
  comparisonMode,
  comparisonAvailable,
}: {
  stage: WebsiteFunnelStage;
  startingSessions: number;
  comparisonMode: WebsiteFunnelOverview["comparison"]["mode"];
  comparisonAvailable: boolean;
}) {
  const barPercent = startingSessions > 0 ? Math.max(0, Math.min(100, (stage.sessions / startingSessions) * 100)) : 0;
  const comparison = resolveComparisonDisplay({
    mode: comparisonMode,
    globallyAvailable: comparisonAvailable,
    measured: stage.measured,
    hasBaseline: stage.previousSessions !== null,
    deltaPercent: stage.deltaPercent,
    includeDelta: true,
  });

  return (
    <li
      className="grid min-w-0 gap-3 rounded-xl border border-white/[0.09] bg-black/15 p-3 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.4fr)_minmax(13rem,1fr)] sm:items-center"
      data-funnel-stage={stage.key}
      aria-label={stage.measured ? `${stage.label}: ${count(stage.sessions)} sessions` : `${stage.label}: not measured`}
    >
      <div className="min-w-0">
        <p className="font-medium text-[#f5f2eb]">{stage.label}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{stage.description}</p>
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-2xl font-semibold tracking-[-0.03em] text-white">{stage.measured ? count(stage.sessions) : "—"}</span>
          <span className="text-xs text-slate-400">{stage.measured ? `${percent(stage.percentOfStart)} of visits` : "Not measured"}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${stage.measured ? barPercent : 0}%`,
              backgroundImage: "linear-gradient(to right, #94a3b8, #67e8f9)",
            }}
            data-funnel-bar={stage.key}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-[var(--muted)]">From previous</dt>
          <dd className="mt-0.5 font-medium text-slate-200">{stage.measured ? percent(stage.fromPrevious) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Drop-off</dt>
          <dd className="mt-0.5 font-medium text-slate-200">
            {!stage.measured || stage.dropOff === null ? "—" : count(stage.dropOff)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Raw events</dt>
          <dd className="mt-0.5 font-medium text-slate-200">{stage.measured ? count(stage.events) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Period change</dt>
          <dd
            className={`mt-0.5 font-medium ${comparisonToneClass(comparison.tone)}`}
            data-comparison-state={comparison.kind}
          >
            {comparison.label}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function StorefrontFunnel({ overview }: { overview: WebsiteFunnelOverview }) {
  const message = stateCopy(overview);
  const startingSessions = overview.stages.find((stage) => stage.key === "visit")?.sessions ?? 0;
  const cartStage = overview.stages.find((stage) => stage.key === "add_to_cart");
  const noCart = overview.dataState === "ready" && cartStage?.measured === true && cartStage.sessions === 0;

  return (
    <GlassPanel
      className="grid min-w-0 gap-4 p-4 sm:p-5"
      data-testid="storefront-funnel"
      aria-labelledby="storefront-funnel-title"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Primary conversion path</p>
          <h2 id="storefront-funnel-title" className="mt-1 text-xl font-semibold text-[#f5f2eb]">
            Storefront session funnel
          </h2>
        </div>
        <Badge tone="cyan">Distinct sessions</Badge>
      </div>

      {message ? (
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.07] p-4" role="status">
          <p className="text-sm leading-6 text-amber-50/85">{message}</p>
        </div>
      ) : null}

      {overview.lowVolume ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-sm text-slate-300">
          Limited data — rates are directional.
        </div>
      ) : null}

      {overview.dataState !== "source_unavailable" && overview.dataState !== "pre_coverage" ? (
        <ol className="grid min-w-0 gap-2.5" aria-label="Ordered first-party storefront funnel">
          {overview.stages.map((stage) => (
            <FunnelStageRow
              key={stage.key}
              stage={stage}
              startingSessions={startingSessions}
              comparisonMode={overview.comparison.mode}
              comparisonAvailable={overview.comparison.available}
            />
          ))}
        </ol>
      ) : null}

      {noCart ? (
        <p className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-300">
          No add-to-cart events were observed in this range.
        </p>
      ) : null}

      <p id="storefront-funnel-footnote" className="border-t border-white/[0.08] pt-3 text-xs leading-5 text-[var(--muted)]">
        First-party session funnel; ends at checkout started. Orders and revenue are reported separately by Shopify.
      </p>
    </GlassPanel>
  );
}
