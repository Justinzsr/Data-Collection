import { beforeEach, describe, expect, it } from "vitest";
import { ingestTrackEvent } from "@/collection/tracking/track-endpoint";
import { generateReactHelper, generateTrackingSnippet } from "@/collection/tracking/snippet-generator";
import { resetDemoStore } from "@/storage/repositories/demo-store";
import { listMetrics } from "@/storage/repositories/metrics-repository";

const baseEvent = {
  public_tracking_key: "mq_demo_public_website",
  anonymous_id: "anon-test",
  session_id: "session-test",
  event_name: "page_view",
  path: "/",
  url: "https://example.com/",
  referrer: null,
  properties: {},
  occurred_at: "2026-04-22T12:00:00.000Z",
};

describe("website tracker validation", () => {
  beforeEach(() => resetDemoStore());

  it("accepts valid page_view events", async () => {
    const event = await ingestTrackEvent(baseEvent, { origin: "https://example.com" });
    expect(event.event_name).toBe("page_view");
    expect(event.ip_hash).toBeNull();
  });

  it("rejects overlong event names", async () => {
    await expect(
      ingestTrackEvent({ ...baseEvent, event_name: "x".repeat(90) }, { origin: "https://example.com" }),
    ).rejects.toThrow();
  });

  it("rejects oversized properties", async () => {
    await expect(
      ingestTrackEvent({ ...baseEvent, properties: { blob: "x".repeat(9000) } }, { origin: "https://example.com" }),
    ).rejects.toThrow(/too large/i);
  });

  it("increments daily page_view rollups and path/referrer breakdowns without event_id dimensions", async () => {
    await ingestTrackEvent(baseEvent, { origin: "https://example.com" });
    await ingestTrackEvent({ ...baseEvent, session_id: "session-two" }, { origin: "https://example.com" });
    const rows = await listMetrics({ metricKeys: ["page_views", "events_by_path", "events_by_referrer"], startDate: "2026-04-22", endDate: "2026-04-22" });
    const pageViews = rows.find((row) => row.metric_key === "page_views" && row.dimensions.rollup === "daily");
    const byPath = rows.find((row) => row.metric_key === "events_by_path" && row.dimensions.path === "/" && row.dimensions.demo !== true);
    const byReferrer = rows.find((row) => row.metric_key === "events_by_referrer" && row.dimensions.referrer === "direct" && row.dimensions.demo !== true);
    expect(pageViews?.metric_value).toBe(2);
    expect(pageViews?.dimensions).not.toHaveProperty("event_id");
    expect(byPath?.metric_value).toBe(2);
    expect(byReferrer?.metric_value).toBe(2);
  });

  it("increments custom event daily rollups", async () => {
    await ingestTrackEvent({ ...baseEvent, event_name: "cta_click", path: "/pricing", referrer: "https://google.com" }, { origin: "https://example.com" });
    await ingestTrackEvent({ ...baseEvent, event_name: "signup_intent", path: "/pricing", referrer: "https://google.com" }, { origin: "https://example.com" });
    const rows = await listMetrics({ metricKeys: ["custom_events", "events_by_path", "events_by_referrer"], startDate: "2026-04-22", endDate: "2026-04-22" });
    const customEvents = rows.find((row) => row.metric_key === "custom_events" && row.dimensions.rollup === "daily");
    const byPath = rows.find((row) => row.metric_key === "events_by_path" && row.dimensions.path === "/pricing" && row.dimensions.demo !== true);
    const byReferrer = rows.find((row) => row.metric_key === "events_by_referrer" && row.dimensions.referrer === "https://google.com" && row.dimensions.demo !== true);
    expect(customEvents?.metric_value).toBe(2);
    expect(customEvents?.dimensions).not.toHaveProperty("event_id");
    expect(byPath?.metric_value).toBe(2);
    expect(byReferrer?.metric_value).toBe(2);
  });

  it("generates copyable tracking snippets", () => {
    const snippet = generateTrackingSnippet({ endpoint: "https://app.example.com/api/track", publicTrackingKey: "mq_public" });
    const helper = generateReactHelper({ endpoint: "https://app.example.com/api/track", publicTrackingKey: "mq_public" });
    expect(snippet.trim().length).toBeGreaterThan(0);
    expect(snippet).toContain("window.moonarqTrack");
    expect(snippet).toContain("moonarq_anonymous_id");
    expect(snippet).toContain("moonarq_session_id");
    expect(snippet).toContain("page_view");
    expect(snippet).toContain("https://app.example.com/api/track");
    expect(snippet).toContain("mq_public");
    expect(helper).toContain("usePageViewTracking");
    expect(helper).toContain("trackEvent");
  });
});
