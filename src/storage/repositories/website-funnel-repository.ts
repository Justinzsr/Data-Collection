import "server-only";

import {
  WEBSITE_FUNNEL_EVENT_NAMES,
  type WebsiteFunnelEventName,
} from "@/aggregation/metric-definitions/website-funnel-definitions";
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
with source_candidates as materialized (
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
event_property_primitives as materialized (
  select
    event.*,
    case
      when jsonb_typeof(event.properties) = 'object'
        and jsonb_typeof(event.properties -> 'items') = 'array'
        then jsonb_array_length(event.properties -> 'items') between 1 and 100
          and not exists (
            select 1
            from jsonb_array_elements(event.properties -> 'items') item
            where not (
              jsonb_typeof(item) = 'object'
              and item - array[
                'item_id',
                'item_name',
                'item_category',
                'item_list_name',
                'price',
                'quantity'
              ]::text[] = '{}'::jsonb
              and jsonb_typeof(item -> 'item_id') = 'string'
              and char_length(btrim(item ->> 'item_id')) between 1 and 256
              and jsonb_typeof(item -> 'item_name') = 'string'
              and char_length(btrim(item ->> 'item_name')) between 1 and 256
              and jsonb_typeof(item -> 'item_category') = 'string'
              and char_length(btrim(item ->> 'item_category')) between 1 and 160
              and case
                when item ? 'item_list_name' then
                  jsonb_typeof(item -> 'item_list_name') = 'string'
                  and char_length(btrim(item ->> 'item_list_name')) between 1 and 256
                else true
              end
              and case
                when item ? 'price' then
                  case
                    when jsonb_typeof(item -> 'price') = 'number'
                      then (item ->> 'price')::numeric >= 0
                    else false
                  end
                else true
              end
              and case
                when item ? 'quantity' then
                  case
                    when jsonb_typeof(item -> 'quantity') = 'number' then
                      (item ->> 'quantity')::numeric >= 1
                      and trunc((item ->> 'quantity')::numeric)
                        = (item ->> 'quantity')::numeric
                    else false
                  end
                else true
              end
            )
          )
      else false
    end as items_are_valid,
    (
      jsonb_typeof(event.properties) = 'object'
      and jsonb_typeof(event.properties -> 'currency') = 'string'
      and btrim(event.properties ->> 'currency') ~ '^[A-Z]{3}$'
      and case
        when jsonb_typeof(event.properties -> 'value') = 'number'
          then (event.properties ->> 'value')::numeric >= 0
        else false
      end
    ) as commerce_values_are_valid
  from known_events event
),
classified_known_events as materialized (
  select
    event.*,
    case
      when jsonb_typeof(event.properties) is distinct from 'object' then false
      when event.event_name = 'page_view' then true
      when event.event_name = 'view_item_list' then
        event.properties
          - array['item_list_name', 'items', 'attribution']::text[] = '{}'::jsonb
        and event.items_are_valid
        and jsonb_typeof(event.properties -> 'item_list_name') = 'string'
        and char_length(btrim(event.properties ->> 'item_list_name'))
          between 1 and 256
      when event.event_name in ('view_item', 'add_to_cart', 'begin_checkout') then
        event.properties
          - array['currency', 'value', 'items', 'attribution']::text[] = '{}'::jsonb
        and event.items_are_valid
        and event.commerce_values_are_valid
      when event.event_name = 'build_start' then
        event.properties - array['item_category', 'attribution']::text[] = '{}'::jsonb
        and jsonb_typeof(event.properties -> 'item_category') = 'string'
        and char_length(btrim(event.properties ->> 'item_category'))
          between 1 and 160
      when event.event_name in ('build_complete', 'save_design') then
        event.properties
          - array['currency', 'item_category', 'stone_count', 'value', 'attribution']::text[]
            = '{}'::jsonb
        and jsonb_typeof(event.properties -> 'currency') = 'string'
        and btrim(event.properties ->> 'currency') ~ '^[A-Z]{3}$'
        and jsonb_typeof(event.properties -> 'item_category') = 'string'
        and char_length(btrim(event.properties ->> 'item_category'))
          between 1 and 160
        and case
          when jsonb_typeof(event.properties -> 'stone_count') = 'number' then
            (event.properties ->> 'stone_count')::numeric >= 0
            and trunc((event.properties ->> 'stone_count')::numeric)
              = (event.properties ->> 'stone_count')::numeric
          else false
        end
        and case
          when jsonb_typeof(event.properties -> 'value') = 'number'
            then (event.properties ->> 'value')::numeric >= 0
          else false
        end
      when event.event_name = 'email_signup' then
        event.properties
          - array['discount_code', 'method', 'attribution']::text[] = '{}'::jsonb
        and jsonb_typeof(event.properties -> 'discount_code') = 'string'
        and char_length(btrim(event.properties ->> 'discount_code'))
          between 1 and 160
        and jsonb_typeof(event.properties -> 'method') = 'string'
        and char_length(btrim(event.properties ->> 'method'))
          between 1 and 160
      else false
    end as property_valid,
    (
      event.items_are_valid
      and event.commerce_values_are_valid
      and exists (
        select 1
        from jsonb_array_elements(
          case
            when event.items_are_valid then event.properties -> 'items'
            else '[]'::jsonb
          end
        ) item
        where lower(btrim(item ->> 'item_category')) <> 'build your own'
      )
    ) as has_ready_made_item
  from event_property_primitives event
),
first_visits as materialized (
  select period_key, session_id, min(occurred_at) as visit_at
  from classified_known_events
  where property_valid
    and event_name = 'page_view'
  group by period_key, session_id
),
visit_context_candidates as materialized (
  select
    visit.period_key,
    visit.session_id,
    visit.visit_at,
    event.anonymous_id,
    coalesce(
      nullif(lower(btrim(event.attribution_context #>> '{utm,source}')), ''),
      nullif(lower(btrim(event.attribution_context #>> '{utm,utm_source}')), ''),
      'Unknown'
    ) as utm_source,
    coalesce(
      nullif(lower(btrim(event.attribution_context #>> '{utm,medium}')), ''),
      nullif(lower(btrim(event.attribution_context #>> '{utm,utm_medium}')), ''),
      'Unknown'
    ) as utm_medium,
    coalesce(
      nullif(btrim(event.attribution_context #>> '{utm,campaign}'), ''),
      nullif(btrim(event.attribution_context #>> '{utm,utm_campaign}'), ''),
      'Unknown'
    ) as utm_campaign,
    case
      when coalesce(event.attribution_context ->> 'landing_page', '') ~ '^/[^?#]*$'
        then event.attribution_context ->> 'landing_page'
      else 'Unknown'
    end as landing_page,
    coalesce(
      nullif(
        substring(
          lower(coalesce(event.attribution_context ->> 'first_referrer', ''))
          from '^https?://([^/?#:]+)'
        ),
        ''
      ),
      nullif(
        substring(lower(coalesce(event.referrer, '')) from '^https?://([^/?#:]+)'),
        ''
      ),
      'Unknown'
    ) as referrer_host,
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
   and event.property_valid
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
  select event.*
  from unknown_event_rows event
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
  where property_valid
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
       and event.has_ready_made_item
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
   and ($18::text <> 'ready-made' or event.has_ready_made_item)
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
   and ($18::text <> 'ready-made' or event.has_ready_made_item)
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
       and event.has_ready_made_item
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
   and ($18::text <> 'ready-made' or event.has_ready_made_item)
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
   and ($18::text <> 'ready-made' or event.has_ready_made_item)
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
        and event.property_valid
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
        and event.property_valid
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
        and event.property_valid
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
   and event.has_ready_made_item
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
   and event.has_ready_made_item
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
   and event.has_ready_made_item
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
       and event.has_ready_made_item
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
       and event.has_ready_made_item
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
       and event.has_ready_made_item
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
    btrim(event.properties ->> 'item_list_name') as item_list_name,
    exists (
      select 1
      from events product_event
      where product_event.period_key = event.period_key
        and product_event.session_id = event.session_id
        and product_event.event_name = 'view_item'
        and product_event.occurred_at > event.occurred_at
        and exists (
          select 1
          from jsonb_array_elements(event.properties -> 'items') list_item
          cross join lateral jsonb_array_elements(
            product_event.properties -> 'items'
          ) product_item
          where btrim(list_item ->> 'item_id')
            = btrim(product_item ->> 'item_id')
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
          from jsonb_array_elements(event.properties -> 'items') list_item
          cross join lateral jsonb_array_elements(
            product_event.properties -> 'items'
          ) product_item
          where btrim(list_item ->> 'item_id')
            = btrim(product_item ->> 'item_id')
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
    btrim(item ->> 'item_id') as item_id,
    btrim(item ->> 'item_name') as item_name,
    btrim(item ->> 'item_category') as item_category
  from events event
  cross join lateral jsonb_array_elements(event.properties -> 'items') item
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
) {
  const normalized = normalizedFilter(value, maximum, field);
  if (normalized === null) return null;
  if (normalized.toLowerCase() === "unknown") return "Unknown";
  return lowerCase ? normalized.toLowerCase() : normalized;
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
    normalizedDimensionFilter(input.filters?.utmSource, 256, "utmSource", true),
    normalizedDimensionFilter(input.filters?.utmMedium, 256, "utmMedium", true),
    normalizedDimensionFilter(input.filters?.utmCampaign, 256, "utmCampaign"),
    normalizedDimensionFilter(input.filters?.landingPage, 500, "landingPage"),
    normalizedDimensionFilter(input.filters?.referrerHost, 253, "referrerHost", true),
    normalizedDimensionFilter(input.filters?.deviceCategory, 20, "deviceCategory"),
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
