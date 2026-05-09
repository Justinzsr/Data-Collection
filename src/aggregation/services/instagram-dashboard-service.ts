import { listMetrics } from "@/storage/repositories/metrics-repository";
import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { ContentItem, ContentMetric, JsonRecord, MetricDaily, RawIngestion, Source } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listContentItems, listContentMetrics } from "@/storage/repositories/content-repository";
import { listSources } from "@/storage/repositories/sources-repository";

type InstagramSnapshotAccount = {
  id: string | null;
  username: string | null;
  followersCount: number | null;
  mediaCount: number | null;
  pageId: string | null;
};

type InstagramSnapshotMedia = {
  id: string;
  caption: string | null;
  mediaType: string;
  permalink: string | null;
  timestamp: string | null;
  likeCount: number;
  commentsCount: number;
  insights: {
    reach: number;
    saved: number;
    totalInteractions: number;
  };
};

type InstagramSnapshot = {
  sourceId: string;
  fetchedAt: string;
  graphApiVersion: string | null;
  account: InstagramSnapshotAccount | null;
  media: InstagramSnapshotMedia[];
};

export type InstagramMediaInsightRow = {
  id: string;
  sourceId: string;
  externalContentId: string;
  captionPreview: string;
  mediaType: string;
  url: string | null;
  publishedAt: string | null;
  reach: number;
  likes: number;
  comments: number;
  saved: number;
  totalInteractions: number;
};

export type InstagramDashboardSource = {
  sourceId: string;
  displayName: string;
  status: Source["status"];
  username: string | null;
  accountId: string | null;
  pageId: string | null;
  graphApiVersion: string | null;
  lastSyncedAt: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  stats: {
    followers: number | null;
    accountMediaCount: number | null;
    fetchedMediaCount: number;
    reach: number;
    likes: number;
    comments: number;
    saved: number;
    totalInteractions: number;
    engagementRate: number | null;
  };
  media: InstagramMediaInsightRow[];
};

export type InstagramDashboardSummary = {
  sources: InstagramDashboardSource[];
  totals: {
    sourceCount: number;
    fetchedMediaCount: number;
    reach: number;
    likes: number;
    comments: number;
    saved: number;
    totalInteractions: number;
    engagementRate: number | null;
  };
};

const ACCOUNT_METRIC_KEYS = ["instagram_followers", "instagram_media_count"] as const;
const MEDIA_METRIC_KEYS = [
  "instagram_media_reach",
  "instagram_media_likes",
  "instagram_media_comments",
  "instagram_media_saved",
  "instagram_media_total_interactions",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function captionPreview(value: string | null | undefined) {
  if (!value) return "No caption available";
  return value.length > 140 ? `${value.slice(0, 137)}...` : value;
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
    .at(-1)?.metric_value ?? 0;
}

function parseSnapshotPayload(sourceId: string, row: Pick<RawIngestion, "fetched_at" | "payload">): InstagramSnapshot | null {
  const payload = row.payload;
  if (!isRecord(payload) || payload.kind !== "instagram_sync_snapshot" || !isRecord(payload.account)) return null;
  const account = payload.account;
  const mediaValues = Array.isArray(payload.media) ? payload.media : [];
  return {
    sourceId,
    fetchedAt: row.fetched_at,
    graphApiVersion: textValue(payload.graphApiVersion),
    account: {
      id: textValue(account.id),
      username: textValue(account.username),
      followersCount: nullableNumber(account.followers_count),
      mediaCount: nullableNumber(account.media_count),
      pageId: textValue(account.page_id),
    },
    media: mediaValues.flatMap((item) => {
      if (!isRecord(item)) return [];
      const id = textValue(item.id);
      if (!id) return [];
      const insights = isRecord(item.insights) ? item.insights : {};
      return [{
        id,
        caption: textValue(item.caption),
        mediaType: textValue(item.media_type) ?? "media",
        permalink: textValue(item.permalink) ?? textValue(item.media_url),
        timestamp: textValue(item.timestamp),
        likeCount: numberValue(item.like_count),
        commentsCount: numberValue(item.comments_count),
        insights: {
          reach: numberValue(insights.reach),
          saved: numberValue(insights.saved),
          totalInteractions: numberValue(insights.total_interactions),
        },
      }];
    }),
  };
}

async function listLatestSnapshots(dataSpaceId: string | undefined, sourceIds: Set<string>): Promise<InstagramSnapshot[]> {
  if (sourceIds.size === 0) return [];

  if (!isRuntimeDatabaseConfigured()) {
    const snapshots = getDemoStore().rawIngestions
      .filter((row) => row.source_id && sourceIds.has(row.source_id) && row.source_type_key === "instagram")
      .map((row) => parseSnapshotPayload(row.source_id!, row))
      .filter((snapshot): snapshot is InstagramSnapshot => Boolean(snapshot))
      .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt));
    const seen = new Set<string>();
    return snapshots.filter((snapshot) => {
      if (seen.has(snapshot.sourceId)) return false;
      seen.add(snapshot.sourceId);
      return true;
    });
  }

  const values: unknown[] = [];
  const where = [
    "s.source_type_key = 'instagram'",
    "r.source_id is not null",
    "r.payload->>'kind' = 'instagram_sync_snapshot'",
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
    if (!row.source_id || seen.has(row.source_id) || !sourceIds.has(row.source_id)) return [];
    const snapshot = parseSnapshotPayload(row.source_id, row);
    if (!snapshot) return [];
    seen.add(row.source_id);
    return [snapshot];
  });
}

