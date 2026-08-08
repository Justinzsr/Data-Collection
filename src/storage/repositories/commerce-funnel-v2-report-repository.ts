import "server-only";

import {
  isRuntimeDatabaseConfigured,
  query,
  queryRows,
  withDatabaseTransaction,
} from "@/storage/db/client";

const QUERY_TIMEOUT_MS = 8_000;
const UUID_V4_SQL = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

export type CommerceFunnelV2ReportInput = {
  dataSpaceId: string;
  websiteSourceId: string;
  shopifySourceId: string;
  startAt: string;
  endExclusive: string;
  segment: "all" | "ready-made" | "builder";
};

export type CommerceFunnelV2MoneyGroup = {
  currency: string;
  orders: number;
  grossSales: string;
  currentTotal: string;
  netPayment: string;
  refunds: string;
  state: "healthy";
};

export type CommerceFunnelV2ReportAggregate = {
  state: "ready" | "migration_unavailable" | "unavailable";
  reason: string;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
  businessVisits: number | null;
  businessIntents: number | null;
  businessCarts: number | null;
  eligibleCheckoutEvents: number | null;
  excludedBotSessions: number | null;
  excludedNonProductionSessions: number | null;
  eligibleShopifyOrders: number | null;
  linkedOrdersPlaced: number | null;
  activeLinkedOrders: number | null;
  cancelledLinkedOrders: number | null;
  bridgeMatchedOrders: number | null;
  bridgeMissingOrders: number | null;
  bridgeInvalidOrders: number | null;
  bridgeAmbiguousOrders: number | null;
  consentBlockedOrders: number | null;
  reversedTimestampOrders: number | null;
  preCoverageOrders: number | null;
  linkedOrderLines: number | null;
  eligibleOrderLines: number | null;
  money: CommerceFunnelV2MoneyGroup[];
};

type AggregateRow = {
  data_space_count: string | number;
  website_candidate_count: string | number;
  shopify_candidate_count: string | number;
  resolved_sources_match: boolean;
  bridge_verified: boolean;
  coverage_start_at: string | Date | null;
  coverage_end_at: string | Date | null;
  business_visits: string | number;
  business_intents: string | number;
  business_carts: string | number;
  eligible_checkout_events: string | number;
  excluded_bot_sessions: string | number;
  excluded_non_production_sessions: string | number;
  eligible_shopify_orders: string | number;
  linked_orders_placed: string | number;
  active_linked_orders: string | number;
  cancelled_linked_orders: string | number;
  bridge_matched_orders: string | number;
  bridge_missing_orders: string | number;
  bridge_invalid_orders: string | number;
  bridge_ambiguous_orders: string | number;
  consent_blocked_orders: string | number;
  reversed_timestamp_orders: string | number;
  pre_coverage_orders: string | number;
  linked_order_lines: string | number;
  eligible_order_lines: string | number;
  money: unknown;
};

export const COMMERCE_FUNNEL_V2_REPORT_RESPONSE_DENYLIST = [
  "anonymous_id",
  "checkout_event_id_hash",
  "event_id",
  "item_instance_id_hash",
  "order_id",
  "session_id",
  "shopify_line_item_id_hash",
  "shopify_order_id_hash",
  "source_id",
  "user_id",
] as const;

