import type { PlatformModule } from "@/aggregation/services/platform-modules-service";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { GlassPanel } from "@/presentation/components/ui/panel";

function formatMetric(value: number | string, unit: string) {
  if (typeof value === "string") return value;
  if (/^[a-z]{3}$/iu.test(unit)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: unit.toUpperCase(),
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${unit.toUpperCase()} ${value.toFixed(2)}`;
    }
  }
  if (unit === "percent") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function CommerceOutcomes({ shopify }: { shopify: PlatformModule | null }) {
  const connected = Boolean(shopify?.sourceId);
  const metrics = connected && shopify
    ? [shopify.primaryMetric, ...shopify.secondaryMetrics.filter((metric) =>
        ["net_payment", "gross_sales", "refunds"].includes(metric.key))]
    : [];

  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="commerce-outcomes-title" data-testid="commerce-outcomes">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/75">Authoritative commerce</p>
          <h2 id="commerce-outcomes-title" className="mt-1 text-xl font-semibold text-[#f5f2eb]">
            Commerce outcomes
          </h2>
        </div>
        <Badge tone={connected && shopify ? statusTone(shopify.status) : "slate"}>
          Shopify · {connected && shopify ? shopify.status.replaceAll("_", " ") : "not connected"}
        </Badge>
      </div>

      <GlassPanel className="p-4 sm:p-5">
        {metrics.length > 0 ? (
          <dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.key} className="min-w-0 border-b border-white/[0.07] pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3 last:border-0">
                <dt className="text-sm text-slate-400">{metric.label}</dt>
                <dd className="mt-2 break-words text-2xl font-semibold tracking-[-0.03em] text-white">
                  {formatMetric(metric.value, metric.unit)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div role="status">
            <p className="text-sm font-medium text-slate-200">Shopify commerce is not connected.</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">Orders and recognized revenue will remain unavailable until the official commerce source is configured.</p>
          </div>
        )}

        <p className="mt-4 border-t border-white/[0.08] pt-3 text-xs leading-5 text-slate-500">
          Shopify outcomes are reported separately and are not session-linked to the first-party Website funnel.
        </p>
      </GlassPanel>
    </section>
  );
}
