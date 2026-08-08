import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectorRegistry } from "@/collection/connectors/registry";
import { enqueueSyncRun } from "@/collection/sync/engine";
import type { CommerceOrderFactInput, ConnectorDefinition } from "@/collection/connectors/types";
import {
  closeDatabasePool,
  query,
  queryRows,
  withDatabaseTransaction,
} from "@/storage/db/client";
import type { CommerceOrder, CommerceOrderLine } from "@/storage/db/schema";
import { replaceCommerceOrdersWindow } from "@/storage/repositories/commerce-orders-repository";

vi.mock("@/storage/repositories/platform-change-events-repository", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/storage/repositories/platform-change-events-repository")
  >();
  return {
    ...actual,
    recordChangeEventsForRawPayloads: async (
      ...args: Parameters<typeof actual.recordChangeEventsForRawPayloads>
    ) => {
      const [source, rawPayloads, executor] = args;
      if (source.id !== atomicSourceId) {
        return actual.recordChangeEventsForRawPayloads(source, rawPayloads, executor);
      }
      const rawPayload = rawPayloads[0];
      if (!rawPayload) return { inserted: 0 };
      const result = await actual.recordPlatformChangeEvent({
        sourceId: source.id,
        sourceTypeKey: source.source_type_key,
        platformRecordType: "atomicity_probe",
        externalRecordId: rawPayload.externalId ?? "atomicity-probe",
        changeType: "snapshot",
        changedAt: rawPayload.fetchedAt,
        payload: rawPayload.payload,
      }, executor);
      return { inserted: result.inserted ? 1 : 0 };
    },
  };
});

const enabled = process.env.RUN_COMMERCE_ORDERS_POSTGRES_TEST === "true";
const databaseUrl = process.env.DATABASE_URL;
const dataSpaceId = randomUUID();
const sourceId = randomUUID();
const atomicSourceId = randomUUID();
const syncRunId = randomUUID();
const lockKey = randomUUID();
const oldOrderId = randomUUID();
const oldLineId = randomUUID();
const CHECKOUT_UUID = "a0b1c2d3-e4f5-4a67-8b90-c1d2e3f4a5b6";
const ITEM_UUID = "b1c2d3e4-f5a6-4b78-9c01-d2e3f4a5b6c7";
const ORDER_GID = "gid://shopify/Order/1001";
const LINE_GID = "gid://shopify/LineItem/2001";
const ATOMIC_ORDER_GID = "gid://shopify/Order/atomicity-probe";
const ATOMIC_LINE_GID = "gid://shopify/LineItem/atomicity-probe";
const ATOMIC_DATE = "2026-07-14";
const ATOMIC_OCCURRED_AT = "2026-07-14T18:30:00.000Z";
const ATOMIC_TRIGGER_NAME = "test_commerce_atomicity_failure";
const ATOMIC_FUNCTION_NAME = "test_raise_commerce_atomicity_failure";
const window = {
  sourceId,
  startAt: "2026-05-16T07:00:00.000Z",
  endAt: "2026-07-14T20:00:00.000Z",
};
const lease = { syncRunId, lockKey };

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requireDisposableLocalDatabase() {
  if (!enabled) return;
  if (!databaseUrl) throw new Error("The opt-in commerce PostgreSQL test requires DATABASE_URL.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("The opt-in commerce PostgreSQL test only runs against a local disposable database.");
  }
}

function fact(): CommerceOrderFactInput {
  return {
    shopifyOrderId: ORDER_GID,
    occurredAt: "2026-07-14T05:30:00.000Z",
    test: false,
    cancelledAt: null,
    currencyCode: "USD",
    grossSales: "0.300000000000000001",
    currentTotal: "0.3",
    netPayment: "0.2",
    totalRefunded: "0.1",
    checkoutEventIdHash: hash(CHECKOUT_UUID),
    checkoutBridgeState: "matched",
    lines: [{
      shopifyLineItemId: LINE_GID,
      quantity: 2,
      itemInstanceIdHash: hash(ITEM_UUID),
      itemBridgeState: "matched",
    }],
  };
}

function atomicFact(): CommerceOrderFactInput {
  return {
    shopifyOrderId: ATOMIC_ORDER_GID,
    occurredAt: ATOMIC_OCCURRED_AT,
    test: false,
    cancelledAt: null,
    currencyCode: "USD",
    grossSales: "0.300000000000000003",
    currentTotal: "0.3",
    netPayment: "0.2",
    totalRefunded: "0.1",
    checkoutEventIdHash: null,
    checkoutBridgeState: "missing",
    lines: [{
      shopifyLineItemId: ATOMIC_LINE_GID,
      quantity: 3,
      itemInstanceIdHash: null,
      itemBridgeState: "missing",
    }],
  };
}

