import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryMock,
  queryRowsMock,
  transactionClient,
  withDatabaseTransactionMock,
} = vi.hoisted(() => {
  const client = { kind: "website-funnel-read-only-client" };
  return {
    queryMock: vi.fn(),
    queryRowsMock: vi.fn(),
    transactionClient: client,
    withDatabaseTransactionMock: vi.fn(
      async (work: (executor: typeof client) => Promise<unknown>) => work(client),
    ),
  };
});

vi.mock("@/storage/db/client", () => ({
  query: queryMock,
  queryRows: queryRowsMock,
  withDatabaseTransaction: withDatabaseTransactionMock,
}));

import { WEBSITE_FUNNEL_EVENT_NAMES } from "@/aggregation/metric-definitions/website-funnel-definitions";
import {
  getWebsiteFunnelAggregate,
  WEBSITE_FUNNEL_AGGREGATE_RESPONSE_DENYLIST,
  WEBSITE_FUNNEL_AGGREGATE_SQL,
  WEBSITE_FUNNEL_EVENT_TAXONOMY,
  websiteFunnelAggregateProjection,
  websiteFunnelQueryValues,
  type WebsiteFunnelAggregateRow,
  type WebsiteFunnelRepositoryInput,
} from "@/storage/repositories/website-funnel-repository";

const DATA_SPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function input(
  overrides: Partial<WebsiteFunnelRepositoryInput> = {},
): WebsiteFunnelRepositoryInput {
  return {
    dataSpaceId: DATA_SPACE_ID,
    current: {
      startAt: "2026-07-01T07:00:00.000Z",
      endExclusive: "2026-07-08T07:00:00.000Z",
    },
    comparison: {
      startAt: "2026-06-24T07:00:00.000Z",
      endExclusive: "2026-07-01T07:00:00.000Z",
    },
    ...overrides,
  };
}

function compactSql(sql: string) {
  return sql.replace(/\s+/gu, " ").trim().toLowerCase();
}

function emptyAggregate(): WebsiteFunnelAggregateRow {
  return {
    candidate_count: 1,
    source: { display_name: "MoonArq Website", status: "healthy" },
    coverage: {
      first_occurred_at: "2026-07-01T07:00:00.000Z",
      latest_received_at: "2026-07-08T06:59:00.000Z",
    },
    stages: [],
    daily_trend: [],
    quality: [],
    journeys: [],
    engagement: [],
    products: [],
    collections: [],
    acquisition: [],
    devices: [],
    filter_options: {
      devices: [],
      utm_sources: [],
      utm_mediums: [],
      utm_campaigns: [],
      landing_pages: [],
      referrer_hosts: [],
    },
    group_totals: { products: 0, collections: 0, acquisition: 0 },
    event_counts: [],
    unknown_events: [],
    invalid_properties: [],
    reconciliation: [],
  };
}

