import type { WebsiteFunnelOverview, WebsiteFunnelStage } from "@/aggregation/services/website-funnel-types";
import { Badge } from "@/presentation/components/ui/badge";
import { Callout, GlassPanel } from "@/presentation/components/ui/panel";
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
      className="inset-surface grid min-w-0 gap-3 rounded-[18px] p-3.5 @md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] @md:items-center @4xl:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.4fr)_minmax(13rem,1fr)]"
      data-funnel-stage={stage.key}
      aria-label={stage.measured ? `${stage.label}: ${count(stage.sessions)} sessions` : `${stage.label}: not measured`}
    >
      <div className="min-w-0">
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-label">{stage.label}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{stage.description}</p>
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="tabular text-2xl font-semibold tracking-[-0.03em] text-label">{stage.measured ? count(stage.sessions) : "—"}</span>
          <span className="text-xs text-label-secondary">{stage.measured ? `${percent(stage.percentOfStart)} of visits` : "Not measured"}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-fill-strong" aria-hidden="true">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${stage.measured ? barPercent : 0}%`,
              backgroundImage: "linear-gradient(to right, var(--funnel-start), var(--funnel-end))",
            }}
            data-funnel-bar={stage.key}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs @md:col-span-2 @md:grid-cols-4 @md:border-t @md:border-separator @md:pt-3 @4xl:col-span-1 @4xl:grid-cols-2 @4xl:border-t-0 @4xl:pt-0">
        <div>
          <dt className="text-[var(--muted)]">From previous</dt>
          <dd className="tabular mt-0.5 font-semibold text-label">{stage.measured ? percent(stage.fromPrevious) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Drop-off</dt>
          <dd className="tabular mt-0.5 font-semibold text-label">
            {!stage.measured || stage.dropOff === null ? "—" : count(stage.dropOff)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Raw events</dt>
          <dd className="tabular mt-0.5 font-semibold text-label">{stage.measured ? count(stage.events) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Period change</dt>
          <dd
            className={`mt-0.5 font-semibold ${comparisonToneClass(comparison.tone)}`}
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
      className="grid min-w-0 content-start gap-4 p-4 sm:p-5"
      data-testid="storefront-funnel"
      aria-labelledby="storefront-funnel-title"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Primary conversion path</p>
          <h2 id="storefront-funnel-title" className="mt-1 text-[20px] font-semibold tracking-[-0.022em] text-label">
            Storefront session funnel
          </h2>
        </div>
        <Badge tone="cyan">Distinct sessions</Badge>
      </div>

      {message ? (
        <Callout tone="warning" role="status">{message}</Callout>
      ) : null}

      {overview.lowVolume ? (
        <Callout tone="neutral">Limited data — rates are directional.</Callout>
      ) : null}

      {overview.dataState !== "source_unavailable" && overview.dataState !== "pre_coverage" ? (
        <ol className="@container grid min-w-0 gap-2.5" aria-label="Ordered first-party storefront funnel">
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
        <Callout tone="neutral">No add-to-cart events were observed in this range.</Callout>
      ) : null}

      <p id="storefront-funnel-footnote" className="border-t border-separator pt-3 text-xs leading-5 text-[var(--muted)]">
        First-party session funnel; ends at checkout started. Orders and revenue are reported separately by Shopify.
      </p>
    </GlassPanel>
  );
}
