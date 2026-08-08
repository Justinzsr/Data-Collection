import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CommerceOrderFactInput } from "@/collection/connectors/types";
import {
  isRuntimeDatabaseConfigured,
  queryRows,
  withDatabaseTransaction,
  type DatabaseExecutor,
} from "@/storage/db/client";
import type { CommerceOrder, CommerceOrderLine } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHOPIFY_ORDER_GID_PATTERN = /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/u;
const SHOPIFY_LINE_ITEM_GID_PATTERN = /^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/u;
const MAX_COMMERCE_WINDOW_MS = (60 * 24 + 2) * 60 * 60_000;
const DEFINITION_VERSION = "shopify-commerce-bridge-v1" as const;

export type CommerceOrderReplacementWindow = {
  sourceId: string;
  startAt: string;
  endAt: string;
};

export type CommerceOrderReplacementLease = {
  syncRunId: string;
  lockKey: string;
};

type PreparedLine = {
  shopifyLineItemIdHash: string;
  quantity: number;
  itemInstanceIdHash: string | null;
  itemBridgeState: CommerceOrderLine["item_bridge_state"];
};

type PreparedOrder = {
  shopifyOrderIdHash: string;
  occurredAt: string;
  test: boolean;
  cancelledAt: string | null;
  currencyCode: string;
  grossSales: string;
  currentTotal: string;
  netPayment: string;
  totalRefunded: string;
  checkoutEventIdHash: string | null;
  checkoutBridgeState: CommerceOrder["checkout_bridge_state"];
  lines: PreparedLine[];
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseTimestamp(value: string, label: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is invalid.`);
  return timestamp;
}

function assertBridgeIdentity(
  hash: string | null,
  state: CommerceOrder["checkout_bridge_state"],
) {
  if (
    !["missing", "matched", "invalid", "ambiguous"].includes(state)
    || (state === "matched" && (hash === null || !SHA256_PATTERN.test(hash)))
    || (state !== "matched" && hash !== null)
  ) {
    throw new Error("A commerce bridge identity has an invalid hash/state pair.");
  }
}

function normalizeAmount(value: string) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value)) {
    throw new Error("A commerce order contains an invalid monetary amount.");
  }
  const [integer, fraction = ""] = value.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/u, "");
  const normalizedFraction = fraction.replace(/0+$/u, "");
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

function prepareReplacement(
  facts: CommerceOrderFactInput[],
  window: CommerceOrderReplacementWindow,
) {
  if (!window.sourceId) throw new Error("Commerce replacement source is required.");
  const startAt = parseTimestamp(window.startAt, "Commerce replacement start");
  const endAt = parseTimestamp(window.endAt, "Commerce replacement end");
  if (startAt > endAt || endAt - startAt > MAX_COMMERCE_WINDOW_MS) {
    throw new Error("Commerce replacement window must be a bounded 60-day snapshot.");
  }

  const orderHashes = new Set<string>();
  const prepared: PreparedOrder[] = [];
  for (const fact of facts) {
    if (!SHOPIFY_ORDER_GID_PATTERN.test(fact.shopifyOrderId)) {
      throw new Error("A commerce fact contains an invalid Shopify order identity.");
    }
    const orderHash = sha256(fact.shopifyOrderId);
    if (orderHashes.has(orderHash)) throw new Error("A commerce replacement contains a duplicate order.");
    orderHashes.add(orderHash);

    const occurredAt = parseTimestamp(fact.occurredAt, "Commerce order timestamp");
    if (occurredAt < startAt || occurredAt > endAt) {
      throw new Error("A commerce order falls outside its declared replacement window.");
    }
    if (
      fact.cancelledAt !== null
      && parseTimestamp(fact.cancelledAt, "Commerce cancellation timestamp") < occurredAt
    ) {
      throw new Error("A commerce cancellation cannot precede its order.");
    }
    if (typeof fact.test !== "boolean" || !/^[A-Z]{3}$/u.test(fact.currencyCode)) {
      throw new Error("A commerce order contains invalid status or currency data.");
    }
    const grossSales = normalizeAmount(fact.grossSales);
    const currentTotal = normalizeAmount(fact.currentTotal);
    const netPayment = normalizeAmount(fact.netPayment);
    const totalRefunded = normalizeAmount(fact.totalRefunded);
    assertBridgeIdentity(fact.checkoutEventIdHash, fact.checkoutBridgeState);

    const lineHashes = new Set<string>();
    const lines: PreparedLine[] = [];
    for (const line of fact.lines) {
      if (!SHOPIFY_LINE_ITEM_GID_PATTERN.test(line.shopifyLineItemId)) {
        throw new Error("A commerce fact contains an invalid Shopify line-item identity.");
      }
      const lineHash = sha256(line.shopifyLineItemId);
      if (lineHashes.has(lineHash)) throw new Error("A commerce order contains a duplicate line item.");
      lineHashes.add(lineHash);
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
        throw new Error("A commerce order line contains an invalid quantity.");
      }
      assertBridgeIdentity(line.itemInstanceIdHash, line.itemBridgeState);
      lines.push({
        shopifyLineItemIdHash: lineHash,
        quantity: line.quantity,
        itemInstanceIdHash: line.itemInstanceIdHash,
        itemBridgeState: line.itemBridgeState,
      });
    }

    prepared.push({
      shopifyOrderIdHash: orderHash,
      occurredAt: fact.occurredAt,
      test: fact.test,
      cancelledAt: fact.cancelledAt,
      currencyCode: fact.currencyCode,
      grossSales,
      currentTotal,
      netPayment,
      totalRefunded,
      checkoutEventIdHash: fact.checkoutEventIdHash,
      checkoutBridgeState: fact.checkoutBridgeState,
      lines,
    });
  }
  return prepared;
}

async function assertDatabaseLease(
  sourceId: string,
  lease: CommerceOrderReplacementLease,
  executor: DatabaseExecutor,
) {
  const rows = await queryRows<{ owned: boolean }>(
    `
      select exists (
        select 1
        from source_locks
        where source_id = $1
          and locked_by_sync_run_id = $2
          and lock_key = $3
          and expires_at > now()
      ) as owned
    `,
    [sourceId, lease.syncRunId, lease.lockKey],
    executor,
  );
  if (!rows[0]?.owned) throw new Error("Source lock lease was lost before commerce facts could be replaced.");
}

async function insertDatabaseFacts(
  sourceId: string,
  orders: PreparedOrder[],
  executor: DatabaseExecutor,
) {
  const now = new Date().toISOString();
  let linesInserted = 0;
  for (const order of orders) {
    const orderId = randomUUID();
    await queryRows(
      `
        insert into commerce_orders (
          id, source_id, shopify_order_id_hash, occurred_at, test, cancelled_at,
          currency_code, gross_sales, current_total, net_payment, total_refunded,
          checkout_event_id_hash, checkout_bridge_state, definition_version,
          created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $15
        )
      `,
      [
        orderId,
        sourceId,
        order.shopifyOrderIdHash,
        order.occurredAt,
        order.test,
        order.cancelledAt,
        order.currencyCode,
        order.grossSales,
        order.currentTotal,
        order.netPayment,
        order.totalRefunded,
        order.checkoutEventIdHash,
        order.checkoutBridgeState,
        DEFINITION_VERSION,
        now,
      ],
      executor,
    );
    for (const line of order.lines) {
      await queryRows(
        `
          insert into commerce_order_lines (
            id, order_id, shopify_line_item_id_hash, quantity,
            item_instance_id_hash, item_bridge_state, definition_version,
            created_at, updated_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        `,
        [
          randomUUID(),
          orderId,
          line.shopifyLineItemIdHash,
          line.quantity,
          line.itemInstanceIdHash,
          line.itemBridgeState,
          DEFINITION_VERSION,
          now,
        ],
        executor,
      );
      linesInserted += 1;
    }
  }
  return { ordersInserted: orders.length, linesInserted };
}

export async function replaceCommerceOrdersWindow(
  facts: CommerceOrderFactInput[],
  window: CommerceOrderReplacementWindow,
  lease: CommerceOrderReplacementLease,
  executor?: DatabaseExecutor,
) {
  const prepared = prepareReplacement(facts, window);

  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const now = new Date();
    const ownedLease = store.sourceLocks.some((lock) => (
      lock.source_id === window.sourceId
      && lock.locked_by_sync_run_id === lease.syncRunId
      && lock.lock_key === lease.lockKey
      && new Date(lock.expires_at).getTime() > now.getTime()
    ));
    if (!ownedLease) throw new Error("Source lock lease was lost before commerce facts could be replaced.");

    const removedOrderIds = new Set(
      store.commerceOrders
        .filter((order) => (
          order.source_id === window.sourceId
          && Date.parse(order.occurred_at) >= Date.parse(window.startAt)
          && Date.parse(order.occurred_at) <= Date.parse(window.endAt)
        ))
        .map((order) => order.id),
    );
    store.commerceOrders = store.commerceOrders.filter((order) => !removedOrderIds.has(order.id));
    store.commerceOrderLines = store.commerceOrderLines.filter((line) => !removedOrderIds.has(line.order_id));

    const insertedAt = now.toISOString();
    for (const order of prepared) {
      const orderId = randomUUID();
      store.commerceOrders.push({
        id: orderId,
        source_id: window.sourceId,
        shopify_order_id_hash: order.shopifyOrderIdHash,
        occurred_at: order.occurredAt,
        test: order.test,
        cancelled_at: order.cancelledAt,
        currency_code: order.currencyCode,
        gross_sales: order.grossSales,
        current_total: order.currentTotal,
        net_payment: order.netPayment,
        total_refunded: order.totalRefunded,
        checkout_event_id_hash: order.checkoutEventIdHash,
        checkout_bridge_state: order.checkoutBridgeState,
        definition_version: DEFINITION_VERSION,
        created_at: insertedAt,
        updated_at: insertedAt,
      });
      for (const line of order.lines) {
        store.commerceOrderLines.push({
          id: randomUUID(),
          order_id: orderId,
          shopify_line_item_id_hash: line.shopifyLineItemIdHash,
          quantity: line.quantity,
          item_instance_id_hash: line.itemInstanceIdHash,
          item_bridge_state: line.itemBridgeState,
          definition_version: DEFINITION_VERSION,
          created_at: insertedAt,
          updated_at: insertedAt,
        });
      }
    }
    return {
      ordersInserted: prepared.length,
      linesInserted: prepared.reduce((total, order) => total + order.lines.length, 0),
    };
  }

  const replace = async (transactionExecutor: DatabaseExecutor) => {
    await queryRows(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [window.sourceId],
      transactionExecutor,
    );
    await assertDatabaseLease(window.sourceId, lease, transactionExecutor);
    await queryRows(
      `
        delete from commerce_orders
        where source_id = $1
          and occurred_at between $2 and $3
      `,
      [window.sourceId, window.startAt, window.endAt],
      transactionExecutor,
    );
    const result = await insertDatabaseFacts(window.sourceId, prepared, transactionExecutor);
    await assertDatabaseLease(window.sourceId, lease, transactionExecutor);
    return result;
  };
  return executor ? replace(executor) : withDatabaseTransaction(replace);
}