describe("Website funnel aggregate SQL", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryRowsMock.mockReset();
    withDatabaseTransactionMock.mockClear();
  });

  it("fails closed unless exactly one active Website source belongs to the data space", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(sql).toContain("s.data_space_id = $1::uuid");
    expect(sql).toContain("s.source_type_key = 'website'");
    expect(sql).toContain("s.status <> 'disabled'");
    expect(sql).toContain("where gate.candidate_count = 1");
    expect(sql).toContain("e.event_source = 'first_party_tracker'");
    expect(sql).not.toContain("vercel_drain");
  });

  it("uses explicit half-open current and comparison periods with no raw row limit", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(sql).toContain("('current'::text, $2::timestamptz, $3::timestamptz)");
    expect(sql).toContain("('comparison'::text, $4::timestamptz, $5::timestamptz)");
    expect(sql).toContain("e.occurred_at >= period.start_at");
    expect(sql).toContain("e.occurred_at < period.end_at");
    const rawEventWindow = sql.slice(
      sql.indexOf("period_event_candidates as materialized"),
      sql.indexOf("known_events as materialized"),
    );
    expect(rawEventWindow).not.toMatch(/\blimit\b/u);
  });

  it("passes the frozen taxonomy as a fixed parameter and preserves unknown diagnostics", () => {
    expect(WEBSITE_FUNNEL_EVENT_TAXONOMY).toBe(WEBSITE_FUNNEL_EVENT_NAMES);
    expect(WEBSITE_FUNNEL_EVENT_TAXONOMY).toEqual([
      "page_view",
      "view_item_list",
      "view_item",
      "add_to_cart",
      "begin_checkout",
      "build_start",
      "build_complete",
      "save_design",
      "email_signup",
    ]);

    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);
    expect(sql).toContain("event_name = any($6::text[])");
    expect(sql).toContain("event_name <> all($6::text[])");
  });

  it("applies the frozen property contract before events can qualify for aggregates", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(sql).toContain("jsonb_array_length(event.properties -> 'items') between 1 and 100");
    expect(sql).toContain(
      "item_entry.item ?& array['item_id', 'item_name', 'item_category']::text[]",
    );
    expect(sql).toContain(") is not true");
    expect(sql).toContain(
      "display.display_safety -> ('item_id:' || item_entry.item_index::text) = 'true'::jsonb",
    );
    expect(sql).toContain(
      "display.display_safety -> ('item_name:' || item_entry.item_index::text) = 'true'::jsonb",
    );
    expect(sql).toContain(
      "display.display_safety -> ('item_category:' || item_entry.item_index::text) = 'true'::jsonb",
    );
    expect(sql).toContain("(item_entry.item ->> 'price')::numeric >= 0");
    expect(sql).toContain("(item_entry.item ->> 'quantity')::numeric >= 1");
    expect(sql).toContain("trunc((item_entry.item ->> 'quantity')::numeric) = (item_entry.item ->> 'quantity')::numeric");
    expect(sql).toContain("btrim(event.properties ->> 'currency') ~ '^[a-z]{3}$'");
    expect(sql).toContain("lower(btrim(item ->> 'item_category')) <> 'build your own'");
    expect(sql).toContain("array['currency', 'value', 'items', 'attribution']");
    expect(sql).toContain("array['discount_code', 'method', 'attribution']");
    expect(sql).toContain("(event.properties ->> 'value')::numeric >= 0");
    expect(sql).toContain("trunc((event.properties ->> 'stone_count')::numeric) = (event.properties ->> 'stone_count')::numeric");
    expect(sql).toContain("jsonb_typeof(event.properties) is distinct from 'object'");
    expect(sql).toContain("from classified_events where property_valid is true");
    expect(sql).toContain("from classified_known_events where property_valid is true and event_name = 'page_view'");
    expect(sql).toContain("from diagnostic_known_events where property_valid is not true");
    expect(sql).toContain("as items_are_valid");
    expect(sql).toContain("as commerce_values_are_valid");
    expect(sql).toContain("is true as property_valid");
    expect(sql).toContain("is true as has_ready_made_item");
  });

  it("normalizes historical display values before session context and projection", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    for (const cte of [
      "raw_display_values as materialized",
      "display_value_features as materialized",
      "display_value_numeric_features as materialized",
      "display_value_risks as materialized",
      "validated_display_values as materialized",
      "normalized_display_values as materialized",
      "display_value_maps as materialized",
    ]) {
      expect(sql).toContain(cte);
    }
    expect(sql).toContain("risk.raw_text !~* '%(25)*(40|3f|23)'");
    expect(sql).toContain("pg_input_is_valid(risk.ipv4_candidate, 'inet') is not true");
    expect(sql).toContain("lower(coalesce(feature.raw_text, '')) ~ '^https?://[^/?#]+(/[^?#]*)?$'");
    expect(sql).toContain(
      "when event.display_presence -> 'first_referrer' = 'true'::jsonb",
    );
    expect(sql).toContain(
      "else coalesce(event.display_values ->> 'fallback_referrer', 'unknown')",
    );
    expect(sql.indexOf("normalized_display_values as materialized")).toBeLessThan(
      sql.indexOf("session_context as materialized"),
    );
    expect(sql.indexOf("normalized_display_values as materialized")).toBeLessThan(
      sql.indexOf("filter_options as"),
    );
  });

  it("deduplicates source/event identity before aggregate sequencing", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(sql).toContain(
      "partition by period.period_key, e.source_id, e.event_id",
    );
    expect(sql).toContain("where delivery_rank = 1");
    expect(sql).toContain("candidate.delivery_rank > 1");
  });

  it("uses strict occurred-at sequencing and reports equal-time and unsequenced activity", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    for (const strictEdge of [
      "event.occurred_at > visit.visit_at",
      "event.occurred_at > intent.intent_at",
      "event.occurred_at > cart.cart_at",
      "event.occurred_at > build_start.build_start_at",
      "product_event.occurred_at > event.occurred_at",
      "cart_event.occurred_at > product_view.product_view_at",
    ]) {
      expect(sql).toContain(strictEdge);
    }
    for (const disclosure of [
      "equal_time_intent_sessions",
      "equal_time_cart_sessions",
      "equal_time_checkout_sessions",
      "unsequenced_intent_sessions",
      "unsequenced_cart_sessions",
      "unsequenced_checkout_sessions",
      "equal_time_build_complete_sessions",
      "equal_time_save_design_sessions",
      "equal_time_progression_sessions",
    ]) {
      expect(sql).toContain(disclosure);
    }
    expect(sql).toContain("from diagnostic_known_events event");
    expect(sql).toContain("from diagnostic_unknown_events unknown_event");
    expect(sql).toContain("quality_intents as materialized");
    expect(sql).toContain("quality_carts as materialized");
    expect(sql).toContain("quality_checkouts as materialized");
    const qualityWindow = sql.slice(
      sql.indexOf("quality as"),
      sql.indexOf("ready_made_views as materialized"),
    );
    expect(qualityWindow).not.toContain("$18::text");
  });

  it("requires an exact shared item identity for collection-to-product progression", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(sql).toContain(
      "event.display_values ->> ('item_id:' || list_entry.item_index::text) = product_event.display_values ->> ('item_id:' || product_entry.item_index::text)",
    );
    expect(sql).toContain(
      "jsonb_array_elements(event.properties -> 'items') with ordinality as list_entry(item, item_index)",
    );
    expect(sql).toContain(
      "jsonb_array_elements( product_event.properties -> 'items' ) with ordinality as product_entry(item, item_index)",
    );
    expect(sql).toContain(
      "'unknown / unmapped'::text as item_list_name",
    );
  });

  it("keeps invalid product metadata visible and requires view-and-cart evidence for stability", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(sql).toContain(
      "'unknown / unmapped'::text as item_id",
    );
    expect(sql).toContain("activity.product_view_sessions > 0");
    expect(sql).toContain("activity.add_to_cart_sessions > 0");
    expect(sql).toContain("false as stable_identity");
  });

  it("returns real journey event counts instead of reusing session counts", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    for (const field of [
      "visit_events",
      "product_view_events",
      "add_to_cart_events",
      "begin_checkout_events",
      "build_start_events",
      "build_complete_events",
      "save_design_events",
    ]) {
      expect(sql).toContain(`as ${field}`);
    }
  });

  it("paginates only grouped dimension rows after full-range aggregation", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    for (const groupedCte of [
      "product_ranked as",
      "collection_ranked as",
      "acquisition_ranked as",
      "unknown_ranked as",
    ]) {
      expect(sql).toContain(groupedCte);
    }
    expect(sql).toContain("grouped_row_number <= $14::integer + $13::integer");
    expect(sql).toContain("grouped_row_number <= $15::integer + $13::integer");
    expect(sql).toContain("grouped_row_number <= $16::integer + $13::integer");
    expect(sql).toContain("grouped_row_number <= $17::integer + $13::integer");
    expect(sql).toContain("group_totals as");
    expect(websiteFunnelAggregateProjection()).toContain("as group_totals");
  });

  it("counts canonical first-visit visitor identity at every stage", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(sql).toContain("count(distinct session.anonymous_id) as visitors");
    expect(sql).toContain(
      "join filtered_session_context session on session.period_key = stage.period_key",
    );
    expect(sql).not.toContain("count(distinct stage.anonymous_id) as visitors");
  });

  it("returns truthful acquisition tuples and per-device funnel progression", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(sql).toContain(
      "group by session.period_key, session.utm_source, session.utm_medium, session.utm_campaign, session.landing_page, session.referrer_host",
    );
    expect(sql).toContain(
      "count(*) filter ( where funnel.intent_at is not null ) as product_intent_sessions",
    );
    expect(sql).toContain(
      "count(*) filter ( where funnel.checkout_at is not null ) as checkout_sessions",
    );
    expect(sql).toContain(
      "group by session.period_key, session.device_category",
    );
    expect(websiteFunnelAggregateProjection()).toContain("as devices");
  });

  it("returns complete pre-pagination filter options and exact selected event counts", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);
    const projection = websiteFunnelAggregateProjection();

    expect(sql).toContain("filter_options as");
    expect(sql).toContain("select distinct utm_source from session_context");
    expect(sql).toContain("order by utm_source limit 100");
    expect(sql).toContain("filtered_all_events as materialized");
    expect(sql).toContain("period_event_counts as");
    expect(projection).toContain("as filter_options");
    expect(projection).toContain("as event_counts");
  });

  it("reconciles only completed Pacific days and detects partially missing daily rows", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(sql).toContain("reconciliation_periods as");
    expect(sql).toContain(
      "date_trunc( 'day', period.end_at at time zone 'america/los_angeles' ) at time zone 'america/los_angeles'",
    );
    expect(sql).toContain("event.occurred_at < period.end_at");
    expect(sql).toContain("as raw_page_view_days");
    expect(sql).toContain("as raw_custom_event_days");
    expect(sql).toContain("as page_view_metric_rows");
    expect(sql).toContain("as custom_event_metric_rows");
  });

  it("keeps the final projection aggregate-only", () => {
    const projection = websiteFunnelAggregateProjection().toLowerCase();

    for (const deniedField of WEBSITE_FUNNEL_AGGREGATE_RESPONSE_DENYLIST) {
      expect(projection).not.toMatch(
        new RegExp(`\\b${deniedField}\\b`, "u"),
      );
    }
    expect(projection).toContain("'display_name'");
    expect(projection).toContain("'status'");
    expect(projection).toContain("stages");
    expect(projection).toContain("daily_trend");
    expect(projection).toContain("reconciliation");
  });

  it("builds stable positional parameters and normalizes safe filters", () => {
    const values = websiteFunnelQueryValues(input({
      filters: {
        utmSource: " Instagram ",
        utmMedium: " Paid_Social ",
        utmCampaign: "Moon Drop",
        referrerHost: "EXAMPLE.COM",
        deviceCategory: "mobile",
      },
      pagination: {
        groupLimit: 40,
        productOffset: 1,
        collectionOffset: 2,
        acquisitionOffset: 3,
        unknownEventOffset: 4,
      },
    }));

    expect(values).toHaveLength(18);
    expect(values.slice(0, 6)).toEqual([
      DATA_SPACE_ID,
      "2026-07-01T07:00:00.000Z",
      "2026-07-08T07:00:00.000Z",
      "2026-06-24T07:00:00.000Z",
      "2026-07-01T07:00:00.000Z",
      [...WEBSITE_FUNNEL_EVENT_TAXONOMY],
    ]);
    expect(values.slice(6)).toEqual([
      "instagram",
      "paid_social",
      "Moon Drop",
      null,
      "example.com",
      "mobile",
      40,
      1,
      2,
      3,
      4,
      "all",
    ]);
  });

  it("discards unsafe dimension and invalid device filters without reflecting them", () => {
    const unsafe = ["private", "-person", "@", "example.invalid"].join("");
    const values = websiteFunnelQueryValues(input({
      filters: {
        utmSource: unsafe,
        utmMedium: `encoded%2540${unsafe}`,
        utmCampaign: unsafe,
        landingPage: `/collections/${unsafe}`,
        referrerHost: unsafe,
        deviceCategory: "television",
      },
    }));

    expect(values.slice(6, 12)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(JSON.stringify(values).includes(unsafe)).toBe(false);
  });

  it("uses one explicit Unknown sentinel for missing acquisition and device filters", () => {
    const values = websiteFunnelQueryValues(input({
      filters: {
        utmSource: "unknown",
        utmMedium: "UNKNOWN",
        utmCampaign: " Unknown ",
        landingPage: "unknown",
        referrerHost: "UnKnOwN",
        deviceCategory: "unknown",
      },
    }));

    expect(values.slice(6, 12)).toEqual([
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
    ]);
    expect(values[17]).toBe("all");
    expect(compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL)).toContain(
      "when event.client_context ->> 'device_category' in ('mobile', 'tablet', 'desktop', 'bot')",
    );
  });

  it("binds an allowlisted segment for coherent stages, trend, acquisition, and device rates", () => {
    const values = websiteFunnelQueryValues(input({ segment: "ready-made" }));
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);

    expect(values[17]).toBe("ready-made");
    expect(sql).toContain("$18::text = 'ready-made'");
    expect(sql).toContain("$18::text = 'builder'");
    expect(sql).toContain("$18::text <> 'builder'");
    expect(() => websiteFunnelQueryValues(input({
      segment: "invalid" as WebsiteFunnelRepositoryInput["segment"],
    }))).toThrow(/segment must be/u);
  });

  it("rejects unbounded periods and invalid final-group pagination", () => {
    expect(() => websiteFunnelQueryValues(input({
      current: {
        startAt: "2026-01-01T08:00:00.000Z",
        endExclusive: "2026-07-08T07:00:00.000Z",
      },
    }))).toThrow(/cannot exceed 32 days/u);

    expect(() => websiteFunnelQueryValues(input({
      pagination: { groupLimit: 101 },
    }))).toThrow(/groupLimit/u);

    const exactMidnightValues = websiteFunnelQueryValues(input({
      current: {
        startAt: "2026-07-08T07:00:00.000Z",
        endExclusive: "2026-07-08T07:00:00.000Z",
      },
    }));
    expect(exactMidnightValues[1]).toBe(exactMidnightValues[2]);

    expect(() => websiteFunnelQueryValues(input({
      comparison: {
        startAt: "2026-07-01T07:00:00.000Z",
        endExclusive: "2026-07-01T07:00:00.000Z",
      },
    }))).toThrow(/non-empty half-open range/u);
  });

  it("executes in one repeatable-read, read-only transaction with a local timeout", async () => {
    const aggregate = emptyAggregate();
    queryRowsMock.mockResolvedValueOnce([aggregate]);

    await expect(getWebsiteFunnelAggregate(input())).resolves.toEqual(aggregate);

    expect(withDatabaseTransactionMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      "set transaction isolation level repeatable read, read only",
      undefined,
      transactionClient,
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      "set local statement_timeout = '8000ms'",
      undefined,
      transactionClient,
    );
    expect(queryRowsMock).toHaveBeenCalledWith(
      WEBSITE_FUNNEL_AGGREGATE_SQL,
      websiteFunnelQueryValues(input()),
      transactionClient,
    );
  });
});
