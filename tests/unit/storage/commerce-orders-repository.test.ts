import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { CommerceOrderFactInput } from "@/collection/connectors/types";
import { acquireSourceLock } from "@/collection/sync/locks";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { replaceCommerceOrdersWindow } from "@/storage/repositories/commerce-orders-repository";

const SOURCE_ID = "55555555-5555-4555-8555-555555555555";
const SYNC_RUN_ID = "66666666-6666-4666-8666-666666666666";
const ORDER_GID = "gid://shopify/Order/1001";
const LINE_GID = "gid://shopify/LineItem/2001";
const CHECKOUT_UUID = "a0b1c2d3-e4f5-4a67-8b90-c1d2e3f4a5b6";
const ITEM_UUID = "b1c2d3e4-f5a6-4b78-9c01-d2e3f4a5b6c7";
const WINDOW = {
  sourceId: SOURCE_ID,
  startAt: "2026-05-16T07:00:00.000Z",
  endAt: "2026-07-14T20:00:00.000Z",
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function fact(patch: Partial<CommerceOrderFactInput> = {}): CommerceOrderFactInput {
  return {
    shopifyOrderId: ORDER_GID,
    occurredAt: "2026-07-14T05:30:00.000Z",
    test: false,
    cancelledAt: null,
    currencyCode: "USD",
    grossSales: "100",
    currentTotal: "85",
    netPayment: "80",
    totalRefunded: "5",
    checkoutEventIdHash: hash(CHECKOUT_UUID),
    checkoutBridgeState: "matched",
    lines: [{
      shopifyLineItemId: LINE_GID,
      quantity: 2,
      itemInstanceIdHash: hash(ITEM_UUID),
      itemBridgeState: "matched",
    }],
    ...patch,
  };
}

async function setupLease() {
  const lock = await acquireSourceLock(SOURCE_ID, SYNC_RUN_ID);
  if (!lock) throw new Error("Test source lock was not acquired.");
  return { syncRunId: SYNC_RUN_ID, lockKey: lock.lock_key };
}

describe("commerce order fact replacement", () => {
  beforeEach(() => {
    resetDemoStore();
  });

  it("stores only hashed identities and atomically replaces rows inside the declared window", async () => {
    const lease = await setupLease();
    const first = await replaceCommerceOrdersWindow([fact()], WINDOW, lease);
    expect(first).toEqual({ ordersInserted: 1, linesInserted: 1 });

    const store = getDemoStore();
    expect(store.commerceOrders).toHaveLength(1);
    expect(store.commerceOrders[0]).toMatchObject({
      source_id: SOURCE_ID,
      shopify_order_id_hash: hash(ORDER_GID),
      checkout_event_id_hash: hash(CHECKOUT_UUID),
      checkout_bridge_state: "matched",
      test: false,
      cancelled_at: null,
      currency_code: "USD",
      gross_sales: "100",
      definition_version: "shopify-commerce-bridge-v1",
    });
    expect(store.commerceOrderLines[0]).toMatchObject({
      shopify_line_item_id_hash: hash(LINE_GID),
      item_instance_id_hash: hash(ITEM_UUID),
      item_bridge_state: "matched",
      quantity: 2,
    });
    const persisted = JSON.stringify({
      orders: store.commerceOrders,
      lines: store.commerceOrderLines,
    });
    for (const rawIdentity of [ORDER_GID, LINE_GID, CHECKOUT_UUID, ITEM_UUID]) {
      expect(persisted).not.toContain(rawIdentity);
    }

    const oldOrderId = randomUUID();
    store.commerceOrders.push({
      ...store.commerceOrders[0],
      id: oldOrderId,
      shopify_order_id_hash: hash("gid://shopify/Order/old"),
      occurred_at: "2026-04-01T12:00:00.000Z",
    });
    store.commerceOrderLines.push({
      ...store.commerceOrderLines[0],
      id: randomUUID(),
      order_id: oldOrderId,
      shopify_line_item_id_hash: hash("gid://shopify/LineItem/old"),
    });

    await replaceCommerceOrdersWindow([], WINDOW, lease);
    expect(store.commerceOrders.map((order) => order.id)).toEqual([oldOrderId]);
    expect(store.commerceOrderLines.map((line) => line.order_id)).toEqual([oldOrderId]);
  });

  it("requires the live source lease and leaves the existing snapshot untouched on failure", async () => {
    const lease = await setupLease();
    await replaceCommerceOrdersWindow([fact()], WINDOW, lease);
    const before = JSON.stringify({
      orders: getDemoStore().commerceOrders,
      lines: getDemoStore().commerceOrderLines,
    });

    await expect(replaceCommerceOrdersWindow([], WINDOW, {
      ...lease,
      lockKey: "not-the-owned-lock",
    })).rejects.toThrow("lock lease was lost");
    expect(JSON.stringify({
      orders: getDemoStore().commerceOrders,
      lines: getDemoStore().commerceOrderLines,
    })).toBe(before);
  });

  it("rejects false matched states, zero quantities, and cancellations before order creation", async () => {
    const lease = await setupLease();
    await expect(replaceCommerceOrdersWindow([fact({
      checkoutEventIdHash: null,
      checkoutBridgeState: "matched",
    })], WINDOW, lease)).rejects.toThrow("invalid hash/state pair");
    await expect(replaceCommerceOrdersWindow([fact({
      lines: [{
        shopifyLineItemId: LINE_GID,
        quantity: 0,
        itemInstanceIdHash: null,
        itemBridgeState: "missing",
      }],
    })], WINDOW, lease)).rejects.toThrow("invalid quantity");
    await expect(replaceCommerceOrdersWindow([fact({
      cancelledAt: "2026-07-14T05:29:59.000Z",
    })], WINDOW, lease)).rejects.toThrow("cannot precede");
    expect(getDemoStore().commerceOrders).toHaveLength(0);
  });

  it("rejects duplicate Shopify order and line identities before replacing any rows", async () => {
    const lease = await setupLease();
    await expect(replaceCommerceOrdersWindow([fact(), fact()], WINDOW, lease)).rejects.toThrow(
      "duplicate order",
    );
    await expect(replaceCommerceOrdersWindow([fact({
      lines: [fact().lines[0], fact().lines[0]],
    })], WINDOW, lease)).rejects.toThrow("duplicate line item");
    expect(getDemoStore().commerceOrders).toHaveLength(0);
    expect(getDemoStore().commerceOrderLines).toHaveLength(0);
  });

  it("normalizes exact decimal strings and rejects non-decimal monetary inputs", async () => {
    const lease = await setupLease();
    await replaceCommerceOrdersWindow([fact({
      grossSales: "000.3000",
      currentTotal: "0.30",
      netPayment: "0.300000000000000000",
      totalRefunded: "0.00",
    })], WINDOW, lease);
    expect(getDemoStore().commerceOrders[0]).toMatchObject({
      gross_sales: "0.3",
      current_total: "0.3",
      net_payment: "0.3",
      total_refunded: "0",
    });

    for (const invalid of ["-1", "1e3", "Infinity", "NaN", "1.", ""]) {
      await expect(replaceCommerceOrdersWindow([fact({ grossSales: invalid })], WINDOW, lease))
        .rejects.toThrow("invalid monetary amount");
    }
  });
});
