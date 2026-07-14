import { describe, expect, it } from "vitest";
import { tiktokConnector } from "@/collection/connectors/tiktok/connector";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";

function source(): Source {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    data_space_id: DATA_SPACE_IDS.autoLab,
    source_type_key: "tiktok",
    display_name: "Auto Lab TikTok",
    input_url: "https://www.tiktok.com/@just_4is",
    normalized_url: "https://www.tiktok.com/@just_4is",
    external_account_id: "open-id-auto-lab",
    account_name: "just_4is",
    status: "healthy",
    sync_mode: "hourly",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    next_sync_at: null,
    metadata: { oauth_connected: true },
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

describe("TikTok normalization integrity", () => {
  it("uses the Los Angeles date and preserves absent video statistics as missing", async () => {
    const fetchedAt = "2026-07-15T06:30:00.000Z"; // Jul 14, 11:30 PM PDT
    const result = await tiktokConnector.normalize(
      [
        {
          fetchedAt,
          payload: {
            kind: "tiktok_sync_snapshot",
            sourceId: source().id,
            fetchedAt,
            account: {
              open_id: "open-id-auto-lab",
              username: "just_4is",
              follower_count: 423,
              video_count: 1,
            },
            videos: [
              {
                id: "video-with-partial-stats",
                title: "Partial scope response",
                view_count: 1560,
              },
            ],
            scopes: ["user.info.basic", "video.list"],
            apiBaseUrl: "https://open.tiktokapis.com",
          } as JsonRecord,
        },
      ],
      source(),
    );

    expect(result.metrics.filter((metric) => metric.metricKey === "tiktok_followers")).toEqual([
      expect.objectContaining({ date: "2026-07-14", metricValue: 423 }),
    ]);
    expect(result.metrics.find((metric) => metric.metricKey === "tiktok_video_views")).toMatchObject({
      date: "2026-07-14",
      metricValue: 1560,
    });
    expect(result.metrics.map((metric) => metric.metricKey)).not.toEqual(
      expect.arrayContaining(["tiktok_likes", "tiktok_comments", "tiktok_shares", "tiktok_engagement_rate", "tiktok_profile_likes"]),
    );
    expect(result.contentMetrics).toEqual([
      expect.objectContaining({
        date: "2026-07-14",
        externalContentId: "video-with-partial-stats",
        metricKey: "tiktok_video_views",
        metricValue: 1560,
        dimensions: {
          open_id: "open-id-auto-lab",
          duration: null,
          width: null,
          height: null,
        },
      }),
    ]);
  });
});
