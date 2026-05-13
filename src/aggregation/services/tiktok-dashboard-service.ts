import { listMetrics } from "@/storage/repositories/metrics-repository";
import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { ContentItem, ContentMetric, JsonRecord, MetricDaily, RawIngestion, Source } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listContentItems, listContentMetrics } from "@/storage/repositories/content-repository";
import { listSources } from "@/storage/repositories/sources-repository";

type TikTokSnapshotAccount = {
  openId: string | null;
  username: string | null;
  displayName: string | null;
  profileDeepLink: string | null;
  followerCount: number | null;
  likesCount: number | null;
  videoCount: number | null;
};

type TikTokSnapshotVideo = {
  id: string;
  title: string | null;
  description: string | null;
  shareUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
};

type TikTokSnapshot = {
  sourceId: string;
  fetchedAt: string;
  scopes: string[];
  apiBaseUrl: string | null;
  account: TikTokSnapshotAccount | null;
  videos: TikTokSnapshotVideo[];
};

export type TikTokVideoInsightRow = {
  id: string;
  sourceId: string;
  externalContentId: string;
  title: string;
  description: string;
  url: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  engagementRate: number | null;
};

export type TikTokDashboardSource = {
  sourceId: string;
  displayName: string;
  status: Source["status"];
  username: string | null;
  displayNameOnPlatform: string | null;
  openId: string | null;
  scopes: string[];
  lastSyncedAt: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  stats: {
    followers: number | null;
    videoCount: number | null;
    profileLikes: number | null;
    fetchedVideoCount: number;
    videoViews: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    engagementRate: number | null;
  };
  videos: TikTokVideoInsightRow[];
};

export type TikTokDashboardSummary = {
  sources: TikTokDashboardSource[];
  totals: {
    sourceCount: number;
    fetchedVideoCount: number;
    videoViews: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    engagementRate: number | null;
  };
};

const ACCOUNT_METRIC_KEYS = ["tiktok_followers", "tiktok_video_count", "tiktok_profile_likes"] as const;
const VIDEO_METRIC_KEYS = ["tiktok_video_views", "tiktok_likes", "tiktok_comments", "tiktok_shares", "tiktok_engagement_rate"] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function previewText(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function timestampFromCreateTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function metadataText(source: Source, key: string) {
  return textValue(source.metadata[key]);
}

function metadataScopes(source: Source) {
  const raw = source.metadata.tiktok_scopes;
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return (textValue(raw) ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function latestMetricValue(rows: MetricDaily[], sourceId: string, metricKey: string) {
  return rows
    .filter((row) => row.source_id === sourceId && row.metric_key === metricKey)
    .sort((left, right) => `${left.date}:${left.updated_at}`.localeCompare(`${right.date}:${right.updated_at}`))
    .at(-1)?.metric_value ?? null;
}

function latestContentMetricValue(rows: ContentMetric[], contentItemId: string, metricKey: string) {
  return rows
    .filter((row) => row.content_item_id === contentItemId && row.metric_key === metricKey)
    .sort((left, right) => `${left.date}:${left.updated_at}`.localeCompare(`${right.date}:${right.updated_at}`))
    .at(-1)?.metric_value ?? null;
}

function parseSnapshotPayload(sourceId: string, row: Pick<RawIngestion, "fetched_at" | "payload">): TikTokSnapshot | null {
  const payload = row.payload;
  if (!isRecord(payload) || payload.kind !== "tiktok_sync_snapshot" || !isRecord(payload.account)) return null;
  const account = payload.account;
  const videoValues = Array.isArray(payload.videos) ? payload.videos : [];
  return {
    sourceId,
    fetchedAt: row.fetched_at,
    scopes: Array.isArray(payload.scopes) ? payload.scopes.filter((value): value is string => typeof value === "string") : [],
    apiBaseUrl: textValue(payload.apiBaseUrl),
    account: {
      openId: textValue(account.open_id),
      username: textValue(account.username),
      displayName: textValue(account.display_name),
      profileDeepLink: textValue(account.profile_deep_link),
      followerCount: nullableNumber(account.follower_count),
      likesCount: nullableNumber(account.likes_count),
      videoCount: nullableNumber(account.video_count),
    },
    videos: videoValues.flatMap((item) => {
      if (!isRecord(item)) return [];
      const id = textValue(item.id);
      if (!id) return [];
      return [{
        id,
        title: textValue(item.title),
        description: textValue(item.video_description),
        shareUrl: textValue(item.share_url) ?? textValue(item.embed_link),
        thumbnailUrl: textValue(item.cover_image_url),
        createdAt: timestampFromCreateTime(item.create_time),
        viewCount: nullableNumber(item.view_count),
        likeCount: nullableNumber(item.like_count),
        commentCount: nullableNumber(item.comment_count),
        shareCount: nullableNumber(item.share_count),
      }];
    }),
  };
}

async function listLatestSnapshots(dataSpaceId: string | undefined, sourceIds: Set<string>): Promise<TikTokSnapshot[]> {
  if (sourceIds.size === 0) return [];

  if (!isRuntimeDatabaseConfigured()) {
    const snapshots = getDemoStore().rawIngestions
      .filter((row) => row.source_id && sourceIds.has(row.source_id) && row.source_type_key === "tiktok")
      .map((row) => parseSnapshotPayload(row.source_id!, row))
      .filter((snapshot): snapshot is TikTokSnapshot => Boolean(snapshot))
      .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt));
    const seen = new Set<string>();
    return snapshots.filter((snapshot) => {
      if (seen.has(snapshot.sourceId)) return false;
      seen.add(snapshot.sourceId);
      return true;
    });
  }

  const values: unknown[] = [Array.from(sourceIds)];
  const where = [
    "s.source_type_key = 'tiktok'",
    "r.source_id is not null",
    "r.source_id = any($1::uuid[])",
    "r.payload->>'kind' = 'tiktok_sync_snapshot'",
  ];
  if (dataSpaceId) {
    values.push(dataSpaceId);
    where.push(`s.data_space_id = $${values.length}`);
  }
  const rows = await queryRows<RawIngestion>(
    `
      select r.*
      from raw_ingestions r
      join sources s on s.id = r.source_id
      where ${where.join(" and ")}
      order by r.fetched_at desc
      limit 50
    `,
    values,
  );
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (!row.source_id || seen.has(row.source_id)) return [];
    const snapshot = parseSnapshotPayload(row.source_id, row);
    if (!snapshot) return [];
    seen.add(row.source_id);
    return [snapshot];
  });
}