async function atomicLayerCounts() {
  const rows = await queryRows<{
    raw_count: number;
    change_event_count: number;
    metric_count: number;
    content_item_count: number;
    content_metric_count: number;
    commerce_order_count: number;
    commerce_line_count: number;
    source_lock_count: number;
  }>(
    `
      select
        (select count(*)::int from raw_ingestions where source_id = $1) as raw_count,
        (select count(*)::int from platform_change_events where source_id = $1) as change_event_count,
        (select count(*)::int from metrics_daily where source_id = $1) as metric_count,
        (select count(*)::int from content_items where source_id = $1) as content_item_count,
        (select count(*)::int from content_metrics where source_id = $1) as content_metric_count,
        (select count(*)::int from commerce_orders where source_id = $1) as commerce_order_count,
        (
          select count(*)::int
          from commerce_order_lines line
          join commerce_orders orders on orders.id = line.order_id
          where orders.source_id = $1
        ) as commerce_line_count,
        (select count(*)::int from source_locks where source_id = $1) as source_lock_count
    `,
    [atomicSourceId],
  );
  return rows[0];
}

async function expectRoleDenied(role: "anon" | "authenticated" | "service_role", table: string) {
  await expect(withDatabaseTransaction(async (client) => {
    await client.query(`set local role ${role}`);
    await client.query(`select count(*) from public.${table}`);
  })).rejects.toThrow(/permission denied/u);
}

