import { notFound } from "next/navigation";
import { getInstagramDashboardSummary } from "@/aggregation/services/instagram-dashboard-service";
import { getPlatformDetail } from "@/aggregation/services/platform-overview-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { currentTime } from "@/presentation/components/ui/relative-time";
import { InstagramMediaList } from "@/presentation/platforms/social-content-list";
import { formatFactTime, parseDetailRange, plainMetric, SocialPlatformPage } from "@/presentation/platforms/social-platform-page";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

export default async function InstagramPlatformPage({
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
  const [detail, summary] = await Promise.all([
    getPlatformDetail({ dataSpace, rangeKey: parseDetailRange(query?.range), key: "instagram" }),
    getInstagramDashboardSummary({ dataSpaceId: dataSpace.id }),
  ]);
  const account = summary.sources.find((item) => item.sourceId === detail.card.source?.id) ?? null;
  const stats = account?.stats;

  return (
    <SocialPlatformPage
      detail={detail}
      title="Instagram"
      iconKey="instagram"
      basePath={basePath}
      dataSpaceSlug={dataSpace.slug}
      path={`${basePath}/platforms/instagram`}
      showAdsLink={dataSpace.slug === "moonarq"}
      now={currentTime()}
      extraMetrics={[
        plainMetric("posts", "Posts", stats?.accountMediaCount ?? null),
        plainMetric("likes", "Likes", stats ? stats.likes : null),
        plainMetric("comments", "Comments", stats ? stats.comments : null),
        plainMetric("saved", "Saves", stats ? stats.saved : null),
        plainMetric("interactions", "Interactions", stats ? stats.totalInteractions : null),
      ]}
      metricsNote="Post reach, engagement, likes, comments, saves, and interactions add up the most recent posts in the last sync, so they move as new posts arrive. Engagement is interactions divided by reach."
      content={<InstagramMediaList media={account?.media ?? []} />}
      facts={account ? [
        { label: "Last sync", value: formatFactTime(account.lastSyncedAt, "No sync yet") },
        { label: "Authorization renews by", value: formatFactTime(account.tokenExpiresAt, "Not reported") },
        { label: "Instagram account ID", value: account.accountId ?? "Not reported" },
        { label: "Graph API version", value: account.graphApiVersion ?? "Not reported" },
      ] : []}
    />
  );
}
