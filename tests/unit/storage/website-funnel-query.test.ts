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

const ECMASCRIPT_TRIM_CHARACTERS_SQL_COMPACT = String.raw`u&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'`;
const ECMASCRIPT_NUMBER_OVERFLOW_THRESHOLD = (
  (BigInt(1) << BigInt(1024)) - (BigInt(1) << BigInt(970))
).toString();

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
    const numericSafetyStart = sql.indexOf("known_event_numeric_safety as materialized");
    const numericSafetyEnd = sql.indexOf("unknown_event_rows as materialized");
    const numericSafetySql = sql.slice(numericSafetyStart, numericSafetyEnd);

    expect(numericSafetyStart).toBeGreaterThan(-1);
    expect(numericSafetyEnd).toBeGreaterThan(numericSafetyStart);
    expect(sql).toContain("known_event_numeric_safety as materialized");
    expect(sql).toContain(
      "select event.period_key, event.event_id, not exists",
    );
    expect(sql).toContain(
      "when event.event_name = 'page_view' then event.properties",
    );
    expect(sql).toContain(
      "when jsonb_typeof(event.properties) = 'object' then event.properties - 'attribution'",
    );
    expect(sql).toContain("'strict $.** ? (@.type() == \"number\")'");
    expect(sql).toContain(
      `abs((numeric_leaf.value #>> '{}')::numeric) >= ${ECMASCRIPT_NUMBER_OVERFLOW_THRESHOLD}::numeric`,
    );
    expect(numericSafetySql).not.toContain("double precision");
    expect(numericSafetySql).not.toContain("::real");
    expect(numericSafetySql).not.toContain("::float");
    expect(numericSafetySql).not.toContain(" regexp ");
    expect(numericSafetySql).not.toContain(" ~ ");
    expect(sql).toContain(
      "when jsonb_typeof(event.properties) is distinct from 'object' then false when event.properties_have_only_finite_numbers is not true then false",
    );
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
    expect(sql).toContain(
      `btrim( event.properties ->> 'currency', ${ECMASCRIPT_TRIM_CHARACTERS_SQL_COMPACT} ) ~ '^[a-z]{3}$'`,
    );
    expect(sql).toContain(
      `lower(btrim( item ->> 'item_category', ${ECMASCRIPT_TRIM_CHARACTERS_SQL_COMPACT} )) <> 'build your own'`,
    );
    expect(sql).toContain(
      `char_length(btrim( event.properties ->> 'discount_code', ${ECMASCRIPT_TRIM_CHARACTERS_SQL_COMPACT} )) between 1 and 160`,
    );
    expect(sql).toContain(
      `char_length(btrim( event.properties ->> 'method', ${ECMASCRIPT_TRIM_CHARACTERS_SQL_COMPACT} )) between 1 and 160`,
    );
    expect(sql.split(ECMASCRIPT_TRIM_CHARACTERS_SQL_COMPACT)).toHaveLength(8);
    expect(sql).toContain("array['currency', 'value', 'items', 'attribution']");
    expect(sql).toContain("array['discount_code', 'method', 'attribution']");
    expect(sql).toContain("(event.properties ->> 'value')::numeric >= 0");
    expect(sql).toContain("trunc((event.properties ->> 'stone_count')::numeric) = (event.properties ->> 'stone_count')::numeric");
    expect(sql).toContain("jsonb_typeof(event.properties) is distinct from 'object'");
    expect(sql).toContain("from classified_events where property_valid is true");
    expect(sql).toContain("from classified_known_events candidate where candidate.event_name = 'page_view' and candidate.property_valid is true");
    expect(sql).toContain("from diagnostic_known_events where property_valid is not true");
    expect(sql).toContain("as items_are_valid");
    expect(sql).toContain("as commerce_values_are_valid");
    expect(sql).toContain("is true as property_valid");
    expect(sql).toContain(
      "event.properties_have_only_finite_numbers is true and event.items_are_valid is true",
    );
    expect(sql).toContain(
      "where event_name = 'view_item_list' and property_valid is not true and properties_have_only_finite_numbers is true",
    );
    expect(sql).toContain(
      "where event.event_name in ('view_item', 'add_to_cart') and event.property_valid is not true and event.properties_have_only_finite_numbers is true",
    );
    expect(sql).toContain("is true as has_ready_made_item");
  });

  it("normalizes historical display values before session context and projection", () => {
    const sql = compactSql(WEBSITE_FUNNEL_AGGREGATE_SQL);
    const referenceStart = sql.indexOf("display_value_references as materialized");
    const referenceEnd = sql.indexOf("display_value_features as materialized");
    const referenceSql = sql.slice(referenceStart, referenceEnd);

    for (const cte of [
      "raw_display_values as materialized",
      "display_value_catalog as materialized",
      "display_value_references as materialized",
      "display_value_features as materialized",
      "display_value_numeric_features as materialized",
      "display_value_payment_inputs as materialized",
      "display_value_payment_segments_raw as materialized",
      "display_value_payment_segments as materialized",
      "display_value_payment_digit_contributions as materialized",
      "display_value_payment_running_sums as materialized",
      "display_value_payment_prefixes as materialized",
      "display_value_payment_risks as materialized",
      "display_value_risks as materialized",
      "validated_display_values as materialized",
      "normalized_display_value_catalog as materialized",
      "normalized_display_values as materialized",
      "display_value_maps as materialized",
    ]) {
      expect(sql).toContain(cte);
    }
    expect(sql).toContain("risk.raw_text !~* '%(25)*(40|3f|23)'");
    expect(sql).toContain("risk.likely_ipv4 is not true");
    expect(sql).toContain(
      "coalesce(feature.scan_text, '') collate \"pg_c_utf8\" ~ '(?=(?<![0-9])",
    );
    expect(sql).toContain("numeric_privacy_probe.normalized_numeric_privacy_scan_text collate \"pg_c_utf8\" ~ '(?=(?<![0-9])");
    expect(sql).toContain("as likely_alternative_ipv4_url");
    expect(sql).toContain("((https?|ftp|ws|wss):[\\\\/]*|file:[\\\\/]{2})");
    expect(sql).toContain("'(^|.)([\\\\/]{2,}([^/?#@\\\\]*@)*");
    expect(sql).toContain("where relative_network.match[1] = ''");
    expect(sql).toContain("relative_network.match[1] <> ':'");
    expect(sql).toContain("(0x[0-9a-f]+|[0-9]+)(\\.(0x[0-9a-f]+|[0-9]+)){0,3}");
    expect(sql).toContain("feature.scan_text collate \"pg_c_utf8\" ~ '(?:\\+");
    expect(sql).toContain("or feature.normalized_numeric_privacy_scan_text collate \"pg_c_utf8\" ~ '(?:\\+");
    expect(sql).toContain("lower(coalesce(feature.raw_text, '')) ~ '^https?://[^/?#]+(/[^?#]*)?$'");
    expect(sql).toContain("false as decode_failed");
    expect(sql).toContain("decoded.decode_valid is not true as decode_failed");
    expect(sql).toContain("convert_from(decode(encoded.hex_text, 'hex'), 'utf8')");
    expect(sql).toContain("and position('%' in variant.scan_text) > 0");
    expect(sql).toContain("risk.decode_failed is true");
    expect(sql).toContain("risk.decode_pass = 3 and position('%' in risk.scan_text) > 0");
    expect(sql).toContain("regexp_count( risk.normalized_privacy_scan_text collate \"pg_c_utf8\", '%[0-9a-f]{2}', 1, 'i' ) > regexp_count( risk.scan_text collate \"pg_c_utf8\", '%[0-9a-f]{2}', 1, 'i' )");
    expect(sql).toContain("as raw_text_utf16_length");
    expect(sql).toContain("normalize( translate( normalized_scan.trimmed_text");
    expect(sql).toContain("u&'\\a7f1\\+01ccd6");
    expect(sql).toContain("normalized_privacy_spaced_scan_text");
    expect(sql).toContain("unicode_decimal_digit_blocks(block_start) as materialized");
    expect(sql).toContain("when octet_length(numeric_probe.scan_text) = char_length(numeric_probe.scan_text)");
    expect(sql).toContain("('removed', privacy_probe_prepared.normalized_privacy_scan_text)");
    expect(sql).toContain("('spaced', privacy_probe_prepared.normalized_privacy_spaced_scan_text)");
    expect(sql).toContain("normalized_numeric_privacy_spaced_scan_text");
    expect(sql).toContain("u&'[^\\0020-\\007e[:alnum:][:space:]]'");
    expect(sql).toContain("u&'[\\00ad\\034f\\0600-\\0605\\061c");
    expect(sql).toContain(
      "u&'[^@[:space:]]+@(?:[^@[:space:].]+[.])+[^@[:space:]._]{2,63}(?![a-z0-9_\\0080-\\+10ffff])'",
    );
    expect(sql).toContain(
      "(^|[^a-z0-9_])bearer[[:space:]]+[a-z0-9._~+/-]+={0,}(?![a-z0-9._~+/=-])",
    );
    expect(sql).toContain(
      "(^|[^a-z0-9_])basic[[:space:]]+([a-z0-9+/]{2,}={0,2})(?![a-z0-9+/=])",
    );
    expect(sql).toContain("position( decode('3a', 'hex') in decode(");
    expect(sql).toContain("sensitive_display_key_families(value, safe_terminal_suffix) as materialized");
    expect(sql).toContain("sensitive_display_key_contract( family_pattern, safe_terminal_pattern, split_family_pattern ) as materialized");
    expect(sql).toContain("string_agg( family.value, '|' order by char_length(family.value) desc, family.value )");
    expect(sql).toContain("with ordinality character(value, delimiter_index)");
    expect(sql).toContain("from greatest(delimiter_character.delimiter_index::integer - 1200, 1)");
    expect(sql).toContain("prefix_exceeds_inspection_limit");
    expect(sql).toContain("char_length(translate(privacy_scan.scan_text, '=:/', '')) > 64");
    expect(sql).toContain("where character.value in ('=', ':', '/')");
    expect(sql).not.toContain("regexp_instr(");
    expect(sql).not.toContain("sensitive_display_key_patterns");
    expect(sql).not.toContain("camel_spaced_key");
    expect(sql).toContain("sensitive_key.safe_terminal_pattern");
    expect(sql).toContain("sensitive_key.split_family_pattern");
    expect(sql).toContain("collate \"pg_c_utf8\" ~ sensitive_key.family_pattern");
    expect(sql).toContain("(input.normalized_numeric_privacy_scan_text)");
    expect(sql).toContain("(input.normalized_numeric_privacy_spaced_scan_text)");
    expect(sql).toContain(
      "((https?|ftp|ws|wss):[\\\\/]*|[a-z][a-z0-9+.-]*:[\\\\/]{2,}|:[\\\\/]{2,})[^[:space:]/?#\\\\]*@",
    );
    expect(sql).toContain("regexp_matches( privacy_scan.scan_text collate \"pg_c_utf8\"");
    expect(sql).toContain("'(^|.)([\\\\/]{2,}[^[:space:]/?#\\\\]*@)', 'g'");
    expect(sql).toContain("where relative_userinfo.match[1] = ''");
    expect(sql).toContain("relative_userinfo.match[1] <> ':'");
    expect(sql).toContain("relative_userinfo.match[1] !~ '[[:alnum:]]'");
    expect(sql).toContain("replace(value.raw_text, u&'\\0130', u&'\\0069\\0307')");
    expect(sql).toContain("collate \"und-x-icu\"");
    expect(sql).not.toContain("u&'\\1c89\\a7cb\\a7cc");
    expect(sql).toContain("when lower(value.raw_text) = 'unknown' then 'unknown'");
    expect(sql).toContain('regexp_matches( input.scan_text collate "pg_c_utf8",');
    expect(sql).toContain("[0-9[:space:][:punct:]");
    for (const unicodeGapRange of [
      "\u1b4e-\u1b4f",
      "\u2427-\u2429",
      "ⓐ-ⓩ",
      "\u{1f8d0}-\u{1f8d8}",
      "\u{1fbcb}-\u{1fbef}",
    ]) {
      expect(sql).toContain(unicodeGapRange);
    }
    expect(sql).toContain("regexp_replace(segment.value, '[^0-9]', '', 'g') as digits");
    expect(sql).toContain(
      "unnest( regexp_split_to_array(candidate.match[1], '[0-9]{20,}') )",
    );
    expect(sql).toContain("values (feature.scan_text), (feature.normalized_numeric_privacy_scan_text), (feature.normalized_numeric_privacy_spaced_scan_text)");
    expect(sql).toContain("probe.scan_text ~ '^[^0-9]*[0-9]([^0-9]*[0-9]){6}'");
    expect(sql).toContain("display_value_phone_risks as materialized");
    expect(sql).toContain("run.match[1] as run_digits");
    expect(sql).toContain("start_run.run_digits collate \"pg_c_utf8\" ~ '^0[1-9][0-9]{0,3}$'");
    expect(sql).toContain("end_run.run_index = start_run.run_index + 1");
    expect(sql).toContain("end_run.run_length >= 5");
    expect(sql).toContain("start_run.run_length + end_run.run_length between 9 and 15");
    expect(sql).toContain(
      "coalesce(payment_risk.likely_payment_card, false) as likely_payment_card",
    );
    expect(sql).toContain("cross join lateral generate_series( 1, segment.digit_count ) position(payment_position)");
    expect(sql).toContain("cross join lateral generate_series( 1, prefix.digit_count - payment_length.window_length + 1 ) payment_start(payment_position)");
    expect(sql).toContain("where char_length(segment.digits) between 13 and 3600");
    expect(sql).toContain(
      "cross join ( values (13), (14), (15), (16), (17), (18), (19) ) payment_length(window_length)",
    );
    expect(sql).toContain("array_agg(running.raw_sum order by running.payment_position)");
    expect(sql).toContain("prefix.raw_prefix[ payment_start.payment_position + payment_length.window_length ]");
    expect(sql).toContain(
      "group by prefix.display_value_id, prefix.value_key, prefix.decode_pass",
    );
    expect(sql).toContain("from display_value_references reference");
    expect(sql).toContain("value.display_value_id = reference.display_value_id");
    expect(referenceStart).toBeGreaterThanOrEqual(0);
    expect(referenceEnd).toBeGreaterThan(referenceStart);
    expect(referenceSql).toContain("union all");
    expect(referenceSql).toContain("catalog.raw_json = raw.raw_json");
    expect(referenceSql).toContain("where raw.raw_json is not null and catalog.raw_json is not null");
    expect(referenceSql).toContain("and catalog.raw_json is null where raw.raw_json is null");
    expect(referenceSql.match(/from raw_display_values raw/gu)).toHaveLength(2);
    expect(referenceSql).not.toContain("catalog.raw_json is not distinct from raw.raw_json");
    expect(sql).toContain(
      "min(candidate.occurred_at) over ( partition by candidate.period_key, candidate.session_id ) as visit_at",
    );
    expect(sql).toContain("where event.occurred_at = event.visit_at");
    expect(sql).not.toContain("first_visits as materialized");
    expect(sql).not.toContain("from '([0-9][0-9 -]{11,22}[0-9])'");
    expect(sql).not.toContain("as payment_digits");
    expect(sql).not.toContain("as first_phone_candidate");
    expect(sql).not.toContain("as ipv4_candidate,");
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

  it("executes in one repeatable-read, read-only transaction with bounded local planner settings", async () => {
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
      "set local jit = off",
      undefined,
      transactionClient,
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      3,
      "set local enable_nestloop = off",
      undefined,
      transactionClient,
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      4,
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
