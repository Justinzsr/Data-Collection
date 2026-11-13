import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryMock,
  queryRowsMock,
  transactionClient,
  withDatabaseTransactionMock,
} = vi.hoisted(() => {
  const client = { kind: "commerce-funnel-v2-read-only-client" };
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
  isRuntimeDatabaseConfigured: () => true,
  query: queryMock,
  queryRows: queryRowsMock,
  withDatabaseTransaction: withDatabaseTransactionMock,
}));

import {
  COMMERCE_FUNNEL_V2_REPORT_RESPONSE_DENYLIST,
  COMMERCE_FUNNEL_V2_REPORT_SQL,
  commerceFunnelV2ReportProjection,
  getCommerceFunnelV2ReportAggregate,
} from "@/storage/repositories/commerce-funnel-v2-report-repository";

const INPUT = {
  dataSpaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  websiteSourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  shopifySourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  startAt: "2026-07-09T07:00:00.000Z",
  endExclusive: "2026-08-08T07:00:00.000Z",
  segment: "all" as const,
};

function aggregateRow() {
  return {
    data_space_count: 1,
    website_candidate_count: 1,
    shopify_candidate_count: 1,
    resolved_sources_match: true,
    bridge_verified: true,
    coverage_start_at: "2026-07-01T00:00:00.000Z",
    coverage_end_at: "2026-08-07T18:00:00.000Z",
    business_visits: 15,
    business_intents: 14,
    business_carts: 13,
    eligible_checkout_events: 12,
    excluded_bot_sessions: 2,
    excluded_non_production_sessions: 3,
    eligible_shopify_orders: 8,
    linked_orders_placed: 6,
    active_linked_orders: 5,
    cancelled_linked_orders: 1,
    bridge_matched_orders: 6,
    bridge_missing_orders: 1,
    bridge_invalid_orders: 1,
    bridge_ambiguous_orders: 0,
    consent_blocked_orders: 1,
    reversed_timestamp_orders: 0,
    pre_coverage_orders: 2,
    linked_order_lines: 4,
    eligible_order_lines: 5,
    money: [{
      currency: "USD",
      orders: 6,
      grossSales: "840.25",
      currentTotal: "810.25",
      netPayment: "780.25",
      refunds: "30",
      state: "healthy",
    }],
  };
}

