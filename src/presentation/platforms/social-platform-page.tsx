import { ArrowRight, Megaphone } from "lucide-react";
import type { ReactNode } from "react";
import type { OverviewMetric, PlatformDetail } from "@/aggregation/services/platform-overview-service";
import type { DateRangeKey } from "@/aggregation/services/summary-service";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { DailyMetricChart } from "@/presentation/charts/daily-metric-chart";
import { LinkButton } from "@/presentation/components/ui/button";
import { Callout, GlassPanel } from "@/presentation/components/ui/panel";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { platformHealth } from "@/presentation/overview/platform-health";
import { MetricTileGrid } from "@/presentation/platforms/metric-tile-grid";
import { PlatformPageHeader } from "@/presentation/platforms/platform-page-header";
import { formatAppDateTime } from "@/storage/runtime/app-time";

export function plainMetric(key: string, label: string, value: number | null, unit = "count"): OverviewMetric {
  return { key, label, value, unit, delta: { kind: "none", reason: "unavailable" }, higherIsBetter: true };
}

export function parseDetailRange(value: string | string[] | undefined): DateRangeKey {
  return value === "today" || value === "7d" || value === "30d" ? value : "30d";
}

/**
 * Shared layout for Instagram and TikTok detail pages: header with actions, key
 * numbers with direction of change, the audience trend, content, and account facts.
 */
export function SocialPlatformPage({
  detail,
  title,
  iconKey,
  basePath,
  dataSpaceSlug,
  path,
  extraMetrics,
  metricsNote,
  content,
  facts,
  showAdsLink,
  now,
}: {
  detail: PlatformDetail;
  title: string;
  iconKey: "instagram" | "tiktok";
  basePath: string;
  dataSpaceSlug: string;
  path: string;
  extraMetrics: OverviewMetric[];
  metricsNote: string;
  content: ReactNode;
  facts: Array<{ label: string; value: string }>;
  showAdsLink: boolean;
  now: number;
}) {
  const { card, range } = detail;
  const health = platformHealth(card.source, now);
  const chartTitle = card.sparkline.label.split(",")[0] ?? "Followers";
  const rangeHref = (next: DateRangeKey) => (next === "30d" ? path : `${path}?range=${next}`);

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5" data-testid={`${iconKey}-platform`}>
      <PlatformPageHeader
        overviewHref={basePath}
        iconKey={iconKey}
        title={title}
        subtitle={card.account ?? undefined}
        status={{ tone: health.tone, label: health.label }}
        range={range.key}
        rangeHref={rangeHref}
        testId={`${iconKey}-header`}
        actions={card.source ? (
          <>
            <SyncActionButton sourceId={card.source.id} dataSpaceSlug={dataSpaceSlug} compact label="Sync now" className="min-h-11 sm:min-h-10" />
            {showAdsLink ? (
              <LinkButton href={`${basePath}/platforms/ads`} variant="secondary" className="min-h-11 sm:min-h-10">
                <Megaphone className="h-4 w-4" aria-hidden="true" />
                Ads
              </LinkButton>
            ) : null}
            <LinkButton href={`${basePath}/sources/${card.source.id}`} variant="secondary" className="min-h-11 sm:min-h-10">
              Source settings
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </LinkButton>
          </>
        ) : (
          <LinkButton href={`${basePath}/sources/new?template=${iconKey}`} variant="primary" className="min-h-11 sm:min-h-10">
            Connect {title}
          </LinkButton>
        )}
      />

      {card.unavailableReason ? <Callout tone="info" role="status">{card.unavailableReason}</Callout> : null}

      <section className="grid min-w-0 gap-2" aria-label={`${title} key numbers`}>
        <MetricTileGrid metrics={[card.primary, ...card.secondary, ...extraMetrics]} testId={`${iconKey}-metrics`} />
        <p className="px-1 text-xs leading-5 text-[var(--muted)]">{metricsNote}</p>
      </section>

      <DailyMetricChart
        title={chartTitle}
        description={`${range.sparkline.label}. The last synced value carries forward on days without a sync.`}
        data={detail.series}
        unit="count"
        color={platformSeriesColor(iconKey)}
        kind="line"
        testId={`${iconKey}-trend`}
      />

      {content}

      {facts.length > 0 ? (
        <GlassPanel className="min-w-0 p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-label">Account</h2>
          <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-xs text-[var(--muted)]">{fact.label}</dt>
                <dd className="mt-0.5 break-words text-[13px] text-label">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </GlassPanel>
      ) : null}
    </div>
  );
}

export function formatFactTime(value: string | null, fallback: string) {
  return value ? formatAppDateTime(value) : fallback;
}