export const COMMERCE_FUNNEL_V2_REPORT_SQL = `
with source_scope as materialized (
  select
    count(distinct data_space.id) as data_space_count,
    count(distinct source.id) filter (
      where source.source_type_key = 'website'
        and source.status <> 'disabled'
    ) as website_candidate_count,
    count(distinct source.id) filter (
      where source.source_type_key = 'shopify'
        and source.status <> 'disabled'
    ) as shopify_candidate_count,
    (min(source.id::text) filter (
      where source.source_type_key = 'website'
        and source.status <> 'disabled'
    ))::uuid as website_source_id,
    (min(source.id::text) filter (
      where source.source_type_key = 'shopify'
        and source.status <> 'disabled'
    ))::uuid as shopify_source_id,
    min(source.last_success_at) filter (
      where source.source_type_key = 'shopify'
        and source.status <> 'disabled'
    ) as shopify_last_success_at,
    bool_and(
      case
        when source.source_type_key = 'shopify' and source.status <> 'disabled'
          then source.metadata ->> 'commerce_bridge_v2_verified' = 'true'
        else true
      end
    ) as bridge_verified,
    min(
      case
        when source.source_type_key = 'shopify'
          and source.status <> 'disabled'
          and source.metadata ->> 'commerce_bridge_v2_coverage_start_at'
            ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?(Z|[+-]\\d{2}:\\d{2})$'
          then (source.metadata ->> 'commerce_bridge_v2_coverage_start_at')::timestamptz
        else null
      end
    ) as coverage_start_at
  from data_spaces data_space
  left join sources source
    on source.data_space_id = data_space.id
  where data_space.id = $1
    and data_space.status = 'active'
),
resolved_scope as materialized (
  select
    source_scope.*,
    (
      source_scope.data_space_count = 1
      and source_scope.website_candidate_count = 1
      and source_scope.shopify_candidate_count = 1
      and source_scope.website_source_id = $2::uuid
      and source_scope.shopify_source_id = $3::uuid
    ) as resolved_sources_match,
    case
      when source_scope.shopify_last_success_at is null
        or shopify_sync.finished_at is null
        or shopify_sync.snapshot_fetched_at is null
        or abs(extract(epoch from (
          source_scope.shopify_last_success_at - shopify_sync.finished_at
        ))) > 300
        or shopify_sync.snapshot_fetched_at > shopify_sync.finished_at + interval '5 minutes'
        then null
      else least($5::timestamptz, shopify_sync.snapshot_fetched_at)
    end as effective_end_at
  from source_scope
  left join lateral (
    select
      sync_run.finished_at,
      case
        when jsonb_typeof(sync_run.cursor_after) = 'object'
          and coalesce(sync_run.cursor_after ->> 'fetchedAt', '')
            ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?(Z|[+-]\\d{2}:\\d{2})$'
          then (sync_run.cursor_after ->> 'fetchedAt')::timestamptz
        else null
      end as snapshot_fetched_at
    from sync_runs sync_run
    where sync_run.source_id = source_scope.shopify_source_id
      and sync_run.source_type_key = 'shopify'
      and sync_run.status = 'success'
      and sync_run.finished_at is not null
    order by sync_run.finished_at desc, sync_run.created_at desc, sync_run.id desc
    limit 1
  ) shopify_sync on true
),
raw_events as materialized (
  select
    event.id,
    event.event_id,
    event.session_id,
    event.event_name,
    event.properties,
    event.consent_status,
    event.client_context,
    event.occurred_at,
    event.received_at,
    row_number() over (
      partition by event.source_id, event.event_id
      order by event.received_at asc, event.id asc
    ) as delivery_rank
  from web_events event
  cross join resolved_scope scope
  where scope.resolved_sources_match is true
    and event.source_id = scope.website_source_id
    and event.event_source = 'first_party_tracker'
    and event.schema_version = '1.0'
    and event.occurred_at >= greatest(
      $4::timestamptz,
      coalesce(scope.coverage_start_at, $5::timestamptz)
    )
    and event.occurred_at < least(
      $5::timestamptz,
      coalesce(scope.effective_end_at, $4::timestamptz)
    )
    and event.event_name in (
      'page_view',
      'view_item',
      'add_to_cart',
      'begin_checkout',
      'build_start',
      'build_complete',
      'save_design'
    )
),
deduplicated_events as materialized (
  select *
  from raw_events
  where delivery_rank = 1
),
classified_events as materialized (
  select
    event.*,
    (
      case
        when jsonb_typeof(event.properties) is distinct from 'object' then false
        when event.event_name = 'page_view' then true
        when event.event_name = 'build_start' then
          event.properties ? 'item_category'
          and event.properties - array['item_category', 'attribution']::text[] = '{}'::jsonb
          and jsonb_typeof(event.properties -> 'item_category') = 'string'
          and char_length(btrim(event.properties ->> 'item_category')) between 1 and 160
        when event.event_name in ('build_complete', 'save_design') then
          event.properties ?& array['currency', 'item_category', 'stone_count', 'value']::text[]
          and event.properties
            - array['currency', 'item_category', 'item_instance_id', 'stone_count', 'value', 'attribution']::text[]
              = '{}'::jsonb
          and jsonb_typeof(event.properties -> 'currency') = 'string'
          and btrim(event.properties ->> 'currency') ~ '^[A-Z]{3}$'
          and jsonb_typeof(event.properties -> 'item_category') = 'string'
          and char_length(btrim(event.properties ->> 'item_category')) between 1 and 160
          and (
            case
              when jsonb_typeof(event.properties -> 'stone_count') = 'number' then
                (event.properties ->> 'stone_count')::numeric >= 0
                and trunc((event.properties ->> 'stone_count')::numeric)
                  = (event.properties ->> 'stone_count')::numeric
              else false
            end
          )
          and (
            case
              when jsonb_typeof(event.properties -> 'value') = 'number' then
                (event.properties ->> 'value')::numeric >= 0
              else false
            end
          )
          and (
            not (event.properties ? 'item_instance_id')
            or (
              jsonb_typeof(event.properties -> 'item_instance_id') = 'string'
              and lower(event.properties ->> 'item_instance_id') ~ '${UUID_V4_SQL}'
            )
          )
        when event.event_name in ('view_item', 'add_to_cart', 'begin_checkout') then
          event.properties ?& array['currency', 'value', 'items']::text[]
          and event.properties - array['currency', 'value', 'items', 'attribution']::text[] = '{}'::jsonb
          and jsonb_typeof(event.properties -> 'currency') = 'string'
          and btrim(event.properties ->> 'currency') ~ '^[A-Z]{3}$'
          and (
            case
              when jsonb_typeof(event.properties -> 'value') = 'number' then
                (event.properties ->> 'value')::numeric >= 0
              else false
            end
          )
          and (
            case
              when jsonb_typeof(event.properties -> 'items') = 'array' then
                jsonb_array_length(event.properties -> 'items') between 1 and 100
                and not exists (
                  select 1
                  from jsonb_array_elements(event.properties -> 'items') item
                  where (
                    case
                      when jsonb_typeof(item) = 'object' then
                        item ?& array['item_id', 'item_name', 'item_category']::text[]
                        and item - (
                          case
                            when event.event_name in ('add_to_cart', 'begin_checkout')
                              then array[
                                'item_id', 'item_name', 'item_category', 'item_list_name',
                                'item_instance_id', 'price', 'quantity'
                              ]::text[]
                            else array[
                              'item_id', 'item_name', 'item_category', 'item_list_name',
                              'price', 'quantity'
                            ]::text[]
                          end
                        ) = '{}'::jsonb
                        and jsonb_typeof(item -> 'item_id') = 'string'
                        and char_length(btrim(item ->> 'item_id')) between 1 and 256
                        and jsonb_typeof(item -> 'item_name') = 'string'
                        and char_length(btrim(item ->> 'item_name')) between 1 and 256
                        and jsonb_typeof(item -> 'item_category') = 'string'
                        and char_length(btrim(item ->> 'item_category')) between 1 and 160
                        and (
                          not (item ? 'item_list_name')
                          or (
                            jsonb_typeof(item -> 'item_list_name') = 'string'
                            and char_length(btrim(item ->> 'item_list_name')) between 1 and 256
                          )
                        )
                        and (
                          not (item ? 'price')
                          or (
                            case
                              when jsonb_typeof(item -> 'price') = 'number'
                                then (item ->> 'price')::numeric >= 0
                              else false
                            end
                          )
                        )
                        and (
                          not (item ? 'quantity')
                          or (
                            case
                              when jsonb_typeof(item -> 'quantity') = 'number' then
                                (item ->> 'quantity')::numeric >= 1
                                and trunc((item ->> 'quantity')::numeric) = (item ->> 'quantity')::numeric
                              else false
                            end
                          )
                        )
                        and (
                          case
                            when event.event_name in ('add_to_cart', 'begin_checkout') then
                              not (item ? 'item_instance_id')
                              or (
                                jsonb_typeof(item -> 'item_instance_id') = 'string'
                                and lower(item ->> 'item_instance_id') ~ '${UUID_V4_SQL}'
                              )
                            else not (item ? 'item_instance_id')
                          end
                        )
                      else false
                    end
                  ) is not true
                )
              else false
            end
          )
        else false
      end
    ) is true as property_valid,
    (
      event.event_name in ('view_item', 'add_to_cart', 'begin_checkout')
      and jsonb_typeof(event.properties -> 'items') = 'array'
      and exists (
        select 1
        from jsonb_array_elements(event.properties -> 'items') item
        where lower(btrim(item ->> 'item_category')) <> 'build your own'
      )
    ) is true as has_ready_made_item
  from deduplicated_events event
),
valid_events as materialized (
  select *
  from classified_events
  where property_valid is true
),
traffic_sessions as materialized (
  select
    session_id,
    bool_or(event_name = 'page_view') as has_page_view,
    bool_or(coalesce(client_context ->> 'device_category' = 'bot', false)) as known_bot,
    bool_and(coalesce(client_context ->> 'traffic_type' = 'production', false)) as production_tagged
  from valid_events
  group by session_id
),
business_sessions as materialized (
  select session_id
  from traffic_sessions
  where has_page_view is true
    and known_bot is false
    and production_tagged is true
),
business_events as materialized (
  select event.*
  from valid_events event
  join business_sessions session
    on session.session_id = event.session_id
),
visits as materialized (
  select session_id, min(occurred_at) as visit_at
  from business_events
  where event_name = 'page_view'
  group by session_id
),
intents as materialized (
  select visit.session_id, min(event.occurred_at) as intent_at
  from visits visit
  join business_events event
    on event.session_id = visit.session_id
   and event.occurred_at > visit.visit_at
   and (
     ($6::text = 'all' and event.event_name in ('view_item', 'build_start'))
     or ($6::text = 'ready-made' and event.event_name = 'view_item' and event.has_ready_made_item)
   )
  group by visit.session_id
),
carts as materialized (
  select intent.session_id, min(event.occurred_at) as cart_at
  from intents intent
  join business_events event
    on event.session_id = intent.session_id
   and event.event_name = 'add_to_cart'
   and ($6::text <> 'ready-made' or event.has_ready_made_item)
   and event.occurred_at > intent.intent_at
  group by intent.session_id
),
sequenced_checkout_candidates as materialized (
  select
    event.id,
    event.event_id,
    event.session_id,
    event.properties,
    event.consent_status,
    event.occurred_at as checkout_at,
    encode(digest(lower(event.event_id::text), 'sha256'), 'hex') as checkout_event_id_hash
  from carts cart
  join business_events event
    on event.session_id = cart.session_id
   and event.event_name = 'begin_checkout'
   and ($6::text <> 'ready-made' or event.has_ready_made_item)
   and event.occurred_at > cart.cart_at
  where lower(event.event_id::text) ~ '${UUID_V4_SQL}'
),
eligible_checkouts as materialized (
  select *
  from sequenced_checkout_candidates
  where consent_status ->> 'analytics' = 'granted'
),
orders_in_range as materialized (
  select commerce_order.*
  from commerce_orders commerce_order
  cross join resolved_scope scope
  where scope.resolved_sources_match is true
    and commerce_order.source_id = scope.shopify_source_id
    and commerce_order.occurred_at >= $4::timestamptz
    and commerce_order.occurred_at < coalesce(scope.effective_end_at, $4::timestamptz)
),
eligible_orders as materialized (
  select commerce_order.*
  from orders_in_range commerce_order
  cross join resolved_scope scope
  where commerce_order.test is false
    and scope.bridge_verified is true
    and scope.coverage_start_at is not null
    and commerce_order.occurred_at >= scope.coverage_start_at
),
bridge_hash_cardinality as materialized (
  select commerce_order.checkout_event_id_hash, count(*) as order_count
  from commerce_orders commerce_order
  cross join resolved_scope scope
  where scope.resolved_sources_match is true
    and commerce_order.source_id = scope.shopify_source_id
    and commerce_order.checkout_bridge_state = 'matched'
    and commerce_order.checkout_event_id_hash is not null
  group by commerce_order.checkout_event_id_hash
),
unique_bridge_orders as materialized (
  select commerce_order.*
  from eligible_orders commerce_order
  join bridge_hash_cardinality cardinality
    on cardinality.checkout_event_id_hash = commerce_order.checkout_event_id_hash
   and cardinality.order_count = 1
  where commerce_order.checkout_bridge_state = 'matched'
),
strict_linked_orders as materialized (
  select
    commerce_order.id as internal_order_id,
    commerce_order.occurred_at as order_at,
    commerce_order.cancelled_at,
    commerce_order.currency_code,
    commerce_order.gross_sales,
    commerce_order.current_total,
    commerce_order.net_payment,
    commerce_order.total_refunded,
    checkout.id as internal_checkout_row_id,
    checkout.session_id,
    checkout.properties as checkout_properties,
    checkout.checkout_at
  from unique_bridge_orders commerce_order
  join eligible_checkouts checkout
    on checkout.checkout_event_id_hash = commerce_order.checkout_event_id_hash
  where commerce_order.occurred_at >= checkout.checkout_at
),
builder_checkout_items as materialized (
  select
    linked.internal_order_id,
    linked.session_id,
    linked.checkout_at,
    lower(item ->> 'item_instance_id') as item_instance_id,
    encode(digest(lower(item ->> 'item_instance_id'), 'sha256'), 'hex') as item_instance_id_hash
  from strict_linked_orders linked
  cross join lateral jsonb_array_elements(linked.checkout_properties -> 'items') item
  where lower(btrim(item ->> 'item_category')) = 'build your own'
    and lower(item ->> 'item_instance_id') ~ '${UUID_V4_SQL}'
),
builder_checkout_hash_cardinality as materialized (
  select internal_order_id, item_instance_id_hash, count(*) as checkout_item_count
  from builder_checkout_items
  group by internal_order_id, item_instance_id_hash
),
builder_item_paths as materialized (
  select item.*
  from builder_checkout_items item
  join builder_checkout_hash_cardinality cardinality
    on cardinality.internal_order_id = item.internal_order_id
   and cardinality.item_instance_id_hash = item.item_instance_id_hash
   and cardinality.checkout_item_count = 1
  where exists (
    select 1
    from business_events build_outcome
    where build_outcome.session_id = item.session_id
      and build_outcome.event_name in ('build_complete', 'save_design')
      and lower(build_outcome.properties ->> 'item_instance_id') = item.item_instance_id
      and build_outcome.occurred_at < item.checkout_at
      and exists (
        select 1
        from business_events build_start
        where build_start.session_id = item.session_id
          and build_start.event_name = 'build_start'
          and build_start.occurred_at < build_outcome.occurred_at
      )
      and exists (
        select 1
        from business_events cart
        cross join lateral jsonb_array_elements(cart.properties -> 'items') cart_item
        where cart.session_id = item.session_id
          and cart.event_name = 'add_to_cart'
          and lower(cart_item ->> 'item_instance_id') = item.item_instance_id
          and cart.occurred_at > build_outcome.occurred_at
          and cart.occurred_at < item.checkout_at
      )
  )
),
builder_line_hash_cardinality as materialized (
  select order_id, item_instance_id_hash, count(*) as line_count
  from commerce_order_lines
  where item_bridge_state = 'matched'
    and item_instance_id_hash is not null
  group by order_id, item_instance_id_hash
),
linked_builder_lines as materialized (
  select line.id as internal_line_id
  from builder_item_paths path
  join commerce_order_lines line
    on line.order_id = path.internal_order_id
   and line.item_bridge_state = 'matched'
   and line.item_instance_id_hash = path.item_instance_id_hash
  join builder_line_hash_cardinality cardinality
    on cardinality.order_id = line.order_id
   and cardinality.item_instance_id_hash = line.item_instance_id_hash
   and cardinality.line_count = 1
),
money_groups as materialized (
  select
    linked.currency_code,
    count(*) as orders,
    sum(linked.gross_sales)::text as gross_sales,
    sum(linked.current_total)::text as current_total,
    sum(linked.net_payment)::text as net_payment,
    sum(linked.total_refunded)::text as refunds
  from strict_linked_orders linked
  group by linked.currency_code
),
aggregate_values as materialized (
  select
    (select count(*) from visits) as business_visits,
    (select count(*) from intents) as business_intents,
    (select count(*) from carts) as business_carts,
    (select count(*) from eligible_checkouts) as eligible_checkout_events,
    (
      select count(*)
      from traffic_sessions
      where has_page_view is true and known_bot is true
    ) as excluded_bot_sessions,
    (
      select count(*)
      from traffic_sessions
      where has_page_view is true
        and known_bot is false
        and production_tagged is false
    ) as excluded_non_production_sessions,
    (select count(*) from eligible_orders) as eligible_shopify_orders,
    (select count(*) from strict_linked_orders) as linked_orders_placed,
    (select count(*) from strict_linked_orders where cancelled_at is null) as active_linked_orders,
    (select count(*) from strict_linked_orders where cancelled_at is not null) as cancelled_linked_orders,
    (
      select count(*)
      from unique_bridge_orders
    ) as bridge_matched_orders,
    (
      select count(*)
      from eligible_orders
      where checkout_bridge_state = 'missing'
    ) as bridge_missing_orders,
    (
      select count(*)
      from eligible_orders
      where checkout_bridge_state = 'invalid'
    ) as bridge_invalid_orders,
    (
      select count(*)
      from eligible_orders commerce_order
      where commerce_order.checkout_bridge_state = 'ambiguous'
        or (
          commerce_order.checkout_bridge_state = 'matched'
          and exists (
            select 1
            from bridge_hash_cardinality cardinality
            where cardinality.checkout_event_id_hash = commerce_order.checkout_event_id_hash
              and cardinality.order_count > 1
          )
        )
    ) as bridge_ambiguous_orders,
    (
      select count(distinct commerce_order.id)
      from unique_bridge_orders commerce_order
      join sequenced_checkout_candidates checkout
        on checkout.checkout_event_id_hash = commerce_order.checkout_event_id_hash
      where checkout.consent_status ->> 'analytics' <> 'granted'
        or checkout.consent_status ->> 'analytics' is null
    ) as consent_blocked_orders,
    (
      select count(distinct commerce_order.id)
      from unique_bridge_orders commerce_order
      join eligible_checkouts checkout
        on checkout.checkout_event_id_hash = commerce_order.checkout_event_id_hash
      where commerce_order.occurred_at < checkout.checkout_at
    ) as reversed_timestamp_orders,
    (
      select count(*)
      from orders_in_range commerce_order
      cross join resolved_scope scope
      where commerce_order.test is false
        and scope.coverage_start_at is not null
        and commerce_order.occurred_at < scope.coverage_start_at
    ) as pre_coverage_orders,
    (select count(*) from linked_builder_lines) as linked_order_lines,
    (select count(*) from builder_item_paths) as eligible_order_lines
)
-- AGGREGATE_ONLY_RESPONSE
select
  scope.data_space_count,
  scope.website_candidate_count,
  scope.shopify_candidate_count,
  scope.resolved_sources_match,
  scope.bridge_verified,
  scope.coverage_start_at,
  scope.effective_end_at as coverage_end_at,
  aggregate_values.business_visits,
  aggregate_values.business_intents,
  aggregate_values.business_carts,
  aggregate_values.eligible_checkout_events,
  aggregate_values.excluded_bot_sessions,
  aggregate_values.excluded_non_production_sessions,
  aggregate_values.eligible_shopify_orders,
  aggregate_values.linked_orders_placed,
  aggregate_values.active_linked_orders,
  aggregate_values.cancelled_linked_orders,
  aggregate_values.bridge_matched_orders,
  aggregate_values.bridge_missing_orders,
  aggregate_values.bridge_invalid_orders,
  aggregate_values.bridge_ambiguous_orders,
  aggregate_values.consent_blocked_orders,
  aggregate_values.reversed_timestamp_orders,
  aggregate_values.pre_coverage_orders,
  aggregate_values.linked_order_lines,
  aggregate_values.eligible_order_lines,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'currency', money.currency_code,
          'orders', money.orders,
          'grossSales', money.gross_sales,
          'currentTotal', money.current_total,
          'netPayment', money.net_payment,
          'refunds', money.refunds,
          'state', 'healthy'
        )
        order by money.currency_code
      )
      from money_groups money
    ),
    '[]'::jsonb
  ) as money
from resolved_scope scope
cross join aggregate_values
`;

