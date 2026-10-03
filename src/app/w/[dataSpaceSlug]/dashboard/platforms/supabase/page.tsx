import { ArrowRight, MailPlus } from "lucide-react";
import { notFound } from "next/navigation";
import { getPlatformDetail } from "@/aggregation/services/platform-overview-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { DailyMetricChart } from "@/presentation/charts/daily-metric-chart";
import { LinkButton } from "@/presentation/components/ui/button";
import { formatMetricValue, formatPercent } from "@/presentation/components/ui/format";
import { Callout, GlassPanel, SectionTitle } from "@/presentation/components/ui/panel";
import { currentTime } from "@/presentation/components/ui/relative-time";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { platformHealth } from "@/presentation/overview/platform-health";
import { MetricTileGrid } from "@/presentation/platforms/metric-tile-grid";
import { PlatformPageHeader } from "@/presentation/platforms/platform-page-header";
import { parseDetailRange } from "@/presentation/platforms/social-platform-page";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

export default async function SupabasePlatformPage({
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
  const detail = await getPlatformDetail({ dataSpace, rangeKey, key: "supabase" });
  const { card, range } = detail;
  const health = platformHealth(card.source, currentTime());
  const path = `${basePath}/platforms/supabase`;
  const providerTotal = detail.providers.reduce((total, item) => total + item.signups, 0);

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5" data-testid="supabase-platform">
      <PlatformPageHeader
        overviewHref={basePath}
        iconKey="supabase"
        title="Supabase"
        subtitle={card.account ? `Signups and users in project ${card.account}` : "Signups and users"}
        status={{ tone: health.tone, label: health.label }}
        range={rangeKey}
        rangeHref={(next) => (next === "30d" ? path : `${path}?range=${next}`)}
        testId="supabase-header"
        actions={(
          <>
            {card.source ? <SyncActionButton sourceId={card.source.id} dataSpaceSlug={dataSpace.slug} compact label="Sync now" className="min-h-11 sm:min-h-10" /> : null}
            {dataSpace.slug === "moonarq" ? (
              <LinkButton href={`${basePath}/supabase/email-marketing`} variant="secondary" className="min-h-11 sm:min-h-10">
                <MailPlus className="h-4 w-4" aria-hidden="true" />
                Email Marketing
              </LinkButton>
            ) : null}
            <LinkButton
              href={card.source ? `${basePath}/sources/${card.source.id}` : `${basePath}/sources/new`}
              variant={card.source ? "secondary" : "primary"}
              className="min-h-11 sm:min-h-10"
            >
              {card.source ? "Source settings" : "Connect Supabase"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </LinkButton>
          </>
        )}
      />

      {card.unavailableReason ? <Callout tone="info" role="status">{card.unavailableReason}</Callout> : null}

      <MetricTileGrid metrics={[card.primary, ...card.secondary]} className="lg:grid-cols-3" testId="supabase-metrics" />

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" aria-label="Signups">
        <DailyMetricChart
          title="Daily signups"
          description={range.sparkline.label}
          data={detail.series}
          unit="count"
          color={platformSeriesColor("supabase")}
          testId="supabase-daily-signups"
        />
        <div className="grid min-w-0 content-start gap-3">
          <SectionTitle title="Sign-up method" action={<span className="text-xs text-[var(--muted)]">{range.label}</span>} />
          <GlassPanel className="min-w-0 p-3 sm:p-4">
            {detail.providers.length > 0 ? (
              <ul className="grid min-w-0 gap-3">
                {detail.providers.map((item) => {
                  const share = providerTotal > 0 ? (item.signups / providerTotal) * 100 : 0;
                  return (
                    <li key={item.provider} className="min-w-0">
                      <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                        <span className="truncate capitalize text-label">{item.provider}</span>
                        <span className="tabular shrink-0 text-label-secondary">
                          <span className="font-semibold text-label">{formatMetricValue(item.signups, "count")}</span> {formatPercent(share, 0)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill-strong" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(share, 2)}%`, backgroundColor: platformSeriesColor("supabase") }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="p-1 text-sm text-label-secondary" role="status">No signups in this period.</p>
            )}
          </GlassPanel>
        </div>
      </section>
    </div>
  );
}
