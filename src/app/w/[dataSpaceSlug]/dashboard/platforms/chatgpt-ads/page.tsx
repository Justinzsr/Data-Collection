import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAdsCampaignHistory } from "@/aggregation/services/ads-campaign-history-service";
import { getChatgptAdsFunnelSnapshot } from "@/aggregation/services/chatgpt-ads-funnel-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { ChatgptAdsFunnel } from "@/presentation/dashboard/chatgpt-ads-funnel";
import { PlatformPageHeader } from "@/presentation/platforms/platform-page-header";
import { AdsCampaignHistory } from "@/presentation/platforms/ads-campaign-history";
import { dashboardPath } from "@/presentation/routes/data-space-routes";
import type { WebsiteFunnelRangeKey } from "@/aggregation/services/website-funnel-types";

export const dynamic = "force-dynamic";

async function CampaignHistory({ dataSpaceId, fixture }: { dataSpaceId: string; fixture: boolean }) {
  const snapshot = await getAdsCampaignHistory({ dataSpaceId, platform: "chatgpt_ads", fixture });
  return <AdsCampaignHistory snapshot={snapshot} />;
}

export default async function ChatgptAdsPage({ params, searchParams }: {
  params: Promise<{ dataSpaceSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ dataSpaceSlug }, query] = await Promise.all([params, searchParams]);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace || dataSpace.slug !== "moonarq") notFound();
  const range: WebsiteFunnelRangeKey = query?.range === "today" || query?.range === "7d" ? query.range : "30d";
  const basePath = dashboardPath(dataSpace.slug);
  const fixture = query?.demo_state === "ads-live";
  const snapshot = await getChatgptAdsFunnelSnapshot({ dataSpaceId: dataSpace.id, range, fixture });
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-4" data-testid="chatgpt-ads-page">
      <PlatformPageHeader overviewHref={basePath} iconKey="chatgpt_ads" title="ChatGPT Ads" subtitle="Ad spend, clicks, attributed goals, and the first-party path to a linked Shopify order." range={range} rangeHref={(next) => `${basePath}/platforms/chatgpt-ads?range=${next}${fixture ? "&demo_state=ads-live" : ""}`} />
      <Suspense fallback={<p className="px-1 text-sm text-label-secondary" role="status">Loading campaign history…</p>}>
        <CampaignHistory dataSpaceId={dataSpace.id} fixture={fixture} />
      </Suspense>
      <ChatgptAdsFunnel snapshot={snapshot} basePath={basePath} dataSpaceSlug={dataSpace.slug} detailed />
    </div>
  );
}
