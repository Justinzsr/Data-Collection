import { beforeEach, describe, expect, it } from "vitest";
import { getSourceDataExplorer } from "@/aggregation/services/source-data-explorer-service";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";

const RAW_EVENT_ID = "c0b1c2d3-e4f5-4a67-8b90-c1d2e3f4a5b6";
const RAW_ITEM_INSTANCE_ID = "d1c2d3e4-f5a6-4b78-9c01-d2e3f4a5b6c7";
const CHECKOUT_HASH = "c".repeat(64);
const ITEM_HASH = "d".repeat(64);

describe("Source Data Explorer exposure boundary", () => {
  beforeEach(() => resetDemoStore());

  it("omits Website item identities and Shopify bridge hashes from JSON and previews", async () => {
    const store = getDemoStore();
    const websiteEvent = store.webEvents[0];
    websiteEvent.properties = {
      item_id: "safe-catalog-item",
      event_id: RAW_EVENT_ID,
      item_instance_id: RAW_ITEM_INSTANCE_ID,
      items: [{ item_id: "safe-catalog-item", itemInstanceIdHash: ITEM_HASH }],
    };
    store.rawIngestions.unshift({
      id: "raw-shopify-exposure-test",
      source_id: websiteEvent.source_id,
      source_type_key: "shopify",
      external_id: "shopify:test:snapshot",
      fetched_at: websiteEvent.received_at,
      payload_hash: "safe-payload-hash",
      payload: {
        kind: "shopify_orders_snapshot",
        orders: [{
          currentTotal: "85.00",
          checkoutEventIdHash: CHECKOUT_HASH,
          lines: [{ itemInstanceIdHash: ITEM_HASH, item_instance_id: RAW_ITEM_INSTANCE_ID }],
        }],
      },
      status: "stored",
      cursor: null,
      created_at: websiteEvent.received_at,
    });

    const website = await getSourceDataExplorer({
      tab: "website",
      range: "30d",
      dataSpaceId: DATA_SPACE_IDS.moonarq,
    });
    const websiteRow = website.rows.find((row) => row.id === websiteEvent.id);
    expect(websiteRow?.json).toMatchObject({ item_id: "safe-catalog-item" });
    const websiteSerialized = JSON.stringify(websiteRow);

    const raw = await getSourceDataExplorer({
      tab: "raw_ingestions",
      range: "30d",
      dataSpaceId: DATA_SPACE_IDS.moonarq,
    });
    const rawRow = raw.rows.find((row) => row.id === "raw-shopify-exposure-test");
    expect(rawRow?.json).toMatchObject({ kind: "shopify_orders_snapshot" });
    expect(rawRow?.cells.payload_preview).toContain("shopify_orders_snapshot");
    const rawSerialized = JSON.stringify(rawRow);

    for (const serialized of [websiteSerialized, rawSerialized]) {
      for (const forbidden of [RAW_EVENT_ID, RAW_ITEM_INSTANCE_ID, CHECKOUT_HASH, ITEM_HASH]) {
        expect(serialized).not.toContain(forbidden);
      }
      for (const forbiddenKey of [
        "event_id",
        "item_instance_id",
        "checkoutEventIdHash",
        "itemInstanceIdHash",
      ]) {
        expect(serialized).not.toContain(forbiddenKey);
      }
    }
    expect(websiteSerialized).toContain("safe-catalog-item");
    expect(rawSerialized).toContain("85.00");
  });
});
