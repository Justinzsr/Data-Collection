import { ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getInstagramPaidAdsSummary } from "@/aggregation/services/meta-ads-attribution-service";
import { getPaidAdsOverview, overviewRange, type OverviewMetric } from "@/aggregation/services/platform-overview-service";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { DailyMetricChart } from "@/presentation/charts/daily-metric-chart";
import { LinkButton } from "@/presentation/components/ui/button";
import { Callout, SectionTitle } from "@/presentation/components/ui/panel";
import { currentTime } from "@/presentation/components/ui/relative-time";
import { InstagramPaidAdsPanel } from "@/presentation/dashboard/instagram-paid-ads-panel";
import { PaidAdsActions, PaidAdsFreshnessLine, paidAdsHasData, paidAdsStatus } from "@/presentation/overview/paid-ads-hero";
import { PaidAdsCampaignTable, PaidAdsTodayStrip } from "@/presentation/platforms/ads-detail";
import { MetricTileGrid } from "@/presentation/platforms/metric-tile-grid";
import { PlatformPageHeader } from "@/presentation/platforms/platform-page-header";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import { getDemoNow } from "@/storage/seed/demo-data";

export const dynamic = "force-dynamic";

const RANGES = ["today", "7d", "30d"] as const;
const GRID_METRICS = ["spend", "impressions", "link_clicks", "ctr", "cpc", "cpm", "purchases", "roas"];

export default async function AdsPlatformPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ dataSpaceSlug }, rawQuery] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) notFound();
  const query = rawQuery ?? {};
  const rangeParam = typeof query.range === "string" ? query.range : undefined;
  const rangeKey: DateRangeKey = (RANGES as readonly string[]).includes(rangeParam ?? "") ? rangeParam as DateRangeKey : "30d";
  const fixture = query.demo_state === "ads-live";
  const basePath = dashboardPath(dataSpace.slug);
  const range = overviewRange(rangeKey, getDemoNow());
  const sources = await listSources({ dataSpaceId: dataSpace.id });
  const ads = await getPaidAdsOverview({ dataSpace, range, sources, fixture });
  if (!ads) notFound();

  const instagramSourceId = ads.instagramSourceId;
  const attribution = dataSpace.slug === "moonarq" && instagramSourceId && !fixture
    ? await getInstagramPaidAdsSummary({ dataSpaceId: dataSpace.id, instagramSourceId, rangeKey })
    : null;
  const now = currentTime();
  const status = paidAdsStatus(ads);
  const hasData = paidAdsHasData(ads);
  const metrics = GRID_METRICS
    .map((key) => ads.period.metrics.find((metric) => metric.key === key))
    .filter((metric): metric is OverviewMetric => Boolean(metric));
  const adsPath = `${basePath}/platforms/ads`;
  const rangeHref = (next: DateRangeKey) => {
    const search = new URLSearchParams();
    if (next !== "30d") search.set("range", next);
    if (fixture) search.set("demo_state", "ads-live");
    const value = search.toString();
    return `${adsPath}${value ? `?${value}` : ""}`;
  };
  const accountLine = [
    ads.accountName,
    ads.activeCampaigns > 0 ? `${ads.activeCampaigns} active campaign${ads.activeCampaigns === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(", ");

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5" data-testid="ads-platform">
      <PlatformPageHeader
        overviewHref={basePath}
        iconKey="meta_ads"
        title="Meta Ads"
        subtitle={accountLine || "Instagram and Facebook ad delivery"}
        status={status}
        range={rangeKey}
        rangeHref={rangeHref}
        testId="ads-header"
        actions={(
          <>
            <PaidAdsActions ads={ads} dataSpaceSlug={dataSpace.slug} basePath={basePath} />
            {ads.source && ads.source.metadata.fixture !== true ? (
              <LinkButton href={`${basePath}/sources/${ads.source.id}`} variant="secondary" className="min-h-11 sm:min-h-10">
                Source settings
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </LinkButton>
            ) : null}
          </>
        )}
      />

      {ads.stateMessage && ads.state !== "live" ? (
        <Callout tone={status.tone === "rose" ? "danger" : status.tone === "amber" ? "warning" : "info"} title={status.label} role="status">
          {ads.stateMessage}
        </Callout>
      ) : null}

      {hasData ? (
        <>
          <PaidAdsTodayStrip
            ads={ads}
            footer={(
              <PaidAdsFreshnessLine
                ads={ads}
                dataSpaceSlug={dataSpace.slug}
                now={now}
                className="mt-3 text-xs leading-5 text-[var(--muted)]"
                testId="ads-freshness"
                showStateMessage={false}
              />
            )}
          />
          <section className="grid min-w-0 gap-3" aria-labelledby="ads-period-title">
            <SectionTitle
              title={range.label}
              id="ads-period-title"
              action={<span className="text-xs text-[var(--muted)]">{range.comparison ? `Change ${range.comparison.basis}, complete days` : "Today is still in progress"}</span>}
            />
            <MetricTileGrid metrics={metrics} testId="ads-period-metrics" />
          </section>
          <section className="grid min-w-0 gap-4 xl:grid-cols-2" aria-label="Daily delivery">
            <DailyMetricChart
              title="Daily spend"
              description={range.sparkline.label}
              data={ads.daily.map((point) => ({ date: point.date, value: point.spend }))}
              unit={ads.currency}
              color={platformSeriesColor("meta_ads")}
              testId="ads-daily-spend"
            />
            <DailyMetricChart
              title="Daily link clicks"
              description={range.sparkline.label}
              data={ads.daily.map((point) => ({ date: point.date, value: point.linkClicks }))}
              unit="count"
              color={platformSeriesColor("meta_ads")}
              testId="ads-daily-clicks"
            />
          </section>
          <PaidAdsCampaignTable ads={ads} periodLabel={range.label} />
        </>
      ) : null}

      {attribution && instagramSourceId ? (
        <section className="grid min-w-0 gap-3" aria-labelledby="ads-attribution-title">
          <SectionTitle title="Tracked campaign attribution" id="ads-attribution-title" />
          <div className="glass min-w-0 rounded-3xl p-3 sm:p-4">
            <InstagramPaidAdsPanel
              summary={attribution}
              instagramSourceId={instagramSourceId}
              dataSpaceSlug={dataSpace.slug}
              returnPath={`${basePath}/sources/${instagramSourceId}`}
            />
          </div>
        </section>
      ) : null}

      <p className="px-1 text-xs leading-5 text-[var(--muted)]">
        CTR is link clicks divided by impressions. CPC is spend per link click and CPM is spend per thousand impressions. ROAS is the purchase value Meta attributes to these ads divided by spend.
      </p>
    </div>
  );
}
