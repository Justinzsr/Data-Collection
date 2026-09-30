"use client";

import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type {
  WebsiteCommerceFunnelV2Snapshot,
  WebsiteCommerceMeasurementState,
  WebsiteCommerceMetric,
  WebsiteCommerceRangeKey,
  WebsiteCommerceSegment,
  WebsiteCommerceSourceReadiness,
} from "@/aggregation/services/website-commerce-funnel-v2-types";
import { Badge } from "@/presentation/components/ui/badge";
import { Button, LinkButton } from "@/presentation/components/ui/button";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { formatAppDateTime } from "@/storage/runtime/app-time";
import { useWebsiteCommerceFunnelV2Data } from "@/presentation/dashboard/use-website-commerce-funnel-v2-data";

function stateLabel(state: WebsiteCommerceMeasurementState) {
  if (state === "healthy") return "Healthy";
  if (state === "partial") return "Partial";
  return "Not measured";
}

function stateTone(state: WebsiteCommerceMeasurementState) {
  if (state === "healthy") return "green" as const;
  if (state === "partial") return "amber" as const;
  return "slate" as const;
}

function StateIcon({ state }: { state: WebsiteCommerceMeasurementState }) {
  if (state === "healthy") return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  if (state === "partial") return <TriangleAlert className="h-4 w-4" aria-hidden="true" />;
  return <CircleDashed className="h-4 w-4" aria-hidden="true" />;
}

function formatCount(value: number | null) {
  return value === null ? "Not measured" : new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(metric: WebsiteCommerceMetric) {
  return metric.state !== "healthy" || metric.value === null
    ? "Not measured"
    : `${Number(metric.value).toFixed(2)}%`;
}

function formatMoney(value: string, currency: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${currency} ${value}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(number);
  } catch {
    return `${currency} ${value}`;
  }
}

function SourceReadiness({ source }: { source: WebsiteCommerceSourceReadiness }) {
  return (
    <div className="min-w-0 border-b border-separator pb-3 last:border-b-0 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3 sm:last:border-r-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-label">{source.label}</p>
        <Badge tone={stateTone(source.state)} className="shrink-0 gap-1">
          <StateIcon state={source.state} />
          {stateLabel(source.state)}
        </Badge>
      </div>
      <p className="mt-2 text-[11px] font-semibold text-muted">
        {source.cadence === "realtime" ? "Real-time events" : "Hourly sync"}
      </p>
      <p className="mt-1 text-xs leading-5 text-label-secondary">{source.authority}</p>
      <p className="mt-2 text-xs leading-5 text-muted">
        {source.asOf ? `Evidence through ${formatAppDateTime(source.asOf)}` : source.note}
      </p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <GlassPanel className="p-4 sm:p-5" role="status" aria-label="Loading V2 commerce funnel">
      <div className="animate-pulse">
        <div className="h-4 w-44 rounded-md bg-fill-strong" />
        <div className="mt-3 h-3 max-w-2xl rounded-md bg-fill-hover" />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-24 rounded-2xl bg-fill" />
          ))}
        </div>
      </div>
    </GlassPanel>
  );
}

function LockedPanel() {
  return (
    <GlassPanel className="border-warning-fill/25 p-4 sm:p-5" role="status">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="font-medium text-warning">Private dashboard access expired</p>
          <p className="mt-1 text-sm leading-6 text-label-secondary">
            Previously loaded V2 aggregates were cleared. Sign in again before refreshing this protected view.
          </p>
          <LinkButton href="/login" variant="secondary" className="mt-3 min-h-9 px-3 text-xs">
            Return to login
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </LinkButton>
        </div>
      </div>
    </GlassPanel>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <GlassPanel className="border-negative-fill/25 p-4 sm:p-5" role="alert">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-negative">V2 commerce funnel unavailable</p>
          <p className="mt-1 text-sm leading-6 text-label-secondary">{message}</p>
        </div>
        <Button type="button" variant="secondary" onClick={onRetry} className="shrink-0">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </GlassPanel>
  );
}

function NotMeasuredPanel({ snapshot }: { snapshot: WebsiteCommerceFunnelV2Snapshot }) {
  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="v2-not-measured">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-label-secondary" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-label">Order linkage is not measured</p>
            <Badge tone="slate">Fail closed</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-label-secondary">{snapshot.reason}</p>
          <p className="mt-2 text-xs leading-5 text-muted">
            No missing source, table, sync, or coverage interval is converted into a numeric zero.
          </p>
        </div>
      </div>
    </GlassPanel>
  );
}

