import { beforeEach, describe, expect, it } from "vitest";
import type { NormalizedContentMetric } from "@/collection/connectors/types";
import { upsertContentMetrics } from "@/storage/repositories/content-repository";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

function videoMetric(
  metricKey: string,
  metricValue: number,
  overrides: Partial<NormalizedContentMetric> = {},
): NormalizedContentMetric {
  return {
    date: "2026-07-14",
    sourceId: DEMO_SOURCE_IDS.tiktok,
    sourceTypeKey: "tiktok",
    externalContentId: "video-one",
    contentType: "video",
    title: "Video one",
    publishedAt: "2026-07-13T18:00:00.000Z",
    metricKey,
    metricValue,
    unit: "count",
    dimensions: { width: 1080, height: 1920 },
    ...overrides,
  };
}

describe("content upsert accounting", () => {
  beforeEach(() => resetDemoStore());

  it("counts one content item once even when several metrics are upserted", async () => {
    const first = await upsertContentMetrics([
      videoMetric("tiktok_video_views", 100),
      videoMetric("tiktok_likes", 10),
      videoMetric("tiktok_comments", 2),
    ]);

    expect(first).toEqual({
      itemsInserted: 1,
      itemsUpdated: 0,
      metricsUpserted: 3,
    });
    expect(getDemoStore().contentItems.filter((item) => item.external_content_id === "video-one")).toHaveLength(1);

    const second = await upsertContentMetrics([
      videoMetric("tiktok_video_views", 120),
      videoMetric("tiktok_likes", 12),
      videoMetric("tiktok_comments", 3),
    ]);

    expect(second).toEqual({
      itemsInserted: 0,
      itemsUpdated: 1,
      metricsUpserted: 3,
    });
    expect(getDemoStore().contentMetrics.filter((metric) => metric.content_item_id === getDemoStore().contentItems.find((item) => item.external_content_id === "video-one")?.id)).toHaveLength(3);
  });

  it("preserves richer item fields and merged metadata from later metrics in a group", async () => {
    await upsertContentMetrics([
      videoMetric("tiktok_video_views", 100, {
        title: null,
        dimensions: { width: 1080 },
      }),
      videoMetric("tiktok_likes", 10, {
        title: "Richer title",
        thumbnailUrl: "https://example.com/video-one.jpg",
        dimensions: { height: 1920 },
      }),
    ]);

    expect(getDemoStore().contentItems.find((item) => item.external_content_id === "video-one")).toMatchObject({
      title: "Richer title",
      thumbnail_url: "https://example.com/video-one.jpg",
      metadata: { width: 1080, height: 1920 },
    });
  });
});
