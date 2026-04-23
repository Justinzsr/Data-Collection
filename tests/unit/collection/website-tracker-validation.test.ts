import { beforeEach, describe, expect, it } from "vitest";
import { ingestTrackEvent } from "@/collection/tracking/track-endpoint";
import { resetDemoStore } from "@/storage/repositories/demo-store";

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
});