function timestamp(value: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function count(value: string | number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function moneyGroups(value: unknown): CommerceFunnelV2MoneyGroup[] | null {
  const parsed = typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return null;
        }
      })()
    : value;
  if (!Array.isArray(parsed)) return null;
  const groups: CommerceFunnelV2MoneyGroup[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.currency !== "string"
      || !/^[A-Z]{3}$/u.test(row.currency)
      || ![row.grossSales, row.currentTotal, row.netPayment, row.refunds].every(
        (amount) => typeof amount === "string" && /^\d+(?:\.\d+)?$/u.test(amount),
      )
    ) return null;
    const orders = Number(row.orders);
    if (!Number.isSafeInteger(orders) || orders < 0) return null;
    groups.push({
      currency: row.currency,
      orders,
      grossSales: row.grossSales as string,
      currentTotal: row.currentTotal as string,
      netPayment: row.netPayment as string,
      refunds: row.refunds as string,
      state: "healthy" as const,
    });
  }
  return groups;
}

function unavailable(reason: string, state: "migration_unavailable" | "unavailable" = "unavailable"):
CommerceFunnelV2ReportAggregate {
  return {
    state,
    reason,
    coverageStartAt: null,
    coverageEndAt: null,
    businessVisits: null,
    businessIntents: null,
    businessCarts: null,
    eligibleCheckoutEvents: null,
    excludedBotSessions: null,
    excludedNonProductionSessions: null,
    eligibleShopifyOrders: null,
    linkedOrdersPlaced: null,
    activeLinkedOrders: null,
    cancelledLinkedOrders: null,
    bridgeMatchedOrders: null,
    bridgeMissingOrders: null,
    bridgeInvalidOrders: null,
    bridgeAmbiguousOrders: null,
    consentBlockedOrders: null,
    reversedTimestampOrders: null,
    preCoverageOrders: null,
    linkedOrderLines: null,
    eligibleOrderLines: null,
    money: [],
  };
}

