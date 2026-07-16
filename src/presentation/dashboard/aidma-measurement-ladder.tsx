import type { InstagramPaidAdsSummary, PaidMetricValue } from "@/aggregation/services/meta-ads-attribution-service";

const stageTone: Record<InstagramPaidAdsSummary["aidma"]["stages"][number]["key"], string> = {
  attention: "border-cyan-300/20 bg-cyan-300/[0.045] text-cyan-100",
  interest: "border-sky-300/20 bg-sky-300/[0.045] text-sky-100",
  desire: "border-fuchsia-300/20 bg-fuchsia-300/[0.045] text-fuchsia-100",
  memory: "border-violet-300/20 bg-violet-300/[0.045] text-violet-100",
  action: "border-emerald-300/20 bg-emerald-300/[0.045] text-emerald-100",
};

function formatMetric(metric: PaidMetricValue) {
  if (metric.state === "stale" && metric.value === null) return "Stale";
  if (metric.state === "pending") return "Pending";
  if (metric.state === "no_delivery") return "No delivery";
  if (metric.state === "not_reported") return "Not reported";
  if (metric.state === "unavailable") return "Unavailable";
  if (metric.value === null) return "Not available";
  if (metric.unit === "percent") return `${metric.value.toFixed(1)}%`;
  if (metric.unit === "ratio") return `${metric.value.toFixed(2)}×`;
  if (/^[a-z]{3}$/iu.test(metric.unit)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: metric.unit.toUpperCase(),
        maximumFractionDigits: 2,
      }).format(metric.value);
    } catch {
      return `${metric.unit.toUpperCase()} ${metric.value.toFixed(2)}`;
    }
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(metric.value);
}

function metricStateDetail(metric: PaidMetricValue) {
  if (metric.reason) return metric.reason;
  if (metric.state === "stale") return "Cached value; refresh the source before relying on it.";
  if (metric.state === "pending") return "Waiting for the required source data.";
  if (metric.state === "no_delivery") return "No matching delivery was reported in this range.";
  if (metric.state === "not_reported") return "The source did not report a usable value or denominator.";
  if (metric.state === "unavailable") return "The required linked evidence is unavailable.";
  return null;
}

function MetricDatum({ label, metric }: { label: string; metric: PaidMetricValue }) {
  const detail = metricStateDetail(metric);
  const emphasized = metric.state === "ready" || (metric.state === "stale" && metric.value !== null);

  return (
    <div className="min-w-0 border-t border-white/10 py-2 first:border-t-0 first:pt-0 last:pb-0" data-state={metric.state}>
      <dt className="break-words text-[10px] font-medium uppercase leading-4 tracking-[0.1em] text-slate-400">{label}</dt>
      <dd className={`mt-0.5 break-words font-semibold tabular-nums ${emphasized ? "text-sm text-white" : "text-xs leading-5 text-amber-100"}`}>
        <span>{formatMetric(metric)}</span>
        {detail ? <span className="mt-0.5 block break-words text-[10px] font-normal leading-4 text-slate-400">{detail}</span> : null}
      </dd>
    </div>
  );
}

export function AidmaMeasurementLadder({ aidma }: { aidma: InstagramPaidAdsSummary["aidma"] }) {
  return (
    <ol
      aria-label="AIDMA paid media measurement ladder"
      className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5"
      data-testid="aidma-measurement-ladder"
    >
      {aidma.stages.map((stage, index) => {
        const countDetail = metricStateDetail(stage.count);
        return (
          <li
            key={stage.key}
            aria-label={`${stage.label} stage`}
            className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3"
            data-aidma-stage={stage.key}
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold ${stageTone[stage.key]}`}>
                    {index + 1}
                  </span>
                  <h4 className="break-words text-xs font-semibold text-white">{stage.label}</h4>
                  {stage.key === "memory" ? (
                    <span className="rounded border border-violet-300/20 bg-violet-300/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-violet-100">
                      Proxy
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 break-words text-[10px] leading-4 text-slate-400">{stage.proxyLabel}</p>
              </div>
              <span className="min-w-0 max-w-[45%] break-words text-right text-[9px] uppercase leading-4 tracking-[0.08em] text-slate-500">
                {stage.sourceLabel}
              </span>
            </div>

            <div className="mt-3 min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">Count</p>
              <p className={`mt-1 break-words font-semibold tabular-nums ${stage.count.state === "ready" ? "text-xl text-white" : stage.count.state === "stale" && stage.count.value !== null ? "text-xl text-amber-100" : "text-sm leading-6 text-amber-100"}`}>
                {formatMetric(stage.count)}
              </p>
              {countDetail ? (
                <p className="mt-0.5 break-words text-[10px] leading-4 text-slate-400">{countDetail}</p>
              ) : null}
            </div>

            <dl className="mt-3 min-w-0">
              <MetricDatum label={stage.rateLabel} metric={stage.rate} />
              <MetricDatum label={stage.supportLabel} metric={stage.support} />
              <MetricDatum label={stage.costLabel} metric={stage.cost} />
            </dl>

            {stage.caveat ? (
              <p className="mt-3 min-w-0 break-words border-t border-white/10 pt-2 text-[10px] leading-4 text-slate-400">
                {stage.caveat}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
