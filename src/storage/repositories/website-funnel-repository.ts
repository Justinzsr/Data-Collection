import "server-only";

import {
  WEBSITE_FUNNEL_EVENT_NAMES,
  type WebsiteFunnelEventName,
} from "@/aggregation/metric-definitions/website-funnel-definitions";
import {
  sanitizeWebsiteDisplayDimension,
  type WebsiteDisplayDimensionKind,
} from "@/collection/tracking/website-display-privacy";
import { query, queryRows, withDatabaseTransaction } from "@/storage/db/client";
import type { SourceStatus } from "@/storage/db/schema";

export const WEBSITE_FUNNEL_EVENT_TAXONOMY = WEBSITE_FUNNEL_EVENT_NAMES;
export type { WebsiteFunnelEventName };
export type WebsiteFunnelPeriodKey = "current" | "comparison";

export type WebsiteFunnelFilters = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  landingPage?: string | null;
  referrerHost?: string | null;
  deviceCategory?: string | null;
};

export type WebsiteFunnelRepositoryInput = {
  dataSpaceId: string;
  segment?: "all" | "ready-made" | "builder";
  current: {
    startAt: string;
    endExclusive: string;
  };
  comparison: {
    startAt: string;
    endExclusive: string;
  };
  filters?: WebsiteFunnelFilters;
  pagination?: {
    groupLimit?: number;
    productOffset?: number;
    collectionOffset?: number;
    acquisitionOffset?: number;
    unknownEventOffset?: number;
  };
};

type CountValue = string | number;

export type WebsiteFunnelSourceSummary = {
  display_name: string;
  status: SourceStatus;
};

export type WebsiteFunnelCoverageSummary = {
  first_occurred_at: string | null;
  latest_received_at: string | null;
};

export type WebsiteFunnelStageRow = {
  period_key: WebsiteFunnelPeriodKey;
  stage_key: "visit" | "product_intent" | "add_to_cart" | "begin_checkout";
  sessions: CountValue;
  visitors: CountValue;
  events: CountValue;
};

export type WebsiteFunnelDailyRow = {
  period_key: WebsiteFunnelPeriodKey;
  date_pt: string;
  sessions: CountValue;
  product_intent_sessions: CountValue;
  add_to_cart_sessions: CountValue;
  checkout_sessions: CountValue;
};

export type WebsiteFunnelQualityRow = {
  period_key: WebsiteFunnelPeriodKey;
  duplicate_deliveries_removed: CountValue;
  equal_time_intent_sessions: CountValue;
  equal_time_cart_sessions: CountValue;
  equal_time_checkout_sessions: CountValue;
  unsequenced_intent_sessions: CountValue;
  unsequenced_cart_sessions: CountValue;
  unsequenced_checkout_sessions: CountValue;
  unknown_events: CountValue;
};

export type WebsiteFunnelJourneyRow = {
  period_key: WebsiteFunnelPeriodKey;
  journey_key: "ready_made" | "builder";
  visit_sessions?: CountValue;
  product_view_sessions?: CountValue;
  add_to_cart_sessions?: CountValue;
  begin_checkout_sessions?: CountValue;
  visit_events?: CountValue;
  product_view_events?: CountValue;
  add_to_cart_events?: CountValue;
  begin_checkout_events?: CountValue;
  build_start_sessions?: CountValue;
  build_complete_sessions?: CountValue;
  save_design_sessions?: CountValue;
  build_start_events?: CountValue;
  build_complete_events?: CountValue;
  save_design_events?: CountValue;
  equal_time_build_complete_sessions?: CountValue;
  equal_time_save_design_sessions?: CountValue;
};

export type WebsiteFunnelEngagementRow = {
  period_key: WebsiteFunnelPeriodKey;
  event_name: "email_signup";
  sessions: CountValue;
  visitors: CountValue;
  events: CountValue;
};

export type WebsiteFunnelProductRow = {
  period_key: WebsiteFunnelPeriodKey;
  item_id: string;
  item_name: string;
  item_category: string;
  product_view_sessions: CountValue;
  add_to_cart_sessions: CountValue;
  matched_view_to_cart_sessions: CountValue;
  product_view_events: CountValue;
  add_to_cart_events: CountValue;
  stable_identity: boolean;
  total_rows: CountValue;
};

export type WebsiteFunnelCollectionRow = {
  period_key: WebsiteFunnelPeriodKey;
  item_list_name: string;
  collection_view_sessions: CountValue;
  collection_view_events: CountValue;
  visitors: CountValue;
  progressed_to_product_sessions: CountValue;
  equal_time_progression_sessions: CountValue;
  total_rows: CountValue;
};

export type WebsiteFunnelAcquisitionRow = {
  period_key: WebsiteFunnelPeriodKey;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  landing_page: string;
  referrer_host: string;
  sessions: CountValue;
  visitors: CountValue;
  events: CountValue;
  product_intent_sessions: CountValue;
  checkout_sessions: CountValue;
  total_rows: CountValue;
};

export type WebsiteFunnelDeviceRow = {
  period_key: WebsiteFunnelPeriodKey;
  device_category: string;
  sessions: CountValue;
  visitors: CountValue;
  events: CountValue;
  product_intent_sessions: CountValue;
  checkout_sessions: CountValue;
};

export type WebsiteFunnelRepositoryFilterOptions = {
  devices: string[];
  utm_sources: string[];
  utm_mediums: string[];
  utm_campaigns: string[];
  landing_pages: string[];
  referrer_hosts: string[];
};

export type WebsiteFunnelRepositoryGroupTotals = {
  products: CountValue;
  collections: CountValue;
  acquisition: CountValue;
};

export type WebsiteFunnelEventCountRow = {
  period_key: WebsiteFunnelPeriodKey;
  accepted_events: CountValue;
  unfiltered_events: CountValue;
};

export type WebsiteFunnelUnknownEventRow = {
  period_key: WebsiteFunnelPeriodKey;
  event_name: string;
  events: CountValue;
  sessions: CountValue;
  total_rows: CountValue;
};

export type WebsiteFunnelInvalidPropertyRow = {
  period_key: WebsiteFunnelPeriodKey;
  event_name: WebsiteFunnelEventName;
  events: CountValue;
};

export type WebsiteFunnelReconciliationRow = {
  period_key: WebsiteFunnelPeriodKey;
  comparable: boolean;
  raw_page_views: CountValue;
  raw_page_view_days: CountValue;
  page_view_metric_rows: CountValue;
  metric_page_views: CountValue | null;
  page_view_difference: CountValue | null;
  raw_custom_events: CountValue;
  raw_custom_event_days: CountValue;
  custom_event_metric_rows: CountValue;
  metric_custom_events: CountValue | null;
  custom_event_difference: CountValue | null;
};

export type WebsiteFunnelAggregateRow = {
  candidate_count: number;
  source: WebsiteFunnelSourceSummary | null;
  coverage: WebsiteFunnelCoverageSummary;
  stages: WebsiteFunnelStageRow[];
  daily_trend: WebsiteFunnelDailyRow[];
  quality: WebsiteFunnelQualityRow[];
  journeys: WebsiteFunnelJourneyRow[];
  engagement: WebsiteFunnelEngagementRow[];
  products: WebsiteFunnelProductRow[];
  collections: WebsiteFunnelCollectionRow[];
  acquisition: WebsiteFunnelAcquisitionRow[];
  devices: WebsiteFunnelDeviceRow[];
  filter_options: WebsiteFunnelRepositoryFilterOptions;
  group_totals: WebsiteFunnelRepositoryGroupTotals;
  event_counts: WebsiteFunnelEventCountRow[];
  unknown_events: WebsiteFunnelUnknownEventRow[];
  invalid_properties: WebsiteFunnelInvalidPropertyRow[];
  reconciliation: WebsiteFunnelReconciliationRow[];
};

const DEFAULT_GROUP_LIMIT = 25;
const MAX_GROUP_LIMIT = 100;
const MAX_GROUP_OFFSET = 10_000;
const MAX_PERIOD_MS = 32 * 24 * 60 * 60 * 1_000;
const QUERY_TIMEOUT_MS = 8_000;

export const WEBSITE_FUNNEL_AGGREGATE_RESPONSE_DENYLIST = [
  "source_id",
  "event_id",
  "session_id",
  "anonymous_id",
  "user_id",
  "public_tracking_key",
  "url",
  "referrer",
  "ip_hash",
  "user_agent",
  "properties",
  "attribution_context",
  "client_context",
  "payload",
] as const;

/*
 * This statement intentionally performs all event work in PostgreSQL. Raw
 * identities are used only inside CTEs and never cross AGGREGATE_ONLY_RESPONSE.
 * Pagination is applied only after dimension rows have been grouped.
 */