function mediaFromContent(items: ContentItem[], metrics: ContentMetric[], sourceId: string): InstagramMediaInsightRow[] {
  return items
    .filter((item) => item.source_id === sourceId && item.source_type_key === "instagram")
    .map((item) => {
      const reach = latestContentMetricValue(metrics, item.id, "instagram_media_reach");
      const saved = latestContentMetricValue(metrics, item.id, "instagram_media_saved");
      const totalInteractions = latestContentMetricValue(metrics, item.id, "instagram_media_total_interactions");
      return {
        id: item.id,
        sourceId,
        externalContentId: item.external_content_id,
        captionPreview: captionPreview(item.caption ?? item.title),
        mediaType: item.content_type,
        url: item.url,
        publishedAt: item.published_at,
        reach,
        likes: latestContentMetricValue(metrics, item.id, "instagram_media_likes"),
        comments: latestContentMetricValue(metrics, item.id, "instagram_media_comments"),
        saved,
        totalInteractions,
      };
    })
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""));
}

function mediaFromSnapshot(snapshot: InstagramSnapshot | undefined, sourceId: string): InstagramMediaInsightRow[] {
  if (!snapshot) return [];
  return snapshot.media
    .map((media) => ({
      id: media.id,
      sourceId,
      externalContentId: media.id,
      captionPreview: captionPreview(media.caption),
      mediaType: media.mediaType,
      url: media.permalink,
      publishedAt: media.timestamp,
      reach: media.insights.reach,
      likes: media.likeCount,
      comments: media.commentsCount,
      saved: media.insights.saved,
      totalInteractions: media.insights.totalInteractions,
    }))
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""));
}

function sumMedia(media: InstagramMediaInsightRow[]) {
  const totals = media.reduce(
    (acc, item) => ({
      reach: acc.reach + item.reach,
      likes: acc.likes + item.likes,
      comments: acc.comments + item.comments,
      saved: acc.saved + item.saved,
      totalInteractions: acc.totalInteractions + item.totalInteractions,
    }),
    { reach: 0, likes: 0, comments: 0, saved: 0, totalInteractions: 0 },
  );
  return {
    ...totals,
    engagementRate: totals.reach > 0 ? (totals.totalInteractions / totals.reach) * 100 : null,
  };
}

export async function getInstagramDashboardSummary(options: { dataSpaceId?: string } = {}): Promise<InstagramDashboardSummary> {
  const [sources, contentItems, contentMetrics, accountMetrics] = await Promise.all([
    listSources({ dataSpaceId: options.dataSpaceId }),
    listContentItems({ dataSpaceId: options.dataSpaceId }),
    listContentMetrics({ dataSpaceId: options.dataSpaceId }),
    listMetrics({ metricKeys: [...ACCOUNT_METRIC_KEYS, ...MEDIA_METRIC_KEYS, "instagram_engagement_rate"], sourceTypeKey: "instagram", dataSpaceId: options.dataSpaceId }),
  ]);
  const instagramSources = sources.filter((source) => source.source_type_key === "instagram");
  const sourceIds = new Set(instagramSources.map((source) => source.id));
  const snapshots = await listLatestSnapshots(options.dataSpaceId, sourceIds);
  const snapshotBySourceId = new Map(snapshots.map((snapshot) => [snapshot.sourceId, snapshot]));

  const sourcesWithInsights = instagramSources.map((source) => {
    const snapshot = snapshotBySourceId.get(source.id);
    const contentMedia = mediaFromContent(contentItems, contentMetrics, source.id);
    const hasInstagramContentMetrics = contentMetrics.some((metric) => metric.source_id === source.id && MEDIA_METRIC_KEYS.includes(metric.metric_key as (typeof MEDIA_METRIC_KEYS)[number]));
    const media = hasInstagramContentMetrics ? contentMedia : mediaFromSnapshot(snapshot, source.id);
    const totals = sumMedia(media);
    const followers = snapshot?.account?.followersCount ?? latestMetricValue(accountMetrics, source.id, "instagram_followers");
    const accountMediaCount = snapshot?.account?.mediaCount ?? latestMetricValue(accountMetrics, source.id, "instagram_media_count");
    const tokenExpiresAt = typeof source.metadata.token_expires_at === "string" ? source.metadata.token_expires_at : null;
    return {
      sourceId: source.id,
      displayName: source.display_name,
      status: source.status,
      username: snapshot?.account?.username ?? source.account_name,
      accountId: snapshot?.account?.id ?? source.external_account_id,
      pageId: snapshot?.account?.pageId ?? (typeof source.metadata.page_id === "string" ? source.metadata.page_id : null),
      graphApiVersion: snapshot?.graphApiVersion ?? (typeof source.metadata.graph_api_version === "string" ? source.metadata.graph_api_version : null),
      lastSyncedAt: snapshot?.fetchedAt ?? source.last_success_at ?? null,
      tokenExpiresAt,
      lastError: source.last_error,
      stats: {
        followers,
        accountMediaCount,
        fetchedMediaCount: media.length,
        ...totals,
      },
      media: media.slice(0, 12),
    } satisfies InstagramDashboardSource;
  });

  const aggregateMedia = sourcesWithInsights.flatMap((source) => source.media);
  const totals = sumMedia(aggregateMedia);
  return {
    sources: sourcesWithInsights,
    totals: {
      sourceCount: sourcesWithInsights.length,
      fetchedMediaCount: aggregateMedia.length,
      ...totals,
    },
  };
}
