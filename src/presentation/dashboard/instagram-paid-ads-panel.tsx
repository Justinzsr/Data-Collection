import { ArrowRight, BadgeDollarSign, ChevronDown, Megaphone, MousePointerClick, ShoppingCart, Target } from "lucide-react";
import type { InstagramPaidAdsSummary, PaidMetricValue } from "@/aggregation/services/meta-ads-attribution-service";
import { PaidAttributionChart } from "@/presentation/charts/paid-attribution-chart";
import { AidmaMeasurementLadder } from "@/presentation/dashboard/aidma-measurement-ladder";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { formatAppDateTime } from "@/storage/runtime/app-time";

function stateText(metric: PaidMetricValue) {
  if (metric.state === "stale" && metric.value === null) return "Stale";
  if (metric.state === "pending") return "Pending";
  if (metric.state === "no_delivery") return "—";
  if (metric.state === "not_reported") return "Not reported";
  if (metric.state === "unavailable") return "Unavailable";
  if (metric.value === null) return "—";
  if (metric.unit === "percent") return `${metric.value.toFixed(1)}%`;
  if (metric.unit === "ratio") return `${metric.value.toFixed(2)}×`;
  if (/^[a-z]{3}$/i.test(metric.unit)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: metric.unit.toUpperCase(), maximumFractionDigits: 2 }).format(metric.value);
    } catch {
      return `${metric.unit.toUpperCase()} ${metric.value.toFixed(2)}`;
    }
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(metric.value);
}

function stateDetail(metric: PaidMetricValue) {
  if (metric.reason) return metric.reason;
  if (metric.state === "no_delivery") return "Waiting for delivery";
  if (metric.state === "pending") return "Waiting for source data";
  if (metric.state === "not_reported") return metric.source === "derived" ? "Needs a non-zero denominator" : "Not reported by source";
  if (metric.state === "unavailable") return "Required linked data is unavailable";
  if (metric.state === "stale") return "Historical cached value; source needs attention";
  return metric.source === "shopify" ? "Shopify last-visit UTM" : metric.source === "utm" ? "First-party UTM" : metric.source === "meta" ? "Meta Ads Insights" : "Derived from linked sources";
}

function MetricTile({ label, metric }: { label: string; metric: PaidMetricValue }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="break-words text-[11px] uppercase leading-4 tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1.5 break-words font-semibold ${metric.state === "ready" ? "text-xl text-white" : metric.state === "stale" && metric.value !== null ? "text-xl text-amber-100" : "text-sm leading-6 text-amber-100"}`}>{stateText(metric)}</p>
      <p className="mt-1 break-words text-[11px] leading-4 text-slate-400">{stateDetail(metric)}</p>
    </div>
  );
}

function coverageTone(active: boolean) {
  return active ? "green" : "amber";
}

function stateBadge(summary: InstagramPaidAdsSummary) {
  if (summary.state === "ready") return { tone: "green" as const, text: "Data available" };
  if (summary.state === "no_delivery") return { tone: "amber" as const, text: "No matching delivery" };
  if (summary.state === "not_connected") return { tone: "amber" as const, text: "Connect Ads" };
  if (summary.state === "needs_account") return { tone: "amber" as const, text: "Select account" };
  if (summary.state === "first_sync") return { tone: "cyan" as const, text: "First sync pending" };
  if (summary.state === "error") return { tone: "rose" as const, text: "Ads sync error" };
  return { tone: "amber" as const, text: "Data available · source warning" };
}

function emptyStateCopy(summary: InstagramPaidAdsSummary) {
  if (summary.state === "not_connected") return ["Connect Meta Ads to begin", "The read-only connector will load delivery, spend, conversion, and creative-level UTM data."];
  if (summary.state === "needs_account") return ["Choose the Meta ad account", "Open the Ads source and select one of the accounts returned by OAuth before syncing."];
  if (summary.state === "first_sync") return ["Run the first Ads sync", "The campaign metadata is connected; daily delivery metrics will appear after the first successful sync."];
  if (summary.state === "error") return ["Meta Ads source needs attention", "Open the Ads source to test the connection, retry sync, or reconnect OAuth."];
  return ["No matching delivery data in this range", "The chart will appear once Meta reports delivery for this exact campaign/content UTM and the linked sources sync."];
}

function formatMinorUnitBudget(value: number | null, currency: string) {
  if (value === null) return "Not reported";
  try {
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(value / (10 ** digits));
  } catch {
    return `${value} minor units`;
  }
}