export const WEBSITE_FUNNEL_AGGREGATE_SQL = `
with recursive source_candidates as materialized (
  select s.id, s.display_name, s.status
  from sources s
  where s.data_space_id = $1::uuid
    and s.source_type_key = 'website'
    and s.status <> 'disabled'
),
source_gate as (
  select count(*)::integer as candidate_count
  from source_candidates
),
selected_source as materialized (
  select candidate.id, candidate.display_name, candidate.status
  from source_candidates candidate
  cross join source_gate gate
  where gate.candidate_count = 1
),
periods(period_key, start_at, end_at) as (
  values
    ('current'::text, $2::timestamptz, $3::timestamptz),
    ('comparison'::text, $4::timestamptz, $5::timestamptz)
),
payment_window_positions(payment_position) as materialized (
  select 1::integer
  union all
  select payment_position + 1
  from payment_window_positions
  where payment_position < 1200
),
coverage as (
  select
    min(e.occurred_at) as first_occurred_at,
    max(e.received_at) as latest_received_at
  from web_events e
  join selected_source source on source.id = e.source_id
  where e.event_source = 'first_party_tracker'
),
period_event_candidates as materialized (
  select
    period.period_key,
    e.source_id,
    e.event_id,
    e.session_id,
    e.anonymous_id,
    e.event_name,
    e.occurred_at,
    e.received_at,
    e.path,
    e.referrer,
    e.properties,
    e.attribution_context,
    e.client_context,
    row_number() over (
      partition by period.period_key, e.source_id, e.event_id
      order by e.received_at asc, e.id asc
    ) as delivery_rank
  from periods period
  join selected_source source on true
  join web_events e on e.source_id = source.id
  where e.event_source = 'first_party_tracker'
    and e.occurred_at >= period.start_at
    and e.occurred_at < period.end_at
),
all_events as materialized (
  select *
  from period_event_candidates
  where delivery_rank = 1
),
known_events as materialized (
  select *
  from all_events
  where event_name = any($6::text[])
),
unknown_event_rows as materialized (
  select *
  from all_events
  where event_name <> all($6::text[])
),
raw_display_values as materialized (
  select
    event.period_key,
    event.event_id,
    dimension.value_key,
    dimension.maximum_length,
    dimension.dimension_kind,
    dimension.raw_json
  from known_events event
  cross join lateral (
    values
      (
        'utm_source'::text,
        256,
        'text'::text,
        case
          when event.attribution_context #> '{utm,source}' is not null
            and event.attribution_context #> '{utm,source}' <> 'null'::jsonb
            then event.attribution_context #> '{utm,source}'
          else event.attribution_context #> '{utm,utm_source}'
        end
      ),
      (
        'utm_medium'::text,
        256,
        'text'::text,
        case
          when event.attribution_context #> '{utm,medium}' is not null
            and event.attribution_context #> '{utm,medium}' <> 'null'::jsonb
            then event.attribution_context #> '{utm,medium}'
          else event.attribution_context #> '{utm,utm_medium}'
        end
      ),
      (
        'utm_campaign'::text,
        256,
        'text'::text,
        case
          when event.attribution_context #> '{utm,campaign}' is not null
            and event.attribution_context #> '{utm,campaign}' <> 'null'::jsonb
            then event.attribution_context #> '{utm,campaign}'
          else event.attribution_context #> '{utm,utm_campaign}'
        end
      ),
      (
        'landing_page'::text,
        500,
        'path'::text,
        event.attribution_context -> 'landing_page'
      ),
      (
        'first_referrer'::text,
        1200,
        'url'::text,
        event.attribution_context -> 'first_referrer'
      ),
      (
        'fallback_referrer'::text,
        1200,
        'url'::text,
        to_jsonb(event.referrer)
      ),
      (
        'property_item_list_name'::text,
        256,
        'text'::text,
        event.properties -> 'item_list_name'
      ),
      (
        'property_item_category'::text,
        160,
        'text'::text,
        event.properties -> 'item_category'
      )
  ) dimension(value_key, maximum_length, dimension_kind, raw_json)

  union all

  select
    event.period_key,
    event.event_id,
    item_dimension.value_key || ':' || item_entry.item_index::text,
    item_dimension.maximum_length,
    'text'::text as dimension_kind,
    item_dimension.raw_json
  from known_events event
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(event.properties -> 'items') = 'array'
        then event.properties -> 'items'
      else '[]'::jsonb
    end
  ) with ordinality as item_entry(item, item_index)
  cross join lateral (
    values
      ('item_id'::text, 256, item_entry.item -> 'item_id'),
      ('item_name'::text, 256, item_entry.item -> 'item_name'),
      ('item_category'::text, 160, item_entry.item -> 'item_category'),
      ('item_list_name'::text, 256, item_entry.item -> 'item_list_name')
  ) item_dimension(value_key, maximum_length, raw_json)

  union all

  select
    event.period_key,
    event.event_id,
    'unknown_event_name'::text as value_key,
    80 as maximum_length,
    'event_name'::text as dimension_kind,
    to_jsonb(event.event_name) as raw_json
  from unknown_event_rows event
),
display_value_features as materialized (
  select
    raw.*,
    raw.raw_json is not null as is_present,
    case
      when jsonb_typeof(raw.raw_json) = 'string'
        then btrim(raw.raw_json #>> '{}')
      else null
    end as raw_text
  from raw_display_values raw
),
display_value_decoded_variants as (
  select
    feature.period_key,
    feature.event_id,
    feature.value_key,
    feature.maximum_length,
    feature.dimension_kind,
    feature.raw_json,
    feature.is_present,
    feature.raw_text,
    0::integer as decode_pass,
    case
      when char_length(feature.raw_text) between 1 and feature.maximum_length
        then feature.raw_text
      else null
    end as scan_text,
    false as decode_failed
  from display_value_features feature

  union all

  select
    variant.period_key,
    variant.event_id,
    variant.value_key,
    variant.maximum_length,
    variant.dimension_kind,
    variant.raw_json,
    variant.is_present,
    variant.raw_text,
    variant.decode_pass + 1,
    decoded.decoded_text collate "default",
    decoded.decode_valid is not true as decode_failed
  from display_value_decoded_variants variant
  cross join lateral (
    select
      assembled.decode_valid,
      case
        when assembled.decode_valid
          then assembled.candidate_text
        else null
      end as decoded_text
    from (
      select
        bool_and(piece.piece_valid) as decode_valid,
        string_agg(piece.decoded_piece, '' order by piece.part_index) as candidate_text
      from (
        select
          token.part_index,
          validation.piece_valid,
          case
            when left(token.part[1], 1) <> '%' then token.part[1]
            when validation.piece_valid
              then convert_from(decode(encoded.hex_text, 'hex'), 'UTF8')
            else null
          end as decoded_piece
        from regexp_matches(
          variant.scan_text collate "pg_c_utf8",
          '((?:%[0-9a-f]{2})+|.)',
          'gis'
        ) with ordinality as token(part, part_index)
        cross join lateral (
          select lower(replace(token.part[1], '%', '')) as hex_text
        ) encoded
        cross join lateral (
          select
            left(token.part[1], 1) <> '%'
            or encoded.hex_text ~ '^(?:(?:0[1-9a-f]|[1-7][0-9a-f])|(?:c[2-f]|d[0-f])[89ab][0-9a-f]|e0[ab][0-9a-f][89ab][0-9a-f]|(?:e[1-c]|e[ef])[89ab][0-9a-f][89ab][0-9a-f]|ed[89][0-9a-f][89ab][0-9a-f]|f0[9ab][0-9a-f](?:[89ab][0-9a-f]){2}|f[1-3][89ab][0-9a-f](?:[89ab][0-9a-f]){2}|f48[0-9a-f](?:[89ab][0-9a-f]){2})+$'
              as piece_valid
        ) validation
      ) piece
    ) assembled
  ) decoded
  where variant.decode_pass < 3
    and variant.decode_failed is false
    and variant.scan_text is not null
    and char_length(variant.raw_text) between 1 and variant.maximum_length
    and position('%' in variant.scan_text) > 0
),
display_value_numeric_features as materialized (
  select
    feature.*,
    char_length(coalesce(feature.scan_text, ''))
      - char_length(translate(coalesce(feature.scan_text, ''), '0123456789', ''))
      as ascii_digit_count,
    substring(
      coalesce(feature.scan_text, '')
      from '([+0-9][+0-9 ().-]{6,24})'
    ) as phone_candidate,
    substring(
      coalesce(feature.scan_text, '')
      from '(([0-9]{1,3}\\.){3}[0-9]{1,3})'
    ) as ipv4_candidate,
    case
      when feature.decode_pass = 0
        and feature.dimension_kind = 'url'
        and lower(coalesce(feature.raw_text, ''))
          ~ '^https?://[^/?#]+(/[^?#]*)?$'
        then substring(
          lower(feature.raw_text)
          from '^https?://([^/?#]+)'
        )
      else null
    end as url_authority
  from display_value_decoded_variants feature
),
display_value_payment_inputs as materialized (
  select
    row_number() over () as payment_input_index,
    feature.*
  from display_value_numeric_features feature
  where feature.scan_text is not null
    and feature.ascii_digit_count >= 13
    and feature.scan_text ~ '^[^0-9]*[0-9]([^0-9]*[0-9]){12}'
),
display_value_payment_segments_raw as materialized (
  select
    input.payment_input_index,
    input.period_key,
    input.event_id,
    input.value_key,
    input.decode_pass,
    candidate.candidate_index,
    segment.segment_index,
    regexp_replace(segment.value, '[^0-9]', '', 'g') as digits
  from display_value_payment_inputs input
  cross join lateral regexp_matches(
    input.scan_text collate "pg_c_utf8",
    '([0-9[:space:][:punct:]]+)',
    'g'
  ) with ordinality candidate(match, candidate_index)
  cross join lateral unnest(
    regexp_split_to_array(candidate.match[1], '[0-9]{20,}')
  ) with ordinality segment(value, segment_index)
),
display_value_payment_segments as materialized (
  select
    segment.*,
    char_length(segment.digits)::integer as digit_count
  from display_value_payment_segments_raw segment
  where char_length(segment.digits) between 13 and 1200
),
display_value_payment_digit_contributions as materialized (
  select
    segment.payment_input_index,
    segment.period_key,
    segment.event_id,
    segment.value_key,
    segment.decode_pass,
    segment.candidate_index,
    segment.segment_index,
    segment.digit_count,
    position.payment_position,
    digit.value,
    case
      when digit.value * 2 > 9 then digit.value * 2 - 9
      else digit.value * 2
    end as doubled_value
  from display_value_payment_segments segment
  join payment_window_positions position
    on position.payment_position <= segment.digit_count
  cross join lateral (
    values (substring(segment.digits from position.payment_position for 1)::integer)
  ) digit(value)
),
display_value_payment_running_sums as materialized (
  select
    digit.*,
    sum(digit.value) over payment_order as raw_sum,
    sum(
      case
        when digit.payment_position % 2 = 0
          then digit.doubled_value - digit.value
        else 0
      end
    ) over payment_order as even_delta_sum,
    sum(
      case
        when digit.payment_position % 2 = 1
          then digit.doubled_value - digit.value
        else 0
      end
    ) over payment_order as odd_delta_sum
  from display_value_payment_digit_contributions digit
  window payment_order as (
    partition by digit.payment_input_index, digit.candidate_index, digit.segment_index
    order by digit.payment_position
    rows between unbounded preceding and current row
  )
),
display_value_payment_prefixes as materialized (
  select
    running.payment_input_index,
    running.period_key,
    running.event_id,
    running.value_key,
    running.decode_pass,
    running.candidate_index,
    running.segment_index,
    max(running.digit_count)::integer as digit_count,
    array_prepend(
      0::bigint,
      array_agg(running.raw_sum order by running.payment_position)
    ) as raw_prefix,
    array_prepend(
      0::bigint,
      array_agg(running.even_delta_sum order by running.payment_position)
    ) as even_delta_prefix,
    array_prepend(
      0::bigint,
      array_agg(running.odd_delta_sum order by running.payment_position)
    ) as odd_delta_prefix
  from display_value_payment_running_sums running
  group by
    running.payment_input_index,
    running.period_key,
    running.event_id,
    running.value_key,
    running.decode_pass,
    running.candidate_index,
    running.segment_index
),
display_value_payment_risks as materialized (
  select
    prefix.period_key,
    prefix.event_id,
    prefix.value_key,
    prefix.decode_pass,
    true as likely_payment_card
  from display_value_payment_prefixes prefix
  cross join (
    values (13), (14), (15), (16), (17), (18), (19)
  ) payment_length(window_length)
  join payment_window_positions payment_start
    on payment_start.payment_position <=
      prefix.digit_count - payment_length.window_length + 1
  where mod(
    prefix.raw_prefix[
      payment_start.payment_position + payment_length.window_length
    ] - prefix.raw_prefix[payment_start.payment_position]
    + case
        when (
          payment_start.payment_position + payment_length.window_length
        ) % 2 = 0
          then prefix.even_delta_prefix[
            payment_start.payment_position + payment_length.window_length
          ] - prefix.even_delta_prefix[payment_start.payment_position]
        else prefix.odd_delta_prefix[
          payment_start.payment_position + payment_length.window_length
        ] - prefix.odd_delta_prefix[payment_start.payment_position]
      end,
    10
  ) = 0
  group by prefix.period_key, prefix.event_id, prefix.value_key, prefix.decode_pass
),
display_value_risks as materialized (
  select
    feature.*,
    case
      when feature.scan_text is null then false
      else exists (
        select 1
        from (
          values (feature.scan_text), (feature.phone_candidate)
        ) phone_candidate(raw_text)
        cross join lateral (
          select btrim(coalesce(phone_candidate.raw_text, '')) as normalized_text
        ) normalized_phone
        cross join lateral (
          select regexp_replace(
            normalized_phone.normalized_text,
            '[^0-9]',
            '',
            'g'
          ) as digits
        ) phone_number
        where (
          normalized_phone.normalized_text ~ '^\\+[0-9 ().-]+$'
          and char_length(phone_number.digits) between 7 and 15
        )
        or (
          normalized_phone.normalized_text ~ '^[0-9]{9,15}$'
          and (
            normalized_phone.normalized_text like '0%'
            or normalized_phone.normalized_text
              ~ '^(20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98)'
          )
        )
        or (
          normalized_phone.normalized_text ~ '^[0-9 ()-]+$'
          and char_length(phone_number.digits) between 9 and 15
          and (
            char_length(normalized_phone.normalized_text)
            - char_length(
              regexp_replace(normalized_phone.normalized_text, '[ ()-]', '', 'g')
            )
          ) >= 2
        )
        or (
          normalized_phone.normalized_text ~ '^[0-9]{10,11}$'
          and (
            case
              when char_length(phone_number.digits) = 11
                and phone_number.digits like '1%'
                then substring(phone_number.digits from 2)
              else phone_number.digits
            end
          ) ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
        )
        or (
          normalized_phone.normalized_text
            ~ '^(1[ .-])?\\(?[2-9][0-9]{2}\\)?[ .-][2-9][0-9]{2}[ .-][0-9]{4}$'
        )
      )
    end as likely_phone,
    coalesce(payment_risk.likely_payment_card, false) as likely_payment_card
  from display_value_numeric_features feature
  left join display_value_payment_risks payment_risk
    on payment_risk.period_key = feature.period_key
    and payment_risk.event_id = feature.event_id
    and payment_risk.value_key = feature.value_key
    and payment_risk.decode_pass = feature.decode_pass
),
display_value_scanned_risks as materialized (
  select
    risk.*,
    coalesce(
      bool_or(
        risk.decode_failed is true
        or (
          risk.scan_text is not null
          and (
            (
              risk.decode_pass = 3
              and position('%' in risk.scan_text) > 0
            )
          or risk.scan_text ~ '[[:cntrl:]]'
          or risk.scan_text
            ~* '(^|[^a-z0-9._%+-])[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}($|[^a-z0-9.-])'
          or regexp_replace(risk.scan_text, '[-_]+', ' ', 'g')
            ~* '(^|[^a-z0-9])p(ost)?\\.?[[:space:]]*o(ffice)?\\.?[[:space:]]+box[[:space:]]+[a-z0-9-]+($|[^a-z0-9])'
          or regexp_replace(risk.scan_text, '[-_]+', ' ', 'g')
            ~* '(^|[^a-z0-9])[0-9]{1,6}[[:space:]]+([a-z0-9.''-]+[[:space:]]+){0,5}(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way|highway|hwy)($|[^a-z0-9])'
          or risk.scan_text
            ~* '(^|[^a-z0-9_])(bearer|basic)[[:space:]]+[a-z0-9._~+/=-]{8,}'
          or risk.scan_text
            ~* '(^|[^a-z0-9_])(sk|pk|rk)_(live|test)_[a-z0-9_-]{8,}'
          or risk.scan_text
            ~* '(^|[^a-z0-9_])eyj[a-z0-9_-]{8,}\\.[a-z0-9_-]{8,}\\.[a-z0-9_-]{8,}'
          or risk.scan_text
            ~* '(^|[?&#/_.-])(authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|access[_-]?key|session[_-]?id)[=:/]'
          or risk.likely_phone is true
          or risk.likely_payment_card is true
          or (
            risk.ipv4_candidate is not null
            and pg_input_is_valid(risk.ipv4_candidate, 'inet') is true
          )
          or risk.scan_text
            ~* '(^|[^a-f0-9])([a-f0-9]{0,4}:){2,}[a-f0-9:]{0,39}($|[^a-f0-9])'
          or risk.scan_text ~* '^https?://[^/?#]*@'
          )
        )
      ) over (
        partition by risk.period_key, risk.event_id, risk.value_key
      ),
      false
    ) as has_unsafe_content
  from display_value_risks risk
),
validated_display_values as materialized (
  select
    risk.*,
    coalesce(
      jsonb_typeof(risk.raw_json) = 'string'
      and char_length(risk.raw_text) between 1 and risk.maximum_length
      and risk.has_unsafe_content is not true
      and risk.raw_text !~* '%(25)*(40|3f|23)'
      and (
        risk.ipv4_candidate is null
        or pg_input_is_valid(risk.ipv4_candidate, 'inet') is not true
      )
      and position('?' in risk.raw_text) = 0
      and position('#' in risk.raw_text) = 0
      and case
        when risk.dimension_kind = 'event_name' then
          risk.raw_text ~ '^[a-zA-Z0-9_.:-]+$'
        when risk.dimension_kind = 'path' then
          risk.raw_text ~ '^/[^?#]*$'
          and risk.raw_text !~ '^//'
        when risk.dimension_kind = 'url' then
          risk.url_authority is not null
          and risk.url_authority !~ '@'
          and risk.url_authority
            ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:[0-9]{1,5})?$'
          and char_length(split_part(risk.url_authority, ':', 1)) <= 253
          and split_part(risk.url_authority, ':', 1)
            !~ '^([0-9]{1,3}\\.){3}[0-9]{1,3}$'
          and pg_input_is_valid(split_part(risk.url_authority, ':', 1), 'inet')
            is not true
          and case
            when position(':' in risk.url_authority) = 0 then true
            when split_part(risk.url_authority, ':', 2) ~ '^[0-9]{1,5}$'
              then split_part(risk.url_authority, ':', 2)::integer between 1 and 65535
            else false
          end
        else
          risk.raw_text !~* '^https?://[^/?#]*@'
      end,
      false
    ) as is_safe
  from display_value_scanned_risks risk
  where risk.decode_pass = 0
),
normalized_display_values as materialized (
  select
    value.period_key,
    value.event_id,
    value.value_key,
    value.is_present,
    value.is_safe,
    case
      when value.is_safe is not true then 'Unknown'
      when value.dimension_kind = 'url'
        then lower(split_part(value.url_authority, ':', 1))
      when value.value_key in ('utm_source', 'utm_medium')
        then lower(value.raw_text)
      else value.raw_text
    end as normalized_value
  from validated_display_values value
),
display_value_maps as materialized (
  select
    value.period_key,
    value.event_id,
    jsonb_object_agg(
      value.value_key,
      to_jsonb(value.is_present)
    ) as display_presence,
    jsonb_object_agg(
      value.value_key,
      to_jsonb(value.is_safe)
    ) as display_safety,
    jsonb_object_agg(
      value.value_key,
      to_jsonb(value.normalized_value)
    ) as display_values
  from normalized_display_values value
  group by value.period_key, value.event_id
),
event_property_primitives as materialized (
  select
    event.*,
    display.display_presence,
    display.display_safety,
    display.display_values,
    coalesce(
      case
        when jsonb_typeof(event.properties) = 'object'
          and jsonb_typeof(event.properties -> 'items') = 'array'
          then jsonb_array_length(event.properties -> 'items') between 1 and 100
            and not exists (
              select 1
              from jsonb_array_elements(event.properties -> 'items')
                with ordinality as item_entry(item, item_index)
              where (
                case
                  when jsonb_typeof(item_entry.item) = 'object' then
                    item_entry.item
                      ?& array['item_id', 'item_name', 'item_category']::text[]
                    and item_entry.item - array[
                  'item_id',
                  'item_name',
                  'item_category',
                  'item_list_name',
                  'price',
                  'quantity'
                ]::text[] = '{}'::jsonb
                and display.display_safety
                  -> ('item_id:' || item_entry.item_index::text) = 'true'::jsonb
                and display.display_safety
                  -> ('item_name:' || item_entry.item_index::text) = 'true'::jsonb
                and display.display_safety
                  -> ('item_category:' || item_entry.item_index::text) = 'true'::jsonb
                and (
                  not (item_entry.item ? 'item_list_name')
                  or display.display_safety
                    -> ('item_list_name:' || item_entry.item_index::text)
                      = 'true'::jsonb
                )
                and (
                  case
                    when item_entry.item ? 'price' then
                      jsonb_typeof(item_entry.item -> 'price') = 'number'
                      and (item_entry.item ->> 'price')::numeric >= 0
                    else true
                  end
                ) is true
                and (
                  case
                    when item_entry.item ? 'quantity' then
                      jsonb_typeof(item_entry.item -> 'quantity') = 'number'
                      and (item_entry.item ->> 'quantity')::numeric >= 1
                      and trunc((item_entry.item ->> 'quantity')::numeric)
                        = (item_entry.item ->> 'quantity')::numeric
                    else true
                  end
                ) is true
                  else false
                end
              ) is not true
            )
        else false
      end,
      false
    ) as items_are_valid,
    coalesce(
      jsonb_typeof(event.properties) = 'object'
      and event.properties ?& array['currency', 'value']::text[]
      and jsonb_typeof(event.properties -> 'currency') = 'string'
      and btrim(event.properties ->> 'currency') ~ '^[A-Z]{3}$'
      and (
        case
          when jsonb_typeof(event.properties -> 'value') = 'number'
            then (event.properties ->> 'value')::numeric >= 0
          else false
        end
      ) is true,
      false
    ) as commerce_values_are_valid
  from known_events event
  join display_value_maps display
    on display.period_key = event.period_key
   and display.event_id = event.event_id
),
classified_known_events as materialized (
  select
    event.*,
    (
      case
        when jsonb_typeof(event.properties) is distinct from 'object' then false
        when event.event_name = 'page_view' then true
        when event.event_name = 'view_item_list' then
          event.properties ?& array['item_list_name', 'items']::text[]
          and event.properties
            - array['item_list_name', 'items', 'attribution']::text[] = '{}'::jsonb
          and event.items_are_valid is true
          and event.display_safety -> 'property_item_list_name' = 'true'::jsonb
        when event.event_name in ('view_item', 'add_to_cart', 'begin_checkout') then
          event.properties ?& array['currency', 'value', 'items']::text[]
          and event.properties
            - array['currency', 'value', 'items', 'attribution']::text[] = '{}'::jsonb
          and event.items_are_valid is true
          and event.commerce_values_are_valid is true
        when event.event_name = 'build_start' then
          event.properties ? 'item_category'
          and event.properties - array['item_category', 'attribution']::text[]
            = '{}'::jsonb
          and event.display_safety -> 'property_item_category' = 'true'::jsonb
        when event.event_name in ('build_complete', 'save_design') then
          event.properties
            ?& array['currency', 'item_category', 'stone_count', 'value']::text[]
          and event.properties
            - array['currency', 'item_category', 'stone_count', 'value', 'attribution']::text[]
              = '{}'::jsonb
          and jsonb_typeof(event.properties -> 'currency') = 'string'
          and btrim(event.properties ->> 'currency') ~ '^[A-Z]{3}$'
          and event.display_safety -> 'property_item_category' = 'true'::jsonb
          and (
            case
              when jsonb_typeof(event.properties -> 'stone_count') = 'number' then
                (event.properties ->> 'stone_count')::numeric >= 0
                and trunc((event.properties ->> 'stone_count')::numeric)
                  = (event.properties ->> 'stone_count')::numeric
              else false
            end
          ) is true
          and (
            case
              when jsonb_typeof(event.properties -> 'value') = 'number'
                then (event.properties ->> 'value')::numeric >= 0
              else false
            end
          ) is true
        when event.event_name = 'email_signup' then
          event.properties ?& array['discount_code', 'method']::text[]
          and event.properties
            - array['discount_code', 'method', 'attribution']::text[] = '{}'::jsonb
          and jsonb_typeof(event.properties -> 'discount_code') = 'string'
          and char_length(btrim(event.properties ->> 'discount_code'))
            between 1 and 160
          and jsonb_typeof(event.properties -> 'method') = 'string'
          and char_length(btrim(event.properties ->> 'method'))
            between 1 and 160
        else false
      end
    ) is true as property_valid,
    (
      event.items_are_valid is true
      and event.commerce_values_are_valid is true
      and exists (
        select 1
        from jsonb_array_elements(
          case
            when event.items_are_valid is true then event.properties -> 'items'
            else '[]'::jsonb
          end
        ) item
        where lower(btrim(item ->> 'item_category')) <> 'build your own'
      )
    ) is true as has_ready_made_item
  from event_property_primitives event
),
first_visits as materialized (
  select period_key, session_id, min(occurred_at) as visit_at
  from classified_known_events
  where property_valid is true
    and event_name = 'page_view'
  group by period_key, session_id
),
visit_context_candidates as materialized (
  select
    visit.period_key,
    visit.session_id,
    visit.visit_at,
    event.anonymous_id,
    coalesce(event.display_values ->> 'utm_source', 'Unknown') as utm_source,
    coalesce(event.display_values ->> 'utm_medium', 'Unknown') as utm_medium,
    coalesce(event.display_values ->> 'utm_campaign', 'Unknown') as utm_campaign,
    coalesce(event.display_values ->> 'landing_page', 'Unknown') as landing_page,
    case
      when event.display_presence -> 'first_referrer' = 'true'::jsonb
        then coalesce(event.display_values ->> 'first_referrer', 'Unknown')
      else coalesce(event.display_values ->> 'fallback_referrer', 'Unknown')
    end as referrer_host,
    case
      when event.client_context ->> 'device_category'
        in ('mobile', 'tablet', 'desktop', 'bot')
        then event.client_context ->> 'device_category'
      else 'Unknown'
    end as device_category
  from first_visits visit
  join classified_known_events event
    on event.period_key = visit.period_key
   and event.session_id = visit.session_id
   and event.event_name = 'page_view'
   and event.occurred_at = visit.visit_at
   and event.property_valid is true
),
session_context as materialized (
  select
    period_key,
    session_id,
    visit_at,
    case
      when count(distinct anonymous_id) = 1 then min(anonymous_id)
      else null
    end as anonymous_id,
    case
      when count(distinct utm_source) = 1 then min(utm_source)
      else 'Unknown'
    end as utm_source,
    case
      when count(distinct utm_medium) = 1 then min(utm_medium)
      else 'Unknown'
    end as utm_medium,
    case
      when count(distinct utm_campaign) = 1 then min(utm_campaign)
      else 'Unknown'
    end as utm_campaign,
    case
      when count(distinct landing_page) = 1 then min(landing_page)
      else 'Unknown'
    end as landing_page,
    case
      when count(distinct referrer_host) = 1 then min(referrer_host)
      else 'Unknown'
    end as referrer_host,
    case
      when count(distinct device_category) = 1 then min(device_category)
      else 'Unknown'
    end as device_category
  from visit_context_candidates
  group by period_key, session_id, visit_at
),
filter_options as (
  select
    array(
      select distinct device_category
      from session_context
      where period_key = 'current'
      order by device_category
      limit 100
    ) as devices,
    array(
      select distinct utm_source
      from session_context
      where period_key = 'current'
      order by utm_source
      limit 100
    ) as utm_sources,
    array(
      select distinct utm_medium
      from session_context
      where period_key = 'current'
      order by utm_medium
      limit 100
    ) as utm_mediums,
    array(
      select distinct utm_campaign
      from session_context
      where period_key = 'current'
      order by utm_campaign
      limit 100
    ) as utm_campaigns,
    array(
      select distinct landing_page
      from session_context
      where period_key = 'current'
      order by landing_page
      limit 100
    ) as landing_pages,
    array(
      select distinct referrer_host
      from session_context
      where period_key = 'current'
      order by referrer_host
      limit 100
    ) as referrer_hosts
),
filtered_session_context as materialized (
  select *
  from session_context
  where ($7::text is null or utm_source = $7::text)
    and ($8::text is null or utm_medium = $8::text)
    and ($9::text is null or utm_campaign = $9::text)
    and ($10::text is null or landing_page = $10::text)
    and ($11::text is null or referrer_host = $11::text)
    and ($12::text is null or device_category = $12::text)
),
filtered_all_events as materialized (
  select event.*
  from all_events event
  where (
    (
      $7::text is null
      and $8::text is null
      and $9::text is null
      and $10::text is null
      and $11::text is null
      and $12::text is null
    )
    or exists (
      select 1
      from filtered_session_context session
      where session.period_key = event.period_key
        and session.session_id = event.session_id
    )
  )
),
period_event_counts as (
  select
    period.period_key,
    (
      select count(*)
      from filtered_all_events event
      where event.period_key = period.period_key
    ) as accepted_events,
    (
      select count(*)
      from all_events event
      where event.period_key = period.period_key
    ) as unfiltered_events
  from periods period
),
diagnostic_known_events as materialized (
  select event.*
  from classified_known_events event
  where (
    (
      $7::text is null
      and $8::text is null
      and $9::text is null
      and $10::text is null
      and $11::text is null
      and $12::text is null
    )
    or exists (
      select 1
      from filtered_session_context session
      where session.period_key = event.period_key
        and session.session_id = event.session_id
    )
  )
),
diagnostic_unknown_events as materialized (
  select
    event.period_key,
    event.session_id,
    coalesce(
      display.display_values ->> 'unknown_event_name',
      'Unknown'
    ) as event_name
  from unknown_event_rows event
  join display_value_maps display
    on display.period_key = event.period_key
   and display.event_id = event.event_id
  where (
    (
      $7::text is null
      and $8::text is null
      and $9::text is null
      and $10::text is null
      and $11::text is null
      and $12::text is null
    )
    or exists (
      select 1
      from filtered_session_context session
      where session.period_key = event.period_key
        and session.session_id = event.session_id
    )
  )
),
classified_events as materialized (
  select event.*
  from classified_known_events event
  join filtered_session_context session
    on session.period_key = event.period_key
   and session.session_id = event.session_id
),
events as materialized (
  select *
  from classified_events
  where property_valid is true
),
visits as materialized (
  select period_key, session_id, min(occurred_at) as visit_at
  from events
  where event_name = 'page_view'
  group by period_key, session_id
),
intents as materialized (
  select
    visit.period_key,
    visit.session_id,
    min(event.occurred_at) as intent_at
  from visits visit
  join events event
    on event.period_key = visit.period_key
   and event.session_id = visit.session_id
   and (
     (
       $18::text = 'all'
       and event.event_name in ('view_item', 'build_start')
     )
     or (
       $18::text = 'ready-made'
       and event.event_name = 'view_item'
       and event.has_ready_made_item is true
     )
     or (
       $18::text = 'builder'
       and event.event_name = 'build_start'
     )
   )
   and event.occurred_at > visit.visit_at
  group by visit.period_key, visit.session_id
),
carts as materialized (
  select
    intent.period_key,
    intent.session_id,
    min(event.occurred_at) as cart_at
  from intents intent
  join events event
    on event.period_key = intent.period_key
   and event.session_id = intent.session_id
   and event.event_name = 'add_to_cart'
   and $18::text <> 'builder'
   and ($18::text <> 'ready-made' or event.has_ready_made_item is true)
   and event.occurred_at > intent.intent_at
  group by intent.period_key, intent.session_id
),
checkouts as materialized (
  select
    cart.period_key,
    cart.session_id,
    min(event.occurred_at) as checkout_at
  from carts cart
  join events event
    on event.period_key = cart.period_key
   and event.session_id = cart.session_id
   and event.event_name = 'begin_checkout'
   and $18::text <> 'builder'
   and ($18::text <> 'ready-made' or event.has_ready_made_item is true)
   and event.occurred_at > cart.cart_at
  group by cart.period_key, cart.session_id
),
quality_intents as materialized (
  select
    visit.period_key,
    visit.session_id,
    min(event.occurred_at) as intent_at
  from visits visit
  join events event
    on event.period_key = visit.period_key
   and event.session_id = visit.session_id
   and event.event_name in ('view_item', 'build_start')
   and event.occurred_at > visit.visit_at
  group by visit.period_key, visit.session_id
),
quality_carts as materialized (
  select
    intent.period_key,
    intent.session_id,
    min(event.occurred_at) as cart_at
  from quality_intents intent
  join events event
    on event.period_key = intent.period_key
   and event.session_id = intent.session_id
   and event.event_name = 'add_to_cart'
   and event.occurred_at > intent.intent_at
  group by intent.period_key, intent.session_id
),
quality_checkouts as materialized (
  select
    cart.period_key,
    cart.session_id,
    min(event.occurred_at) as checkout_at
  from quality_carts cart
  join events event
    on event.period_key = cart.period_key
   and event.session_id = cart.session_id
   and event.event_name = 'begin_checkout'
   and event.occurred_at > cart.cart_at
  group by cart.period_key, cart.session_id
),
funnel_anchors as materialized (
  select
    visit.period_key,
    visit.session_id,
    visit.visit_at,
    intent.intent_at,
    cart.cart_at,
    checkout.checkout_at
  from visits visit
  left join intents intent
    on intent.period_key = visit.period_key
   and intent.session_id = visit.session_id
  left join carts cart
    on cart.period_key = visit.period_key
   and cart.session_id = visit.session_id
  left join checkouts checkout
    on checkout.period_key = visit.period_key
   and checkout.session_id = visit.session_id
),
stage_event_rows as materialized (
  select
    visit.period_key,
    'visit'::text as stage_key,
    event.session_id,
    event.anonymous_id
  from visits visit
  join events event
    on event.period_key = visit.period_key
   and event.session_id = visit.session_id
   and event.event_name = 'page_view'

  union all

  select
    intent.period_key,
    'product_intent'::text,
    event.session_id,
    event.anonymous_id
  from intents intent
  join visits visit
    on visit.period_key = intent.period_key
   and visit.session_id = intent.session_id
  join events event
    on event.period_key = intent.period_key
   and event.session_id = intent.session_id
   and (
     (
       $18::text = 'all'
       and event.event_name in ('view_item', 'build_start')
     )
     or (
       $18::text = 'ready-made'
       and event.event_name = 'view_item'
       and event.has_ready_made_item is true
     )
     or (
       $18::text = 'builder'
       and event.event_name = 'build_start'
     )
   )
   and event.occurred_at > visit.visit_at

  union all

  select
    cart.period_key,
    'add_to_cart'::text,
    event.session_id,
    event.anonymous_id
  from carts cart
  join intents intent
    on intent.period_key = cart.period_key
   and intent.session_id = cart.session_id
  join events event
    on event.period_key = cart.period_key
   and event.session_id = cart.session_id
   and event.event_name = 'add_to_cart'
   and $18::text <> 'builder'
   and ($18::text <> 'ready-made' or event.has_ready_made_item is true)
   and event.occurred_at > intent.intent_at

  union all

  select
    checkout.period_key,
    'begin_checkout'::text,
    event.session_id,
    event.anonymous_id
  from checkouts checkout
  join carts cart
    on cart.period_key = checkout.period_key
   and cart.session_id = checkout.session_id
  join events event
    on event.period_key = checkout.period_key
   and event.session_id = checkout.session_id
   and event.event_name = 'begin_checkout'
   and $18::text <> 'builder'
   and ($18::text <> 'ready-made' or event.has_ready_made_item is true)
   and event.occurred_at > cart.cart_at
),
stage_aggregates as (
  select
    stage.period_key,
    stage.stage_key,
    count(distinct stage.session_id) as sessions,
    count(distinct session.anonymous_id) as visitors,
    count(*) as events
  from stage_event_rows stage
  join filtered_session_context session
    on session.period_key = stage.period_key
   and session.session_id = stage.session_id
  group by stage.period_key, stage.stage_key
),
daily_trend as (
  select
    period_key,
    (visit_at at time zone 'America/Los_Angeles')::date::text as date_pt,
    count(*) as sessions,
    count(*) filter (where intent_at is not null) as product_intent_sessions,
    count(*) filter (where cart_at is not null) as add_to_cart_sessions,
    count(*) filter (where checkout_at is not null) as checkout_sessions
  from funnel_anchors
  group by period_key, (visit_at at time zone 'America/Los_Angeles')::date
),
quality as (
  select
    period.period_key,
    (
      select count(*)
      from period_event_candidates candidate
      where candidate.period_key = period.period_key
        and candidate.delivery_rank > 1
    ) as duplicate_deliveries_removed,
    (
      select count(distinct visit.session_id)
      from visits visit
      join events event
        on event.period_key = visit.period_key
       and event.session_id = visit.session_id
       and event.event_name in ('view_item', 'build_start')
       and event.occurred_at = visit.visit_at
      where visit.period_key = period.period_key
    ) as equal_time_intent_sessions,
    (
      select count(distinct intent.session_id)
      from quality_intents intent
      join events event
        on event.period_key = intent.period_key
       and event.session_id = intent.session_id
       and event.event_name = 'add_to_cart'
       and event.occurred_at = intent.intent_at
      where intent.period_key = period.period_key
    ) as equal_time_cart_sessions,
    (
      select count(distinct cart.session_id)
      from quality_carts cart
      join events event
        on event.period_key = cart.period_key
       and event.session_id = cart.session_id
       and event.event_name = 'begin_checkout'
       and event.occurred_at = cart.cart_at
      where cart.period_key = period.period_key
    ) as equal_time_checkout_sessions,
    (
      select count(distinct event.session_id)
      from diagnostic_known_events event
      where event.period_key = period.period_key
        and event.property_valid is true
        and event.event_name in ('view_item', 'build_start')
        and not exists (
          select 1
          from quality_intents intent
          where intent.period_key = event.period_key
            and intent.session_id = event.session_id
        )
    ) as unsequenced_intent_sessions,
    (
      select count(distinct event.session_id)
      from diagnostic_known_events event
      where event.period_key = period.period_key
        and event.property_valid is true
        and event.event_name = 'add_to_cart'
        and not exists (
          select 1
          from quality_carts cart
          where cart.period_key = event.period_key
            and cart.session_id = event.session_id
        )
    ) as unsequenced_cart_sessions,
    (
      select count(distinct event.session_id)
      from diagnostic_known_events event
      where event.period_key = period.period_key
        and event.property_valid is true
        and event.event_name = 'begin_checkout'
        and not exists (
          select 1
          from quality_checkouts checkout
          where checkout.period_key = event.period_key
            and checkout.session_id = event.session_id
        )
    ) as unsequenced_checkout_sessions,
    (
      select count(*)
      from diagnostic_unknown_events unknown_event
      where unknown_event.period_key = period.period_key
    ) as unknown_events
  from periods period
),
ready_made_views as materialized (
  select
    visit.period_key,
    visit.session_id,
    min(event.occurred_at) as product_view_at
  from visits visit
  join events event
    on event.period_key = visit.period_key
   and event.session_id = visit.session_id
   and event.event_name = 'view_item'
   and event.has_ready_made_item is true
   and event.occurred_at > visit.visit_at
  group by visit.period_key, visit.session_id
),
ready_made_carts as materialized (
  select
    product_view.period_key,
    product_view.session_id,
    min(event.occurred_at) as cart_at
  from ready_made_views product_view
  join events event
    on event.period_key = product_view.period_key
   and event.session_id = product_view.session_id
   and event.event_name = 'add_to_cart'
   and event.has_ready_made_item is true
   and event.occurred_at > product_view.product_view_at
  group by product_view.period_key, product_view.session_id
),
ready_made_checkouts as materialized (
  select
    cart.period_key,
    cart.session_id,
    min(event.occurred_at) as checkout_at
  from ready_made_carts cart
  join events event
    on event.period_key = cart.period_key
   and event.session_id = cart.session_id
   and event.event_name = 'begin_checkout'
   and event.has_ready_made_item is true
   and event.occurred_at > cart.cart_at
  group by cart.period_key, cart.session_id
),
ready_made_journey as (
  select
    period.period_key,
    'ready_made'::text as journey_key,
    count(distinct visit.session_id) as visit_sessions,
    count(distinct ready_view.session_id) as product_view_sessions,
    count(distinct ready_cart.session_id) as add_to_cart_sessions,
    count(distinct ready_checkout.session_id) as begin_checkout_sessions,
    (
      select count(*)
      from events event
      where event.period_key = period.period_key
        and event.event_name = 'page_view'
    ) as visit_events,
    (
      select count(*)
      from ready_made_views anchor
      join visits visit
        on visit.period_key = anchor.period_key
       and visit.session_id = anchor.session_id
      join events event
        on event.period_key = anchor.period_key
       and event.session_id = anchor.session_id
       and event.event_name = 'view_item'
       and event.has_ready_made_item is true
       and event.occurred_at > visit.visit_at
      where anchor.period_key = period.period_key
    ) as product_view_events,
    (
      select count(*)
      from ready_made_carts anchor
      join ready_made_views product_view
        on product_view.period_key = anchor.period_key
       and product_view.session_id = anchor.session_id
      join events event
        on event.period_key = anchor.period_key
       and event.session_id = anchor.session_id
       and event.event_name = 'add_to_cart'
       and event.has_ready_made_item is true
       and event.occurred_at > product_view.product_view_at
      where anchor.period_key = period.period_key
    ) as add_to_cart_events,
    (
      select count(*)
      from ready_made_checkouts anchor
      join ready_made_carts cart
        on cart.period_key = anchor.period_key
       and cart.session_id = anchor.session_id
      join events event
        on event.period_key = anchor.period_key
       and event.session_id = anchor.session_id
       and event.event_name = 'begin_checkout'
       and event.has_ready_made_item is true
       and event.occurred_at > cart.cart_at
      where anchor.period_key = period.period_key
    ) as begin_checkout_events
  from periods period
  left join visits visit on visit.period_key = period.period_key
  left join ready_made_views ready_view
    on ready_view.period_key = visit.period_key
   and ready_view.session_id = visit.session_id
  left join ready_made_carts ready_cart
    on ready_cart.period_key = ready_view.period_key
   and ready_cart.session_id = ready_view.session_id
  left join ready_made_checkouts ready_checkout
    on ready_checkout.period_key = ready_cart.period_key
   and ready_checkout.session_id = ready_cart.session_id
  group by period.period_key
),
build_starts as materialized (
  select period_key, session_id, min(occurred_at) as build_start_at
  from events
  where event_name = 'build_start'
  group by period_key, session_id
),
build_completions as materialized (
  select
    build_start.period_key,
    build_start.session_id,
    min(event.occurred_at) as build_complete_at
  from build_starts build_start
  join events event
    on event.period_key = build_start.period_key
   and event.session_id = build_start.session_id
   and event.event_name = 'build_complete'
   and event.occurred_at > build_start.build_start_at
  group by build_start.period_key, build_start.session_id
),
design_saves as materialized (
  select
    build_start.period_key,
    build_start.session_id,
    min(event.occurred_at) as save_design_at
  from build_starts build_start
  join events event
    on event.period_key = build_start.period_key
   and event.session_id = build_start.session_id
   and event.event_name = 'save_design'
   and event.occurred_at > build_start.build_start_at
  group by build_start.period_key, build_start.session_id
),
builder_journey as (
  select
    period.period_key,
    'builder'::text as journey_key,
    count(distinct build_start.session_id) as build_start_sessions,
    count(distinct build_complete.session_id) as build_complete_sessions,
    count(distinct design_save.session_id) as save_design_sessions,
    (
      select count(*)
      from events event
      where event.period_key = period.period_key
        and event.event_name = 'build_start'
    ) as build_start_events,
    (
      select count(*)
      from build_completions anchor
      join build_starts build_start_anchor
        on build_start_anchor.period_key = anchor.period_key
       and build_start_anchor.session_id = anchor.session_id
      join events event
        on event.period_key = anchor.period_key
       and event.session_id = anchor.session_id
       and event.event_name = 'build_complete'
       and event.occurred_at > build_start_anchor.build_start_at
      where anchor.period_key = period.period_key
    ) as build_complete_events,
    (
      select count(*)
      from design_saves anchor
      join build_starts build_start_anchor
        on build_start_anchor.period_key = anchor.period_key
       and build_start_anchor.session_id = anchor.session_id
      join events event
        on event.period_key = anchor.period_key
       and event.session_id = anchor.session_id
       and event.event_name = 'save_design'
       and event.occurred_at > build_start_anchor.build_start_at
      where anchor.period_key = period.period_key
    ) as save_design_events,
    count(distinct build_start.session_id) filter (
      where exists (
        select 1
        from events event
        where event.period_key = build_start.period_key
          and event.session_id = build_start.session_id
          and event.event_name = 'build_complete'
          and event.occurred_at = build_start.build_start_at
      )
    ) as equal_time_build_complete_sessions,
    count(distinct build_start.session_id) filter (
      where exists (
        select 1
        from events event
        where event.period_key = build_start.period_key
          and event.session_id = build_start.session_id
          and event.event_name = 'save_design'
          and event.occurred_at = build_start.build_start_at
      )
    ) as equal_time_save_design_sessions
  from periods period
  left join build_starts build_start
    on build_start.period_key = period.period_key
  left join build_completions build_complete
    on build_complete.period_key = build_start.period_key
   and build_complete.session_id = build_start.session_id
  left join design_saves design_save
    on design_save.period_key = build_start.period_key
   and design_save.session_id = build_start.session_id
  group by period.period_key
),
email_signup_engagement as (
  select
    period.period_key,
    'email_signup'::text as event_name,
    count(distinct event.session_id) as sessions,
    count(distinct event.anonymous_id) as visitors,
    count(event.event_id) as events
  from periods period
  left join events event
    on event.period_key = period.period_key
   and event.event_name = 'email_signup'
  group by period.period_key
),
collection_event_rows as materialized (
  select
    event.period_key,
    event.session_id,
    event.anonymous_id,
    event.display_values ->> 'property_item_list_name' as item_list_name,
    exists (
      select 1
      from events product_event
      where product_event.period_key = event.period_key
        and product_event.session_id = event.session_id
        and product_event.event_name = 'view_item'
        and product_event.occurred_at > event.occurred_at
        and exists (
          select 1
          from jsonb_array_elements(event.properties -> 'items')
            with ordinality as list_entry(item, item_index)
          cross join lateral jsonb_array_elements(
            product_event.properties -> 'items'
          ) with ordinality as product_entry(item, item_index)
          where event.display_values
              ->> ('item_id:' || list_entry.item_index::text)
            = product_event.display_values
              ->> ('item_id:' || product_entry.item_index::text)
        )
    ) as progressed_to_product,
    exists (
      select 1
      from events product_event
      where product_event.period_key = event.period_key
        and product_event.session_id = event.session_id
        and product_event.event_name = 'view_item'
        and product_event.occurred_at = event.occurred_at
        and exists (
          select 1
          from jsonb_array_elements(event.properties -> 'items')
            with ordinality as list_entry(item, item_index)
          cross join lateral jsonb_array_elements(
            product_event.properties -> 'items'
          ) with ordinality as product_entry(item, item_index)
          where event.display_values
              ->> ('item_id:' || list_entry.item_index::text)
            = product_event.display_values
              ->> ('item_id:' || product_entry.item_index::text)
        )
    ) as equal_time_progression
  from events event
  where event.event_name = 'view_item_list'
),
collection_grouped as (
  select
    period_key,
    item_list_name,
    count(distinct session_id) as collection_view_sessions,
    count(*) as collection_view_events,
    count(distinct anonymous_id) as visitors,
    count(distinct session_id) filter (
      where progressed_to_product
    ) as progressed_to_product_sessions,
    count(distinct session_id) filter (
      where equal_time_progression
    ) as equal_time_progression_sessions
  from collection_event_rows
  group by period_key, item_list_name

  union all

  select
    period_key,
    'Unknown / unmapped'::text as item_list_name,
    count(distinct session_id) as collection_view_sessions,
    count(*) as collection_view_events,
    count(distinct anonymous_id) as visitors,
    0::bigint as progressed_to_product_sessions,
    0::bigint as equal_time_progression_sessions
  from diagnostic_known_events
  where event_name = 'view_item_list'
    and property_valid is not true
  group by period_key
),
collection_ranked as (
  select
    collection.*,
    count(*) over (partition by period_key) as total_rows,
    row_number() over (
      partition by period_key
      order by collection_view_sessions desc, item_list_name asc
    ) as grouped_row_number
  from collection_grouped collection
),
collection_paged as (
  select *
  from collection_ranked
  where grouped_row_number > $15::integer
    and grouped_row_number <= $15::integer + $13::integer
),
product_item_events as materialized (
  select
    event.period_key,
    event.event_id,
    event.session_id,
    event.anonymous_id,
    event.event_name,
    event.occurred_at,
    event.display_values ->> ('item_id:' || item_entry.item_index::text) as item_id,
    event.display_values ->> ('item_name:' || item_entry.item_index::text) as item_name,
    event.display_values ->> ('item_category:' || item_entry.item_index::text)
      as item_category
  from events event
  cross join lateral jsonb_array_elements(event.properties -> 'items')
    with ordinality as item_entry(item, item_index)
  where event.event_name in ('view_item', 'add_to_cart')
),
product_labels as (
  select
    period_key,
    item_id,
    case
      when count(distinct item_name) = 1 then min(item_name)
      else 'Unknown / unmapped'
    end as item_name,
    case
      when count(distinct item_category) = 1 then min(item_category)
      else 'Unknown / unmapped'
    end as item_category
  from product_item_events
  group by period_key, item_id
),
product_activity as (
  select
    period_key,
    item_id,
    count(distinct session_id) filter (
      where event_name = 'view_item'
    ) as product_view_sessions,
    count(distinct session_id) filter (
      where event_name = 'add_to_cart'
    ) as add_to_cart_sessions,
    count(*) filter (where event_name = 'view_item') as product_view_events,
    count(*) filter (where event_name = 'add_to_cart') as add_to_cart_events
  from product_item_events
  group by period_key, item_id
),
product_views as materialized (
  select
    period_key,
    session_id,
    item_id,
    min(occurred_at) as product_view_at
  from product_item_events
  where event_name = 'view_item'
  group by period_key, session_id, item_id
),
product_view_to_cart as (
  select
    product_view.period_key,
    product_view.item_id,
    count(distinct product_view.session_id) as matched_view_to_cart_sessions
  from product_views product_view
  where exists (
    select 1
    from product_item_events cart_event
    where cart_event.period_key = product_view.period_key
      and cart_event.session_id = product_view.session_id
      and cart_event.item_id = product_view.item_id
      and cart_event.event_name = 'add_to_cart'
      and cart_event.occurred_at > product_view.product_view_at
  )
  group by product_view.period_key, product_view.item_id
),
product_grouped as (
  select
    activity.period_key,
    activity.item_id,
    label.item_name,
    label.item_category,
    activity.product_view_sessions,
    activity.add_to_cart_sessions,
    coalesce(matched.matched_view_to_cart_sessions, 0) as matched_view_to_cart_sessions,
    activity.product_view_events,
    activity.add_to_cart_events,
    (
      label.item_name <> 'Unknown / unmapped'
      and label.item_category <> 'Unknown / unmapped'
      and activity.product_view_sessions > 0
      and activity.add_to_cart_sessions > 0
    ) as stable_identity
  from product_activity activity
  join product_labels label
    on label.period_key = activity.period_key
   and label.item_id = activity.item_id
  left join product_view_to_cart matched
    on matched.period_key = activity.period_key
   and matched.item_id = activity.item_id

  union all

  select
    event.period_key,
    'Unknown / unmapped'::text as item_id,
    'Unknown / unmapped'::text as item_name,
    'Unknown / unmapped'::text as item_category,
    count(distinct event.session_id) filter (
      where event.event_name = 'view_item'
    ) as product_view_sessions,
    count(distinct event.session_id) filter (
      where event.event_name = 'add_to_cart'
    ) as add_to_cart_sessions,
    0::bigint as matched_view_to_cart_sessions,
    count(*) filter (
      where event.event_name = 'view_item'
    ) as product_view_events,
    count(*) filter (
      where event.event_name = 'add_to_cart'
    ) as add_to_cart_events,
    false as stable_identity
  from diagnostic_known_events event
  where event.event_name in ('view_item', 'add_to_cart')
    and event.property_valid is not true
  group by event.period_key
),
product_ranked as (
  select
    product.*,
    count(*) over (partition by period_key) as total_rows,
    row_number() over (
      partition by period_key
      order by product_view_sessions desc, add_to_cart_sessions desc, item_id asc
    ) as grouped_row_number
  from product_grouped product
),
product_paged as (
  select *
  from product_ranked
  where grouped_row_number > $14::integer
    and grouped_row_number <= $14::integer + $13::integer
),
session_activity as (
  select period_key, session_id, count(*) as events
  from events
  group by period_key, session_id
),
acquisition_grouped as (
  select
    session.period_key,
    session.utm_source,
    session.utm_medium,
    session.utm_campaign,
    session.landing_page,
    session.referrer_host,
    count(*) as sessions,
    count(distinct session.anonymous_id) as visitors,
    sum(activity.events) as events,
    count(*) filter (
      where funnel.intent_at is not null
    ) as product_intent_sessions,
    count(*) filter (
      where funnel.checkout_at is not null
    ) as checkout_sessions
  from filtered_session_context session
  join session_activity activity
    on activity.period_key = session.period_key
   and activity.session_id = session.session_id
  join funnel_anchors funnel
    on funnel.period_key = session.period_key
   and funnel.session_id = session.session_id
  group by
    session.period_key,
    session.utm_source,
    session.utm_medium,
    session.utm_campaign,
    session.landing_page,
    session.referrer_host
),
acquisition_ranked as (
  select
    acquisition.*,
    count(*) over (partition by period_key) as total_rows,
    row_number() over (
      partition by period_key
      order by
        sessions desc,
        utm_source asc,
        utm_medium asc,
        utm_campaign asc,
        landing_page asc,
        referrer_host asc
    ) as grouped_row_number
  from acquisition_grouped acquisition
),
acquisition_paged as (
  select *
  from acquisition_ranked
  where grouped_row_number > $16::integer
    and grouped_row_number <= $16::integer + $13::integer
),
group_totals as (
  select
    (
      select count(*)
      from product_grouped
      where period_key = 'current'
    ) as products,
    (
      select count(*)
      from collection_grouped
      where period_key = 'current'
    ) as collections,
    (
      select count(*)
      from acquisition_grouped
      where period_key = 'current'
    ) as acquisition
),
device_grouped as (
  select
    session.period_key,
    session.device_category,
    count(*) as sessions,
    count(distinct session.anonymous_id) as visitors,
    sum(activity.events) as events,
    count(*) filter (
      where funnel.intent_at is not null
    ) as product_intent_sessions,
    count(*) filter (
      where funnel.checkout_at is not null
    ) as checkout_sessions
  from filtered_session_context session
  join session_activity activity
    on activity.period_key = session.period_key
   and activity.session_id = session.session_id
  join funnel_anchors funnel
    on funnel.period_key = session.period_key
   and funnel.session_id = session.session_id
  group by session.period_key, session.device_category
),
unknown_grouped as (
  select
    period_key,
    event_name,
    count(*) as events,
    count(distinct session_id) as sessions
  from diagnostic_unknown_events
  group by period_key, event_name
),
unknown_ranked as (
  select
    unknown_event.*,
    count(*) over (partition by period_key) as total_rows,
    row_number() over (
      partition by period_key
      order by events desc, event_name asc
    ) as grouped_row_number
  from unknown_grouped unknown_event
),
unknown_paged as (
  select *
  from unknown_ranked
  where grouped_row_number > $17::integer
    and grouped_row_number <= $17::integer + $13::integer
),
invalid_properties as (
  select period_key, event_name, count(*) as events
  from diagnostic_known_events
  where property_valid is not true
  group by period_key, event_name
),
reconciliation_periods as (
  select
    period.period_key,
    period.start_at,
    (
      date_trunc(
        'day',
        period.end_at at time zone 'America/Los_Angeles'
      ) at time zone 'America/Los_Angeles'
    ) as end_at
  from periods period
),
raw_additive as (
  select
    period.period_key,
    count(event.event_id) filter (
      where event.event_name = 'page_view'
    ) as raw_page_views,
    count(distinct (
      event.occurred_at at time zone 'America/Los_Angeles'
    )::date) filter (
      where event.event_name = 'page_view'
    ) as raw_page_view_days,
    count(event.event_id) filter (
      where event.event_name <> 'page_view'
    ) as raw_custom_events,
    count(distinct (
      event.occurred_at at time zone 'America/Los_Angeles'
    )::date) filter (
      where event.event_name <> 'page_view'
    ) as raw_custom_event_days
  from reconciliation_periods period
  left join all_events event
    on event.period_key = period.period_key
   and event.occurred_at < period.end_at
  group by period.period_key
),
metric_additive as (
  select
    period.period_key,
    (
      period.end_at > period.start_at
    ) as comparable,
    count(metric.id) filter (
      where metric.metric_key = 'page_views'
        and metric.dimensions = '{"rollup":"daily"}'::jsonb
    ) as page_view_metric_rows,
    sum(metric.metric_value) filter (
      where metric.metric_key = 'page_views'
        and metric.dimensions = '{"rollup":"daily"}'::jsonb
    ) as metric_page_views,
    count(metric.id) filter (
      where metric.metric_key = 'custom_events'
        and metric.dimensions = '{"rollup":"daily"}'::jsonb
    ) as custom_event_metric_rows,
    sum(metric.metric_value) filter (
      where metric.metric_key = 'custom_events'
        and metric.dimensions = '{"rollup":"daily"}'::jsonb
    ) as metric_custom_events
  from reconciliation_periods period
  cross join selected_source source
  left join metrics_daily metric
    on metric.source_id = source.id
   and metric.date >= (period.start_at at time zone 'America/Los_Angeles')::date
   and metric.date < (period.end_at at time zone 'America/Los_Angeles')::date
  group by period.period_key, period.start_at, period.end_at
),
reconciliation as (
  select
    raw.period_key,
    coalesce(metric.comparable, false) as comparable,
    raw.raw_page_views,
    raw.raw_page_view_days,
    coalesce(metric.page_view_metric_rows, 0) as page_view_metric_rows,
    case
      when metric.comparable then coalesce(metric.metric_page_views, 0)
      else null
    end as metric_page_views,
    case
      when metric.comparable
        then raw.raw_page_views - coalesce(metric.metric_page_views, 0)
      else null
    end as page_view_difference,
    raw.raw_custom_events,
    raw.raw_custom_event_days,
    coalesce(metric.custom_event_metric_rows, 0) as custom_event_metric_rows,
    case
      when metric.comparable then coalesce(metric.metric_custom_events, 0)
      else null
    end as metric_custom_events,
    case
      when metric.comparable
        then raw.raw_custom_events - coalesce(metric.metric_custom_events, 0)
      else null
    end as custom_event_difference
  from raw_additive raw
  left join metric_additive metric using (period_key)
)
-- AGGREGATE_ONLY_RESPONSE
select
  gate.candidate_count,
  (
    select jsonb_build_object(
      'display_name', source.display_name,
      'status', source.status
    )
    from selected_source source
  ) as source,
  coalesce(
    (
      select jsonb_build_object(
        'first_occurred_at', coverage.first_occurred_at,
        'latest_received_at', coverage.latest_received_at
      )
      from coverage
    ),
    '{"first_occurred_at":null,"latest_received_at":null}'::jsonb
  ) as coverage,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'period_key', stage.period_key,
          'stage_key', stage.stage_key,
          'sessions', stage.sessions,
          'visitors', stage.visitors,
          'events', stage.events
        )
        order by
          case stage.period_key when 'current' then 0 else 1 end,
          case stage.stage_key
            when 'visit' then 0
            when 'product_intent' then 1
            when 'add_to_cart' then 2
            else 3
          end
      )
      from stage_aggregates stage
    ),
    '[]'::jsonb
  ) as stages,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(daily)
        order by
          case daily.period_key when 'current' then 0 else 1 end,
          daily.date_pt
      )
      from daily_trend daily
    ),
    '[]'::jsonb
  ) as daily_trend,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(quality_row)
        order by case quality_row.period_key when 'current' then 0 else 1 end
      )
      from quality quality_row
    ),
    '[]'::jsonb
  ) as quality,
  coalesce(
    (
      select jsonb_agg(
        journey
        order by
          case journey ->> 'period_key' when 'current' then 0 else 1 end,
          journey ->> 'journey_key'
      )
      from (
        select to_jsonb(ready) as journey from ready_made_journey ready
        union all
        select to_jsonb(builder) as journey from builder_journey builder
      ) journeys
    ),
    '[]'::jsonb
  ) as journeys,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(engagement_row)
        order by case engagement_row.period_key when 'current' then 0 else 1 end
      )
      from email_signup_engagement engagement_row
    ),
    '[]'::jsonb
  ) as engagement,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(product)
          - 'grouped_row_number'
        order by
          case product.period_key when 'current' then 0 else 1 end,
          product.product_view_sessions desc,
          product.add_to_cart_sessions desc,
          product.item_id asc
      )
      from product_paged product
    ),
    '[]'::jsonb
  ) as products,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(collection)
          - 'grouped_row_number'
        order by
          case collection.period_key when 'current' then 0 else 1 end,
          collection.collection_view_sessions desc,
          collection.item_list_name asc
      )
      from collection_paged collection
    ),
    '[]'::jsonb
  ) as collections,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(acquisition)
          - 'grouped_row_number'
        order by
          case acquisition.period_key when 'current' then 0 else 1 end,
          acquisition.sessions desc,
          acquisition.utm_source,
          acquisition.utm_medium,
          acquisition.utm_campaign,
          acquisition.landing_page,
          acquisition.referrer_host
      )
      from acquisition_paged acquisition
    ),
    '[]'::jsonb
  ) as acquisition,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(device)
        order by
          case device.period_key when 'current' then 0 else 1 end,
          device.sessions desc,
          device.device_category
      )
      from device_grouped device
    ),
    '[]'::jsonb
  ) as devices,
  coalesce(
    (
      select jsonb_build_object(
        'devices', coalesce(to_jsonb(options.devices), '[]'::jsonb),
        'utm_sources', coalesce(to_jsonb(options.utm_sources), '[]'::jsonb),
        'utm_mediums', coalesce(to_jsonb(options.utm_mediums), '[]'::jsonb),
        'utm_campaigns', coalesce(to_jsonb(options.utm_campaigns), '[]'::jsonb),
        'landing_pages', coalesce(to_jsonb(options.landing_pages), '[]'::jsonb),
        'referrer_hosts', coalesce(to_jsonb(options.referrer_hosts), '[]'::jsonb)
      )
      from filter_options options
    ),
    '{"devices":[],"utm_sources":[],"utm_mediums":[],"utm_campaigns":[],"landing_pages":[],"referrer_hosts":[]}'::jsonb
  ) as filter_options,
  coalesce(
    (
      select to_jsonb(totals)
      from group_totals totals
    ),
    '{"products":0,"collections":0,"acquisition":0}'::jsonb
  ) as group_totals,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(event_count)
        order by case event_count.period_key when 'current' then 0 else 1 end
      )
      from period_event_counts event_count
    ),
    '[]'::jsonb
  ) as event_counts,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(unknown_event)
          - 'grouped_row_number'
        order by
          case unknown_event.period_key when 'current' then 0 else 1 end,
          unknown_event.events desc,
          unknown_event.event_name
      )
      from unknown_paged unknown_event
    ),
    '[]'::jsonb
  ) as unknown_events,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(invalid)
        order by
          case invalid.period_key when 'current' then 0 else 1 end,
          invalid.event_name
      )
      from invalid_properties invalid
    ),
    '[]'::jsonb
  ) as invalid_properties,
  coalesce(
    (
      select jsonb_agg(
        to_jsonb(reconciliation_row)
        order by
          case reconciliation_row.period_key when 'current' then 0 else 1 end
      )
      from reconciliation reconciliation_row
    ),
    '[]'::jsonb
  ) as reconciliation
from source_gate gate
`;

function requireUuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error(`${field} must be a UUID.`);
  }
}

function requirePeriod(
  startAt: string,
  endExclusive: string,
  field: string,
  allowEmpty = false,
) {
  const start = Date.parse(startAt);
  const end = Date.parse(endExclusive);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`${field} must contain valid timestamps.`);
  }
  if (end < start || (!allowEmpty && end === start)) {
    throw new Error(`${field} must be a non-empty half-open range.`);
  }
  if (end - start > MAX_PERIOD_MS) {
    throw new Error(`${field} cannot exceed 32 days.`);
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function normalizedFilter(value: string | null | undefined, maximum: number, field: string) {
  if (value == null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) throw new Error(`${field} is too long.`);
  return normalized;
}

function normalizedDimensionFilter(
  value: string | null | undefined,
  maximum: number,
  field: string,
  lowerCase = false,
  kind?: WebsiteDisplayDimensionKind,
) {
  const normalized = normalizedFilter(value, maximum, field);
  if (normalized === null) return null;
  const privacySafe = kind
    ? sanitizeWebsiteDisplayDimension(normalized, kind, maximum)
    : normalized;
  if (!privacySafe) return null;
  if (privacySafe.toLowerCase() === "unknown") return "Unknown";
  return lowerCase ? privacySafe.toLowerCase() : privacySafe;
}

function normalizedDeviceFilter(value: string | null | undefined) {
  const normalized = normalizedDimensionFilter(value, 20, "deviceCategory");
  if (
    normalized === null
    || normalized === "Unknown"
    || ["mobile", "tablet", "desktop", "bot"].includes(normalized)
  ) {
    return normalized;
  }
  return null;
}

function normalizedSegment(value: WebsiteFunnelRepositoryInput["segment"]) {
  const segment = value ?? "all";
  if (segment !== "all" && segment !== "ready-made" && segment !== "builder") {
    throw new Error("segment must be all, ready-made, or builder.");
  }
  return segment;
}

export function websiteFunnelQueryValues(input: WebsiteFunnelRepositoryInput): unknown[] {
  requireUuid(input.dataSpaceId, "dataSpaceId");
  requirePeriod(input.current.startAt, input.current.endExclusive, "current", true);
  requirePeriod(input.comparison.startAt, input.comparison.endExclusive, "comparison");

  const groupLimit = boundedInteger(
    input.pagination?.groupLimit,
    DEFAULT_GROUP_LIMIT,
    1,
    MAX_GROUP_LIMIT,
    "groupLimit",
  );
  const productOffset = boundedInteger(
    input.pagination?.productOffset,
    0,
    0,
    MAX_GROUP_OFFSET,
    "productOffset",
  );
  const collectionOffset = boundedInteger(
    input.pagination?.collectionOffset,
    0,
    0,
    MAX_GROUP_OFFSET,
    "collectionOffset",
  );
  const acquisitionOffset = boundedInteger(
    input.pagination?.acquisitionOffset,
    0,
    0,
    MAX_GROUP_OFFSET,
    "acquisitionOffset",
  );
  const unknownEventOffset = boundedInteger(
    input.pagination?.unknownEventOffset,
    0,
    0,
    MAX_GROUP_OFFSET,
    "unknownEventOffset",
  );

  return [
    input.dataSpaceId,
    input.current.startAt,
    input.current.endExclusive,
    input.comparison.startAt,
    input.comparison.endExclusive,
    [...WEBSITE_FUNNEL_EVENT_TAXONOMY],
    normalizedDimensionFilter(input.filters?.utmSource, 256, "utmSource", true, "utm"),
    normalizedDimensionFilter(input.filters?.utmMedium, 256, "utmMedium", true, "utm"),
    normalizedDimensionFilter(input.filters?.utmCampaign, 256, "utmCampaign", false, "utm"),
    normalizedDimensionFilter(input.filters?.landingPage, 500, "landingPage", false, "landing_path"),
    normalizedDimensionFilter(input.filters?.referrerHost, 253, "referrerHost", true, "referrer_host"),
    normalizedDeviceFilter(input.filters?.deviceCategory),
    groupLimit,
    productOffset,
    collectionOffset,
    acquisitionOffset,
    unknownEventOffset,
    normalizedSegment(input.segment),
  ];
}

export function websiteFunnelAggregateProjection() {
  const marker = "-- AGGREGATE_ONLY_RESPONSE";
  const markerIndex = WEBSITE_FUNNEL_AGGREGATE_SQL.indexOf(marker);
  if (markerIndex < 0) throw new Error("Website funnel aggregate projection marker is missing.");
  return WEBSITE_FUNNEL_AGGREGATE_SQL.slice(markerIndex + marker.length);
}

export async function getWebsiteFunnelAggregate(
  input: WebsiteFunnelRepositoryInput,
): Promise<WebsiteFunnelAggregateRow> {
  const values = websiteFunnelQueryValues(input);
  return withDatabaseTransaction(async (client) => {
    await query(
      "set transaction isolation level repeatable read, read only",
      undefined,
      client,
    );
    await query(
      `set local statement_timeout = '${QUERY_TIMEOUT_MS}ms'`,
      undefined,
      client,
    );
    const rows = await queryRows<WebsiteFunnelAggregateRow>(
      WEBSITE_FUNNEL_AGGREGATE_SQL,
      values,
      client,
    );
    const row = rows[0];
    if (!row) throw new Error("Website funnel aggregate query returned no result.");
    return row;
  });
}
