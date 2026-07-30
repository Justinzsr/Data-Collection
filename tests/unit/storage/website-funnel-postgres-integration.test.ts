import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabasePool, query } from "@/storage/db/client";
import { getWebsiteFunnelAggregate } from "@/storage/repositories/website-funnel-repository";

const enabled = process.env.RUN_WEBSITE_FUNNEL_POSTGRES_TEST === "true";
const databaseUrl = process.env.DATABASE_URL;
const dataSpaceId = randomUUID();
const websiteSourceId = randomUUID();
const otherSourceId = randomUUID();
let insertedWebsiteSourceType = false;

function requireDisposableLocalDatabase() {
  if (!enabled) return;
  if (!databaseUrl) throw new Error("The opt-in Website funnel PostgreSQL test requires DATABASE_URL.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("The opt-in Website funnel PostgreSQL test only runs against a local disposable database.");
  }
}

async function insertEvent(input: {
  sourceId: string;
  eventName: string;
  occurredAt: string;
  properties?: unknown;
  eventSource?: "first_party_tracker" | "vercel_drain";
}) {
  await query(
    `
      insert into web_events (
        id,
        event_id,
        schema_version,
        event_source,
        source_id,
        anonymous_id,
        session_id,
        event_name,
        path,
        url,
        properties,
        attribution_context,
        consent_status,
        client_context,
        occurred_at,
        received_at,
        created_at
      ) values (
        $1::uuid,
        $2::uuid,
        '1.0',
        $3::text,
        $4::uuid,
        'fixture-visitor',
        'fixture-session',
        $5::text,
        '/products/fixture',
        'https://fixture.invalid/products/fixture',
        $6::jsonb,
        '{"utm":{"source":"fixture","medium":"test","campaign":"contract-v1"},"landing_page":"/products/fixture"}'::jsonb,
        '{"analytics":"granted","marketing":"denied"}'::jsonb,
        '{"device_category":"desktop"}'::jsonb,
        $7::timestamptz,
        $7::timestamptz + interval '1 second',
        $7::timestamptz + interval '1 second'
      )
    `,
    [
      randomUUID(),
      randomUUID(),
      input.eventSource ?? "first_party_tracker",
      input.sourceId,
      input.eventName,
      JSON.stringify(input.properties ?? {}),
      input.occurredAt,
    ],
  );
}

