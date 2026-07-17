import { beforeEach, describe, expect, it } from "vitest";
import { MOONARQ_FIRST_STORY_UTM } from "@/aggregation/services/meta-ads-attribution-service";
import type { JsonRecord, WebEvent } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { countWebPageViewsByUtm } from "@/storage/repositories/events-repository";
import { endOfAppDateUtc, startOfAppDateUtc } from "@/storage/runtime/app-time";

function webEvent(
  id: string,
  anonymousId: string,
  properties: JsonRecord,
  url: string,
  occurredAt = "2026-07-15T20:00:00.000Z",
  sourceId = "website-source",
): WebEvent {
  return {
    id,
    event_id: id,
    schema_version: "legacy",
    event_source: "first_party_tracker",
    source_id: sourceId,
    public_tracking_key: null,
    anonymous_id: anonymousId,
    session_id: `session-${id}`,
    user_id: null,
    event_name: "page_view",
    path: "/core-collection",
    url,
    referrer: null,
    user_agent: null,
    ip_hash: null,
    country: null,
    device_type: null,
    properties,
    attribution_context: {},
    consent_status: { analytics: "unknown", marketing: "unknown" },
    client_context: {},
    occurred_at: occurredAt,
    received_at: occurredAt,
    created_at: occurredAt,
  };
}

describe("web event UTM aggregation", () => {
  beforeEach(() => resetDemoStore());

  it("counts exact normalized and legacy page views without double-counting visitors", async () => {
    getDemoStore().webEvents.push(
      webEvent("normalized", "visitor-1", { attribution: { utm: MOONARQ_FIRST_STORY_UTM } }, "https://www.moonarqstudio.com/core-collection"),
      webEvent("legacy", "visitor-1", {
        vercel: {
          query_params: JSON.stringify({
            utm_source: "instagram",
            utm_medium: "paid_social",
            utm_campaign: "bracelet_grid_jul2026",
            utm_content: "story_v1",
          }),
        },
      }, "https://www.moonarqstudio.com/core-collection"),
      webEvent("url", "visitor-2", {}, "https://www.moonarqstudio.com/core-collection?utm_source=instagram&utm_medium=paid_social&utm_campaign=bracelet_grid_jul2026&utm_content=story_v1"),
      webEvent("wrong", "visitor-3", { attribution: { utm: { ...MOONARQ_FIRST_STORY_UTM, content: "feed_v1" } } }, "https://www.moonarqstudio.com/core-collection"),
      webEvent("partial-conflict", "visitor-4", { attribution: { utm: { source: "instagram" } } }, "https://www.moonarqstudio.com/core-collection?utm_source=facebook&utm_medium=paid_social&utm_campaign=bracelet_grid_jul2026&utm_content=story_v1"),
      webEvent("anonymous", "", { attribution: { utm: MOONARQ_FIRST_STORY_UTM } }, "https://www.moonarqstudio.com/core-collection"),
    );

    const counts = await countWebPageViewsByUtm({
      sourceId: "website-source",
      startOccurredAt: "2026-07-15T00:00:00.000Z",
      endOccurredAt: "2026-07-15T23:59:59.999Z",
      utm: MOONARQ_FIRST_STORY_UTM,
    });

    expect(counts).toEqual({
      pageViews: 4,
      visitors: 2,
      eligibleReturnDevices1d: 0,
      returningDevices1d: 0,
      eligibleReturnDevices7d: 0,
      returningDevices7d: 0,
    });
  });

  it("counts PT-calendar 1d and 7d return devices without right-censoring or placeholder identities", async () => {
    const exactProperties = { attribution: { utm: MOONARQ_FIRST_STORY_UTM } };
    const landingUrl = "https://www.moonarqstudio.com/core-collection";
    const plainUrl = "https://www.moonarqstudio.com/pages/about";
    getDemoStore().webEvents.push(
      webEvent("return-1-touch", "return-1", exactProperties, landingUrl, "2026-07-01T20:00:00.000Z"),
      webEvent("return-1-next-day", "return-1", {}, plainUrl, "2026-07-02T20:00:00.000Z"),
      webEvent("return-7-touch", "return-7", exactProperties, landingUrl, "2026-07-02T20:00:00.000Z"),
      webEvent("return-7-day-seven", "return-7", {}, plainUrl, "2026-07-09T20:00:00.000Z"),
      webEvent("no-return-touch", "no-return", exactProperties, landingUrl, "2026-07-03T20:00:00.000Z"),
      webEvent("no-return-same-day", "no-return", {}, plainUrl, "2026-07-03T22:00:00.000Z"),
      webEvent("no-return-other-source", "no-return", {}, plainUrl, "2026-07-04T20:00:00.000Z", "other-source"),
      webEvent("one-day-only-touch", "one-day-only", exactProperties, landingUrl, "2026-07-10T20:00:00.000Z"),
      webEvent("one-day-only-return", "one-day-only", {}, plainUrl, "2026-07-11T20:00:00.000Z"),
      webEvent("right-censored-touch", "right-censored", exactProperties, landingUrl, "2026-07-15T20:00:00.000Z"),
      webEvent("placeholder-touch", "vercel-device", exactProperties, landingUrl, "2026-07-01T21:00:00.000Z"),
      webEvent("placeholder-return", "vercel-device", {}, plainUrl, "2026-07-02T21:00:00.000Z"),
      webEvent("empty-touch", "", exactProperties, landingUrl, "2026-07-01T22:00:00.000Z"),
      webEvent("pre-range-first-touch", "preexisting", exactProperties, landingUrl, "2026-06-30T20:00:00.000Z"),
      webEvent("preexisting-repeat-utm", "preexisting", exactProperties, landingUrl, "2026-07-04T20:00:00.000Z"),
      webEvent("preexisting-return", "preexisting", {}, plainUrl, "2026-07-05T20:00:00.000Z"),
    );

    const counts = await countWebPageViewsByUtm({
      sourceId: "website-source",
      startOccurredAt: startOfAppDateUtc("2026-07-01"),
      endOccurredAt: endOfAppDateUtc("2026-07-15"),
      utm: MOONARQ_FIRST_STORY_UTM,
    });

    expect(counts).toEqual({
      pageViews: 8,
      visitors: 6,
      eligibleReturnDevices1d: 4,
      returningDevices1d: 2,
      eligibleReturnDevices7d: 3,
      returningDevices7d: 2,
    });
  });
});