function engagementRateFromParts(views: number | null, likes: number | null, comments: number | null, shares: number | null) {
  if (views === null || views <= 0) return null;
  return (((likes ?? 0) + (comments ?? 0) + (shares ?? 0)) / views) * 100;
}

function videosFromContent(items: ContentItem[], metrics: ContentMetric[], sourceId: string): TikTokVideoInsightRow[] {
  return items
    .filter((item) => item.source_id === sourceId && item.source_type_key === "tiktok")
    .map((item) => {
      const views = latestContentMetricValue(metrics, item.id, "tiktok_video_views");
      const likes = latestContentMetricValue(metrics, item.id, "tiktok_likes");
      const comments = latestContentMetricValue(metrics, item.id, "tiktok_comments");
      const shares = latestContentMetricValue(metrics, item.id, "tiktok_shares");
      return {
        id: item.id,
        sourceId,
        externalContentId: item.external_content_id,
        title: previewText(item.title, `TikTok video ${item.external_content_id}`),
        description: previewText(item.caption, "No video description available"),
        url: item.url,
        thumbnailUrl: item.thumbnail_url,
        publishedAt: item.published_at,
        views,
        likes,
        comments,
        shares,
        engagementRate: latestContentMetricValue(metrics, item.id, "tiktok_engagement_rate") ?? engagementRateFromParts(views, likes, comments, shares),
      };
    })
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""));
}

function videosFromSnapshot(snapshot: TikTokSnapshot | undefined, sourceId: string): TikTokVideoInsightRow[] {
  if (!snapshot) return [];
  return snapshot.videos
    .map((video) => ({
      id: video.id,
      sourceId,
      externalContentId: video.id,
      title: previewText(video.title ?? video.description, `TikTok video ${video.id}`),
      description: previewText(video.description ?? video.title, "No video description available"),
      url: video.shareUrl,
      thumbnailUrl: video.thumbnailUrl,
      publishedAt: video.createdAt,
      views: video.viewCount,
      likes: video.likeCount,
      comments: video.commentCount,
      shares: video.shareCount,
      engagementRate: engagementRateFromParts(video.viewCount, video.likeCount, video.commentCount, video.shareCount),
    }))
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""));
}

function sumNullable(values: Array<number | null>) {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
}

function statsFromVideos(videos: TikTokVideoInsightRow[], accountMetrics: MetricDaily[], sourceId: string) {
  const videoViews = sumNullable(videos.map((video) => video.views)) ?? latestMetricValue(accountMetrics, sourceId, "tiktok_video_views");
  const likes = sumNullable(videos.map((video) => video.likes)) ?? latestMetricValue(accountMetrics, sourceId, "tiktok_likes");
  const comments = sumNullable(videos.map((video) => video.comments)) ?? latestMetricValue(accountMetrics, sourceId, "tiktok_comments");
  const shares = sumNullable(videos.map((video) => video.shares)) ?? latestMetricValue(accountMetrics, sourceId, "tiktok_shares");
  const engagementRate = videoViews && videoViews > 0
    ? (((likes ?? 0) + (comments ?? 0) + (shares ?? 0)) / videoViews) * 100
    : latestMetricValue(accountMetrics, sourceId, "tiktok_engagement_rate");
  return { videoViews, likes, comments, shares, engagementRate };
}

