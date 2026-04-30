create schema if not exists reporting;

create table if not exists platform_change_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid null references sources(id) on delete set null,
  source_type_key text not null,
  platform_record_type text not null,
  external_record_id text not null,
  change_type text not null check (change_type in ('inserted', 'updated', 'deleted', 'snapshot', 'event')),
  changed_at timestamptz not null,
  changed_at_pt text not null,
  previous_hash text null,
  new_hash text not null,
  changed_fields jsonb not null default '[]',
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_platform_change_events_dedupe
  on platform_change_events (
    coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid),
    platform_record_type,
    external_record_id,
    new_hash
  );

create index if not exists idx_platform_change_events_source_time
  on platform_change_events (source_id, changed_at desc);

create table if not exists daily_report_runs (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  report_date_pt text not null,
  status text not null check (status in ('generated', 'error')),
  generated_at timestamptz not null default now(),
  generated_at_pt text not null,
  summary text not null,
  source_count integer not null default 0,
  health_status text not null,
  error_message text null,
  metadata jsonb not null default '{}',
  unique(report_date)
);

create table if not exists daily_report_sections (
  id uuid primary key default gen_random_uuid(),
  report_run_id uuid not null references daily_report_runs(id) on delete cascade,
  section_key text not null,
  title text not null,
  summary text not null,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'
);

create table if not exists daily_report_metrics (
  id uuid primary key default gen_random_uuid(),
  report_run_id uuid not null references daily_report_runs(id) on delete cascade,
  section_key text not null,
  metric_key text not null,
  label text not null,
  value numeric null,
  text_value text null,
  unit text null,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'
);

create index if not exists idx_daily_report_sections_run_sort
  on daily_report_sections (report_run_id, sort_order);

create index if not exists idx_daily_report_metrics_run_section_sort
  on daily_report_metrics (report_run_id, section_key, sort_order);

create or replace view reporting.moonarq_website_daily as
with website_sources as (
  select *
  from sources
  where source_type_key in ('website', 'vercel_web_analytics_drain')
),
metric_dates as (
  select distinct
    m.date as date_pt,
    m.source_id
  from metrics_daily m
  join website_sources s on s.id = m.source_id
),
metric_rollups as (
  select
    m.date as date_pt,
    m.source_id,
    sum(m.metric_value) filter (where m.metric_key = 'unique_visitors') as unique_visitors,
    sum(m.metric_value) filter (where m.metric_key = 'page_views') as page_views,
    sum(m.metric_value) filter (where m.metric_key = 'sessions') as sessions,
    sum(m.metric_value) filter (where m.metric_key = 'custom_events') as custom_events
  from metrics_daily m
  join website_sources s on s.id = m.source_id
  group by m.date, m.source_id
),
top_paths as (
  select date_pt, source_id, path_value, metric_value
  from (
    select
      m.date as date_pt,
      m.source_id,
      coalesce(m.dimensions->>'path', '/') as path_value,
      sum(m.metric_value) as metric_value,
      row_number() over (partition by m.date, m.source_id order by sum(m.metric_value) desc, coalesce(m.dimensions->>'path', '/') asc) as row_number
    from metrics_daily m
    join website_sources s on s.id = m.source_id
    where m.metric_key = 'events_by_path'
    group by m.date, m.source_id, coalesce(m.dimensions->>'path', '/')
  ) ranked
  where row_number = 1
),
top_referrers as (
  select date_pt, source_id, referrer_value, metric_value
  from (
    select
      m.date as date_pt,
      m.source_id,
      coalesce(m.dimensions->>'referrer', 'direct') as referrer_value,
      sum(m.metric_value) as metric_value,
      row_number() over (partition by m.date, m.source_id order by sum(m.metric_value) desc, coalesce(m.dimensions->>'referrer', 'direct') asc) as row_number
    from metrics_daily m
    join website_sources s on s.id = m.source_id
    where m.metric_key = 'events_by_referrer'
    group by m.date, m.source_id, coalesce(m.dimensions->>'referrer', 'direct')
  ) ranked
  where row_number = 1
),
top_countries as (
  select date_pt, source_id, country_value, event_count
  from (
    select
      (timezone('America/Los_Angeles', e.occurred_at))::date as date_pt,
      e.source_id,
      coalesce(e.country, 'Unknown') as country_value,
      count(*) as event_count,
      row_number() over (partition by (timezone('America/Los_Angeles', e.occurred_at))::date, e.source_id order by count(*) desc, coalesce(e.country, 'Unknown') asc) as row_number
    from web_events e
    join website_sources s on s.id = e.source_id
    group by (timezone('America/Los_Angeles', e.occurred_at))::date, e.source_id, coalesce(e.country, 'Unknown')
  ) ranked
  where row_number = 1
),
top_devices as (
  select date_pt, source_id, device_value, event_count
  from (
    select
      (timezone('America/Los_Angeles', e.occurred_at))::date as date_pt,
      e.source_id,
      coalesce(e.device_type, 'Unknown') as device_value,
      count(*) as event_count,
      row_number() over (partition by (timezone('America/Los_Angeles', e.occurred_at))::date, e.source_id order by count(*) desc, coalesce(e.device_type, 'Unknown') asc) as row_number
    from web_events e
    join website_sources s on s.id = e.source_id
    group by (timezone('America/Los_Angeles', e.occurred_at))::date, e.source_id, coalesce(e.device_type, 'Unknown')
  ) ranked
  where row_number = 1
),
last_events as (
  select
    (timezone('America/Los_Angeles', e.occurred_at))::date as date_pt,
    e.source_id,
    max(e.occurred_at) as last_event_at
  from web_events e
  join website_sources s on s.id = e.source_id
  group by (timezone('America/Los_Angeles', e.occurred_at))::date, e.source_id
)
select
  d.date_pt,
  d.source_id,
  s.display_name as source_name,
  case
    when s.source_type_key = 'vercel_web_analytics_drain' then 'Vercel Drain'
    when s.metadata->>'website_mode' = 'tracker' then 'Website Tracker'
    else 'Website Tracker'
  end as source_mode,
  coalesce(r.unique_visitors, 0) as unique_visitors,
  coalesce(r.page_views, 0) as page_views,
  coalesce(r.sessions, 0) as sessions,
  coalesce(r.custom_events, 0) as custom_events,
  case when p.path_value is null then null else p.path_value || ' (' || p.metric_value::text || ')' end as top_page,
  case when ref.referrer_value is null then null else ref.referrer_value || ' (' || ref.metric_value::text || ')' end as top_referrer,
  case when c.country_value is null then null else c.country_value || ' (' || c.event_count::text || ')' end as top_country,
  case when dv.device_value is null then null else dv.device_value || ' (' || dv.event_count::text || ')' end as top_device,
  case when le.last_event_at is null then null else to_char(timezone('America/Los_Angeles', le.last_event_at), 'Mon DD, YYYY HH12:MI AM "PT"') end as last_event_at_pt,
  case when s.last_success_at is null then null else to_char(timezone('America/Los_Angeles', s.last_success_at), 'Mon DD, YYYY HH12:MI AM "PT"') end as last_sync_at_pt
