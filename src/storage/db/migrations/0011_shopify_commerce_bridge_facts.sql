-- Privacy-minimized Shopify commerce facts for the V2 exact-match bridge.
-- Raw bridge UUIDs and arbitrary Shopify custom attributes never belong here.
set local lock_timeout = '10s';
set local statement_timeout = '15min';

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  shopify_order_id_hash text not null,
  occurred_at timestamptz not null,
  test boolean not null,
  cancelled_at timestamptz null,
  currency_code text not null,
  gross_sales numeric not null,
  current_total numeric not null,
  net_payment numeric not null,
  total_refunded numeric not null,
  checkout_event_id_hash text null,
  checkout_bridge_state text not null,
  definition_version text not null default 'shopify-commerce-bridge-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_orders_order_hash_check
    check (shopify_order_id_hash ~ '^[0-9a-f]{64}$'),
  constraint commerce_orders_checkout_hash_check
    check (checkout_event_id_hash is null or checkout_event_id_hash ~ '^[0-9a-f]{64}$'),
  constraint commerce_orders_checkout_state_check
    check (checkout_bridge_state in ('missing', 'matched', 'invalid', 'ambiguous')),
  constraint commerce_orders_checkout_state_hash_check
    check (
      (checkout_bridge_state = 'matched' and checkout_event_id_hash is not null)
      or
      (checkout_bridge_state <> 'matched' and checkout_event_id_hash is null)
    ),
  constraint commerce_orders_currency_check
    check (currency_code ~ '^[A-Z]{3}$'),
  constraint commerce_orders_amounts_check
    check (
      gross_sales >= 0
      and current_total >= 0
      and net_payment >= 0
      and total_refunded >= 0
    ),
  constraint commerce_orders_cancellation_time_check
    check (cancelled_at is null or cancelled_at >= occurred_at),
  constraint commerce_orders_definition_version_check
    check (definition_version = 'shopify-commerce-bridge-v1'),
  unique (source_id, shopify_order_id_hash)
);

create table if not exists public.commerce_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  shopify_line_item_id_hash text not null,
  quantity integer not null,
  item_instance_id_hash text null,
  item_bridge_state text not null,
  definition_version text not null default 'shopify-commerce-bridge-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_order_lines_line_hash_check
    check (shopify_line_item_id_hash ~ '^[0-9a-f]{64}$'),
  constraint commerce_order_lines_item_hash_check
    check (item_instance_id_hash is null or item_instance_id_hash ~ '^[0-9a-f]{64}$'),
  constraint commerce_order_lines_item_state_check
    check (item_bridge_state in ('missing', 'matched', 'invalid', 'ambiguous')),
  constraint commerce_order_lines_item_state_hash_check
    check (
      (item_bridge_state = 'matched' and item_instance_id_hash is not null)
      or
      (item_bridge_state <> 'matched' and item_instance_id_hash is null)
    ),
  constraint commerce_order_lines_quantity_check check (quantity >= 1),
  constraint commerce_order_lines_definition_version_check
    check (definition_version = 'shopify-commerce-bridge-v1'),
  unique (order_id, shopify_line_item_id_hash)
);

create index if not exists idx_commerce_orders_source_time
  on public.commerce_orders (source_id, occurred_at desc);
create index if not exists idx_commerce_orders_checkout_event
  on public.commerce_orders (checkout_event_id_hash)
  where checkout_bridge_state = 'matched';
create index if not exists idx_commerce_order_lines_order
  on public.commerce_order_lines (order_id);
create index if not exists idx_commerce_order_lines_item_instance
  on public.commerce_order_lines (item_instance_id_hash)
  where item_bridge_state = 'matched';

alter table public.commerce_orders enable row level security;
alter table public.commerce_order_lines enable row level security;

revoke all privileges on table public.commerce_orders from public;
revoke all privileges on table public.commerce_order_lines from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all privileges on table public.commerce_orders from anon';
    execute 'revoke all privileges on table public.commerce_order_lines from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all privileges on table public.commerce_orders from authenticated';
    execute 'revoke all privileges on table public.commerce_order_lines from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all privileges on table public.commerce_orders from service_role';
    execute 'revoke all privileges on table public.commerce_order_lines from service_role';
  end if;
end $$;
