import { ArrowRight, Megaphone } from "lucide-react";
import type { OverviewMetric, OverviewRange, PaidAdsOverview } from "@/aggregation/services/platform-overview-service";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { SparklineChart } from "@/presentation/charts/sparkline-chart";
import { Badge, type BadgeTone } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { formatMetricValue } from "@/presentation/components/ui/format";
import { PlatformIcon } from "@/presentation/components/ui/platform-icon";
import { formatRelativeTime } from "@/presentation/components/ui/relative-time";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { AdsAutoSync } from "@/presentation/overview/ads-auto-sync";
import { MetricDelta } from "@/presentation/overview/metric-delta";
import { formatAppTime } from "@/storage/runtime/app-time";

const HERO_METRICS = ["spend", "link_clicks", "ctr", "cpc"] as const;

/** Oldest paid delivery, in minutes, a page shows while it is open before syncing again. */
export const PAID_ADS_LIVE_SYNC_MINUTES = 15;

/**
 * Live and overdue connections sync themselves while the monitor is open. Setup
 * and error states wait for the person, so a broken connection is never retried
 * in a loop.
 */
function paidAdsSyncsWhileOpen(ads: PaidAdsOverview) {
  return ads.state === "live" || ads.state === "stale";
}

/** Whether this page should start live syncs: never for fixtures or demo data, which have nothing to call. */
export function paidAdsAutoSyncEnabled(ads: PaidAdsOverview) {
  const source = ads.source;
  if (!source || source.metadata.fixture === true || source.status === "demo") return false;
  return paidAdsSyncsWhileOpen(ads);
}

export function paidAdsStatus(ads: PaidAdsOverview): { tone: BadgeTone; label: string } {
  if (ads.state === "live") {
    if (ads.today.delivering === null) return { tone: "slate", label: "Awaiting today's data" };
    return ads.today.delivering ? { tone: "green", label: "Delivering" } : { tone: "slate", label: "No delivery today" };
  }
  if (ads.state === "stale") return { tone: "amber", label: "Sync overdue" };
  if (ads.state === "error") return { tone: "rose", label: "Sync error" };
  if (ads.state === "needs_reconnect") return { tone: "rose", label: "Reconnect needed" };
  if (ads.state === "needs_account") return { tone: "amber", label: "Choose ad account" };
  if (ads.state === "first_sync") return { tone: "cyan", label: "Waiting for first sync" };
  return { tone: "slate", label: "Not connected" };
}

export function metaAdsConnectHref(ads: PaidAdsOverview, dataSpaceSlug: string) {
  if (!ads.instagramSourceId) return null;
  const returnPath = `/w/${dataSpaceSlug}/dashboard/sources/${ads.instagramSourceId}`;
  return `/api/oauth/meta-ads/start?instagramSourceId=${encodeURIComponent(ads.instagramSourceId)}&dataSpaceSlug=${encodeURIComponent(dataSpaceSlug)}&returnPath=${encodeURIComponent(returnPath)}`;
}

/**
 * Whether there is delivery data worth drawing. Setup states, and a sync error
 * before anything was ever synced, show a single prompt instead.
 */
export function paidAdsHasData(ads: PaidAdsOverview) {
  if (ads.state === "live" || ads.state === "stale") return true;
  if (ads.state === "error" && ads.updatedAt) return true;
  return ads.daily.some((point) => point.impressions > 0 || point.spend > 0);
}

export function PaidAdsActions({
  ads,
  dataSpaceSlug,
  basePath,
  detailsHref,
}: {
  ads: PaidAdsOverview;
  dataSpaceSlug: string;
  basePath: string;
  /** Link to the Ads page, keeping the selected range; omitted on the Ads page itself. */
  detailsHref?: string;
}) {
  const connectHref = metaAdsConnectHref(ads, dataSpaceSlug);
  const isFixture = ads.source?.metadata.fixture === true;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {(ads.state === "not_connected" || ads.state === "needs_reconnect") && connectHref ? (
        <LinkButton href={connectHref} variant="primary" className="min-h-11 sm:min-h-10">
          <Megaphone className="h-4 w-4" aria-hidden="true" />
          {ads.state === "needs_reconnect" ? "Reconnect Meta Ads" : "Connect Meta Ads"}
        </LinkButton>
      ) : null}
      {ads.state === "needs_account" && ads.source ? (
        <LinkButton href={`${basePath}/sources/${ads.source.id}`} variant="primary" className="min-h-11 sm:min-h-10">
          Choose ad account
        </LinkButton>
      ) : null}
      {ads.source && !isFixture && (ads.state === "live" || ads.state === "stale" || ads.state === "error" || ads.state === "first_sync") ? (
        <SyncActionButton sourceId={ads.source.id} dataSpaceSlug={dataSpaceSlug} compact label="Refresh now" className="min-h-11 sm:min-h-10" />
      ) : null}
      {detailsHref ? (
        <LinkButton href={detailsHref} variant="secondary" className="min-h-11 sm:min-h-10">
          Ads details
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </LinkButton>
      ) : null}
    </div>
  );
}