function compactSql(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

describe("commerce funnel V2 aggregate-only query", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryRowsMock.mockReset();
    withDatabaseTransactionMock.mockClear();
    queryRowsMock.mockResolvedValue([aggregateRow()]);
  });

  it("enforces exact source scope, first-party consent, strict sequence, hash linkage, and Shopify truth", () => {
    const sql = compactSql(COMMERCE_FUNNEL_V2_REPORT_SQL);

    expect(sql).toContain("source.data_space_id = data_space.id");
    expect(sql).toContain("source.source_type_key = 'website'");
    expect(sql).toContain("source.source_type_key = 'shopify'");
    expect(sql).toContain("event.event_source = 'first_party_tracker'");
    expect(sql).toContain("event.schema_version = '1.0'");
    expect(sql).toContain("event.occurred_at > visit.visit_at");
    expect(sql).toContain("event.occurred_at > intent.intent_at");
    expect(sql).toContain("event.occurred_at > cart.cart_at");
    expect(sql).toContain("consent_status ->> 'analytics' = 'granted'");
    expect(sql).toContain("client_context ->> 'traffic_type' = 'production'");
    expect(sql).toContain("client_context ->> 'device_category' = 'bot'");
    expect(sql).toContain("greatest( $4::timestamptz, coalesce(scope.coverage_start_at, $5::timestamptz) )");
    expect(sql).toContain("encode(digest(lower(event.event_id::text), 'sha256'), 'hex')");
    expect(sql).toContain("commerce_order.test is false");
    expect(sql).toContain("commerce_order.occurred_at >= checkout.checkout_at");
    expect(sql).toContain("commerce_order.source_id = scope.shopify_source_id");
    expect(sql).toContain("from commerce_orders commerce_order cross join resolved_scope scope");
    expect(sql).not.toContain("from eligible_orders where checkout_bridge_state = 'matched'");
    expect(sql).toContain("builder_checkout_hash_cardinality");
    expect(sql).toContain("cardinality.checkout_item_count = 1");
    expect(sql).toContain("builder_line_hash_cardinality");
    expect(sql).toContain("cardinality.line_count = 1");
    expect(sql).toContain("sync_run.source_type_key = 'shopify'");
    expect(sql).toContain("sync_run.status = 'success'");
    expect(sql).toContain("sync_run.cursor_after ->> 'fetchedat'");
    expect(COMMERCE_FUNNEL_V2_REPORT_SQL).toContain(
      String.raw`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?`,
    );
    expect(sql).toContain("source_scope.shopify_last_success_at - shopify_sync.finished_at");
    expect(sql).toContain("least($5::timestamptz, shopify_sync.snapshot_fetched_at)");
    expect(sql).not.toContain("least($5::timestamptz, source_scope.shopify_last_success_at)");
    expect(sql).not.toMatch(/email|customer_id|time proximity|fuzzy/iu);
  });

  it("projects only aggregate fields and keeps every identity-bearing field internal", () => {
    const projection = commerceFunnelV2ReportProjection().toLowerCase();

    for (const forbidden of COMMERCE_FUNNEL_V2_REPORT_RESPONSE_DENYLIST) {
      expect(projection, forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "u"));
    }
    expect(projection).toContain("eligible_checkout_events");
    expect(projection).toContain("linked_orders_placed");
    expect(projection).toContain("jsonb_agg");
  });

  it("runs one parameterized aggregate in a repeatable-read, read-only bounded transaction", async () => {
    const result = await getCommerceFunnelV2ReportAggregate(INPUT);

    expect(result).toEqual({
      state: "ready",
      reason: "The aggregate-only commerce bridge is ready.",
      coverageStartAt: "2026-07-01T00:00:00.000Z",
      coverageEndAt: "2026-08-07T18:00:00.000Z",
      businessVisits: 15,
      businessIntents: 14,
      businessCarts: 13,
      eligibleCheckoutEvents: 12,
      excludedBotSessions: 2,
      excludedNonProductionSessions: 3,
      eligibleShopifyOrders: 8,
      linkedOrdersPlaced: 6,
      activeLinkedOrders: 5,
      cancelledLinkedOrders: 1,
      bridgeMatchedOrders: 6,
      bridgeMissingOrders: 1,
      bridgeInvalidOrders: 1,
      bridgeAmbiguousOrders: 0,
      consentBlockedOrders: 1,
      reversedTimestampOrders: 0,
      preCoverageOrders: 2,
      linkedOrderLines: 4,
      eligibleOrderLines: 5,
      money: [expect.objectContaining({ currency: "USD", netPayment: "780.25" })],
    });
    expect(withDatabaseTransactionMock).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      "set transaction isolation level repeatable read, read only",
      undefined,
      transactionClient,
    );
    expect(queryMock).toHaveBeenCalledWith(
      "set local statement_timeout = '8000ms'",
      undefined,
      transactionClient,
    );
    expect(queryRowsMock).toHaveBeenCalledWith(
      COMMERCE_FUNNEL_V2_REPORT_SQL,
      [
        INPUT.dataSpaceId,
        INPUT.websiteSourceId,
        INPUT.shopifySourceId,
        INPUT.startAt,
        INPUT.endExclusive,
        INPUT.segment,
        null,
        null,
      ],
      transactionClient,
    );
  });

  it("normalizes acquisition filters as parameters and withholds unassignable order diagnostics", async () => {
    const result = await getCommerceFunnelV2ReportAggregate({
      ...INPUT,
      utmSource: "  ChatGPT ",
      utmMedium: " PAID ",
    });

    expect(queryRowsMock).toHaveBeenCalledWith(
      COMMERCE_FUNNEL_V2_REPORT_SQL,
      [INPUT.dataSpaceId, INPUT.websiteSourceId, INPUT.shopifySourceId, INPUT.startAt, INPUT.endExclusive, INPUT.segment, "chatgpt", "paid"],
      transactionClient,
    );
    expect(result).toMatchObject({
      state: "ready",
      businessVisits: 15,
      eligibleCheckoutEvents: 12,
      linkedOrdersPlaced: 6,
      bridgeMatchedOrders: 6,
      eligibleShopifyOrders: null,
      bridgeMissingOrders: null,
      bridgeInvalidOrders: null,
      bridgeAmbiguousOrders: null,
      preCoverageOrders: null,
      money: [expect.objectContaining({ currency: "USD", netPayment: "780.25" })],
    });
    expect(result.reason).toContain("Orders without a usable bridge cannot be assigned to this channel");
  });

  it("limits acquisition to consistent first valid page views and keeps bridge replay detection source-wide", () => {
    const sql = compactSql(COMMERCE_FUNNEL_V2_REPORT_SQL);
    const firstVisits = sql.slice(sql.indexOf("first_visit_times as materialized"), sql.indexOf("traffic_sessions as materialized"));
    expect(firstVisits).toContain("from valid_events where event_name = 'page_view'");
    expect(firstVisits).toContain("visit.visit_at = event.occurred_at");
    expect(firstVisits).toContain("bool_and((utm_source = $7::text) is true)");
    expect(firstVisits).toContain("bool_and((utm_medium = $8::text) is true)");
    expect(firstVisits).toContain("'{utm,utm_source}'");
    expect(firstVisits).toContain("'{utm,utm_medium}'");
    expect(firstVisits).toContain("event.attribution_context #> '{utm,source}' <> 'null'::jsonb then event.attribution_context #> '{utm,source}'");
    expect(firstVisits).toContain("case when jsonb_typeof(raw_utm_source) = 'string' then raw_utm_source #>> '{}'");
    expect(COMMERCE_FUNNEL_V2_REPORT_SQL).toContain(String.raw`U&'\0009\000A\000B`);
    expect(firstVisits).not.toContain("referrer");
    const orderScope = sql.slice(sql.indexOf("orders_in_range as materialized"), sql.indexOf("eligible_orders as materialized"));
    expect(orderScope).toContain("from sequenced_checkout_candidates checkout");
    expect(orderScope).toContain("checkout.checkout_event_id_hash = commerce_order.checkout_event_id_hash");
    const replayScope = sql.slice(sql.indexOf("bridge_hash_cardinality as materialized"), sql.indexOf("unique_bridge_orders as materialized"));
    expect(replayScope).toContain("from commerce_orders commerce_order");
    expect(replayScope).not.toContain("acquisition_sessions");
    expect(replayScope).not.toContain("eligible_orders");
  });

  it.each(["", " ", "a".repeat(257)])("rejects invalid acquisition filters before reading aggregates: %s", async (value) => {
    await expect(getCommerceFunnelV2ReportAggregate({ ...INPUT, utmSource: value })).rejects.toThrow("acquisition filter is invalid");
    expect(queryRowsMock).not.toHaveBeenCalled();
  });

  it("fails closed for builder scope because V1 builder cart-to-checkout continuity is unproven", async () => {
    const result = await getCommerceFunnelV2ReportAggregate({ ...INPUT, segment: "builder" });

    expect(result).toMatchObject({ state: "unavailable", linkedOrdersPlaced: null });
    expect(queryRowsMock).not.toHaveBeenCalled();
  });

  it("maps a missing migration table to a sanitized not-measured result", async () => {
    queryRowsMock.mockRejectedValue(Object.assign(new Error("relation commerce_orders secret detail"), {
      code: "42P01",
    }));

    const result = await getCommerceFunnelV2ReportAggregate(INPUT);

    expect(result).toMatchObject({
      state: "migration_unavailable",
      reason: "The commerce bridge migration is unavailable.",
      linkedOrdersPlaced: null,
      money: [],
    });
    expect(JSON.stringify(result)).not.toContain("secret detail");
  });

  it("withholds all values when sources or verified coverage are incomplete", async () => {
    queryRowsMock.mockResolvedValueOnce([{
      ...aggregateRow(),
      website_candidate_count: 2,
      resolved_sources_match: false,
    }]);
    const ambiguous = await getCommerceFunnelV2ReportAggregate(INPUT);
    expect(ambiguous).toMatchObject({ state: "unavailable", eligibleCheckoutEvents: null });

    queryRowsMock.mockResolvedValueOnce([{
      ...aggregateRow(),
      bridge_verified: false,
      coverage_start_at: null,
    }]);
    const uncovered = await getCommerceFunnelV2ReportAggregate(INPUT);
    expect(uncovered).toMatchObject({ state: "unavailable", linkedOrdersPlaced: null });
  });

  it("returns a ready aggregate for an overlapping partial coverage window", async () => {
    queryRowsMock.mockResolvedValueOnce([{
      ...aggregateRow(),
      coverage_start_at: "2026-08-01T00:00:00.000Z",
    }]);

    const result = await getCommerceFunnelV2ReportAggregate(INPUT);

    expect(result).toMatchObject({
      state: "ready",
      coverageStartAt: "2026-08-01T00:00:00.000Z",
      coverageEndAt: "2026-08-07T18:00:00.000Z",
      linkedOrdersPlaced: 6,
    });
  });

  it("fails closed instead of converting invalid aggregate values to zero", async () => {
    queryRowsMock.mockResolvedValueOnce([{
      ...aggregateRow(),
      linked_orders_placed: "not-a-count",
    }]);

    const result = await getCommerceFunnelV2ReportAggregate(INPUT);

    expect(result).toMatchObject({
      state: "unavailable",
      linkedOrdersPlaced: null,
      eligibleCheckoutEvents: null,
    });
  });
});
