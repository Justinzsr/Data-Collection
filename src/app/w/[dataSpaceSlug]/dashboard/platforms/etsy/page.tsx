import { ArrowRight, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { getEtsyDetail, shortDateLabel } from "@/aggregation/services/platform-overview-service";
import { etsyOAuthStartPath } from "@/collection/connectors/etsy/paths";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { DailyMetricChart } from "@/presentation/charts/daily-metric-chart";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { Callout, GlassPanel, SectionTitle } from "@/presentation/components/ui/panel";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { currentTime } from "@/presentation/components/ui/relative-time";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { platformHealth } from "@/presentation/overview/platform-health";
import { MetricTileGrid } from "@/presentation/platforms/metric-tile-grid";
import { PlatformPageHeader } from "@/presentation/platforms/platform-page-header";
import { parseDetailRange } from "@/presentation/platforms/social-platform-page";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

export default async function EtsyPlatformPage({
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
  const detail = await getEtsyDetail({ dataSpace, rangeKey });
  const { card, range, source } = detail;
  const health = platformHealth(source, currentTime());
  const path = `${basePath}/platforms/etsy`;
  const connected = source?.metadata.oauth_connected === true;
  const ready = card.unavailableReason === null;
  const sourceHref = source ? `${basePath}/sources/${source.id}` : null;
  const needsReconnect = connected && health.label === "Reconnect needed";

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5" data-testid="etsy-platform">
      <PlatformPageHeader
        overviewHref={basePath}
        iconKey="etsy"
        title="Etsy"
        subtitle={card.account ? `Orders and sales for ${card.account}, from the Etsy Open API` : "Orders and sales from the Etsy Open API"}
        status={{ tone: health.tone, label: health.label }}
        range={rangeKey}
        rangeHref={(next) => (next === "30d" ? path : `${path}?range=${next}`)}
        testId="etsy-header"
        actions={!source ? (
          <LinkButton href={`${basePath}/sources/new?template=etsy`} variant="primary" className="min-h-11 sm:min-h-10">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Etsy
          </LinkButton>
        ) : connected ? (
          <>
            {needsReconnect ? (
              <LinkButton
                href={etsyOAuthStartPath({ sourceId: source.id, dataSpaceSlug: dataSpace.slug, returnPath: sourceHref! })}
                variant="primary"
                className="min-h-11 sm:min-h-10"
              >
                Reconnect Etsy
              </LinkButton>
            ) : (
              <SyncActionButton sourceId={source.id} dataSpaceSlug={dataSpace.slug} compact label="Sync now" className="min-h-11 sm:min-h-10" />
            )}
            <LinkButton href={sourceHref!} variant="secondary" className="min-h-11 sm:min-h-10">
              Source settings
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </LinkButton>
          </>
        ) : (
          <LinkButton href={sourceHref!} variant="primary" className="min-h-11 sm:min-h-10">
            Finish connecting
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </LinkButton>
        )}
      />

      {!source ? (
        <GlassPanel className="grid min-w-0 gap-4 p-5 sm:p-7" data-testid="etsy-setup">
          <div className="flex min-w-0 items-start gap-4">
            <PlatformIcon sourceTypeKey="etsy" size="lg" />
            <div className="min-w-0 max-w-2xl">
              <h2 className="text-[20px] font-semibold tracking-[-0.022em] text-label">Bring in your Etsy sales</h2>
              <p className="mt-2 text-sm leading-6 text-label-secondary">
                Add your Etsy shop, then connect it with an app from Etsy&apos;s developer portal. Every hour the dashboard reads your
                orders, sales, refunds, and active listings, read-only. Your Etsy password is never asked for.
              </p>
            </div>
          </div>
          <LinkButton href={`${basePath}/sources/new?template=etsy`} variant="primary" className="w-full sm:w-fit">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Etsy
          </LinkButton>
        </GlassPanel>
      ) : null}

      {needsReconnect ? (
        <Callout tone="danger" title="Etsy stopped accepting this connection" role="status">
          {source?.last_error} The numbers below stop at the last successful sync until you reconnect.
        </Callout>
      ) : null}

      {source && !ready ? (
        <Callout tone={connected ? "info" : "warning"} title={connected ? "Waiting for the first sync" : "Finish connecting Etsy"} role="status">
          {connected
            ? "The first sync reads the past year of orders. It runs within the hour, or choose Sync now."
            : "Add your Etsy app's callback URL and keys on the source page, then approve read-only access on Etsy."}
        </Callout>
      ) : null}

      {ready ? (
        <>
          <section className="grid min-w-0 gap-3" aria-labelledby="etsy-period-title">
            <SectionTitle
              title={range.label}
              id="etsy-period-title"
              action={(
                <span className="text-xs text-[var(--muted)]">
                  {range.startDate === range.endDate ? shortDateLabel(range.endDate) : `${shortDateLabel(range.startDate)} – ${shortDateLabel(range.endDate)}`}
                </span>
              )}
            />
            <MetricTileGrid metrics={detail.metrics} className="lg:grid-cols-3" testId="etsy-metrics" />
          </section>
          <section className="grid min-w-0 gap-4 xl:grid-cols-2" aria-label="Daily sales and orders">
            <DailyMetricChart
              title="Daily sales"
              description={range.sparkline.label}
              data={detail.dailySales}
              unit={detail.currency}
              color={platformSeriesColor("etsy")}
              testId="etsy-daily-sales"
            />
            <DailyMetricChart
              title="Daily orders"
              description={range.sparkline.label}
              data={detail.dailyOrders}
              unit="count"
              color={platformSeriesColor("etsy")}
              testId="etsy-daily-orders"
            />
          </section>
        </>
      ) : null}

      {source ? (
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">Read-only</Badge>
            <Badge tone="cyan">Encrypted on the server</Badge>
            <Badge tone="slate">Hourly sync</Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-label-secondary">
            The dashboard keeps order dates, statuses, totals, quantities, and refunds. Buyer names, addresses, emails, messages,
            gift notes, and listing titles are never stored. Each sync recomputes the past five weeks, so recent changes show up and
            retries never double count.
          </p>
        </GlassPanel>
      ) : null}

      <p className="px-1 text-xs leading-5 text-[var(--muted)]">
        Orders, sales, and units count on the day the order was placed, in Pacific Time, for every order where money changed hands. Sales
        are item prices after your shop&apos;s discounts, before shipping and tax, and before refunds: a refund, a cancellation&apos;s included,
        counts under Refunds on the day Etsy issued it, and the order keeps its sale. Active listings is your shop&apos;s count at the latest sync.
      </p>
    </div>
  );
}
