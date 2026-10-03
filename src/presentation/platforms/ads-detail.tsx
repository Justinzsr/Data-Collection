import type { ReactNode } from "react";
import type { PaidAdsCampaignRow, PaidAdsOverview } from "@/aggregation/services/platform-overview-service";
import { Badge, type BadgeTone } from "@/presentation/components/ui/badge";
import { formatMetricValue } from "@/presentation/components/ui/format";
import { GlassPanel, SectionTitle } from "@/presentation/components/ui/panel";

function campaignStatus(status: string | null): { tone: BadgeTone; label: string } {
  if (!status) return { tone: "slate", label: "Unknown" };
  if (status === "ACTIVE") return { tone: "green", label: "Active" };
  if (status === "PAUSED" || status === "CAMPAIGN_PAUSED" || status === "ADSET_PAUSED") return { tone: "slate", label: "Paused" };
  if (status === "ARCHIVED" || status === "DELETED") return { tone: "slate", label: "Archived" };
  if (status.includes("ISSUES") || status === "DISAPPROVED") return { tone: "rose", label: "Needs review" };
  if (status === "IN_PROCESS" || status === "PENDING_REVIEW") return { tone: "amber", label: "In review" };
  return { tone: "slate", label: status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ") };
}

/** Today so far next to yesterday's full day, so pace is readable without a chart. */
export function PaidAdsTodayStrip({ ads, footer }: { ads: PaidAdsOverview; footer?: ReactNode }) {
  const { today, yesterday, currency } = ads;
  const items = [
    { label: "Spend", today: formatMetricValue(today.totals?.spend ?? null, currency), yesterday: formatMetricValue(yesterday.totals?.spend ?? null, currency) },
    { label: "Impressions", today: formatMetricValue(today.totals?.impressions ?? null, "count"), yesterday: formatMetricValue(yesterday.totals?.impressions ?? null, "count") },
    { label: "Link clicks", today: formatMetricValue(today.totals?.linkClicks ?? null, "count"), yesterday: formatMetricValue(yesterday.totals?.linkClicks ?? null, "count") },
    { label: "CTR (link)", today: formatMetricValue(today.rates?.ctr ?? null, "percent"), yesterday: formatMetricValue(yesterday.rates?.ctr ?? null, "percent") },
    { label: "CPC (link)", today: formatMetricValue(today.rates?.cpc ?? null, currency), yesterday: formatMetricValue(yesterday.rates?.cpc ?? null, currency) },
    { label: "Purchases", today: formatMetricValue(today.totals?.purchases ?? null, "count"), yesterday: formatMetricValue(yesterday.totals?.purchases ?? null, "count") },
  ];
  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5" data-testid="paid-ads-today-strip">
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[17px] font-semibold tracking-[-0.018em] text-label">Today so far</h2>
        <p className="text-xs text-[var(--muted)]">Against yesterday&apos;s full day, in the ad account&apos;s time zone</p>
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <div key={item.label} className="inset-surface min-w-0 p-3">
            <dt className="truncate text-xs text-[var(--muted)]">{item.label}</dt>
            <dd className="mt-1 min-w-0">
              <span className="tabular block truncate text-[20px] font-semibold tracking-[-0.025em] text-label">{item.today}</span>
              <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">Yesterday {item.yesterday}</span>
            </dd>
          </div>
        ))}
      </dl>
      {footer}
    </GlassPanel>
  );
}

function CampaignCells({ campaign, currency }: { campaign: PaidAdsCampaignRow; currency: string }) {
  return (
    <>
      <td className="tabular px-3 py-3 text-right text-label">{formatMetricValue(campaign.totals.spend, currency)}</td>
      <td className="tabular px-3 py-3 text-right text-label-secondary">{formatMetricValue(campaign.totals.impressions, "count")}</td>
      <td className="tabular px-3 py-3 text-right text-label-secondary">{formatMetricValue(campaign.totals.linkClicks, "count")}</td>
      <td className="tabular px-3 py-3 text-right text-label-secondary">{formatMetricValue(campaign.rates.ctr, "percent")}</td>
      <td className="tabular px-3 py-3 text-right text-label-secondary">{formatMetricValue(campaign.rates.cpc, currency)}</td>
      <td className="tabular px-3 py-3 text-right text-label-secondary">{formatMetricValue(campaign.totals.purchases, "count")}</td>
      <td className="tabular px-3 py-3 text-right text-label-secondary sm:pr-5">{formatMetricValue(campaign.rates.roas, "ratio")}</td>
    </>
  );
}

/** Campaigns that delivered in the selected period, highest spend first. */
export function PaidAdsCampaignTable({ ads, periodLabel }: { ads: PaidAdsOverview; periodLabel: string }) {
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="paid-ads-campaigns-title" data-testid="paid-ads-campaigns">
      <SectionTitle
        title="Campaigns"
        id="paid-ads-campaigns-title"
        action={<span className="text-xs text-[var(--muted)]">{periodLabel}, highest spend first</span>}
      />
      <GlassPanel className="min-w-0 overflow-hidden p-0">
        {ads.campaigns.length === 0 ? (
          <p className="p-4 text-sm text-label-secondary sm:p-5" role="status">
            {ads.period.known ? "No campaign delivered in this period." : "Today's campaigns appear after the first sync of the day."}
          </p>
        ) : (
          <div className="min-w-0 overflow-x-auto focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-tint/30" role="region" aria-label="Scrollable campaigns table" tabIndex={0}>
            <table className="w-full min-w-[46rem] text-left text-sm">
              <caption className="sr-only">Meta Ads campaigns for {periodLabel.toLowerCase()}</caption>
              <thead className="border-b border-separator text-xs text-[var(--muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-medium sm:pl-5">Campaign</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Spend</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Impressions</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Link clicks</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">CTR</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">CPC</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Purchases</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium sm:pr-5">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {ads.campaigns.map((campaign) => {
                  const status = campaignStatus(campaign.status);
                  return (
                    <tr key={campaign.key}>
                      <th scope="row" className="max-w-[18rem] px-3 py-3 font-normal sm:pl-5">
                        <span className="block truncate font-semibold text-label" title={campaign.name}>{campaign.name}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone={status.tone} dot>{status.label}</Badge>
                          {campaign.deliveringToday ? <Badge tone="cyan">Delivering today</Badge> : null}
                        </span>
                      </th>
                      <CampaignCells campaign={campaign} currency={ads.currency} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>
    </section>
  );
}
