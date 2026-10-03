import { notFound } from "next/navigation";
import { getPlatformDetail } from "@/aggregation/services/platform-overview-service";
import { getTikTokDashboardSummary } from "@/aggregation/services/tiktok-dashboard-service";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { currentTime } from "@/presentation/components/ui/relative-time";
import { TikTokVideoList } from "@/presentation/platforms/social-content-list";
import { formatFactTime, parseDetailRange, plainMetric, SocialPlatformPage } from "@/presentation/platforms/social-platform-page";
import { dashboardPath } from "@/presentation/routes/data-space-routes";

export const dynamic = "force-dynamic";

export default async function TikTokPlatformPage({
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
    getPlatformDetail({ dataSpace, rangeKey: parseDetailRange(query?.range), key: "tiktok" }),
    getTikTokDashboardSummary({ dataSpaceId: dataSpace.id }),
  ]);
  const account = summary.sources.find((item) => item.sourceId === detail.card.source?.id) ?? null;
  const stats = account?.stats;

  return (
    <SocialPlatformPage
      detail={detail}
      title="TikTok"
      iconKey="tiktok"
      basePath={basePath}
      dataSpaceSlug={dataSpace.slug}
      path={`${basePath}/platforms/tiktok`}
      showAdsLink={false}
      now={currentTime()}
      extraMetrics={[
        plainMetric("videos", "Videos", stats?.videoCount ?? null),
        plainMetric("likes", "Video likes", stats?.likes ?? null),
        plainMetric("comments", "Comments", stats?.comments ?? null),
        plainMetric("shares", "Shares", stats?.shares ?? null),
        plainMetric("profile_likes", "Profile likes", stats?.profileLikes ?? null),
      ]}
      metricsNote="Video views, engagement, likes, comments, and shares add up the videos returned by the last sync. Engagement is likes, comments, and shares divided by views. Profile likes come from the account itself."
      content={<TikTokVideoList videos={account?.videos ?? []} />}
      facts={account ? [
        { label: "Last sync", value: formatFactTime(account.lastSyncedAt, "No sync yet") },
        { label: "Access token refreshes", value: account.tokenExpiresAt ? `Automatically, next by ${formatFactTime(account.tokenExpiresAt, "")}` : "Not reported" },
        { label: "Granted scopes", value: account.scopes.length > 0 ? account.scopes.join(", ") : "Not reported" },
        { label: "Last error", value: account.lastError ?? "None" },
      ] : []}
    />
  );
}
