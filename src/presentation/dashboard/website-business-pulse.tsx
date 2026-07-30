import type { WebsiteFunnelOverview, WebsiteFunnelStageKey } from "@/aggregation/services/website-funnel-types";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel } from "@/presentation/components/ui/panel";
import {
  comparisonToneClass,
  resolveComparisonDisplay,
} from "@/presentation/dashboard/comparison-display";

const pulseDefinitions: Array<{
  key: "visitors" | WebsiteFunnelStageKey;
  label: string;
}> = [
  { key: "visitors", label: "Unique Website visitors" },
  { key: "visit", label: "Website sessions" },
  { key: "product_intent", label: "Product-intent sessions" },
  { key: "add_to_cart", label: "Add-to-cart sessions" },
  { key: "begin_checkout", label: "Checkout-start sessions" },
];

function count(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function WebsiteBusinessPulse({ overview }: { overview: WebsiteFunnelOverview }) {
  const stageByKey = new Map(overview.stages.map((stage) => [stage.key, stage]));
  const unavailable = overview.dataState === "pre_coverage" || overview.dataState === "source_unavailable";

  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="business-pulse-title" data-testid="business-pulse">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Business pulse</p>
          <h2 id="business-pulse-title" className="mt-1 text-xl font-semibold text-[#f5f2eb]">
            Storefront movement
          </h2>
        </div>
        <Badge tone="cyan">First-party Website Tracker</Badge>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {pulseDefinitions.map((definition) => {
          const stage = definition.key === "visitors" ? null : stageByKey.get(definition.key);
          const value = definition.key === "visitors" ? overview.uniqueVisitors : stage?.sessions ?? 0;
          const delta = definition.key === "visitors" ? null : stage?.deltaPercent ?? null;
          const measured = definition.key === "visitors" || stage?.measured !== false;
          const comparison = resolveComparisonDisplay({
            mode: overview.comparison.mode,
            globallyAvailable: overview.comparison.available,
            measured,
            hasBaseline: definition.key !== "visitors",
            deltaPercent: delta,
            includeDelta: definition.key !== "visitors",
          });
          return (
            <GlassPanel
              key={definition.key}
              className="min-h-36 p-4"
              data-testid={`business-pulse-${definition.key}`}
            >
              <p className="text-sm leading-5 text-slate-400">{definition.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[#f5f2eb]">
                {unavailable || !measured ? "—" : count(value)}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[var(--muted)]">
                  {!measured ? "Not measured" : definition.key === "visitors" ? "Period distinct" : "Distinct sessions"}
                </span>
                <span
                  className={comparisonToneClass(comparison.tone)}
                  data-comparison-state={comparison.kind}
                >
                  {comparison.label}
                </span>
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </section>
  );
}
