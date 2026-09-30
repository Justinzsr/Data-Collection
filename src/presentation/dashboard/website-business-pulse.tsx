import type { WebsiteFunnelOverview, WebsiteFunnelStageKey } from "@/aggregation/services/website-funnel-types";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel, SectionTitle } from "@/presentation/components/ui/panel";
import {
  comparisonChipClass,
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
      <SectionTitle
        eyebrow="Business pulse"
        title="Storefront movement"
        id="business-pulse-title"
        action={<Badge tone="cyan">First-party Website Tracker</Badge>}
      />

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
              className="flex min-h-36 flex-col rounded-[22px] p-4"
              data-testid={`business-pulse-${definition.key}`}
            >
              <p className="text-[13px] font-medium leading-5 text-label-secondary">{definition.label}</p>
              <p className="tabular mt-2 text-[30px] font-semibold leading-9 tracking-[-0.035em] text-label">
                {unavailable || !measured ? "—" : count(value)}
              </p>
              <div className="mt-auto flex flex-col items-start gap-1.5 pt-3 text-xs">
                <span
                  className={`${comparisonChipClass(comparison.tone)} rounded-full px-2 py-0.5 font-semibold`}
                  data-comparison-state={comparison.kind}
                >
                  {comparison.label}
                </span>
                <span className="text-[var(--muted)]">
                  {!measured ? "Not measured" : definition.key === "visitors" ? "Period distinct" : "Distinct sessions"}
                </span>
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </section>
  );
}
