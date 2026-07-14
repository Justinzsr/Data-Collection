import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getTikTokDashboardSummary } from "@/aggregation/services/tiktok-dashboard-service";
import { AUTO_LAB_TIKTOK_SOURCE_ID } from "@/collection/connectors/tiktok/constants";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { ContentItem, ContentMetric, JsonRecord, MetricDaily, RawIngestion, Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";

const MOONARQ_TIKTOK_SOURCE_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-05-11T18:30:00.000Z";

function hash(payload: JsonRecord) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function makeSource(input: { id: string; dataSpaceId: string; displayName: string; accountName: string; status?: Source["status"] }): Source {
  return {
    id: input.id,
    data_space_id: input.dataSpaceId,
    source_type_key: "tiktok",
    display_name: input.displayName,
    input_url: `https://www.tiktok.com/@${input.accountName}`,
    normalized_url: `https://www.tiktok.com/@${input.accountName}`,
    external_account_id: input.id === AUTO_LAB_TIKTOK_SOURCE_ID ? "open-id-auto-lab-tiktok" : "open-id-moonarq-tiktok",
    account_name: input.accountName,
    status: input.status ?? "healthy",
    sync_mode: "manual",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: NOW,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: NOW,
    last_error_at: null,
    last_error: null,
    next_sync_at: null,
    metadata: {
      oauth_connected: true,
      tiktok_username: input.accountName,
      tiktok_display_name: input.displayName,
      tiktok_scopes: "user.info.basic,user.info.profile,user.info.stats,video.list",
      token_expires_at: "2026-06-10T18:30:00.000Z",
    },
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeMetric(sourceId: string, metricKey: string, value: number): MetricDaily {
  const dimensions = { rollup: "account_snapshot" };
  return {
    id: `${sourceId}-${metricKey}`,
    date: "2026-05-11",
    source_id: sourceId,
    source_type_key: "tiktok",
    metric_key: metricKey,
    metric_value: value,
    unit: metricKey.includes("rate") ? "percent" : "count",
    dimensions,
    dimensions_hash: hash(dimensions),
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeVideoItem(sourceId: string, input: { id: string; title: string; caption: string; url: string }): ContentItem {
  return {
    id: `${sourceId}-${input.id}`,
    source_id: sourceId,
    source_type_key: "tiktok",
    external_content_id: input.id,
    content_type: "video",
    title: input.title,
    caption: input.caption,
    url: input.url,
    thumbnail_url: "https://example.com/cover.jpg",
    published_at: "2026-05-10T12:00:00.000Z",
    metadata: { open_id: sourceId === AUTO_LAB_TIKTOK_SOURCE_ID ? "open-id-auto-lab-tiktok" : "open-id-moonarq-tiktok" },
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeContentMetric(item: ContentItem, metricKey: string, value: number): ContentMetric {
  return {
    id: `${item.id}-${metricKey}`,
    date: "2026-05-10",
    content_item_id: item.id,
    source_id: item.source_id,
    source_type_key: "tiktok",
    metric_key: metricKey,
    metric_value: value,
    unit: metricKey.includes("rate") ? "percent" : "count",
    dimensions: { open_id: item.metadata.open_id ?? "unknown" },
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeSnapshot(sourceId: string, input: { username: string; views: number; likes: number; comments: number; shares: number; followers: number; videoCount: number; profileLikes: number }): RawIngestion {
  const payload = {
    kind: "tiktok_sync_snapshot",
    sourceId,
    fetchedAt: NOW,
    account: {
      open_id: sourceId === AUTO_LAB_TIKTOK_SOURCE_ID ? "open-id-auto-lab-tiktok" : "open-id-moonarq-tiktok",
      username: input.username,
      display_name: input.username,
      follower_count: input.followers,
      video_count: input.videoCount,
      likes_count: input.profileLikes,
    },
    videos: [
      {
        id: "video-1",
        title: "IS350 shakedown",
        video_description: "IS350 canyon shakedown.",
        share_url: "https://www.tiktok.com/@just_4is/video/1",
        create_time: 1_779_120_000,
        view_count: input.views,
        like_count: input.likes,
        comment_count: input.comments,
        share_count: input.shares,
      },
    ],
    scopes: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
    apiBaseUrl: "https://open.tiktokapis.com",
    tiktok_access_token: "secret-token-that-must-not-leak",
  } satisfies JsonRecord;
  return {
    id: `raw-${sourceId}`,
    source_id: sourceId,
    source_type_key: "tiktok",
    external_id: `tiktok:${sourceId}:2026-05-11`,
    fetched_at: NOW,
    payload,
    payload_hash: hash(payload),
    status: "stored",
    cursor: { fetchedAt: NOW },
    created_at: NOW,
  };
}

describe("tiktok dashboard service", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetDemoStore();
  });

  it("summarizes Auto Lab TikTok metrics and videos without leaking MoonArq or credential data", async () => {
    const store = getDemoStore();
    const autoLabVideo = makeVideoItem(AUTO_LAB_TIKTOK_SOURCE_ID, {
      id: "video-1",
      title: "IS350 shakedown",
      caption: "IS350 canyon shakedown.",
      url: "https://www.tiktok.com/@just_4is/video/1",
    });
    const moonarqVideo = makeVideoItem(MOONARQ_TIKTOK_SOURCE_ID, {
      id: "moon-video-1",
      title: "MoonArq launch clip",
      caption: "MoonArq should not leak into Auto Lab.",
      url: "https://www.tiktok.com/@moonarq/video/1",
    });
    store.sources.push(
      makeSource({ id: AUTO_LAB_TIKTOK_SOURCE_ID, dataSpaceId: DATA_SPACE_IDS.autoLab, displayName: "Auto Lab TikTok", accountName: "just_4is" }),
      makeSource({ id: MOONARQ_TIKTOK_SOURCE_ID, dataSpaceId: DATA_SPACE_IDS.moonarq, displayName: "MoonArq TikTok", accountName: "moonarq" }),
    );
    store.rawIngestions.push(
      makeSnapshot(AUTO_LAB_TIKTOK_SOURCE_ID, { username: "just_4is", views: 1000, likes: 42, comments: 5, shares: 3, followers: 321, videoCount: 9, profileLikes: 1200 }),
      makeSnapshot(MOONARQ_TIKTOK_SOURCE_ID, { username: "moonarq", views: 9000, likes: 500, comments: 50, shares: 40, followers: 8000, videoCount: 60, profileLikes: 12000 }),
    );
    store.metricsDaily.push(
      makeMetric(AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_followers", 321),
      makeMetric(AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_video_count", 9),
      makeMetric(AUTO_LAB_TIKTOK_SOURCE_ID, "tiktok_profile_likes", 1200),
      makeMetric(MOONARQ_TIKTOK_SOURCE_ID, "tiktok_followers", 8000),
    );
    store.contentItems.push(autoLabVideo, moonarqVideo);
    store.contentMetrics.push(
      makeContentMetric(autoLabVideo, "tiktok_video_views", 1000),
      makeContentMetric(autoLabVideo, "tiktok_likes", 42),
      makeContentMetric(autoLabVideo, "tiktok_comments", 5),
      makeContentMetric(autoLabVideo, "tiktok_shares", 3),
      makeContentMetric(autoLabVideo, "tiktok_engagement_rate", 5),
      makeContentMetric(moonarqVideo, "tiktok_video_views", 9000),
      makeContentMetric(moonarqVideo, "tiktok_likes", 500),
    );

    const summary = await getTikTokDashboardSummary({ dataSpaceId: DATA_SPACE_IDS.autoLab });
    const body = JSON.stringify(summary);

    expect(summary.sources).toHaveLength(1);
    expect(summary.sources[0]).toMatchObject({
      sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
      username: "just_4is",
      openId: "open-id-auto-lab-tiktok",
      scopes: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
      stats: {
        followers: 321,
        videoCount: 9,
        profileLikes: 1200,
        fetchedVideoCount: 1,
        videoViews: 1000,
        likes: 42,
        comments: 5,
        shares: 3,
        engagementRate: 5,
      },
    });
    expect(summary.sources[0].videos[0]).toMatchObject({
      externalContentId: "video-1",
      title: "IS350 shakedown",
      description: "IS350 canyon shakedown.",
      views: 1000,
      likes: 42,
      comments: 5,
      shares: 3,
      engagementRate: 5,
    });
    expect(body).not.toContain("MoonArq TikTok");
    expect(body).not.toContain("MoonArq launch clip");
    expect(body).not.toContain("secret-token-that-must-not-leak");
  });

  it("uses the latest raw snapshot as current truth and excludes stale persisted videos", async () => {
    const store = getDemoStore();
    const currentVideo = makeVideoItem(AUTO_LAB_TIKTOK_SOURCE_ID, {
      id: "video-1",
      title: "Persisted current video",
      caption: "This stored copy has older counters.",
      url: "https://www.tiktok.com/@just_4is/video/1",
    });
    const staleVideo = makeVideoItem(AUTO_LAB_TIKTOK_SOURCE_ID, {
      id: "stale-video",
      title: "Historical video",
      caption: "This video is absent from the latest API snapshot.",
      url: "https://www.tiktok.com/@just_4is/video/stale",
    });
    store.sources.push(
      makeSource({ id: AUTO_LAB_TIKTOK_SOURCE_ID, dataSpaceId: DATA_SPACE_IDS.autoLab, displayName: "Auto Lab TikTok", accountName: "just_4is" }),
    );
    store.rawIngestions.push(
      makeSnapshot(AUTO_LAB_TIKTOK_SOURCE_ID, { username: "just_4is", views: 100, likes: 10, comments: 2, shares: 1, followers: 423, videoCount: 1, profileLikes: 15070 }),
    );
    store.contentItems.push(currentVideo, staleVideo);
    store.contentMetrics.push(
      makeContentMetric(currentVideo, "tiktok_video_views", 900),
      makeContentMetric(currentVideo, "tiktok_likes", 90),
      makeContentMetric(staleVideo, "tiktok_video_views", 5000),
      makeContentMetric(staleVideo, "tiktok_likes", 500),
    );

    const summary = await getTikTokDashboardSummary({ dataSpaceId: DATA_SPACE_IDS.autoLab });

    expect(summary.sources[0].videos).toHaveLength(1);
    expect(summary.sources[0].videos[0]).toMatchObject({
      externalContentId: "video-1",
      title: "IS350 shakedown",
      views: 100,
      likes: 10,
      comments: 2,
      shares: 1,
      engagementRate: 13,
    });
    expect(summary.sources[0].stats).toMatchObject({
      fetchedVideoCount: 1,
      videoViews: 100,
      likes: 10,
      comments: 2,
      shares: 1,
      engagementRate: 13,
    });
    expect(summary.totals).toMatchObject({ fetchedVideoCount: 1, videoViews: 100, likes: 10, comments: 2, shares: 1, engagementRate: 13 });
  });

  it("keeps the Auto Lab TikTok source visible with waiting values when scopes or video data are missing", async () => {
    const store = getDemoStore();
    store.sources.push(
      makeSource({
        id: AUTO_LAB_TIKTOK_SOURCE_ID,
        dataSpaceId: DATA_SPACE_IDS.autoLab,
        displayName: "Auto Lab TikTok",
        accountName: "just_4is",
        status: "needs_credentials",
      }),
    );

    const summary = await getTikTokDashboardSummary({ dataSpaceId: DATA_SPACE_IDS.autoLab });

    expect(summary.sources).toHaveLength(1);
    expect(summary.sources[0].videos).toHaveLength(0);
    expect(summary.sources[0].stats).toMatchObject({
      followers: null,
      videoCount: null,
      profileLikes: null,
      fetchedVideoCount: 0,
      videoViews: null,
      likes: null,
      comments: null,
      shares: null,
      engagementRate: null,
    });
  });
});