export function paidAdsFreshness(ads: PaidAdsOverview, now: number) {
  if (!ads.updatedAt) return null;
  const updated = `Updated ${formatRelativeTime(ads.updatedAt, { now })}`;
  if (paidAdsSyncsWhileOpen(ads)) {
    return `${updated}. Syncs with Meta every ${PAID_ADS_LIVE_SYNC_MINUTES} minutes while this page is open.`;
  }
  const parts = [updated];
  if (ads.nextSyncAt && Date.parse(ads.nextSyncAt) > now) parts.push(`next automatic sync at ${formatAppTime(ads.nextSyncAt)}`);
  return `${parts.join(", ")}.`;
}

/** The freshness sentence, followed by the live-sync status while that runs. */
export function PaidAdsFreshnessLine({
  ads,
  dataSpaceSlug,
  now,
  className,
  testId,
  showStateMessage,
}: {
  ads: PaidAdsOverview;
  dataSpaceSlug: string;
  now: number;
  className: string;
  testId?: string;
  /** Leads with the state message; off where a callout already shows it. */
  showStateMessage: boolean;
}) {
  const freshness = paidAdsFreshness(ads, now);
  const prefix = showStateMessage && ads.stateMessage && ads.state !== "live" ? `${ads.stateMessage} ` : "";
  if (!freshness && !prefix) return null;
  return (
    <p className={className} data-testid={testId}>
      {prefix}
      {freshness}
      {ads.source && paidAdsAutoSyncEnabled(ads) ? (
        <AdsAutoSync
          sourceId={ads.source.id}
          dataSpaceSlug={dataSpaceSlug}
          lastSyncedAt={ads.updatedAt}
          maxAgeMinutes={PAID_ADS_LIVE_SYNC_MINUTES}
        />
      ) : null}
    </p>
  );
}

function HeroMetric({ metric }: { metric: OverviewMetric }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-[var(--muted)]">{metric.label}</dt>
      <dd className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="tabular text-[20px] font-semibold leading-7 tracking-[-0.025em] text-label">
          {formatMetricValue(metric.value, metric.unit)}
        </span>
        <MetricDelta delta={metric.delta} higherIsBetter={metric.higherIsBetter} size="sm" />
      </dd>
    </div>
  );
}