from metric_dates d
join website_sources s on s.id = d.source_id
left join metric_rollups r on r.date_pt = d.date_pt and r.source_id = d.source_id
left join top_paths p on p.date_pt = d.date_pt and p.source_id = d.source_id
left join top_referrers ref on ref.date_pt = d.date_pt and ref.source_id = d.source_id
left join top_countries c on c.date_pt = d.date_pt and c.source_id = d.source_id
left join top_devices dv on dv.date_pt = d.date_pt and dv.source_id = d.source_id
left join last_events le on le.date_pt = d.date_pt and le.source_id = d.source_id;

create or replace view reporting.moonarq_supabase_daily as
with supabase_sources as (
  select *
  from sources
  where source_type_key = 'supabase'
),
metric_dates as (
  select distinct
    m.date as date_pt,
    m.source_id
  from metrics_daily m
  join supabase_sources s on s.id = m.source_id
),
daily_rollups as (
  select
    m.date as date_pt,
    m.source_id,
    sum(m.metric_value) filter (where m.metric_key = 'signups') as new_signups,
    sum(m.metric_value) filter (where m.metric_key = 'signups_by_provider' and coalesce(m.dimensions->>'provider', 'email') = 'email') as provider_email,
    sum(m.metric_value) filter (where m.metric_key = 'signups_by_provider' and coalesce(m.dimensions->>'provider', '') = 'google') as provider_google,
    sum(m.metric_value) filter (where m.metric_key = 'signups_by_provider' and coalesce(m.dimensions->>'provider', '') not in ('email', 'google')) as provider_other
  from metrics_daily m
  join supabase_sources s on s.id = m.source_id
  group by m.date, m.source_id
)
select
  d.date_pt,
  d.source_id,
  s.display_name as source_name,
  coalesce(r.new_signups, 0) as new_signups,
  coalesce(users_total.metric_value, 0) as users_total,
  coalesce(confirmed_users.metric_value, 0) as confirmed_users,
  coalesce(r.provider_email, 0) as provider_email,
  coalesce(r.provider_google, 0) as provider_google,
  coalesce(r.provider_other, 0) as provider_other,
  case when s.last_success_at is null then null else to_char(timezone('America/Los_Angeles', s.last_success_at), 'Mon DD, YYYY HH12:MI AM "PT"') end as last_sync_at_pt
from metric_dates d
join supabase_sources s on s.id = d.source_id
left join daily_rollups r on r.date_pt = d.date_pt and r.source_id = d.source_id
left join lateral (
  select m.metric_value
  from metrics_daily m
  where m.source_id = d.source_id
    and m.metric_key = 'users_total'
    and m.date <= d.date_pt
  order by m.date desc, m.updated_at desc
  limit 1
) users_total on true
left join lateral (
  select m.metric_value
  from metrics_daily m
  where m.source_id = d.source_id
    and m.metric_key = 'confirmed_users'
    and m.date <= d.date_pt
  order by m.date desc, m.updated_at desc
  limit 1
) confirmed_users on true;

create or replace view reporting.moonarq_instagram_daily as
select
  null::date as date_pt,
  null::uuid as source_id,
  'MoonArq Instagram'::text as source_name,
  0::numeric as reach,
  0::numeric as impressions
where false;

create or replace view reporting.moonarq_tiktok_daily as
select
  null::date as date_pt,
  null::uuid as source_id,
  'MoonArq TikTok'::text as source_name,
  0::numeric as video_views,
  0::numeric as engagement_rate
where false;

create or replace view reporting.moonarq_shopify_daily as
select
  null::date as date_pt,
  null::uuid as source_id,
  'MoonArq Commerce'::text as source_name,
  0::numeric as orders,
  0::numeric as net_payment
where false;
