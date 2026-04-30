import { beforeEach, describe, expect, it } from "vitest";
import { detectChangedFields, recordChangeEventsForRawPayloads, stablePayloadHash } from "@/storage/repositories/platform-change-events-repository";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";
import type { RawPayload } from "@/collection/connectors/types";

describe("platform change events", () => {
  beforeEach(() => resetDemoStore());

  it("hashes equivalent payloads deterministically", () => {
    expect(stablePayloadHash({ b: 2, a: 1 })).toBe(stablePayloadHash({ a: 1, b: 2 }));
  });

  it("detects changed top-level fields", () => {
    expect(detectChangedFields({ id: "1", provider: "email" }, { id: "1", provider: "google" })).toEqual(["provider"]);
  });

  it("does not duplicate unchanged Supabase users or snapshots", async () => {
    const source = getDemoStore().sources.find((item) => item.id === DEMO_SOURCE_IDS.supabase)!;
    const payload: RawPayload = {
      externalId: "supabase-users",
      fetchedAt: "2026-04-22T15:00:00.000Z",
      payload: { mode: "admin_list_users", users: [{ id: "user-1", email: "safe@example.com", created_at: "2026-03-01T00:00:00.000Z", confirmed_at: "2026-03-01T00:00:00.000Z", provider: "email" }] },
    };
    await recordChangeEventsForRawPayloads(source, [payload]);
    await recordChangeEventsForRawPayloads(source, [{ ...payload, fetchedAt: "2026-04-22T16:00:00.000Z" }]);
    expect(getDemoStore().platformChangeEvents).toHaveLength(2);
    expect(JSON.stringify(getDemoStore().platformChangeEvents)).not.toContain("safe@example.com");
  });

  it("records an updated Supabase user when the sanitized payload changes", async () => {
    const source = getDemoStore().sources.find((item) => item.id === DEMO_SOURCE_IDS.supabase)!;
    await recordChangeEventsForRawPayloads(source, [{ externalId: "supabase-users", fetchedAt: "2026-04-22T15:00:00.000Z", payload: { mode: "admin_list_users", users: [{ id: "user-1", created_at: "2026-03-01T00:00:00.000Z", provider: "email" }] } }]);
    await recordChangeEventsForRawPayloads(source, [{ externalId: "supabase-users", fetchedAt: "2026-04-22T16:00:00.000Z", payload: { mode: "admin_list_users", users: [{ id: "user-1", created_at: "2026-03-01T00:00:00.000Z", provider: "google" }] } }]);
    const userEvents = getDemoStore().platformChangeEvents.filter((event) => event.platform_record_type === "auth_user");
    expect(userEvents).toHaveLength(2);
    expect(userEvents[0].change_type).toBe("updated");
    expect(userEvents[0].changed_fields).toContain("provider");
  });

  it("dedupes repeated Vercel drain events", async () => {
    const source = getDemoStore().sources.find((item) => item.id === DEMO_SOURCE_IDS.website)!;
    source.source_type_key = "vercel_web_analytics_drain";
    const payload: RawPayload = { externalId: "pageview:1:device:session", fetchedAt: "2026-04-22T15:00:00.000Z", payload: { eventType: "pageview", timestamp: 1776870000000, deviceId: "device", sessionId: "session", path: "/" } };
    await recordChangeEventsForRawPayloads(source, [payload]);
    await recordChangeEventsForRawPayloads(source, [payload]);
    expect(getDemoStore().platformChangeEvents.filter((event) => event.platform_record_type === "vercel_analytics_event")).toHaveLength(1);
  });
});
