import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabasePool, query } from "@/storage/db/client";
import { getCommerceFunnelV2ReportAggregate } from "@/storage/repositories/commerce-funnel-v2-report-repository";

const enabled = process.env.RUN_COMMERCE_FUNNEL_V2_REPORT_POSTGRES_TEST === "true";
const databaseUrl = process.env.DATABASE_URL;
const dataSpaceId = randomUUID();
const websiteSourceId = randomUUID();
const shopifySourceId = randomUUID();
const checkoutEventId = "a0b1c2d3-e4f5-4a67-8b90-c1d2e3f4a5b6";
const itemInstanceId = "b1c2d3e4-f5a6-4b78-9c01-d2e3f4a5b6c7";
const orderId = randomUUID();
const replayOrderId = randomUUID();

function hash(value: string) {
  return createHash("sha256").update(value.toLowerCase()).digest("hex");
}

function requireDisposableLocalDatabase() {
  if (!enabled) return;
  if (!databaseUrl) throw new Error("The opt-in V2 report test requires DATABASE_URL.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("The opt-in V2 report test only runs against a local disposable database.");
  }
}

async function insertEvent(input: {
  eventName: string;
  occurredAt: string;
  properties: unknown;
  eventId?: string;
  sessionId?: string;
  clientContext?: unknown;
}) {
  await query(
    `
      insert into web_events (
        id, event_id, schema_version, event_source, source_id,
        anonymous_id, session_id, event_name, path, url, properties,
        attribution_context, consent_status, client_context,
        occurred_at, received_at, created_at
      ) values (
        $1::uuid, $2::uuid, '1.0', 'first_party_tracker', $3::uuid,
        'aggregate-only-fixture', $7::text, $4::text,
        '/build', 'https://fixture.invalid/build', $5::jsonb,
        '{}'::jsonb, '{"analytics":"granted","marketing":"denied"}'::jsonb,
        $8::jsonb,
        $6::timestamptz, $6::timestamptz + interval '1 second',
        $6::timestamptz + interval '1 second'
      )
    `,
    [
      randomUUID(),
      input.eventId ?? randomUUID(),
      websiteSourceId,
      input.eventName,
      JSON.stringify(input.properties),
      input.occurredAt,
      input.sessionId ?? "aggregate-only-session",
      JSON.stringify(input.clientContext ?? {
        device_category: "desktop",
        traffic_type: "production",
      }),
    ],
  );
}