describe.skipIf(!enabled)("Website funnel PostgreSQL aggregate", () => {
  beforeAll(async () => {
    requireDisposableLocalDatabase();
    const sourceType = await query(
      `
        insert into source_types (
          key,
          display_name,
          description,
          category,
          auth_type
        ) values (
          'website',
          'Website',
          'Disposable Website funnel integration source.',
          'website',
          'public_key'
        )
        on conflict (key) do nothing
        returning key
      `,
    );
    insertedWebsiteSourceType = sourceType.rowCount === 1;
    await query(
      `
        insert into data_spaces (
          id, slug, display_name, category, status
        ) values (
          $1::uuid, $2::text, 'Funnel integration fixture', 'test', 'active'
        )
      `,
      [dataSpaceId, `funnel-fixture-${dataSpaceId}`],
    );
    await query(
      `
        insert into sources (
          id,
          data_space_id,
          source_type_key,
          display_name,
          status,
          sync_mode
        ) values
          ($1::uuid, $3::uuid, 'website', 'Fixture Website', 'healthy', 'webhook'),
          ($2::uuid, $3::uuid, 'website', 'Other data-space Website', 'healthy', 'webhook')
      `,
      [websiteSourceId, otherSourceId, dataSpaceId],
    );
    await query(
      "update sources set status = 'disabled' where id = $1::uuid",
      [otherSourceId],
    );

    const item = {
      item_id: "FIXTURE-SKU",
      item_name: "Fixture product",
      item_category: "Ready-made",
      quantity: 1,
    };
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "page_view",
      occurredAt: "2026-07-02T16:00:00.000Z",
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "view_item",
      occurredAt: "2026-07-02T16:01:00.000Z",
      properties: {
        currency: " USD ",
        value: 80,
        items: [item],
        attribution: { utm: { source: "fixture", medium: "test" } },
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "add_to_cart",
      occurredAt: "2026-07-02T16:02:00.000Z",
      properties: { currency: "USD", value: 80, items: [item] },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "begin_checkout",
      occurredAt: "2026-07-02T16:03:00.000Z",
      properties: {
        currency: "USD",
        value: 80,
        items: [{ ...item, item_id: "fixture-product-slug" }],
      },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "view_item",
      occurredAt: "2026-07-02T16:04:00.000Z",
      properties: null,
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "fixture_unknown",
      occurredAt: "2026-07-02T16:05:00.000Z",
      properties: { diagnostic: true },
    });
    await insertEvent({
      sourceId: websiteSourceId,
      eventName: "page_view",
      occurredAt: "2026-07-02T16:06:00.000Z",
      eventSource: "vercel_drain",
    });
  });

  afterAll(async () => {
    if (enabled) {
      await query(
        "delete from web_events where source_id = any($1::uuid[])",
        [[websiteSourceId, otherSourceId]],
      );
      await query(
        "delete from sources where id = any($1::uuid[])",
        [[websiteSourceId, otherSourceId]],
      );
      await query("delete from data_spaces where id = $1::uuid", [dataSpaceId]);
      if (insertedWebsiteSourceType) {
        await query("delete from source_types where key = 'website'");
      }
      await closeDatabasePool();
    }
  });

  it("executes the fixed query and preserves strict first-party semantics", async () => {
    const result = await getWebsiteFunnelAggregate({
      dataSpaceId,
      segment: "all",
      current: {
        startAt: "2026-07-01T07:00:00.000Z",
        endExclusive: "2026-07-08T07:00:00.000Z",
      },
      comparison: {
        startAt: "2026-06-24T07:00:00.000Z",
        endExclusive: "2026-07-01T07:00:00.000Z",
      },
    });

    expect(result.candidate_count).toBe(1);
    expect(
      result.stages
        .filter((row) => row.period_key === "current")
        .map((row) => [row.stage_key, Number(row.sessions)]),
    ).toEqual([
      ["visit", 1],
      ["product_intent", 1],
      ["add_to_cart", 1],
      ["begin_checkout", 1],
    ]);
    expect(result.invalid_properties).toContainEqual({
      period_key: "current",
      event_name: "view_item",
      events: 1,
    });
    expect(result.unknown_events[0]).toMatchObject({
      period_key: "current",
      event_name: "fixture_unknown",
      events: 1,
    });
    expect(result.event_counts).toContainEqual({
      period_key: "current",
      accepted_events: 6,
      unfiltered_events: 6,
    });
    expect(result.products.find((row) => row.item_id === "FIXTURE-SKU")).toMatchObject({
      stable_identity: true,
      product_view_sessions: 1,
      add_to_cart_sessions: 1,
      matched_view_to_cart_sessions: 1,
    });
    expect(result.products.find((row) => row.item_id === "Unknown / unmapped")).toMatchObject({
      stable_identity: false,
      product_view_events: 1,
    });
    expect(result.filter_options).toMatchObject({
      devices: ["desktop"],
      utm_sources: ["fixture"],
      utm_mediums: ["test"],
    });

    const exactMidnight = await getWebsiteFunnelAggregate({
      dataSpaceId,
      segment: "all",
      current: {
        startAt: "2026-07-08T07:00:00.000Z",
        endExclusive: "2026-07-08T07:00:00.000Z",
      },
      comparison: {
        startAt: "2026-07-01T07:00:00.000Z",
        endExclusive: "2026-07-08T07:00:00.000Z",
      },
    });

    expect(exactMidnight.candidate_count).toBe(1);
    expect(exactMidnight.source).toMatchObject({
      display_name: "Fixture Website",
      status: "healthy",
    });
    expect(exactMidnight.event_counts).toContainEqual({
      period_key: "current",
      accepted_events: 0,
      unfiltered_events: 0,
    });
  });
});
