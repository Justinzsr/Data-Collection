import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getInstagramDashboardSummary } from "@/aggregation/services/instagram-dashboard-service";
import {
  AUTO_LAB_INSTAGRAM_ACCOUNT_ID,
  AUTO_LAB_INSTAGRAM_SOURCE_ID,
  AUTO_LAB_INSTAGRAM_USERNAME,
  AUTO_LAB_FACEBOOK_PAGE_ID,
} from "@/collection/connectors/instagram/constants";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { ContentItem, ContentMetric, JsonRecord, RawIngestion, Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";

const MOONARQ_INSTAGRAM_SOURCE_ID = "99999999-9999-4999-8999-999999999999";
const MEDIA_ID = "18112617760837714";
const NOW = "2026-05-09T06:04:00.000Z";

function hash(payload: JsonRecord) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function makeSource(input: { id: string; dataSpaceId: string; displayName: string; accountName: string; status?: Source["status"] }): Source {
  return {
    id: input.id,
    data_space_id: input.dataSpaceId,
    source_type_key: "instagram",
    display_name: input.displayName,
    input_url: `https://www.instagram.com/${input.accountName}`,
    normalized_url: `https://www.instagram.com/${input.accountName}`,
    external_account_id: input.id === AUTO_LAB_INSTAGRAM_SOURCE_ID ? AUTO_LAB_INSTAGRAM_ACCOUNT_ID : null,
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
      instagram_username: input.accountName,
      token_expires_at: "2026-07-08T06:04:00.000Z",
    },
    created_at: NOW,
    updated_at: NOW,
  };
}

function makeSnapshot(sourceId: string, accountName: string, data: { followers: number; mediaCount: number; reach: number; likes: number; comments: number; saved: number; interactions: number }): RawIngestion {
  const payload = {
    kind: "instagram_sync_snapshot",
    account: {
      id: sourceId === AUTO_LAB_INSTAGRAM_SOURCE_ID ? AUTO_LAB_INSTAGRAM_ACCOUNT_ID : "not-auto-lab",
      username: accountName,
      followers_count: data.followers,
      media_count: data.mediaCount,
      page_id: sourceId === AUTO_LAB_INSTAGRAM_SOURCE_ID ? AUTO_LAB_FACEBOOK_PAGE_ID : null,
    },
    media: [
      {
        id: MEDIA_ID,
        caption: "First shakedown clip for the Auto Lab IS350.",
        media_type: "VIDEO",
        permalink: "https://www.instagram.com/p/test-media/",
        timestamp: "2026-04-22T12:00:00+0000",
        like_count: data.likes,
        comments_count: data.comments,
        insights: {
          reach: data.reach,
          saved: data.saved,
          total_interactions: data.interactions,
        },
      },
    ],
    graphApiVersion: "v25.0",
    fetchedAt: NOW,
    instagram_long_lived_access_token: "secret-token-that-must-not-leak",
  } satisfies JsonRecord;
  return {
    id: sourceId,
    source_id: sourceId,
    source_type_key: "instagram",
    external_id: `instagram:${sourceId}:2026-05-09`,
    fetched_at: NOW,
    payload,
    payload_hash: hash(payload),
    status: "stored",
    cursor: { fetchedAt: NOW },
    created_at: NOW,
  };
}

function makeContentMetric(item: ContentItem, metricKey: string, value: number): ContentMetric {
  const dimensions = { account_id: AUTO_LAB_INSTAGRAM_ACCOUNT_ID, media_type: "VIDEO" };
  return {
    id: `${item.id}-${metricKey}`,
    date: "2026-04-22",
    content_item_id: item.id,
    source_id: item.source_id,
    source_type_key: "instagram",
    metric_key: metricKey,
    metric_value: value,
    unit: "count",
    dimensions,
    created_at: NOW,
    updated_at: NOW,
  };
}

describe("instagram dashboard service", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetDemoStore();
  });

  it("summarizes Auto Lab Instagram metrics without leaking MoonArq or credential data", async () => {
    const store = getDemoStore();
    store.sources.push(
      makeSource({ id: AUTO_LAB_INSTAGRAM_SOURCE_ID, dataSpaceId: DATA_SPACE_IDS.autoLab, displayName: "Auto Lab Instagram", accountName: AUTO_LAB_INSTAGRAM_USERNAME }),
      makeSource({ id: MOONARQ_INSTAGRAM_SOURCE_ID, dataSpaceId: DATA_SPACE_IDS.moonarq, displayName: "MoonArq Test Instagram", accountName: "moonarq" }),
    );
    store.rawIngestions.push(
      makeSnapshot(AUTO_LAB_INSTAGRAM_SOURCE_ID, AUTO_LAB_INSTAGRAM_USERNAME, { followers: 428, mediaCount: 17, reach: 100, likes: 27, comments: 3, saved: 0, interactions: 30 }),
      makeSnapshot(MOONARQ_INSTAGRAM_SOURCE_ID, "moonarq", { followers: 9000, mediaCount: 200, reach: 8000, likes: 700, comments: 80, saved: 22, interactions: 802 }),
    );
    const item: ContentItem = {
      id: "content-auto-lab-media",
      source_id: AUTO_LAB_INSTAGRAM_SOURCE_ID,
      source_type_key: "instagram",
      external_content_id: MEDIA_ID,
      content_type: "VIDEO",
      title: "First shakedown clip for the Auto Lab IS350.",
      caption: "First shakedown clip for the Auto Lab IS350.",
      url: "https://www.instagram.com/p/test-media/",
      thumbnail_url: null,
      published_at: "2026-04-22T12:00:00+0000",
      metadata: { account_id: AUTO_LAB_INSTAGRAM_ACCOUNT_ID },
      created_at: NOW,
      updated_at: NOW,
    };
    store.contentItems.push(item);
    store.contentMetrics.push(
      makeContentMetric(item, "instagram_media_reach", 100),
      makeContentMetric(item, "instagram_media_likes", 27),
      makeContentMetric(item, "instagram_media_comments", 3),
      makeContentMetric(item, "instagram_media_saved", 0),
      makeContentMetric(item, "instagram_media_total_interactions", 30),
    );

    const summary = await getInstagramDashboardSummary({ dataSpaceId: DATA_SPACE_IDS.autoLab });
    const body = JSON.stringify(summary);

    expect(summary.sources).toHaveLength(1);
    expect(summary.sources[0]).toMatchObject({
      sourceId: AUTO_LAB_INSTAGRAM_SOURCE_ID,
      username: AUTO_LAB_INSTAGRAM_USERNAME,
      accountId: AUTO_LAB_INSTAGRAM_ACCOUNT_ID,
      pageId: AUTO_LAB_FACEBOOK_PAGE_ID,
      graphApiVersion: "v25.0",
      stats: {
        followers: 428,
        accountMediaCount: 17,
        fetchedMediaCount: 1,
        reach: 100,
        likes: 27,
        comments: 3,
        saved: 0,
        totalInteractions: 30,
        engagementRate: 30,
      },
    });
    expect(summary.sources[0].media[0]).toMatchObject({
      externalContentId: MEDIA_ID,
      captionPreview: "First shakedown clip for the Auto Lab IS350.",
      reach: 100,
      likes: 27,
      comments: 3,
      totalInteractions: 30,
    });
    expect(body).not.toContain("MoonArq Test Instagram");
    expect(body).not.toContain("secret-token-that-must-not-leak");
  });
});
