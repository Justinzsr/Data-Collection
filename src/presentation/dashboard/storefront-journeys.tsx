import type { WebsiteFunnelOverview, WebsiteJourneyStage } from "@/aggregation/services/website-funnel-types";
import { Badge } from "@/presentation/components/ui/badge";
import { GlassPanel } from "@/presentation/components/ui/panel";

function count(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function percent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function JourneyStage({ stage }: { stage: WebsiteJourneyStage }) {
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-white/[0.07] py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{stage.label}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {count(stage.events)} events · {percent(stage.fromPrevious)} from previous
        </p>
      </div>
      <p className="text-lg font-semibold text-white">{count(stage.sessions)}</p>
    </li>
  );
}

export function StorefrontJourneys({ overview }: { overview: WebsiteFunnelOverview }) {
  const unavailable = overview.dataState === "source_unavailable"
    || overview.dataState === "pre_coverage";
  const unavailableCopy = overview.dataState === "pre_coverage"
    ? "Journey outcomes are unavailable before Website tracking coverage begins."
    : "Journey outcomes require exactly one available authoritative Website source.";

  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="storefront-journeys-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Journey detail</p>
          <h2 id="storefront-journeys-title" className="mt-1 text-xl font-semibold text-[#f5f2eb]">
            Ready-made and Build Your Own
          </h2>
        </div>
        <Badge tone="slate">Separate behavioral paths</Badge>
      </div>

      {unavailable ? (
        <GlassPanel className="p-4 sm:p-5" role="status">
          <p className="text-sm font-medium text-slate-200">Journey data unavailable</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">{unavailableCopy}</p>
        </GlassPanel>
      ) : (
      <div className="grid min-w-0 gap-3 xl:grid-cols-3">
        <GlassPanel className="p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Ready-made journey</p>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Direct product landings remain eligible; collection discovery is not required.
          </p>
          <ol className="mt-3" aria-label="Ready-made session journey">
            {overview.readyMade.stages.map((stage) => <JourneyStage key={stage.label} stage={stage} />)}
          </ol>
        </GlassPanel>

        <GlassPanel className="p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Build Your Own outcomes</p>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Completion and save are separate outcomes from build-start sessions; saves are not assumed to follow completion.
          </p>
          <dl className="mt-3 grid gap-2.5">
            {[
              { label: "Build starts", stage: overview.builder.starts, rate: null },
              { label: "Build completions", stage: overview.builder.completions, rate: overview.builder.completionRate },
              { label: "Designs saved", stage: overview.builder.saves, rate: overview.builder.saveRate },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 border-b border-white/[0.07] py-2 last:border-0">
                <dt className="text-sm text-slate-300">
                  <span className="block">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {count(item.stage.events)} events{item.rate === null ? "" : ` · ${percent(item.rate)} of starts`}
                  </span>
                </dt>
                <dd className="text-lg font-semibold text-white">{count(item.stage.sessions)}</dd>
              </div>
            ))}
          </dl>
        </GlassPanel>

        <GlassPanel className="p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Email signup engagement</p>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Website Tracker engagement only — not a confirmed subscriber count and not combined with persisted email subscriptions.
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label: "Sessions", value: overview.emailSignup.sessions },
              { label: "Visitors", value: overview.emailSignup.visitors },
              { label: "Events", value: overview.emailSignup.events },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-lg border border-white/[0.08] bg-black/15 p-2.5">
                <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{item.label}</dt>
                <dd className="mt-1 break-words text-lg font-semibold text-white">{count(item.value)}</dd>
              </div>
            ))}
          </dl>
        </GlassPanel>
      </div>
      )}
    </section>
  );
}
