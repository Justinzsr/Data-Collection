import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestTrackEvent } from "@/collection/tracking/track-endpoint";
import { generateReactHelper, generateTrackingSnippet } from "@/collection/tracking/snippet-generator";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { listWebEvents } from "@/storage/repositories/events-repository";
import { listMetrics } from "@/storage/repositories/metrics-repository";
import { createSource } from "@/storage/repositories/sources-repository";

const baseEvent = {
  public_tracking_key: "mq_demo_public_website",
  anonymous_id: "anon-test",
  session_id: "session-test",
  event_name: "page_view",
  path: "/",
  url: "https://moonarqstudio.com/",
  referrer: null,
  properties: {},
  occurred_at: "2026-04-22T12:00:00.000Z",
};

describe("website tracker validation", () => {
  beforeEach(() => resetDemoStore());

  it("accepts valid page_view events", async () => {
    const event = await ingestTrackEvent(baseEvent, { origin: "https://moonarqstudio.com" });
    expect(event.event_name).toBe("page_view");
    expect(event.ip_hash).toBeNull();
    expect(event.source_id).not.toBeNull();
  });

  it("rejects tracker events without a source id or public tracking key", async () => {
    const eventWithoutKey = { ...baseEvent, public_tracking_key: undefined };
    await expect(ingestTrackEvent(eventWithoutKey, { origin: "https://moonarqstudio.com" })).rejects.toThrow(/source_id or public_tracking_key/i);
  });

  it("rejects unknown public tracking keys", async () => {
    await expect(
      ingestTrackEvent({ ...baseEvent, public_tracking_key: "mq_unknown_key" }, { origin: "https://moonarqstudio.com" }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects disabled website sources before storing an event", async () => {
    const source = await createSource({
      source_type_key: "website",
      display_name: "Disabled Website Tracker",
      input_url: "https://disabled.example",
      normalized_url: "https://disabled.example",
      status: "disabled",
      sync_mode: "webhook",
      supports_webhook: true,
      metadata: { public_tracking_key: "mq_disabled_tracker", allowed_origins: ["https://disabled.example"] },
    });
    const before = (await listWebEvents(100)).length;

    await expect(
      ingestTrackEvent(
        { ...baseEvent, source_id: source.id, public_tracking_key: undefined, url: "https://disabled.example/" },
        { origin: "https://disabled.example" },
      ),
    ).rejects.toThrow(/disabled/i);

    expect((await listWebEvents(100)).length).toBe(before);
  });

  it("rejects planned and non-website sources before storing an event", async () => {
    const [plannedSource, nonWebsiteSource] = await Promise.all([
      createSource({
        source_type_key: "xiaohongshu",
        display_name: "Planned Xiaohongshu",
        input_url: "https://www.xiaohongshu.com/user/profile/test",
        normalized_url: "https://www.xiaohongshu.com/user/profile/test",
        status: "demo",
        sync_mode: "manual",
      }),
      createSource({
        source_type_key: "supabase",
        display_name: "Not a website tracker",
        input_url: "https://project.supabase.co",
        normalized_url: "https://project.supabase.co",
        status: "healthy",
        sync_mode: "webhook",
      }),
    ]);
    const before = (await listWebEvents(100)).length;

    await expect(
      ingestTrackEvent(
        { ...baseEvent, source_id: plannedSource.id, public_tracking_key: undefined },
        { origin: "https://moonarqstudio.com" },
      ),
    ).rejects.toThrow(/planned/i);
    await expect(
      ingestTrackEvent(
        { ...baseEvent, source_id: nonWebsiteSource.id, public_tracking_key: undefined },
        { origin: "https://moonarqstudio.com" },
      ),
    ).rejects.toThrow(/does not accept website tracker events/i);

    expect((await listWebEvents(100)).length).toBe(before);
  });

  it("rejects disallowed origins", async () => {
    await expect(ingestTrackEvent(baseEvent, { origin: "https://evil.example" })).rejects.toThrow(/origin/i);
  });

  it("rejects production tracker events when allowed origins are not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const source = await createSource({
        source_type_key: "website",
        display_name: "Unconfigured Website Tracker",
        input_url: "https://tracker.example",
        normalized_url: "https://tracker.example",
        status: "healthy",
        sync_mode: "webhook",
        supports_webhook: true,
        metadata: { public_tracking_key: "mq_unconfigured", allowed_origins: [] },
      });
      await expect(
        ingestTrackEvent({ ...baseEvent, source_id: source.id, public_tracking_key: undefined }, { origin: "https://tracker.example" }),
      ).rejects.toThrow(/allowed origins/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects overlong event names", async () => {
    await expect(
      ingestTrackEvent({ ...baseEvent, event_name: "x".repeat(90) }, { origin: "https://moonarqstudio.com" }),
    ).rejects.toThrow();
  });

  it("rejects oversized properties", async () => {
    await expect(
      ingestTrackEvent({ ...baseEvent, properties: { blob: "x".repeat(9000) } }, { origin: "https://moonarqstudio.com" }),
    ).rejects.toThrow(/too large/i);
  });

  it("increments daily page_view rollups and path/referrer breakdowns without event_id dimensions", async () => {
    await ingestTrackEvent(baseEvent, { origin: "https://moonarqstudio.com" });
    await ingestTrackEvent({ ...baseEvent, session_id: "session-two" }, { origin: "https://moonarqstudio.com" });
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
    await ingestTrackEvent({ ...baseEvent, event_name: "cta_click", path: "/pricing", referrer: "https://google.com" }, { origin: "https://moonarqstudio.com" });
    await ingestTrackEvent({ ...baseEvent, event_name: "signup_intent", path: "/pricing", referrer: "https://google.com" }, { origin: "https://moonarqstudio.com" });
    const rows = await listMetrics({ metricKeys: ["custom_events", "events_by_path", "events_by_referrer"], startDate: "2026-04-22", endDate: "2026-04-22" });
    const customEvents = rows.find((row) => row.metric_key === "custom_events" && row.dimensions.rollup === "daily");
    const byPath = rows.find((row) => row.metric_key === "events_by_path" && row.dimensions.path === "/pricing" && row.dimensions.demo !== true);
    const byReferrer = rows.find((row) => row.metric_key === "events_by_referrer" && row.dimensions.referrer === "https://google.com" && row.dimensions.demo !== true);
    expect(customEvents?.metric_value).toBe(2);
    expect(customEvents?.dimensions).not.toHaveProperty("event_id");
    expect(byPath?.metric_value).toBe(2);
    expect(byReferrer?.metric_value).toBe(2);
  });

  it("rolls website event metrics up by Pacific business date", async () => {
    await ingestTrackEvent(
      {
        ...baseEvent,
        anonymous_id: "anon-pacific",
        session_id: "session-pacific",
        occurred_at: "2026-04-27T06:30:00.000Z",
      },
      { origin: "https://moonarqstudio.com" },
    );

    const pacificRows = await listMetrics({ metricKeys: ["page_views"], startDate: "2026-04-26", endDate: "2026-04-26" });
    const utcRows = await listMetrics({ metricKeys: ["page_views"], startDate: "2026-04-27", endDate: "2026-04-27" });
    expect(pacificRows.find((row) => row.dimensions.rollup === "daily")?.metric_value).toBe(1);
    expect(utcRows.find((row) => row.dimensions.rollup === "daily" && row.dimensions.demo !== true)).toBeUndefined();
  });

  it("deduplicates visitors and sessions within the same Pacific day after UTC midnight", async () => {
    await ingestTrackEvent(
      {
        ...baseEvent,
        anonymous_id: "anon-evening",
        session_id: "session-evening",
        occurred_at: "2026-04-23T00:30:00.000Z",
      },
      { origin: "https://moonarqstudio.com" },
    );
    await ingestTrackEvent(
      {
        ...baseEvent,
        anonymous_id: "anon-evening",
        session_id: "session-evening",
        occurred_at: "2026-04-23T01:00:00.000Z",
      },
      { origin: "https://moonarqstudio.com" },
    );

    const rows = await listMetrics({
      metricKeys: ["page_views", "unique_visitors", "sessions"],
      startDate: "2026-04-22",
      endDate: "2026-04-22",
    });
    expect(rows.find((row) => row.metric_key === "page_views" && row.dimensions.rollup === "daily")?.metric_value).toBe(2);
    expect(rows.find((row) => row.metric_key === "unique_visitors" && row.dimensions.rollup === "daily")?.metric_value).toBe(1);
    expect(rows.find((row) => row.metric_key === "sessions" && row.dimensions.rollup === "daily")?.metric_value).toBe(1);
  });

  it("counts the same visitor and session again after the Pacific day changes", async () => {
    const sharedIdentity = {
      ...baseEvent,
      anonymous_id: "anon-midnight",
      session_id: "session-midnight",
    };
    await ingestTrackEvent(
      { ...sharedIdentity, occurred_at: "2026-04-23T06:30:00.000Z" },
      { origin: "https://moonarqstudio.com" },
    );
    await ingestTrackEvent(
      { ...sharedIdentity, occurred_at: "2026-04-23T07:30:00.000Z" },
      { origin: "https://moonarqstudio.com" },
    );

    const rows = await listMetrics({
      metricKeys: ["unique_visitors", "sessions"],
      startDate: "2026-04-22",
      endDate: "2026-04-23",
    });
    for (const date of ["2026-04-22", "2026-04-23"]) {
      expect(rows.find((row) => row.date === date && row.metric_key === "unique_visitors" && row.dimensions.rollup === "daily")?.metric_value).toBe(1);
      expect(rows.find((row) => row.date === date && row.metric_key === "sessions" && row.dimensions.rollup === "daily")?.metric_value).toBe(1);
    }
  });

  it("stores tracker page views as raw events but suppresses rollups when Vercel Drain is primary", async () => {
    await createSource({
      source_type_key: "vercel_web_analytics_drain",
      display_name: "MoonArq Website Drain",
      input_url: "https://moonarqstudio.com",
      normalized_url: "https://moonarqstudio.com",
      account_name: "moonarqstudio.com",
      status: "healthy",
      sync_mode: "webhook",
      supports_webhook: true,
      metadata: {
        monitored_source: "moonarq_website",
      },
    });

    await ingestTrackEvent(
      {
        ...baseEvent,
        occurred_at: "2026-05-01T12:00:00.000Z",
      },
      { origin: "https://moonarqstudio.com" },
    );

    const rows = await listMetrics({ metricKeys: ["page_views"], startDate: "2026-05-01", endDate: "2026-05-01" });
    const pageViews = rows.find((row) => row.metric_key === "page_views" && row.dimensions.demo !== true);
    const events = await listWebEvents(20);
    const stored = events.find((event) => event.occurred_at === "2026-05-01T12:00:00.000Z");

    expect(pageViews).toBeUndefined();
    expect(stored?.properties).toMatchObject({
      moonarq_ingestion: {
        suppressed_rollup: true,
        reason: "vercel_drain_primary",
      },
    });
  });

  it("keeps the healthy tracker primary while the Vercel Drain needs attention", async () => {
    const tracker = getDemoStore().sources.find((source) => source.source_type_key === "website");
    if (tracker) tracker.status = "healthy";
    await createSource({
      source_type_key: "vercel_web_analytics_drain",
      display_name: "MoonArq Website Drain",
      input_url: "https://moonarqstudio.com",
      normalized_url: "https://moonarqstudio.com",
      account_name: "moonarqstudio.com",
      status: "warning",
      sync_mode: "webhook",
      supports_webhook: true,
      metadata: { monitored_source: "moonarq_website" },
    });

    await ingestTrackEvent(
      { ...baseEvent, occurred_at: "2026-05-03T12:00:00.000Z" },
      { origin: "https://moonarqstudio.com" },
    );

    const rows = await listMetrics({ metricKeys: ["page_views"], startDate: "2026-05-03", endDate: "2026-05-03" });
    expect(rows.find((row) => row.metric_key === "page_views" && row.dimensions.rollup === "daily")?.metric_value).toBe(1);
  });

  it("keeps tracker custom events available when Vercel Drain is primary", async () => {
    await createSource({
      source_type_key: "vercel_web_analytics_drain",
      display_name: "MoonArq Website Drain",
      input_url: "https://moonarqstudio.com",
      normalized_url: "https://moonarqstudio.com",
      account_name: "moonarqstudio.com",
      status: "healthy",
      sync_mode: "webhook",
      supports_webhook: true,
      metadata: {
        monitored_source: "moonarq_website",
      },
    });

    await ingestTrackEvent(
      {
        ...baseEvent,
        event_name: "cta_click",
        path: "/pricing",
        occurred_at: "2026-05-02T12:00:00.000Z",
      },
      { origin: "https://moonarqstudio.com" },
    );

    const rows = await listMetrics({ metricKeys: ["custom_events"], startDate: "2026-05-02", endDate: "2026-05-02" });
    const customEvents = rows.find((row) => row.metric_key === "custom_events" && row.dimensions.rollup === "daily");
    expect(customEvents?.metric_value).toBe(1);
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