function FullSnapshot({ snapshot }: { snapshot: WebsiteCommerceFunnelV2Snapshot }) {
  const diagnosticRows = [
    ["Excluded bots", snapshot.diagnostics.excludedBotSessions],
    ["Excluded non-production", snapshot.diagnostics.excludedNonProductionSessions],
    ["Eligible Shopify orders", snapshot.diagnostics.eligibleShopifyOrders],
    ["Valid bridge", snapshot.diagnostics.bridgeMatchedOrders],
    ["Missing bridge", snapshot.diagnostics.bridgeMissingOrders],
    ["Invalid bridge", snapshot.diagnostics.bridgeInvalidOrders],
    ["Ambiguous bridge", snapshot.diagnostics.bridgeAmbiguousOrders],
    ["Consent blocked", snapshot.diagnostics.consentBlockedOrders],
    ["Reversed time", snapshot.diagnostics.reversedTimestampOrders],
    ["Pre-coverage", snapshot.diagnostics.preCoverageOrders],
  ] as const;

  return (
    <div className="grid min-w-0 gap-3">
      <GlassPanel className="overflow-hidden">
        <div className="grid min-w-0 gap-3 border-b border-separator p-4 sm:grid-cols-3 sm:p-5">
          <SourceReadiness source={snapshot.sources.website} />
          <SourceReadiness source={snapshot.sources.shopify} />
          <SourceReadiness source={snapshot.sources.meta} />
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">
                Strict deterministic path
              </p>
              <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">Website behavior to Shopify order</h3>
            </div>
            <p className="text-xs text-muted">{snapshot.range.label} · Pacific Time</p>
          </div>

          <ol className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="V2 commerce funnel stages">
            {snapshot.funnel.map((stage, index) => (
              <li key={stage.key} className="relative min-w-0 rounded-2xl bg-fill p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-muted">
                    {stage.authority}
                  </span>
                  {index < snapshot.funnel.length - 1 ? (
                    <ArrowRight className="hidden h-3.5 w-3.5 text-muted xl:block" aria-hidden="true" />
                  ) : null}
                </div>
                <p className="mt-2 truncate text-sm text-label-secondary">{stage.label}</p>
                <p className={`mt-2 break-words font-semibold ${stage.count === null ? "text-sm text-muted" : "text-2xl text-label"}`}>
                  {formatCount(stage.count)}
                </p>
                <Badge tone={stateTone(stage.state)} className="mt-2">{stateLabel(stage.state)}</Badge>
              </li>
            ))}
          </ol>
        </div>
      </GlassPanel>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <BadgeDollarSign className="h-4 w-4 text-warning" aria-hidden="true" />
            <h3 className="font-semibold text-label">Shopify-authoritative outcomes</h3>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Eligible checkouts", snapshot.commerce.eligibleCheckoutEvents, formatCount(snapshot.commerce.eligibleCheckoutEvents.value as number | null)],
              ["Linked orders", snapshot.commerce.linkedOrdersPlaced, formatCount(snapshot.commerce.linkedOrdersPlaced.value as number | null)],
              ["Linked order rate", snapshot.commerce.linkedOrderRatePercent, formatPercent(snapshot.commerce.linkedOrderRatePercent)],
              ["Link coverage", snapshot.commerce.linkCoveragePercent, formatPercent(snapshot.commerce.linkCoveragePercent)],
            ].map(([label, metricValue, display]) => {
              const item = metricValue as WebsiteCommerceMetric;
              return (
                <div key={label as string} className="min-w-0 border-b border-separator pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3 last:border-0">
                  <dt className="text-xs text-label-secondary">{label as string}</dt>
                  <dd className={`mt-2 break-words font-semibold ${item.value === null ? "text-sm text-muted" : "text-xl text-label"}`}>
                    {display as string}
                  </dd>
                </div>
              );
            })}
          </dl>

          {snapshot.commerce.money.length > 0 ? (
            <div className="mt-5 border-t border-separator pt-4">
              <p className="text-xs font-semibold text-muted">Currency-separated money</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {snapshot.commerce.money.map((group) => (
                  <dl key={group.currency} className="grid grid-cols-2 gap-3 rounded-2xl bg-fill p-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted">Net payment</dt>
                      <dd className="mt-1 break-words font-semibold text-label">{formatMoney(group.netPayment, group.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Refunds</dt>
                      <dd className="mt-1 break-words font-semibold text-label">{formatMoney(group.refunds, group.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Gross sales</dt>
                      <dd className="mt-1 break-words text-label-secondary">{formatMoney(group.grossSales, group.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Current total</dt>
                      <dd className="mt-1 break-words text-label-secondary">{formatMoney(group.currentTotal, group.currency)}</dd>
                    </div>
                  </dl>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-5 border-t border-separator pt-4 text-sm text-muted">
              Monetary values are not measured for this covered scope.
            </p>
          )}
        </GlassPanel>

        <GlassPanel className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-pink" aria-hidden="true" />
            <h3 className="font-semibold text-label">Meta platform view</h3>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            {[
              ["Impressions", snapshot.meta.impressions],
              ["Link clicks", snapshot.meta.linkClicks],
              ["Platform purchases", snapshot.meta.platformPurchases],
            ].map(([label, value]) => {
              const item = value as WebsiteCommerceMetric;
              return (
                <div key={label as string} className="min-w-0 border-b border-separator pb-3 last:border-b-0 2xl:border-b-0 2xl:border-r 2xl:pb-0 2xl:pr-3 2xl:last:border-r-0">
                  <dt className="text-xs text-muted">{label as string}</dt>
                  <dd className={`mt-2 break-words font-semibold ${item.value === null ? "text-sm text-muted" : "text-xl text-label"}`}>
                    {formatCount(item.value as number | null)}
                  </dd>
                </div>
              );
            })}
          </dl>
          <div className="mt-4 border-t border-separator pt-3">
            <p className="text-xs text-muted">Spend</p>
            <p className="mt-1 break-words text-sm font-medium text-label">
              {snapshot.meta.spend.length > 0
                ? snapshot.meta.spend.map((group) => formatMoney(group.value, group.currency)).join(" · ")
                : "Not measured"}
            </p>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">{snapshot.meta.note}</p>
        </GlassPanel>
      </div>

      <details className="group glass min-w-0 rounded-2xl" data-testid="v2-coverage-diagnostics">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-sm font-medium text-label">
          <span>Coverage, Build Your Own, and reconciliation diagnostics</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-4 border-t border-separator p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {diagnosticRows.map(([label, item]) => (
              <div key={label} className="min-w-0 border-b border-separator pb-3 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-3 xl:[&:nth-child(4n)]:border-r-0">
                <p className="text-xs text-muted">{label}</p>
                <p className={`mt-1 break-words font-semibold ${item.value === null ? "text-sm text-muted" : "text-lg text-label"}`}>
                  {formatCount(item.value as number | null)}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 border-t border-separator pt-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted">Build Your Own linked lines</p>
              <p className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">{formatCount(snapshot.builder.linkedOrderLines.value as number | null)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Build Your Own item-link coverage</p>
              <p className="mt-1 text-[17px] font-semibold tracking-[-0.018em] text-label">{formatPercent(snapshot.builder.itemLinkCoveragePercent)}</p>
            </div>
          </div>
          <ul className="grid gap-1 border-t border-separator pt-4 text-xs leading-5 text-muted">
            {snapshot.caveats.map((caveat) => <li key={caveat}>• {caveat}</li>)}
          </ul>
        </div>
      </details>
    </div>
  );
}

export function WebsiteCommerceFunnelV2({
  dataSpaceSlug,
  range,
  segment,
}: {
  dataSpaceSlug: string;
  range: WebsiteCommerceRangeKey;
  segment: WebsiteCommerceSegment;
}) {
  const state = useWebsiteCommerceFunnelV2Data({ dataSpaceSlug, range, segment });

  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="website-commerce-funnel-v2-title" data-testid="website-commerce-funnel-v2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Commerce funnel V2</p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <h2 id="website-commerce-funnel-v2-title" className="text-[20px] font-semibold tracking-[-0.022em] text-label">
              Meta delivery · Website → Shopify
            </h2>
            {state.snapshot ? <Badge tone={stateTone(state.snapshot.state)}>{stateLabel(state.snapshot.state)}</Badge> : null}
            {state.isStale ? <Badge tone="amber">Stale snapshot</Badge> : null}
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-label-secondary">
            Exact, consent-gated Website-to-Shopify linkage. Meta delivery remains a separate platform-authoritative view.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {state.snapshot ? (
            <span className="text-xs text-muted" aria-live="polite">
              Updated {formatAppDateTime(state.snapshot.generatedAt)}
            </span>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="min-h-9 px-3 text-xs"
            onClick={() => void state.refresh()}
            disabled={state.isRefreshing || state.isLoading || state.isAuthLocked}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${state.isRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {state.isRefreshing ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      </div>

      {state.isAuthLocked ? <LockedPanel /> : null}
      {!state.isAuthLocked && state.isLoading && !state.snapshot ? <LoadingPanel /> : null}
      {!state.isAuthLocked && !state.isLoading && !state.snapshot && state.error ? (
        <ErrorPanel message={state.error} onRetry={() => void state.refresh()} />
      ) : null}
      {!state.isAuthLocked && state.snapshot?.state === "not_measured" ? (
        <NotMeasuredPanel snapshot={state.snapshot} />
      ) : null}
      {!state.isAuthLocked && state.snapshot && state.snapshot.state !== "not_measured" ? (
        <FullSnapshot snapshot={state.snapshot} />
      ) : null}

      <p className="flex items-center gap-2 text-xs leading-5 text-muted">
        <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Refreshes every 60 seconds while visible and immediately when this tab becomes visible again.
      </p>
    </section>
  );
}
