import type { PlatformModule } from "@/aggregation/services/platform-modules-service";
import { Badge, statusTone } from "@/presentation/components/ui/badge";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { formatAppDateTime } from "@/storage/runtime/app-time";

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

export type ShopifyCommerceState =
  | { kind: "not_connected"; label: "not connected"; title: string; detail: string }
  | { kind: "needs_credentials"; label: "needs credentials"; title: string; detail: string }
  | { kind: "awaiting_first_sync"; label: "awaiting first sync"; title: string; detail: string }
  | { kind: "sync_error"; label: "sync error"; title: string; detail: string }
  | { kind: "not_live"; label: "not live"; title: string; detail: string }
  | { kind: "ready"; label: "live"; title: string; detail: string };

export function resolveShopifyCommerceState(shopify: PlatformModule | null): ShopifyCommerceState {
  if (!shopify?.sourceId) {
    return {
      kind: "not_connected",
      label: "not connected",
      title: "Shopify commerce is not connected.",
      detail: "Orders and recognized revenue remain unavailable until the official commerce source is configured.",
    };
  }
  if (shopify.status === "needs_credentials") {
    return {
      kind: "needs_credentials",
      label: "needs credentials",
      title: "Shopify credentials are required.",
      detail: "Finish the official read-only connector setup before treating commerce metrics as available.",
    };
  }
  if (shopify.status === "demo" || shopify.status === "disabled") {
    return {
      kind: "not_live",
      label: "not live",
      title: "Shopify commerce is not live.",
      detail: "Demo or disabled sources do not provide authoritative commerce outcomes.",
    };
  }
  if (shopify.status === "error" || shopify.lastError) {
    return {
      kind: "sync_error",
      label: "sync error",
      title: "Shopify commerce metrics are unavailable because the latest sync failed.",
      detail: shopify.lastSuccessfulSyncAt
        ? `Last successful sync: ${formatAppDateTime(shopify.lastSuccessfulSyncAt)}. Current values are withheld until a successful sync.`
        : "No successful Shopify sync has completed yet. Current values are withheld.",
    };
  }
  if (shopify.status === "warning" || !shopify.lastSuccessfulSyncAt) {
    return {
      kind: "awaiting_first_sync",
      label: "awaiting first sync",
      title: "Shopify is awaiting its first successful sync.",
      detail: "Connected metrics remain unavailable until the shared sync engine completes successfully.",
    };
  }
  return {
    kind: "ready",
    label: "live",
    title: "Shopify commerce is live.",
    detail: "Authoritative commerce outcomes from the latest successful sync.",
  };
}

function shopifyStateTone(state: ShopifyCommerceState, shopify: PlatformModule | null) {
  if (state.kind === "ready" && shopify) return statusTone(shopify.status);
  if (state.kind === "sync_error") return "rose" as const;
  if (state.kind === "needs_credentials" || state.kind === "awaiting_first_sync") return "amber" as const;
  return "slate" as const;
}

export function CommerceOutcomes({ shopify }: { shopify: PlatformModule | null }) {
  const state = resolveShopifyCommerceState(shopify);
  const metrics = state.kind === "ready" && shopify
    ? [shopify.primaryMetric, ...shopify.secondaryMetrics.filter((metric) =>
        ["net_payment", "gross_sales", "refunds"].includes(metric.key))]
    : [];
  const zeroOrders = state.kind === "ready"
    && shopify?.primaryMetric.key === "orders"
    && typeof shopify.primaryMetric.value === "number"
    && shopify.primaryMetric.value === 0;

  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="commerce-outcomes-title" data-testid="commerce-outcomes">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/75">Authoritative commerce</p>
          <h2 id="commerce-outcomes-title" className="mt-1 text-xl font-semibold text-[#f5f2eb]">
            Commerce outcomes
          </h2>
        </div>
        <Badge tone={shopifyStateTone(state, shopify)}>
          Shopify · {state.label}
        </Badge>
      </div>

      <GlassPanel className="p-4 sm:p-5">
        {state.kind === "ready" && shopify ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
              <span>Selected range: {shopify.rangeLabel}</span>
              <span>Data through: {formatAppDateTime(shopify.lastSuccessfulSyncAt)}</span>
            </div>
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
            {zeroOrders ? (
              <p className="mt-4 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-300">
                No Shopify orders were recorded in the selected period.
              </p>
            ) : null}
          </>
        ) : (
          <div role="status">
            <p className="text-sm font-medium text-slate-200">{state.title}</p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{state.detail}</p>
          </div>
        )}

        <p className="mt-4 border-t border-white/[0.08] pt-3 text-xs leading-5 text-[var(--muted)]">
          Shopify outcomes are reported separately and are not session-linked to the first-party Website funnel.
        </p>
      </GlassPanel>
    </section>
  );
}