function TodayPanel({ ads }: { ads: PaidAdsOverview }) {
  const { today, yesterday, currency } = ads;
  const stats = [
    { label: "Impressions", value: formatMetricValue(today.totals?.impressions ?? null, "count", { compact: true }) },
    { label: "Link clicks", value: formatMetricValue(today.totals?.linkClicks ?? null, "count", { compact: true }) },
    { label: "CTR", value: formatMetricValue(today.rates?.ctr ?? null, "percent") },
  ];
  return (
    <div className="inset-surface flex min-w-0 flex-col rounded-[20px] p-4" data-testid="paid-ads-today">
      <p className="text-[13px] font-medium text-label-secondary">Spend today</p>
      <p className="tabular mt-1 text-[40px] font-semibold leading-[44px] tracking-[-0.04em] text-label">
        {formatMetricValue(today.totals?.spend ?? null, currency)}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {yesterday.totals
          ? `Yesterday ${formatMetricValue(yesterday.totals.spend, currency)} for the full day`
          : "Today's numbers appear after the first sync of the day"}
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-separator pt-3">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="truncate text-xs text-[var(--muted)]">{stat.label}</dt>
            <dd className="tabular mt-0.5 truncate text-[15px] font-semibold text-label">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PeriodPanel({ ads, range }: { ads: PaidAdsOverview; range: OverviewRange }) {
  const metrics = HERO_METRICS
    .map((key) => ads.period.metrics.find((metric) => metric.key === key))
    .filter((metric): metric is OverviewMetric => Boolean(metric));
  const { totals: yesterdayTotals, rates: yesterdayRates } = ads.yesterday;
  const yesterdayMetrics: OverviewMetric[] = [
    { key: "spend", label: "Spend", value: yesterdayTotals?.spend ?? null, unit: ads.currency, delta: { kind: "none", reason: "unavailable" }, higherIsBetter: null },
    { key: "link_clicks", label: "Link clicks", value: yesterdayTotals?.linkClicks ?? null, unit: "count", delta: { kind: "none", reason: "unavailable" }, higherIsBetter: true },
    { key: "ctr", label: "CTR (link)", value: yesterdayRates?.ctr ?? null, unit: "percent", delta: { kind: "none", reason: "unavailable" }, higherIsBetter: true },
    { key: "cpc", label: "CPC (link)", value: yesterdayRates?.cpc ?? null, unit: ads.currency, delta: { kind: "none", reason: "unavailable" }, higherIsBetter: false },
  ];
  const isToday = range.comparison === null;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="paid-ads-period">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] font-semibold text-label">{isToday ? "Yesterday" : range.label}</p>
        <p className="text-xs text-[var(--muted)]">
          {isToday ? "Full day, for comparison" : `Change ${range.comparison?.basis}, complete days`}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {(isToday ? yesterdayMetrics : metrics).map((metric) => <HeroMetric key={metric.key} metric={metric} />)}
      </dl>
      <div className="mt-auto hidden sm:block">
        <SparklineChart
          data={ads.daily.map((point) => ({ date: point.date, value: point.spend }))}
          color={platformSeriesColor("meta_ads")}
          label={`Daily ad spend, ${range.sparkline.label.toLowerCase()}`}
        />
        <p className="mt-1.5 text-xs text-[var(--muted)]">Daily spend, {range.sparkline.label.toLowerCase()}</p>
      </div>
    </div>
  );
}

/**
 * The paid-ads monitor at the top of the Overview: today's delivery so far, the
 * selected period with direction of change, freshness, and an on-demand refresh.
 */
export function PaidAdsHero({
  ads,
  range,
  dataSpaceSlug,
  basePath,
  detailsHref,
  now,
}: {
  ads: PaidAdsOverview;
  range: OverviewRange;
  dataSpaceSlug: string;
  basePath: string;
  detailsHref: string;
  now: number;
}) {
  const status = paidAdsStatus(ads);
  const hasData = paidAdsHasData(ads);
  const accountLine = [
    ads.accountName,
    ads.activeCampaigns > 0 ? `${ads.activeCampaigns} active campaign${ads.activeCampaigns === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(", ");

  return (
    <section
      className="glass min-w-0 rounded-[28px] p-4 sm:p-6"
      aria-labelledby="paid-ads-title"
      data-testid="paid-ads-overview"
      data-ads-state={ads.state}
    >
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <PlatformIcon sourceTypeKey="meta_ads" size="lg" />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id="paid-ads-title" className="text-[20px] font-semibold tracking-[-0.022em] text-label">Meta Ads</h2>
              <Badge tone={status.tone} dot>{status.label}</Badge>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-label-secondary">
              {accountLine || "Instagram and Facebook ad delivery"}
            </p>
          </div>
        </div>
        <PaidAdsActions ads={ads} dataSpaceSlug={dataSpaceSlug} basePath={basePath} detailsHref={detailsHref} />
      </div>

      {hasData ? (
        <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,2fr)]">
          <TodayPanel ads={ads} />
          <PeriodPanel ads={ads} range={range} />
        </div>
      ) : (
        <p className="inset-surface mt-5 rounded-[20px] p-4 text-[14px] leading-6 text-label-secondary" role="status">
          {ads.stateMessage}
        </p>
      )}

      {hasData ? (
        <PaidAdsFreshnessLine
          ads={ads}
          dataSpaceSlug={dataSpaceSlug}
          now={now}
          className="mt-4 text-xs leading-5 text-[var(--muted)]"
          testId="paid-ads-freshness"
          showStateMessage
        />
      ) : null}
    </section>
  );
}