export function InstagramPaidAdsPanel({ summary, instagramSourceId, dataSpaceSlug, returnPath }: {
  summary: InstagramPaidAdsSummary;
  instagramSourceId: string;
  dataSpaceSlug: string;
  returnPath: string;
}) {
  const badge = stateBadge(summary);
  const connectHref = `/api/oauth/meta-ads/start?instagramSourceId=${encodeURIComponent(instagramSourceId)}&dataSpaceSlug=${encodeURIComponent(dataSpaceSlug)}&returnPath=${encodeURIComponent(returnPath)}`;
  const utm = summary.campaign.utm;

  return (
    <section className="min-w-0 rounded-xl border border-fuchsia-300/15 bg-fuchsia-300/[0.035] p-3 [&_a]:!min-h-11 [&_button]:!min-h-11 sm:p-4" data-testid="instagram-paid-ads-panel">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/10"><Megaphone className="h-4 w-4 text-fuchsia-100" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-200/75">Paid Story attribution</p>
              <h3 className="mt-0.5 break-words text-sm font-semibold text-white">{summary.campaign.campaignName}</h3>
            </div>
            <Badge tone={badge.tone}>{badge.text}</Badge>
          </div>
          <p className="mt-2 break-all text-[11px] leading-5 text-slate-400">
            utm_source={utm.source}&amp;utm_medium={utm.medium}&amp;utm_campaign={utm.campaign}&amp;utm_content={utm.content}
          </p>
        </div>
        {summary.state === "not_connected" ? (
          <LinkButton href={connectHref} variant="primary" className="min-h-9 shrink-0 px-3 text-xs">
            <Megaphone className="h-3.5 w-3.5" />
            Connect Meta Ads
          </LinkButton>
        ) : summary.metaAdsSourceId ? (
          <LinkButton href={`/w/${encodeURIComponent(dataSpaceSlug)}/dashboard/sources/${summary.metaAdsSourceId}`} variant="secondary" className="min-h-9 shrink-0 px-3 text-xs">
            {summary.state === "needs_account" ? "Select account" : summary.state === "error" ? "Review Ads source" : "Ads source"} <ArrowRight className="h-3.5 w-3.5" />
          </LinkButton>
        ) : null}
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-[10px]">
        <Badge tone={coverageTone(summary.coverage.meta)}>Meta {summary.coverage.meta ? "connected" : "not connected"}</Badge>
        <Badge tone={coverageTone(summary.coverage.utm)}>UTM traffic {summary.coverage.utm ? "observed" : "waiting"}</Badge>
        <Badge tone={summary.campaign.creativeUtmStatus === "exact" ? "green" : summary.campaign.creativeUtmStatus === "missing" || summary.campaign.creativeUtmStatus === "mismatch" ? "rose" : "slate"}>
          Creative UTM {summary.campaign.creativeUtmStatus}
        </Badge>
        <Badge tone={coverageTone(summary.coverage.shopify)}>Shopify {summary.coverage.shopify ? "linked" : "not linked"}</Badge>
        <Badge tone={coverageTone(summary.coverage.shopifyJourneyReady)}>Order journey {summary.coverage.shopifyJourneyReady ? "ready" : "pending"}</Badge>
        <Badge tone={summary.coverage.currencyAligned === null ? "slate" : coverageTone(summary.coverage.currencyAligned)}>
          Currency {summary.coverage.currencyAligned === null ? "waiting" : summary.coverage.currencyAligned ? "aligned" : "mismatch"}
        </Badge>
      </div>
      {summary.campaign.creativeUtmStatus === "missing" || summary.campaign.creativeUtmStatus === "mismatch" ? (
        <p className="mt-2 rounded-lg border border-rose-300/20 bg-rose-300/[0.06] p-2.5 text-xs leading-5 text-rose-100">
          The live creative URL tags do not exactly match this Story UTM. This creative is excluded from exact paid attribution, and first-party visits and Shopify orders will not reconcile until it is published with the exact tags above.
        </p>
      ) : null}

      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Spend" metric={summary.outcomes.spend} />
        <MetricTile label="Shopify net revenue" metric={summary.outcomes.attributedNetRevenue} />
        <MetricTile label="Attributed orders" metric={summary.outcomes.attributedOrders} />
        <MetricTile label="Shopify ROAS" metric={summary.outcomes.shopifyRoas} />
      </div>

      <details open className="group mt-3 rounded-lg border border-fuchsia-300/15 bg-black/15" data-testid="aidma-details">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-xs font-medium text-slate-200">
          <span className="inline-flex items-center gap-2"><Target className="h-3.5 w-3.5 text-fuchsia-100" /> AIDMA paid measurement · Memory proxies</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-180" />
        </summary>
        <div className="min-w-0 border-t border-white/10 p-3">
          <p className="mb-3 text-[11px] leading-5 text-slate-400">
            A decision ladder, not a single-user funnel: Meta delivery, first-party UTM devices, and Shopify order attribution retain their own sources and denominators.
          </p>
          <AidmaMeasurementLadder aidma={summary.aidma} />
        </div>
      </details>

      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.6fr)]">
        <div className="min-w-0">
          {summary.daily.length > 0 ? (
            <PaidAttributionChart
              data={summary.daily}
              metaCurrency={summary.currency}
              shopifyCurrency={summary.shopifyCurrency}
              showShopify={summary.coverage.currencyAligned === true && summary.daily.some((point) => point.shopifyNetRevenue !== null)}
            />
          ) : (
            <div className="grid h-32 place-items-center rounded-lg border border-white/10 bg-black/20 px-4 text-center">
              <div>
                <p className="text-sm font-medium text-slate-200">{emptyStateCopy(summary)[0]}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{emptyStateCopy(summary)[1]}</p>
              </div>
            </div>
          )}
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <MetricTile label="Meta purchase value" metric={summary.outcomes.metaPurchaseValue} />
          <MetricTile label="Meta ROAS" metric={summary.outcomes.metaRoas} />
          <MetricTile label="Ad-spend return" metric={summary.outcomes.adSpendReturn} />
          <MetricTile label="Profit ROI" metric={summary.outcomes.profitRoi} />
        </div>
      </div>

      <details className="group mt-3 rounded-lg border border-white/10 bg-black/15" data-testid="paid-raw-efficiency">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-xs font-medium text-slate-300">
          <span className="inline-flex items-center gap-2"><Target className="h-3.5 w-3.5 text-fuchsia-100" /> Raw delivery &amp; efficiency</span>
          <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
        </summary>
        <div className="grid min-w-0 gap-2 border-t border-white/10 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="Impressions" metric={summary.funnel.impressions} />
          <MetricTile label="Ad-day reach sum" metric={summary.funnel.paidReach} />
          <MetricTile label="Weighted ad-day frequency" metric={summary.funnel.frequency} />
          <MetricTile label="All clicks" metric={summary.funnel.allClicks} />
          <MetricTile label="Link clicks" metric={summary.funnel.linkClicks} />
          <MetricTile label="Outbound clicks" metric={summary.funnel.outboundClicks} />
          <MetricTile label="Meta landing views" metric={summary.funnel.landingPageViews} />
          <MetricTile label="UTM visitors" metric={summary.funnel.utmVisitors} />
          <MetricTile label="All-click CTR" metric={summary.funnel.allCtr} />
          <MetricTile label="Link CTR" metric={summary.funnel.linkCtr} />
          <MetricTile label="Outbound CTR" metric={summary.funnel.outboundCtr} />
          <MetricTile label="Cost / outbound click" metric={summary.funnel.cpc} />
          <MetricTile label="CPM" metric={summary.funnel.cpm} />
          <MetricTile label="Cost / landing view" metric={summary.funnel.costPerLandingPageView} />
          <MetricTile label="Cost / exact UTM visitor" metric={summary.funnel.costPerUtmVisitor} />
          <MetricTile label="Outbound → landing" metric={summary.funnel.outboundToLandingRate} />
          <MetricTile label="Landing → content" metric={summary.funnel.landingToContentRate} />
          <MetricTile label="View content" metric={summary.funnel.viewContent} />
          <MetricTile label="Add to cart" metric={summary.funnel.addToCart} />
          <MetricTile label="Checkout started" metric={summary.funnel.initiateCheckout} />
          <MetricTile label="Content → cart" metric={summary.funnel.contentToCartRate} />
          <MetricTile label="Cart → checkout" metric={summary.funnel.cartToCheckoutRate} />
          <MetricTile label="Checkout → Meta purchase" metric={summary.funnel.checkoutToMetaPurchaseRate} />
          <MetricTile label="Meta LPV → purchase" metric={summary.funnel.metaLandingPurchaseRate} />
          <MetricTile label="UTM capture vs Meta LPV" metric={summary.funnel.utmCaptureRate} />
          <MetricTile label="Period blended order rate" metric={summary.funnel.periodBlendedOrderRate} />
          <MetricTile label="Cost / content view" metric={summary.funnel.costPerViewContent} />
          <MetricTile label="Cost / add to cart" metric={summary.funnel.costPerAddToCart} />
          <MetricTile label="Cost / checkout" metric={summary.funnel.costPerCheckout} />
          <MetricTile label="Meta cost / purchase" metric={summary.funnel.metaCostPerPurchase} />
          <MetricTile label="Cost / Shopify-attributed order" metric={summary.funnel.costPerShopifyOrder} />
          <MetricTile label="Average order value" metric={summary.funnel.averageOrderValue} />
          <MetricTile label="Video 25%" metric={summary.funnel.video25} />
          <MetricTile label="Video 50%" metric={summary.funnel.video50} />
          <MetricTile label="Video 75%" metric={summary.funnel.video75} />
          <MetricTile label="Video 95%" metric={summary.funnel.video95} />
          <MetricTile label="Video complete" metric={summary.funnel.video100} />
          <MetricTile label="25% view rate" metric={summary.funnel.video25Rate} />
          <MetricTile label="25% → 50% retention" metric={summary.funnel.video25To50Retention} />
          <MetricTile label="50% → 75% retention" metric={summary.funnel.video50To75Retention} />
          <MetricTile label="75% → complete retention" metric={summary.funnel.video75To100Retention} />
          <MetricTile label="25% → complete" metric={summary.funnel.videoCompletionRate} />
          <MetricTile label="ThruPlay" metric={summary.funnel.thruPlay} />
          <MetricTile label="ThruPlay / impressions" metric={summary.funnel.thruPlayRate} />
          <MetricTile label="Cost / 25% view" metric={summary.funnel.costPerVideo25} />
          <MetricTile label="Cost / complete view" metric={summary.funnel.costPerVideoComplete} />
          <MetricTile label="Cost / ThruPlay" metric={summary.funnel.costPerThruPlay} />
        </div>
      </details>

      <details className="group mt-2 rounded-lg border border-white/10 bg-black/15" data-testid="paid-budget-pacing">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-xs font-medium text-slate-300">
          <span className="inline-flex items-center gap-2"><BadgeDollarSign className="h-3.5 w-3.5 text-fuchsia-100" /> Budget pacing &amp; spend guardrails</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-180" />
        </summary>
        <div className="border-t border-white/10 p-3">
          {summary.pacing.reason ? <p className="mb-3 text-[11px] leading-5 text-slate-400">{summary.pacing.reason}</p> : null}
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile label="Budget" metric={summary.pacing.budget} />
            <MetricTile label="Budget remaining" metric={summary.pacing.budgetRemaining} />
            <MetricTile label="Budget used" metric={summary.pacing.budgetUsed} />
            <MetricTile label="Schedule elapsed" metric={summary.pacing.scheduleElapsed} />
            <MetricTile label="Expected spend to date" metric={summary.pacing.expectedSpendToDate} />
            <MetricTile label="Pacing index · 1× on pace" metric={summary.pacing.pacingIndex} />
            <MetricTile label="Projected final spend" metric={summary.pacing.projectedFinalSpend} />
            <MetricTile label="Average daily spend" metric={summary.pacing.averageDailySpend} />
            <MetricTile label="Days remaining" metric={summary.pacing.daysRemaining} />
          </div>
        </div>
      </details>

      <details className="group mt-2 rounded-lg border border-white/10 bg-black/15" data-testid="paid-memory-economics">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-xs font-medium text-slate-300">
          <span className="inline-flex items-center gap-2"><ShoppingCart className="h-3.5 w-3.5 text-fuchsia-100" /> Memory proxies &amp; commerce economics</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-180" />
        </summary>
        <div className="border-t border-white/10 p-3">
          <p className="mb-3 text-[11px] leading-5 text-slate-400">First- and last-visit models stay separate. Delayed conversion is a behavioral memory proxy, not a direct measure of recall.</p>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile label="Meta post saves" metric={summary.memory.postSaves} />
            <MetricTile label="Meta post reactions" metric={summary.memory.postReactions} />
            <MetricTile label="Meta comments" metric={summary.memory.comments} />
            <MetricTile label="Meta post engagements" metric={summary.memory.postEngagements} />
            <MetricTile label="Save / impressions" metric={summary.memory.saveRate} />
            <MetricTile label="Post engagement / impressions" metric={summary.memory.postEngagementRate} />
            <MetricTile label="Cost / save" metric={summary.memory.costPerSave} />
            <MetricTile label="1-day return-eligible devices" metric={summary.memory.eligibleReturnDevices1d} />
            <MetricTile label="1-day returning devices" metric={summary.memory.returningDevices1d} />
            <MetricTile label="1-day device return rate" metric={summary.memory.deviceReturnRate1d} />
            <MetricTile label="7-day return-eligible devices" metric={summary.memory.eligibleReturnDevices7d} />
            <MetricTile label="7-day returning devices" metric={summary.memory.returningDevices7d} />
            <MetricTile label="7-day device return rate" metric={summary.memory.deviceReturnRate7d} />
            <MetricTile label="First-touch orders" metric={summary.memory.firstTouchOrders} />
            <MetricTile label="First-touch net payment" metric={summary.memory.firstTouchRevenue} />
            <MetricTile label="First-touch only orders" metric={summary.memory.firstTouchOnlyOrders} />
            <MetricTile label="Same UTM first + last" metric={summary.memory.bothFirstAndLastOrders} />
            <MetricTile label="Delayed first-touch orders" metric={summary.memory.delayedFirstTouchOrders} />
            <MetricTile label="Delayed first-touch share" metric={summary.memory.delayedFirstTouchShare} />
            <MetricTile label="Average days to conversion" metric={summary.memory.averageDaysToConversion} />
            <MetricTile label="New-customer last-touch orders" metric={summary.memory.newCustomerLastTouchOrders} />
            <MetricTile label="Returning-customer orders" metric={summary.memory.returningCustomerLastTouchOrders} />
            <MetricTile label="New-customer share" metric={summary.memory.newCustomerShare} />
            <MetricTile label="Attributed gross sales" metric={summary.economics.attributedGrossSales} />
            <MetricTile label="Attributed discounts" metric={summary.economics.attributedDiscounts} />
            <MetricTile label="Attributed current total" metric={summary.economics.attributedCurrentTotal} />
            <MetricTile label="Attributed refunds" metric={summary.economics.attributedRefunds} />
            <MetricTile label="Discount rate" metric={summary.economics.discountRate} />
            <MetricTile label="Refund / gross sales" metric={summary.economics.refundRate} />
            <MetricTile label="First-touch ROAS" metric={summary.economics.firstTouchRoas} />
            <MetricTile label="New-customer CAC proxy" metric={summary.economics.newCustomerCacProxy} />
            <MetricTile label="Net payment after ad spend" metric={summary.outcomes.netPaymentAfterAdSpend} />
            <MetricTile label="Net payment / UTM visitor" metric={summary.outcomes.revenuePerUtmVisitor} />
            <MetricTile label="Net payment / 1K impressions" metric={summary.outcomes.revenuePerThousandImpressions} />
          </div>
        </div>
      </details>

      <details className="group mt-2 rounded-lg border border-white/10 bg-black/15" data-testid="paid-attribution-reconciliation">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-xs font-medium text-slate-300">
          <span className="inline-flex items-center gap-2"><BadgeDollarSign className="h-3.5 w-3.5 text-fuchsia-100" /> Attribution reconciliation</span>
          <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
        </summary>
        <div className="min-w-0 border-t border-white/10 p-3">
          <div className="grid min-w-0 gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-indigo-300/15 bg-indigo-300/[0.05] p-3">
            <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-indigo-200"><Megaphone className="h-3 w-3" /> Meta reported</p>
            <p className="mt-2 text-sm text-slate-200">{stateText(summary.funnel.metaPurchases)} purchases · {stateText(summary.outcomes.metaPurchaseValue)}</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">Includes Meta&apos;s selected click/view attribution window.</p>
            </div>
            <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.05] p-3">
            <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-cyan-200"><MousePointerClick className="h-3 w-3" /> UTM observed</p>
            <p className="mt-2 text-sm text-slate-200">{summary.observed.utmVisitors} visitors · {summary.observed.utmPageViews} page views</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">Exact campaign/content tuple from the first-party Website Tracker.</p>
            </div>
            <div className="rounded-lg border border-emerald-300/15 bg-emerald-300/[0.05] p-3">
            <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-emerald-200"><ShoppingCart className="h-3 w-3" /> Shopify matched</p>
            <p className="mt-2 text-sm text-slate-200">{stateText(summary.outcomes.attributedOrders)} orders · {stateText(summary.outcomes.attributedNetRevenue)}</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">Exact last-visit UTM; refunds are reflected in net payment.</p>
            </div>
          </div>
          <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile label="Meta − Shopify purchases" metric={summary.reconciliation.metaVsShopifyPurchaseDelta} />
            <MetricTile label="Meta − Shopify value" metric={summary.reconciliation.metaVsShopifyRevenueDelta} />
            <MetricTile label="Meta LPV − UTM devices" metric={summary.reconciliation.landingTrackingGap} />
            <MetricTile label="UTM capture / Meta LPV" metric={summary.reconciliation.landingTrackingRatio} />
          </div>
        </div>
      </details>

      <details className="group mt-2 rounded-lg border border-white/10 bg-black/15" data-testid="paid-creative-diagnostics">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-xs font-medium text-slate-300">
          <span className="inline-flex items-center gap-2"><Megaphone className="h-3.5 w-3.5 text-fuchsia-100" /> Creative &amp; delivery diagnostics</span>
          <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
        </summary>
        <div className="grid min-w-0 gap-2 border-t border-white/10 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Objective", summary.campaign.objective],
            ["Optimization", summary.campaign.optimizationGoal],
            ["Budget", `${summary.campaign.budgetKind ? `${summary.campaign.budgetKind} · ` : ""}${formatMinorUnitBudget(summary.campaign.budgetMinorUnits, summary.currency)}${summary.campaign.budgetSource ? ` · ${summary.campaign.budgetSource.replace("_", " ")}` : ""}`],
            ["Schedule", summary.campaign.startsAt || summary.campaign.endsAt ? `${summary.campaign.startsAt ? formatAppDateTime(summary.campaign.startsAt) : "open"} → ${summary.campaign.endsAt ? formatAppDateTime(summary.campaign.endsAt) : "open"}` : null],
            ["Quality ranking", summary.campaign.qualityRanking],
            ["Engagement ranking", summary.campaign.engagementRateRanking],
            ["Conversion ranking", summary.campaign.conversionRateRanking],
            ["Campaign evidence", summary.campaign.evidenceAt ? formatAppDateTime(summary.campaign.evidenceAt) : null],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] uppercase tracking-[0.1em] text-slate-400">{label}</p>
              <p className="mt-1.5 break-words leading-5 text-slate-200">{value ?? "Not reported"}</p>
            </div>
          ))}
        </div>
      </details>

      <div className="mt-3 grid min-w-0 gap-x-4 gap-y-1 text-[11px] text-slate-400 sm:grid-cols-2 xl:grid-cols-3">
        <span className="min-w-0 break-all">Ad: <span className="text-slate-300">{summary.campaign.adName ?? "Waiting for Ads sync"}</span></span>
        <span className="min-w-0 break-all">Ad set: <span className="text-slate-300">{summary.campaign.adSetName ?? "Waiting for Ads sync"}</span></span>
        <span className="min-w-0 break-all">Delivery status: <span className="text-slate-300">{summary.campaign.deliveryStatus ?? "Not reported"}</span></span>
        <span className="min-w-0 break-all">Attribution: <span className="text-slate-300">{summary.campaign.attributionSetting ?? "Meta account setting"}</span></span>
        <span className="min-w-0 break-all">Last Ads sync: <span className="text-slate-300">{summary.lastSyncedAt ? formatAppDateTime(summary.lastSyncedAt) : "No sync yet"}</span></span>
        <span className="min-w-0 break-all">Last Shopify sync: <span className="text-slate-300">{summary.shopifyLastSyncedAt ? formatAppDateTime(summary.shopifyLastSyncedAt) : "No attribution sync yet"}</span></span>
      </div>
      {summary.error ? (
        <details className="group mt-2 rounded-lg border border-rose-300/15 bg-rose-300/[0.05]">
          <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-xs font-medium text-rose-100">
            Source warning
            <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
          </summary>
          <p className="min-w-0 break-words border-t border-rose-300/10 p-3 text-xs leading-5 text-rose-100/80">{summary.error}</p>
        </details>
      ) : null}
    </section>
  );
}
