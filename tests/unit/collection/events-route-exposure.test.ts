import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/events/route";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { listWebEvents } from "@/storage/repositories/events-repository";

const RAW_EVENT_ID = "a0b1c2d3-e4f5-4a67-8b90-c1d2e3f4a5b6";
const RAW_ITEM_INSTANCE_ID = "b1c2d3e4-f5a6-4b78-9c01-d2e3f4a5b6c7";
const CHECKOUT_HASH = "a".repeat(64);
const ITEM_HASH = "b".repeat(64);

describe("GET /api/events exposure boundary", () => {
  beforeEach(() => resetDemoStore());

  it("keeps exact identities internal while omitting UUIDs and commerce bridge hashes from the response DTO", async () => {
    const store = getDemoStore();
    const internalEvent = store.webEvents[0];
    internalEvent.event_id = RAW_EVENT_ID;
    internalEvent.properties = {
      item_id: "moon-bracelet",
      item_instance_id: RAW_ITEM_INSTANCE_ID,
      checkoutEventIdHash: CHECKOUT_HASH,
      items: [{ item_id: "moon-bracelet", itemInstanceIdHash: ITEM_HASH }],
    };
    internalEvent.attribution_context = { event_id: RAW_EVENT_ID, utm_source: "instagram" };
    store.connectorEvents.unshift({
      id: "connector-event-exposure-test",
      source_id: internalEvent.source_id,
      event_type: "exposure_test",
      severity: "info",
      message: "Safe operational message",
      metadata: { item_instance_id: RAW_ITEM_INSTANCE_ID, safe: "retained" },
      created_at: internalEvent.received_at,
    });

    const internalRows = await listWebEvents(100, { dataSpaceId: DATA_SPACE_IDS.moonarq });
    expect(internalRows.some((event) => event.event_id === RAW_EVENT_ID)).toBe(true);

    const response = await GET(new Request("https://app.example/api/events"));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      webEvents: Array<Record<string, unknown>>;
      connectorEvents: Array<Record<string, unknown>>;
    };
    const serialized = JSON.stringify(body);

    for (const forbidden of [RAW_EVENT_ID, RAW_ITEM_INSTANCE_ID, CHECKOUT_HASH, ITEM_HASH]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const forbiddenKey of [
      "event_id",
      "item_instance_id",
      "checkoutEventIdHash",
      "itemInstanceIdHash",
      "anonymous_id",
      "session_id",
      "ip_hash",
    ]) {
      expect(serialized).not.toContain(forbiddenKey);
    }
    expect(serialized).toContain("moon-bracelet");
    expect(serialized).toContain("utm_source");
    expect(serialized).toContain("retained");
  });
});
