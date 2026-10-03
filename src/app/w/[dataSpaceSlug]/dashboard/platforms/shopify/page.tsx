import { ArrowRight, ShoppingBag } from "lucide-react";
import { notFound } from "next/navigation";
import { getPlatformDetail } from "@/aggregation/services/platform-overview-service";
import { getPlatformModules, type PlatformModule } from "@/aggregation/services/platform-modules-service";
import { isRuntimeDatabaseConfigured } from "@/storage/db/client";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { DailyMetricChart } from "@/presentation/charts/daily-metric-chart";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { formatMetricValue } from "@/presentation/components/ui/format";
import { GlassPanel, SectionTitle } from "@/presentation/components/ui/panel";
import { currentTime } from "@/presentation/components/ui/relative-time";
import { CommerceOutcomes } from "@/presentation/dashboard/commerce-outcomes";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { platformHealth } from "@/presentation/overview/platform-health";
import { PlatformPageHeader } from "@/presentation/platforms/platform-page-header";
import { parseDetailRange } from "@/presentation/platforms/social-platform-page";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

/** Deterministic Shopify states for local browser tests; never used with a configured database. */
function localShopifyFixture(demoState: "shopify-awaiting" | "shopify-zero"): PlatformModule {
  const synced = demoState === "shopify-zero";
  return {
    sourceId: "local-shopify-fixture",
    sourceTypeKey: "shopify",
    displayName: "Shopify local fixture",
    platformLabel: "Shopify",
    status: synced ? "healthy" : "warning",
    syncMode: "webhook",
    sourceModeLabel: "Shopify authoritative commerce",
    rangeLabel: "Last 30 days",
    primaryMetric: { key: "orders", label: "Orders", value: 0, unit: "count", deltaPercent: null, deltaLabel: "—" },
    secondaryMetrics: [
      { key: "net_payment", label: "Net payment", value: 0, unit: "usd" },
      { key: "gross_sales", label: "Gross sales", value: 0, unit: "usd" },
      { key: "refunds", label: "Refunds", value: 0, unit: "usd" },
    ],
    sparkline: [],
    insights: [],
    lastSyncAt: synced ? "2026-07-29T18:00:00.000Z" : null,
    lastSuccessfulSyncAt: synced ? "2026-07-29T18:00:00.000Z" : null,
    nextSyncAt: null,
    lastError: null,
    setupState: {
      label: synced ? "Healthy" : "Awaiting first sync",
      severity: synced ? "ok" : "warning",
      message: synced
        ? "Deterministic local Shopify fixture is synced."
        : "Deterministic local Shopify fixture is awaiting its first successful sync.",
    },
    actions: { canRunSync: true, canConfigure: true, canViewDetails: true },
  };
}

export default async function ShopifyPlatformPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ dataSpaceSlug }, query] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const basePath = dashboardPath(dataSpace.slug);
  const rangeKey = parseDetailRange(query?.range);
  const [modules, detail] = await Promise.all([
    getPlatformModules(rangeKey, { dataSpaceId: dataSpace.id, dataSpaceName: dataSpace.display_name }),
    getPlatformDetail({ dataSpace, rangeKey, key: "shopify" }),
  ]);
  const demoState = query?.demo_state;
  const fixtureState = process.env.MOONARQ_OVERVIEW_E2E_FIXTURES === "true"
    && !isRuntimeDatabaseConfigured()
    && (demoState === "shopify-awaiting" || demoState === "shopify-zero")
    ? demoState
    : null;
  const shopifyModule = fixtureState
    ? localShopifyFixture(fixtureState)
    : modules.find((item) => item.sourceTypeKey === "shopify") ?? null;
  const { card, range } = detail;
  const health = platformHealth(card.source, currentTime());
  const ready = !fixtureState && card.unavailableReason === null;
  const path = `${basePath}/platforms/shopify`;
  const currency = card.primary.unit;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5" data-testid="shopify-platform">
      <PlatformPageHeader
        overviewHref={basePath}
        iconKey="shopify"
        title="Shopify"
        subtitle={card.account ?? "Orders and revenue from the official Shopify Admin API"}
        status={{ tone: health.tone, label: health.label }}
        range={rangeKey}
        rangeHref={(next) => (next === "30d" ? path : `${path}?range=${next}`)}
        testId="shopify-header"
        actions={card.source ? (
          <>
            <SyncActionButton sourceId={card.source.id} dataSpaceSlug={dataSpace.slug} compact label="Sync now" className="min-h-11 sm:min-h-10" />
            <LinkButton href={`${basePath}/sources/${card.source.id}`} variant="secondary" className="min-h-11 sm:min-h-10">
              Source settings
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </LinkButton>
          </>
        ) : (
          <LinkButton href={`${basePath}/sources/new?template=shopify`} variant="primary" className="min-h-11 sm:min-h-10">
            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
            Connect Shopify
          </LinkButton>
        )}
      />

      <CommerceOutcomes shopify={shopifyModule} />

      {ready ? (
        <>
          <section className="grid min-w-0 gap-4 xl:grid-cols-2" aria-label="Daily commerce">
            <DailyMetricChart
              title="Daily net payment"
              description={range.sparkline.label}
              data={detail.series}
              unit={currency}
              color={platformSeriesColor("shopify")}
              testId="shopify-daily-net-payment"
            />
            <DailyMetricChart
              title="Daily orders"
              description={range.sparkline.label}
              data={detail.ordersSeries}
              unit="count"
              color={platformSeriesColor("shopify")}
              testId="shopify-daily-orders"
            />
          </section>
          <section className="grid min-w-0 gap-3" aria-labelledby="shopify-products-title">
            <SectionTitle title="Top products" id="shopify-products-title" action={<span className="text-xs text-[var(--muted)]">Units ordered, {range.label.toLowerCase()}</span>} />
            <GlassPanel className="min-w-0 p-3 sm:p-4">
              {detail.topProducts.length > 0 ? (
                <ol className="grid min-w-0 gap-1">
                  {detail.topProducts.map((product) => (
                    <li key={product.name} className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-xl px-2 py-1.5">
                      <span className="min-w-0 truncate text-sm text-label" title={product.name}>{product.name}</span>
                      <span className="tabular shrink-0 text-sm font-semibold text-label">{formatMetricValue(product.units, "count")}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="p-1 text-sm text-label-secondary" role="status">No products were ordered in this period.</p>
              )}
            </GlassPanel>
          </section>
        </>
      ) : null}

      <GlassPanel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="green">Read-only</Badge>
          <Badge tone="cyan">Encrypted on the server</Badge>
          <Badge tone="slate">60-day rolling window</Badge>
        </div>
        <p className="mt-3 text-sm leading-6 text-label-secondary">
          MoonArq requests order totals and line-item names and quantities only. It does not request customer names,
          email addresses, phone numbers, addresses, IP data, notes, or payment details. Test orders are excluded, and
          every sync recomputes store-local daily totals so retries do not double count.
        </p>
      </GlassPanel>
    </div>
  );
}
