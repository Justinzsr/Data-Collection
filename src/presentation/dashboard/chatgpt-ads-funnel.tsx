import { ArrowRight, ExternalLink } from "lucide-react";
import type { ChatgptAdsFunnelSnapshot } from "@/aggregation/services/chatgpt-ads-funnel-types";
import { DailyMetricChart } from "@/presentation/charts/daily-metric-chart";
import { platformSeriesColor } from "@/presentation/charts/chart-theme";
import { Badge } from "@/presentation/components/ui/badge";
import { LinkButton } from "@/presentation/components/ui/button";
import { formatMetricValue } from "@/presentation/components/ui/format";
import { GlassPanel } from "@/presentation/components/ui/panel";
import { SyncActionButton } from "@/presentation/dashboard/sync-action-button";
import { formatAppDateTime } from "@/storage/runtime/app-time";

const STATE_LABELS = { not_connected: "Not connected", ambiguous: "Choose one account", first_sync: "Awaiting first sync", live: "Synced", stale: "Sync overdue", error: "Needs attention" };

export function ChatgptAdsFunnel({ snapshot, basePath, dataSpaceSlug, detailed = false }: {
  snapshot: ChatgptAdsFunnelSnapshot; basePath: string; dataSpaceSlug: string; detailed?: boolean;
}) {
  const { connection, delivery, website } = snapshot;
  const unit = delivery.currency ?? "currency";
  const t = delivery.totals;
  const metrics = [
    { label: "Ad spend", value: t.spend, unit },
    { label: "Impressions", value: t.impressions, unit: "count" },
    { label: "Ad clicks", value: t.clicks, unit: "count" },
    { label: "CTR", value: t.ctrPercent, unit: "percent" },
    { label: "CPC", value: t.cpc, unit },
    { label: "Attributed goal conversions", value: t.conversions, unit: "attributed_goal" },
    { label: "Post-click goal CVR", value: t.postClickCvrPercent, unit: "percent" },
    { label: "Visit → linked order CVR", value: website.visitToOrderRatePercent, unit: "percent" },
  ];
  const tone = connection.state === "live" ? "green" : connection.state === "error" ? "rose" : connection.state === "stale" || connection.state === "ambiguous" ? "amber" : "slate";
  const filteredHref = `${basePath}/platforms/website?range=${snapshot.range.key}&utm_source=chatgpt&utm_medium=paid`;
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="chatgpt-ads-funnel-title" data-testid="chatgpt-ads-funnel">
      <GlassPanel className="min-w-0 overflow-hidden p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="chatgpt-ads-funnel-title" className="text-[19px] font-semibold tracking-[-0.018em] text-label">ChatGPT Ads · visitor funnel</h2>
              <Badge tone={tone} dot>{STATE_LABELS[connection.state]}</Badge>
              {snapshot.fixture ? <Badge tone="amber">Sample data</Badge> : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-label-secondary">{connection.note}</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {snapshot.range.label} · {delivery.timeZone ?? "Account time zone not yet verified"}
              {connection.updatedAt ? ` · Synced ${formatAppDateTime(connection.updatedAt)}` : ""}
              {delivery.coverage === "partial" ? " · Partial reporting coverage" : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            {connection.sourceId ? (
              <>
                <SyncActionButton sourceId={connection.sourceId} dataSpaceSlug={dataSpaceSlug} compact label="Refresh reports" />
                <LinkButton href={`${basePath}/sources/${connection.sourceId}`} variant="secondary" className="min-h-11 text-xs">Source settings</LinkButton>
              </>
            ) : !snapshot.fixture ? (
              <LinkButton href={`${basePath}/sources/new`} variant="primary" className="min-h-11">Connect ChatGPT Ads</LinkButton>
            ) : null}
            {!detailed ? <LinkButton href={`${basePath}/platforms/chatgpt-ads?range=${snapshot.range.key}`} variant="secondary" className="min-h-11 text-xs">Ads details<ArrowRight className="h-3.5 w-3.5" /></LinkButton> : null}
          </div>
        </div>
        <dl className="mt-5 grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 border-t border-separator pt-4 md:grid-cols-3 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <dt className="text-xs leading-5 text-label-secondary">{metric.label}</dt>
              <dd className="tabular mt-1 break-words text-[24px] font-semibold leading-8 tracking-[-0.025em] text-label">{formatMetricValue(metric.value, metric.unit)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-5 text-muted">{delivery.note} Post-click CVR divides click-through goal conversions by clicks on the same reported days.</p>
        <div className="mt-5 border-t border-separator pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-label">Tracked visitor journey</h3>
            <LinkButton href={filteredHref} variant="ghost" className="min-h-11 px-2 text-xs">Explore tagged visits<ExternalLink className="h-3.5 w-3.5" /></LinkButton>
          </div>
          <ol className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="ChatGPT paid visitor funnel">
            {website.stages.map((stage, index) => (
              <li key={stage.key} className="inset-surface min-w-0 rounded-2xl p-3">
                <div className="flex items-center justify-between gap-2 text-xs text-muted"><span>{stage.authority === "shopify" ? "Shopify · exact bridge" : "Website · paid visits"}</span>{index < website.stages.length - 1 ? <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}</div>
                <p className="mt-2 text-sm font-medium text-label-secondary">{stage.label}</p>
                <p className="tabular mt-1 text-[26px] font-semibold tracking-[-0.025em] text-label">{stage.count === null ? "—" : formatMetricValue(stage.count, "count")}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{stage.state === "not_measured" ? "Not measured" : stage.state === "partial" ? "Partial coverage" : stage.fromPrevious === null ? "Tagged sessions" : `${formatMetricValue(stage.fromPrevious, "percent")} from previous stage`}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs leading-5 text-muted">{website.note} Website stages use Pacific Time. Impressions and clicks are account totals and are not an individual identity join.</p>
          <p className="mt-2 break-words text-xs leading-5 text-label-secondary">Ad links must include <code className="rounded bg-fill px-1 py-0.5">utm_source=chatgpt&amp;utm_medium=paid</code>. Untagged visits cannot be assigned to this paid cohort.</p>
        </div>
      </GlassPanel>
      {detailed ? (
        <>
          <div className="grid min-w-0 gap-3 lg:grid-cols-3">
            <DailyMetricChart title="Daily ad spend" description="Official account report; unreported days remain unknown." data={delivery.daily.map((point) => ({ date: point.date, value: point.spend }))} unit={unit} color={platformSeriesColor("chatgpt_ads")} />
            <DailyMetricChart title="Daily ad clicks" data={delivery.daily.map((point) => ({ date: point.date, value: point.clicks }))} unit="count" color={platformSeriesColor("chatgpt_ads")} />
            <DailyMetricChart title="Daily attributed goals" description="Platform attribution, including eligible view-through credit." data={delivery.daily.map((point) => ({ date: point.date, value: point.conversions }))} unit="attributed_goal" color={platformSeriesColor("chatgpt_ads")} />
          </div>
          <GlassPanel className="min-w-0 p-4 sm:p-5">
            <h3 className="text-[17px] font-semibold text-label">Attribution detail</h3>
            <dl className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                { label: "Click-through goals", value: t.clickThroughConversions, unit: "attributed_goal" },
                { label: "View-through goals", value: t.viewThroughConversions, unit: "attributed_goal" },
                { label: "Platform-attributed sales", value: t.purchaseValue, unit },
                { label: "Platform ROAS", value: t.platformRoas, unit: "ratio" },
              ].map((metric) => <div key={metric.label} className="min-w-0"><dt className="text-xs text-label-secondary">{metric.label}</dt><dd className="tabular mt-1 break-words text-xl font-semibold text-label">{formatMetricValue(metric.value, metric.unit)}</dd></div>)}
            </dl>
            <p className="mt-3 text-xs leading-5 text-muted">Attributed goals may be checkout starts or other configured events. Platform-attributed sales follow OpenAI attribution; linked Shopify orders above use the checkout-event bridge and are counted separately.</p>
          </GlassPanel>
        </>
      ) : null}
    </section>
  );
}