export async function getTikTokDashboardSummary(options: { dataSpaceId?: string } = {}): Promise<TikTokDashboardSummary> {
  const [sources, contentItems, contentMetrics, accountMetrics] = await Promise.all([
    listSources({ dataSpaceId: options.dataSpaceId }),
    listContentItems({ dataSpaceId: options.dataSpaceId }),
    listContentMetrics({ dataSpaceId: options.dataSpaceId }),
    listMetrics({ metricKeys: [...ACCOUNT_METRIC_KEYS, ...VIDEO_METRIC_KEYS], sourceTypeKey: "tiktok", dataSpaceId: options.dataSpaceId }),
  ]);
  const allTikTokSources = sources.filter((source) => source.source_type_key === "tiktok");
  const hasConfiguredTikTokSource = allTikTokSources.some((source) => source.status !== "demo");
  const tiktokSources = hasConfiguredTikTokSource
    ? allTikTokSources.filter((source) => !(source.status === "demo" && source.metadata.scaffoldOnly === true))
    : allTikTokSources;
  const sourceIds = new Set(tiktokSources.map((source) => source.id));
  const snapshots = await listLatestSnapshots(options.dataSpaceId, sourceIds);
  const snapshotBySourceId = new Map(snapshots.map((snapshot) => [snapshot.sourceId, snapshot]));

  const sourcesWithInsights = tiktokSources.map((source) => {
    const snapshot = snapshotBySourceId.get(source.id);
    const contentVideos = videosFromContent(contentItems, contentMetrics, source.id);
    const hasTikTokContentMetrics = contentMetrics.some((metric) => metric.source_id === source.id && VIDEO_METRIC_KEYS.includes(metric.metric_key as (typeof VIDEO_METRIC_KEYS)[number]));
    const videos = hasTikTokContentMetrics ? contentVideos : videosFromSnapshot(snapshot, source.id);
    const videoStats = statsFromVideos(videos, accountMetrics, source.id);
    const tokenExpiresAt = metadataText(source, "token_expires_at");
    const scopes = snapshot?.scopes.length ? snapshot.scopes : metadataScopes(source);
    return {
      sourceId: source.id,
      displayName: source.display_name,
      status: source.status,
      username: snapshot?.account?.username ?? metadataText(source, "tiktok_username") ?? source.account_name,
      displayNameOnPlatform: snapshot?.account?.displayName ?? metadataText(source, "tiktok_display_name"),
      openId: snapshot?.account?.openId ?? metadataText(source, "tiktok_open_id") ?? source.external_account_id,
      scopes,
      lastSyncedAt: snapshot?.fetchedAt ?? source.last_success_at ?? null,
      tokenExpiresAt,
      lastError: source.last_error,
      stats: {
        followers: snapshot?.account?.followerCount ?? latestMetricValue(accountMetrics, source.id, "tiktok_followers"),
        videoCount: snapshot?.account?.videoCount ?? latestMetricValue(accountMetrics, source.id, "tiktok_video_count"),
        profileLikes: snapshot?.account?.likesCount ?? latestMetricValue(accountMetrics, source.id, "tiktok_profile_likes"),
        fetchedVideoCount: videos.length,
        ...videoStats,
      },
      videos: videos.slice(0, 12),
    } satisfies TikTokDashboardSource;
  }).sort((left, right) => {
    const leftRank = left.status === "healthy" ? 0 : left.videos.length > 0 ? 1 : 2;
    const rightRank = right.status === "healthy" ? 0 : right.videos.length > 0 ? 1 : 2;
    return leftRank - rightRank || left.displayName.localeCompare(right.displayName);
  });

  const aggregateVideos = sourcesWithInsights.flatMap((source) => source.videos);
  const videoViews = sumNullable(sourcesWithInsights.map((source) => source.stats.videoViews));
  const likes = sumNullable(sourcesWithInsights.map((source) => source.stats.likes));
  const comments = sumNullable(sourcesWithInsights.map((source) => source.stats.comments));
  const shares = sumNullable(sourcesWithInsights.map((source) => source.stats.shares));
  return {
    sources: sourcesWithInsights,
    totals: {
      sourceCount: sourcesWithInsights.length,
      fetchedVideoCount: aggregateVideos.length,
      videoViews,
      likes,
      comments,
      shares,
      engagementRate: videoViews && videoViews > 0 ? (((likes ?? 0) + (comments ?? 0) + (shares ?? 0)) / videoViews) * 100 : null,
    },
  };
}
