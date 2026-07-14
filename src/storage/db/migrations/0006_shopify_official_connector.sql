insert into source_types (
  key,
  display_name,
  description,
  category,
  icon,
  url_patterns,
  required_fields,
  optional_fields,
  supported_metrics,
  auth_type,
  docs_url,
  enabled,
  created_at,
  updated_at
) values (
  'shopify',
  'Shopify',
  'Official Shopify Admin GraphQL API connector for store-local orders and sales, without collecting customer contact data.',
  'Commerce',
  'ShoppingBag',
  '["^https:\/\/[a-z0-9-]+\\.myshopify\\.com\\/?$","^https:\/\/admin\\.shopify\\.com\/store\/[a-z0-9-]+"]'::jsonb,
  '[
    {
      "key": "shopify_client_id",
      "label": "Shopify Client ID",
      "description": "From the installed app Settings page in Shopify Dev Dashboard. Stored encrypted server-side.",
      "required": true,
      "secret": true,
      "type": "password",
      "placeholder": "Paste the Client ID"
    },
    {
      "key": "shopify_client_secret",
      "label": "Shopify Client secret",
      "description": "Used only server-side to request a short-lived Admin API token.",
      "required": true,
      "secret": true,
      "type": "password",
      "placeholder": "Paste the Client secret"
    }
  ]'::jsonb,
  '[]'::jsonb,
  '["orders","gross_sales","current_total","net_payment","refunds","top_products"]'::jsonb,
  'shopify_client_credentials',
  'https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant',
  true,
  now(),
  now()
)
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  category = excluded.category,
  icon = excluded.icon,
  url_patterns = excluded.url_patterns,
  required_fields = excluded.required_fields,
  optional_fields = excluded.optional_fields,
  supported_metrics = excluded.supported_metrics,
  auth_type = excluded.auth_type,
  docs_url = excluded.docs_url,
  enabled = excluded.enabled,
  updated_at = excluded.updated_at;

insert into metric_definitions (
  key,
  display_name,
  description,
  source_type_key,
  category,
  unit,
  higher_is_better,
  created_at,
  updated_at
) values
  ('orders', 'Orders', 'Non-test Shopify orders grouped by the store-local order creation date.', 'shopify', 'Commerce', 'count', true, now(), now()),
  ('gross_sales', 'Gross sales', 'Shopify order subtotal plus pre-return discounts, excluding shipping and separately added taxes when prices are tax-exclusive.', 'shopify', 'Commerce', 'currency', true, now(), now()),
  ('current_total', 'Current total', 'Shopify order total after returns, refunds, edits, and cancellations, grouped by store-local order creation date.', 'shopify', 'Commerce', 'currency', true, now(), now()),
  ('net_payment', 'Net payment', 'Amount received for Shopify orders minus refunded amounts, grouped by store-local order creation date.', 'shopify', 'Commerce', 'currency', true, now(), now()),
  ('refunds', 'Refunds', 'Total refunded amount attached to Shopify orders, grouped by store-local order creation date rather than refund event date.', 'shopify', 'Commerce', 'currency', false, now(), now()),
  ('top_products', 'Ordered product units', 'Non-test Shopify line-item quantity grouped by order, line item, product name, and store-local order creation date.', 'shopify', 'Commerce', 'units', true, now(), now())
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  source_type_key = excluded.source_type_key,
  category = excluded.category,
  unit = excluded.unit,
  higher_is_better = excluded.higher_is_better,
  updated_at = excluded.updated_at;

create or replace view reporting.moonarq_shopify_daily
with (security_invoker = true) as
select
  m.date as date_pt,
  s.id as source_id,
  s.display_name as source_name,
  coalesce(sum(m.metric_value) filter (where m.metric_key = 'orders'), 0)::numeric as orders,
  coalesce(sum(m.metric_value) filter (where m.metric_key = 'net_payment'), 0)::numeric as net_payment,
  coalesce(sum(m.metric_value) filter (where m.metric_key = 'gross_sales'), 0)::numeric as gross_sales,
  coalesce(sum(m.metric_value) filter (where m.metric_key = 'current_total'), 0)::numeric as current_total,
  coalesce(sum(m.metric_value) filter (where m.metric_key = 'refunds'), 0)::numeric as refunds,
  coalesce(max(m.dimensions->>'currency'), upper(max(m.unit) filter (where m.unit ~ '^[a-zA-Z]{3}$'))) as currency
from metrics_daily m
join sources s on s.id = m.source_id
join data_spaces d on d.id = s.data_space_id
where d.slug = 'moonarq'
  and s.source_type_key = 'shopify'
  and m.dimensions->>'rollup' = 'daily_order_summary'
group by m.date, s.id, s.display_name;

revoke all on reporting.moonarq_shopify_daily from anon, authenticated;