describe.skipIf(!enabled)("Commerce order PostgreSQL facts", () => {
  beforeAll(async () => {
    requireDisposableLocalDatabase();
    await query(
      `
        insert into data_spaces (id, slug, display_name, category, status)
        values ($1, $2, 'Commerce integration fixture', 'test', 'active')
      `,
      [dataSpaceId, `commerce-fixture-${dataSpaceId}`],
    );
    await query(
      `
        insert into sources (
          id, data_space_id, source_type_key, display_name, status, sync_mode
        ) values ($1, $2, 'shopify', 'Fixture Shopify', 'healthy', 'hourly')
      `,
      [sourceId, dataSpaceId],
    );
    await query(
      `
        insert into sync_runs (
          id, source_id, source_type_key, trigger, status, lock_key
        ) values ($1, $2, 'shopify', 'manual', 'running', $3)
      `,
      [syncRunId, sourceId, lockKey],
    );
    await query(
      `
        insert into source_locks (
          source_id, locked_by_sync_run_id, lock_key, acquired_at, expires_at
        ) values ($1, $2, $3, now(), now() + interval '10 minutes')
      `,
      [sourceId, syncRunId, lockKey],
    );
    await query(
      `
        insert into commerce_orders (
          id, source_id, shopify_order_id_hash, occurred_at, test, cancelled_at,
          currency_code, gross_sales, current_total, net_payment, total_refunded,
          checkout_event_id_hash, checkout_bridge_state
        ) values (
          $1, $2, $3, '2026-04-01T12:00:00.000Z', false, null,
          'USD', 12, 12, 12, 0, null, 'missing'
        )
      `,
      [oldOrderId, sourceId, hash("gid://shopify/Order/older")],
    );
    await query(
      `
        insert into commerce_order_lines (
          id, order_id, shopify_line_item_id_hash, quantity,
          item_instance_id_hash, item_bridge_state
        ) values ($1, $2, $3, 1, null, 'missing')
      `,
      [oldLineId, oldOrderId, hash("gid://shopify/LineItem/older")],
    );
  });

  afterAll(async () => {
    if (!enabled) return;
    await query("delete from sources where id = $1", [sourceId]);
    await query("delete from sync_runs where id = $1", [syncRunId]);
    await query("delete from data_spaces where id = $1", [dataSpaceId]);
    await closeDatabasePool();
  });

  it("replaces only the bounded commerce window and preserves older facts", async () => {
    expect(await replaceCommerceOrdersWindow([fact()], window, lease)).toEqual({
      ordersInserted: 1,
      linesInserted: 1,
    });
    const orders = await queryRows<CommerceOrder>(
      `
        select
          id, source_id, shopify_order_id_hash, occurred_at, test, cancelled_at,
          currency_code, gross_sales::text as gross_sales,
          current_total::text as current_total, net_payment::text as net_payment,
          total_refunded::text as total_refunded, checkout_event_id_hash,
          checkout_bridge_state, definition_version, created_at, updated_at
        from commerce_orders
        where source_id = $1
        order by occurred_at
      `,
      [sourceId],
    );
    const lines = await queryRows<CommerceOrderLine>(
      `
        select l.*
        from commerce_order_lines l
        join commerce_orders o on o.id = l.order_id
        where o.source_id = $1
        order by o.occurred_at
      `,
      [sourceId],
    );
    expect(orders).toHaveLength(2);
    expect(lines).toHaveLength(2);
    expect(orders[1]).toMatchObject({
      shopify_order_id_hash: hash(ORDER_GID),
      checkout_event_id_hash: hash(CHECKOUT_UUID),
      checkout_bridge_state: "matched",
      gross_sales: "0.300000000000000001",
    });
    expect(lines[1]).toMatchObject({
      shopify_line_item_id_hash: hash(LINE_GID),
      item_instance_id_hash: hash(ITEM_UUID),
      item_bridge_state: "matched",
      quantity: 2,
    });
    const stored = JSON.stringify({ orders, lines });
    for (const rawIdentity of [ORDER_GID, LINE_GID, CHECKOUT_UUID, ITEM_UUID]) {
      expect(stored).not.toContain(rawIdentity);
    }

    await replaceCommerceOrdersWindow([], window, lease);
    const remainingOrders = await queryRows<{ id: string }>(
      "select id from commerce_orders where source_id = $1",
      [sourceId],
    );
    const remainingLines = await queryRows<{ id: string }>(
      "select id from commerce_order_lines where order_id = $1",
      [oldOrderId],
    );
    expect(remainingOrders).toEqual([{ id: oldOrderId }]);
    expect(remainingLines).toEqual([{ id: oldLineId }]);
  });

  it("enforces commerce fact truth constraints in PostgreSQL", async () => {
    const insertOrder = (suffix: string, columns: string, values: string) => query(
      `
        insert into commerce_orders (
          id, source_id, shopify_order_id_hash, occurred_at, test,
          currency_code, gross_sales, current_total, net_payment, total_refunded,
          checkout_event_id_hash, checkout_bridge_state${columns}
        ) values (
          $1, $2, $3, '2026-07-14T05:30:00.000Z', false,
          'USD', 1, 1, 1, 0, null, 'matched'${values}
        )
      `,
      [randomUUID(), sourceId, hash(`gid://shopify/Order/${suffix}`)],
    );
    await expect(insertOrder("bad-state", "", "")).rejects.toThrow();
    await expect(insertOrder(
      "bad-cancel",
      ", cancelled_at",
      ", '2026-07-14T05:29:59.000Z'",
    )).rejects.toThrow();
    await expect(query(
      `
        insert into commerce_order_lines (
          id, order_id, shopify_line_item_id_hash, quantity,
          item_instance_id_hash, item_bridge_state
        ) values ($1, $2, $3, 0, null, 'missing')
      `,
      [randomUUID(), oldOrderId, hash("gid://shopify/LineItem/zero")],
    )).rejects.toThrow();
  });

  it("denies commerce facts to browser and service roles while owner writes", async () => {
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      for (const table of ["commerce_orders", "commerce_order_lines"]) {
        const privileges = await queryRows<{ allowed: boolean }>(
          "select has_table_privilege($1, $2, 'select') as allowed",
          [role, `public.${table}`],
        );
        expect(privileges).toEqual([{ allowed: false }]);
        await expectRoleDenied(role, table);
      }
    }
    const ownerWrite = await queryRows<{ id: string }>(
      `
        update commerce_orders
        set updated_at = now()
        where id = $1
        returning id
      `,
      [oldOrderId],
    );
    expect(ownerWrite).toEqual([{ id: oldOrderId }]);
  });

  it("rolls back every sync persistence layer on commerce failure and commits them together on success", async () => {
    const connectorIndex = connectorRegistry.findIndex((connector) => connector.key === "shopify");
    const originalConnector = connectorRegistry[connectorIndex];
    if (!originalConnector) throw new Error("The Shopify connector fixture was not found.");
    const syntheticConnector: ConnectorDefinition = {
      ...originalConnector,
      requiredFields: [],
      async sync() {
        return {
          rawPayloads: [{
            externalId: "atomicity-probe",
            fetchedAt: ATOMIC_OCCURRED_AT,
            payload: { kind: "atomicity_probe", amount: "0.300000000000000003" },
          }],
          commerceOrderFacts: [atomicFact()],
          replaceCommerceOrderWindow: {
            startAt: `${ATOMIC_DATE}T00:00:00.000Z`,
            endAt: `${ATOMIC_DATE}T23:59:59.999Z`,
          },
          recordsFetched: 1,
          message: "Synthetic atomicity probe completed.",
        };
      },
      async normalize(_rawPayloads, source) {
        return {
          metrics: [{
            date: ATOMIC_DATE,
            sourceId: source.id,
            sourceTypeKey: "shopify",
            metricKey: "orders",
            metricValue: 1,
            unit: "count",
            dimensions: { rollup: "atomicity_probe" },
          }],
          contentMetrics: [{
            date: ATOMIC_DATE,
            sourceId: source.id,
            sourceTypeKey: "shopify",
            externalContentId: "atomicity-content",
            contentType: "atomicity_probe",
            title: "Atomicity probe",
            metricKey: "views",
            metricValue: 1,
            unit: "count",
            dimensions: { rollup: "atomicity_probe" },
          }],
          replaceMetricWindow: {
            metricKeys: ["orders"],
            startDate: ATOMIC_DATE,
            endDate: ATOMIC_DATE,
          },
        };
      },
    };
    const previousFlag = process.env.ENABLE_SHOPIFY_COMMERCE_FACTS_V2;

    try {
      connectorRegistry[connectorIndex] = syntheticConnector;
      process.env.ENABLE_SHOPIFY_COMMERCE_FACTS_V2 = "true";
      await query(
        `
          insert into sources (
            id, data_space_id, source_type_key, display_name, status, sync_mode
          ) values ($1, $2, 'shopify', 'Atomicity fixture Shopify', 'healthy', 'manual')
        `,
        [atomicSourceId, dataSpaceId],
      );
      await query(`drop trigger if exists ${ATOMIC_TRIGGER_NAME} on commerce_orders`);
      await query(`drop function if exists ${ATOMIC_FUNCTION_NAME}()`);
      await query(
        `
          create function ${ATOMIC_FUNCTION_NAME}()
          returns trigger
          language plpgsql
          as $function$
          begin
            raise exception 'Injected commerce atomicity failure.';
          end;
          $function$
        `,
      );
      await query(
        `
          create trigger ${ATOMIC_TRIGGER_NAME}
          before insert on commerce_orders
          for each row execute function ${ATOMIC_FUNCTION_NAME}()
        `,
      );

      const failedRun = await enqueueSyncRun({ sourceId: atomicSourceId, trigger: "manual" });
      expect(failedRun).toMatchObject({
        status: "error",
        error_message: "Injected commerce atomicity failure.",
      });
      expect(await atomicLayerCounts()).toEqual({
        raw_count: 0,
        change_event_count: 0,
        metric_count: 0,
        content_item_count: 0,
        content_metric_count: 0,
        commerce_order_count: 0,
        commerce_line_count: 0,
        source_lock_count: 0,
      });

      await query(`drop trigger ${ATOMIC_TRIGGER_NAME} on commerce_orders`);
      await query(`drop function ${ATOMIC_FUNCTION_NAME}()`);

      const successfulRun = await enqueueSyncRun({ sourceId: atomicSourceId, trigger: "manual" });
      expect(successfulRun.status).toBe("success");
      expect(await atomicLayerCounts()).toEqual({
        raw_count: 1,
        change_event_count: 1,
        metric_count: 1,
        content_item_count: 1,
        content_metric_count: 1,
        commerce_order_count: 1,
        commerce_line_count: 1,
        source_lock_count: 0,
      });
      expect(await queryRows<{ gross_sales: string }>(
        "select gross_sales::text as gross_sales from commerce_orders where source_id = $1",
        [atomicSourceId],
      )).toEqual([{ gross_sales: "0.300000000000000003" }]);
    } finally {
      connectorRegistry[connectorIndex] = originalConnector;
      if (previousFlag === undefined) delete process.env.ENABLE_SHOPIFY_COMMERCE_FACTS_V2;
      else process.env.ENABLE_SHOPIFY_COMMERCE_FACTS_V2 = previousFlag;
      await query(`drop trigger if exists ${ATOMIC_TRIGGER_NAME} on commerce_orders`);
      await query(`drop function if exists ${ATOMIC_FUNCTION_NAME}()`);
      for (const table of [
        "platform_change_events",
        "raw_ingestions",
        "metrics_daily",
        "content_metrics",
        "content_items",
        "commerce_orders",
        "connector_events",
        "source_locks",
        "sync_runs",
      ]) {
        await query(`delete from ${table} where source_id = $1`, [atomicSourceId]);
      }
      await query("delete from sources where id = $1", [atomicSourceId]);
    }
  });
});