describe.skipIf(!enabled)("commerce funnel V2 PostgreSQL aggregate report", () => {
  beforeAll(async () => {
    requireDisposableLocalDatabase();
    await query(
      `
        insert into source_types (key, display_name, description, category, auth_type)
        values
          ('website', 'Website', 'V2 report fixture.', 'website', 'public_key'),
          ('shopify', 'Shopify', 'V2 report fixture.', 'commerce', 'oauth')
        on conflict (key) do nothing
      `,
    );
    await query(
      `
        insert into data_spaces (id, slug, display_name, category, status)
        values ($1::uuid, $2::text, 'V2 report fixture', 'test', 'active')
      `,
      [dataSpaceId, `commerce-report-${dataSpaceId}`],
    );
    await query(
      `
        insert into sources (
          id, data_space_id, source_type_key, display_name, status,
          sync_mode, sync_frequency_minutes, last_success_at, metadata
        ) values
          ($1::uuid, $3::uuid, 'website', 'Fixture Website', 'healthy',
            'realtime', 1, '2026-08-07T23:59:00.000Z', '{}'::jsonb),
          ($2::uuid, $3::uuid, 'shopify', 'Fixture Shopify', 'healthy',
            'hourly', 60, '2026-08-07T23:00:00.000Z',
            '{"commerce_bridge_v2_verified":"true","commerce_bridge_v2_coverage_start_at":"2026-07-01T00:00:00.000Z"}'::jsonb)
      `,
      [websiteSourceId, shopifySourceId, dataSpaceId],
    );
    await query(
      `
        insert into sync_runs (
          source_id, source_type_key, trigger, status,
          started_at, finished_at, duration_ms, cursor_after, created_at
        ) values (
          $1::uuid, 'shopify', 'cron', 'success',
          '2026-08-07T22:58:00.000Z', '2026-08-07T23:00:00.000Z', 120000,
          '{"fetchedAt":"2026-08-07T22:55:00.000Z","queryStartAt":"2026-06-08T22:55:00.000Z","mode":"overlapping_60_day_snapshot"}'::jsonb,
          '2026-08-07T22:58:00.000Z'
        )
      `,
      [shopifySourceId],
    );

    await insertEvent({ eventName: "page_view", occurredAt: "2026-08-01T10:00:00.000Z", properties: {} });
    await insertEvent({
      eventName: "page_view",
      occurredAt: "2026-08-01T10:00:30.000Z",
      properties: {},
      sessionId: "aggregate-only-bot-session",
      clientContext: { device_category: "bot", traffic_type: "production" },
    });
    await insertEvent({
      eventName: "page_view",
      occurredAt: "2026-08-01T10:00:45.000Z",
      properties: {},
      sessionId: "aggregate-only-synthetic-session",
      clientContext: { device_category: "desktop", traffic_type: "synthetic" },
    });
    await insertEvent({
      eventName: "build_start",
      occurredAt: "2026-08-01T10:01:00.000Z",
      properties: { item_category: "Build Your Own" },
    });
    await insertEvent({
      eventName: "build_complete",
      occurredAt: "2026-08-01T10:02:00.000Z",
      properties: {
        currency: "USD",
        item_category: "Build Your Own",
        item_instance_id: itemInstanceId,
        stone_count: 3,
        value: 120,
      },
    });
    const commerceItems = [{
      item_id: "builder-fixture",
      item_name: "Builder fixture",
      item_category: "Build Your Own",
      item_instance_id: itemInstanceId,
      price: 120,
      quantity: 1,
    }];
    await insertEvent({
      eventName: "add_to_cart",
      occurredAt: "2026-08-01T10:03:00.000Z",
      properties: { currency: "USD", value: 120, items: commerceItems },
    });
    await insertEvent({
      eventName: "begin_checkout",
      occurredAt: "2026-08-01T10:04:00.000Z",
      eventId: checkoutEventId,
      properties: { currency: "USD", value: 120, items: commerceItems },
    });

    await query(
      `
        insert into commerce_orders (
          id, source_id, shopify_order_id_hash, occurred_at, test, cancelled_at,
          currency_code, gross_sales, current_total, net_payment, total_refunded,
          checkout_event_id_hash, checkout_bridge_state
        ) values (
          $1::uuid, $2::uuid, $3::text, '2026-08-01T10:05:00.000Z', false, null,
          'USD', 120.30, 120.30, 120.30, 0,
          $4::text, 'matched'
        )
      `,
      [orderId, shopifySourceId, hash("fixture-shopify-order"), hash(checkoutEventId)],
    );
    await query(
      `
        insert into commerce_order_lines (
          order_id, shopify_line_item_id_hash, quantity,
          item_instance_id_hash, item_bridge_state
        ) values ($1::uuid, $2::text, 1, $3::text, 'matched')
      `,
      [orderId, hash("fixture-shopify-line"), hash(itemInstanceId)],
    );
  });

  afterAll(async () => {
    if (!enabled) return;
    await query("delete from sources where data_space_id = $1", [dataSpaceId]);
    await query("delete from data_spaces where id = $1", [dataSpaceId]);
    await closeDatabasePool();
  });

  it("executes the production SQL and returns only strict aggregate truth", async () => {
    const report = await getCommerceFunnelV2ReportAggregate({
      dataSpaceId,
      websiteSourceId,
      shopifySourceId,
      startAt: "2026-07-09T07:00:00.000Z",
      endExclusive: "2026-08-08T07:00:00.000Z",
      segment: "all",
    });

    expect(report).toMatchObject({
      state: "ready",
      coverageEndAt: "2026-08-07T22:55:00.000Z",
      businessVisits: 1,
      businessIntents: 1,
      businessCarts: 1,
      eligibleCheckoutEvents: 1,
      excludedBotSessions: 1,
      excludedNonProductionSessions: 1,
      eligibleShopifyOrders: 1,
      linkedOrdersPlaced: 1,
      activeLinkedOrders: 1,
      cancelledLinkedOrders: 0,
      bridgeMatchedOrders: 1,
      bridgeMissingOrders: 0,
      linkedOrderLines: 1,
      eligibleOrderLines: 1,
      money: [{
        currency: "USD",
        orders: 1,
        grossSales: "120.30",
        currentTotal: "120.30",
        netPayment: "120.30",
        refunds: "0",
        state: "healthy",
      }],
    });
    expect(JSON.stringify(report)).not.toMatch(
      /"(?:anonymous(?:_?id)?|event_?id|item_?instance(?:_?id)?|order_?id|session(?:_?id)?|shopify_?line(?:_?item)?(?:_?id)?|source_?id)"\s*:/iu,
    );
  });

  it("rejects a checkout hash replayed by an out-of-range test order retained for the same Shopify source", async () => {
    await query(
      `
        insert into commerce_orders (
          id, source_id, shopify_order_id_hash, occurred_at, test, cancelled_at,
          currency_code, gross_sales, current_total, net_payment, total_refunded,
          checkout_event_id_hash, checkout_bridge_state
        ) values (
          $1::uuid, $2::uuid, $3::text, '2026-06-01T10:05:00.000Z', true, null,
          'USD', 1, 1, 1, 0, $4::text, 'matched'
        )
      `,
      [replayOrderId, shopifySourceId, hash("fixture-replay-order"), hash(checkoutEventId)],
    );

    try {
      const report = await getCommerceFunnelV2ReportAggregate({
        dataSpaceId,
        websiteSourceId,
        shopifySourceId,
        startAt: "2026-07-09T07:00:00.000Z",
        endExclusive: "2026-08-08T07:00:00.000Z",
        segment: "all",
      });

      expect(report).toMatchObject({
        state: "ready",
        eligibleShopifyOrders: 1,
        linkedOrdersPlaced: 0,
        bridgeMatchedOrders: 0,
        bridgeAmbiguousOrders: 1,
      });
    } finally {
      await query("delete from commerce_orders where id = $1::uuid", [replayOrderId]);
    }
  });

  it("fails closed when two Shopify lines reuse one item-instance hash", async () => {
    await query(
      `
        insert into commerce_order_lines (
          order_id, shopify_line_item_id_hash, quantity,
          item_instance_id_hash, item_bridge_state
        ) values ($1::uuid, $2::text, 1, $3::text, 'matched')
      `,
      [orderId, hash("fixture-shopify-line-duplicate"), hash(itemInstanceId)],
    );

    const report = await getCommerceFunnelV2ReportAggregate({
      dataSpaceId,
      websiteSourceId,
      shopifySourceId,
      startAt: "2026-07-09T07:00:00.000Z",
      endExclusive: "2026-08-08T07:00:00.000Z",
      segment: "all",
    });

    expect(report).toMatchObject({
      state: "ready",
      eligibleOrderLines: 1,
      linkedOrderLines: 0,
    });
  });
});
