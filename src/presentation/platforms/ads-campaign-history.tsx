import type { AdsCampaignHistorySnapshot } from "@/aggregation/services/ads-campaign-history-types";
import { Badge, type BadgeTone } from "@/presentation/components/ui/badge";
import { formatMetricValue } from "@/presentation/components/ui/format";
import { GlassPanel, SectionTitle } from "@/presentation/components/ui/panel";

const HISTORY_STATES: Record<AdsCampaignHistorySnapshot["state"], { label: string; tone: BadgeTone }> = {
  ready: { label: "Reported", tone: "green" },
  partial: { label: "Partial history", tone: "amber" },
  stale: { label: "Previous report", tone: "amber" },
  unavailable: { label: "Unavailable", tone: "slate" },
  ambiguous: { label: "Choose one account", tone: "amber" },
};

function dateSpan(startDate: string | null, endDate: string | null) {
  if (startDate && endDate) return startDate === endDate ? startDate : `${startDate} – ${endDate}`;
  if (startDate) return `From ${startDate}`;
  if (endDate) return `Through ${endDate}`;
  return "Dates not yet reported";
}

function updatedLabel(value: string | null, timeZone: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium", timeStyle: "short", timeZone: timeZone ?? "UTC",
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
    }).format(new Date(value)) + " UTC";
  }
}

/** Stored, account-scoped campaign history, independent of the page's selected date range. */
export function AdsCampaignHistory({ snapshot }: { snapshot: AdsCampaignHistorySnapshot }) {
  const status = HISTORY_STATES[snapshot.state];
  const basis = snapshot.coverage.basis === "official_available_history" ? "Official available history" : "Collected history";
  const updated = updatedLabel(snapshot.updatedAt, snapshot.timeZone);
  const spend = (value: number | null) => snapshot.currency ? formatMetricValue(value, snapshot.currency) : "—";
  const totals = [
    { key: "spend", label: "Spend", value: spend(snapshot.totals.spend) },
    { key: "impressions", label: "Impressions", value: formatMetricValue(snapshot.totals.impressions, "count") },
    { key: "clicks", label: snapshot.clickLabel, value: formatMetricValue(snapshot.totals.clicks, "count") },
  ];

  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="ads-campaign-history-title" data-testid="ads-campaign-history">
      <SectionTitle
        title="Campaign history"
        id="ads-campaign-history-title"
        action={<Badge tone={status.tone} dot>{status.label}</Badge>}
      />
      <GlassPanel className="min-w-0 overflow-hidden">
        <div className="p-4 sm:p-5">
          <p className="break-words text-sm font-medium text-label" data-testid="ads-history-coverage">
            {basis} · {dateSpan(snapshot.coverage.startDate, snapshot.coverage.endDate)}
          </p>
          <p className="mt-1 break-words text-xs leading-5 text-muted">
            {[snapshot.accountName, snapshot.currency, snapshot.timeZone ?? "Account time zone not yet verified"].filter(Boolean).join(" · ")}
            {updated ? <> · Updated <time dateTime={snapshot.updatedAt!}>{updated}</time>{!snapshot.timeZone ? " UTC" : ""}</> : null}
          </p>
          <p className="mt-2 break-words text-xs leading-5 text-label-secondary">{snapshot.coverage.note}</p>
          <dl className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3" data-testid="ads-history-totals">
            {totals.map((metric) => (
              <div key={metric.key} className="inset-surface min-w-0 rounded-2xl p-3" data-testid={`ads-history-${metric.key}`}>
                <dt className="text-xs leading-5 text-label-secondary">{metric.label}</dt>
                <dd className="tabular mt-1 break-words text-[26px] font-semibold leading-8 tracking-[-0.025em] text-label">{metric.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 break-words text-xs leading-5 text-muted">{snapshot.note}</p>
        </div>

        {snapshot.campaigns.length > 0 ? (
          <div className="min-w-0 overflow-x-auto border-t border-separator focus-visible:outline-hidden focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-tint/30" role="region" aria-label="Scrollable campaign history" tabIndex={0} data-testid="ads-history-campaigns">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Campaign history within the reported coverage, independent of the selected date range</caption>
              <thead className="border-b border-separator text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium sm:pl-5">Campaign</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Spend</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Impressions</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium sm:pr-5">{snapshot.clickLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {snapshot.campaigns.map((campaign) => {
                  const name = campaign.name.trim();
                  return (
                    <tr key={campaign.key}>
                      <th scope="row" className="max-w-[22rem] px-4 py-3 font-normal sm:pl-5">
                        <span className="block break-words font-semibold text-label">{name && name !== campaign.key ? name : "Unnamed campaign"}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted">{dateSpan(campaign.startDate, campaign.endDate)}</span>
                      </th>
                      <td className="tabular whitespace-nowrap px-3 py-3 text-right text-label">{spend(campaign.spend)}</td>
                      <td className="tabular whitespace-nowrap px-3 py-3 text-right text-label">{formatMetricValue(campaign.impressions, "count")}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right text-label sm:pr-5">{formatMetricValue(campaign.clicks, "count")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="border-t border-separator p-4 text-sm leading-6 text-label-secondary sm:px-5" role="status">
            {snapshot.state === "unavailable" || snapshot.state === "ambiguous" ? "Campaign history is not available yet." : "No campaign-level history has been reported yet."}
          </p>
        )}
      </GlassPanel>
    </section>
  );
}