function validateInput(input: CommerceFunnelV2ReportInput) {
  const startAt = Date.parse(input.startAt);
  const endExclusive = Date.parse(input.endExclusive);
  if (
    !input.dataSpaceId
    || !input.websiteSourceId
    || !input.shopifySourceId
    || !Number.isFinite(startAt)
    || !Number.isFinite(endExclusive)
    || startAt >= endExclusive
    || !["all", "ready-made", "builder"].includes(input.segment)
  ) throw new RangeError("Commerce funnel V2 report scope is invalid.");
}

function undefinedTable(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "42P01";
}

export function commerceFunnelV2ReportProjection() {
  const marker = "-- AGGREGATE_ONLY_RESPONSE";
  const markerIndex = COMMERCE_FUNNEL_V2_REPORT_SQL.indexOf(marker);
  if (markerIndex < 0) throw new Error("Commerce funnel V2 aggregate projection marker is missing.");
  return COMMERCE_FUNNEL_V2_REPORT_SQL.slice(markerIndex + marker.length);
}

export async function getCommerceFunnelV2ReportAggregate(
  input: CommerceFunnelV2ReportInput,
): Promise<CommerceFunnelV2ReportAggregate> {
  validateInput(input);
  if (input.segment === "builder") {
    return unavailable(
      "Builder cart and checkout remain unmeasured until journey-level continuity is proven.",
    );
  }
  if (!isRuntimeDatabaseConfigured()) {
    return unavailable("The commerce bridge report requires the configured PostgreSQL read model.");
  }

  try {
    const row = await withDatabaseTransaction(async (client) => {
      await query("set transaction isolation level repeatable read, read only", undefined, client);
      await query("set local jit = off", undefined, client);
      await query(`set local statement_timeout = '${QUERY_TIMEOUT_MS}ms'`, undefined, client);
      const rows = await queryRows<AggregateRow>(
        COMMERCE_FUNNEL_V2_REPORT_SQL,
        [
          input.dataSpaceId,
          input.websiteSourceId,
          input.shopifySourceId,
          input.startAt,
          input.endExclusive,
          input.segment,
        ],
        client,
      );
      return rows[0] ?? null;
    });
    if (!row) return unavailable("The commerce bridge aggregate returned no result.");
    if (
      count(row.data_space_count) !== 1
      || count(row.website_candidate_count) !== 1
      || count(row.shopify_candidate_count) !== 1
      || !row.resolved_sources_match
    ) {
      return unavailable("The report requires exactly one authoritative Website source and one Shopify source.");
    }
    const coverageStartAt = timestamp(row.coverage_start_at);
    const coverageEndAt = timestamp(row.coverage_end_at);
    if (!row.bridge_verified || !coverageStartAt || !coverageEndAt) {
      return unavailable("Verified commerce bridge coverage is unavailable.");
    }
    if (
      Date.parse(coverageStartAt) >= Date.parse(coverageEndAt)
      || Date.parse(coverageEndAt) <= Date.parse(input.startAt)
    ) {
      return unavailable("Verified commerce bridge coverage does not overlap the selected interval.");
    }

    const businessVisits = count(row.business_visits);
    const businessIntents = count(row.business_intents);
    const businessCarts = count(row.business_carts);
    const eligibleCheckoutEvents = count(row.eligible_checkout_events);
    const excludedBotSessions = count(row.excluded_bot_sessions);
    const excludedNonProductionSessions = count(row.excluded_non_production_sessions);
    const eligibleShopifyOrders = count(row.eligible_shopify_orders);
    const linkedOrdersPlaced = count(row.linked_orders_placed);
    const activeLinkedOrders = count(row.active_linked_orders);
    const cancelledLinkedOrders = count(row.cancelled_linked_orders);
    const bridgeMatchedOrders = count(row.bridge_matched_orders);
    const bridgeMissingOrders = count(row.bridge_missing_orders);
    const bridgeInvalidOrders = count(row.bridge_invalid_orders);
    const bridgeAmbiguousOrders = count(row.bridge_ambiguous_orders);
    const consentBlockedOrders = count(row.consent_blocked_orders);
    const reversedTimestampOrders = count(row.reversed_timestamp_orders);
    const preCoverageOrders = count(row.pre_coverage_orders);
    const linkedOrderLines = count(row.linked_order_lines);
    const eligibleOrderLines = count(row.eligible_order_lines);
    const money = moneyGroups(row.money);
    if (
      [
        businessVisits,
        businessIntents,
        businessCarts,
        eligibleCheckoutEvents,
        excludedBotSessions,
        excludedNonProductionSessions,
        eligibleShopifyOrders,
        linkedOrdersPlaced,
        activeLinkedOrders,
        cancelledLinkedOrders,
        bridgeMatchedOrders,
        bridgeMissingOrders,
        bridgeInvalidOrders,
        bridgeAmbiguousOrders,
        consentBlockedOrders,
        reversedTimestampOrders,
        preCoverageOrders,
        linkedOrderLines,
        eligibleOrderLines,
      ].some((value) => value === null)
      || money === null
    ) {
      return unavailable("The commerce bridge aggregate contains invalid measured values.");
    }

    return {
      state: "ready",
      reason: "The aggregate-only commerce bridge is ready.",
      coverageStartAt,
      coverageEndAt,
      businessVisits,
      businessIntents,
      businessCarts,
      eligibleCheckoutEvents,
      excludedBotSessions,
      excludedNonProductionSessions,
      eligibleShopifyOrders,
      linkedOrdersPlaced,
      activeLinkedOrders,
      cancelledLinkedOrders,
      bridgeMatchedOrders,
      bridgeMissingOrders,
      bridgeInvalidOrders,
      bridgeAmbiguousOrders,
      consentBlockedOrders,
      reversedTimestampOrders,
      preCoverageOrders,
      linkedOrderLines,
      eligibleOrderLines,
      money,
    };
  } catch (error) {
    if (undefinedTable(error)) {
      return unavailable(
        "The commerce bridge migration is unavailable.",
        "migration_unavailable",
      );
    }
    throw error;
  }
}
