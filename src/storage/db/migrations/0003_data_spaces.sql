create table if not exists data_spaces (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  display_name text not null,
  description text null,
  category text not null check (category in ('business', 'personal', 'client', 'test', 'archive')),
  icon text null,
  is_default boolean not null default false,
  status text not null default 'active',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_data_spaces_default_single
  on data_spaces (is_default)
  where is_default is true;

insert into data_spaces (
  id,
  slug,
  display_name,
  description,
  category,
  icon,
  is_default,
  status,
  metadata
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'moonarq',
    'MoonArq',
    'Existing MoonArq company data space.',
    'business',
    'MoonStar',
    true,
    'active',
    '{"seeded": true}'::jsonb
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    'auto-lab',
    'Auto Lab',
    'Personal car/content account testing space',
    'personal',
    'Gauge',
    false,
    'active',
    '{"seeded": true}'::jsonb
  )
on conflict (slug) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  category = excluded.category,
  icon = excluded.icon,
  is_default = excluded.is_default,
  status = excluded.status,
  metadata = data_spaces.metadata || excluded.metadata,
  updated_at = now();

alter table sources
  add column if not exists data_space_id uuid references data_spaces(id);

update sources
set data_space_id = (
  select id
  from data_spaces
  where slug = 'moonarq'
)
where data_space_id is null;

alter table sources
  alter column data_space_id set not null;

create index if not exists idx_sources_data_space
  on sources (data_space_id, source_type_key, display_name);

alter table daily_report_runs
  add column if not exists data_space_id uuid references data_spaces(id);

update daily_report_runs
set data_space_id = (
  select id
  from data_spaces
  where slug = 'moonarq'
)
where data_space_id is null;

alter table daily_report_runs
  alter column data_space_id set not null;

alter table daily_report_runs
  drop constraint if exists daily_report_runs_report_date_key;

create unique index if not exists idx_daily_report_runs_space_date
  on daily_report_runs (data_space_id, report_date);

create index if not exists idx_daily_report_runs_space_generated
  on daily_report_runs (data_space_id, report_date desc);

create or replace view reporting.platform_website_daily as
with website_sources as (
  select
    s.*,
    ds.slug as data_space_slug,
    ds.display_name as data_space_name
  from sources s
  join data_spaces ds on ds.id = s.data_space_id
  where s.source_type_key in ('website', 'vercel_web_analytics_drain')
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
  s.data_space_id,
  s.data_space_slug,
  s.data_space_name,
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

create or replace view reporting.platform_supabase_daily as
with supabase_sources as (
  select
    s.*,
    ds.slug as data_space_slug,
    ds.display_name as data_space_name
  from sources s
  join data_spaces ds on ds.id = s.data_space_id
  where s.source_type_key = 'supabase'
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
  s.data_space_id,
  s.data_space_slug,
  s.data_space_name,
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

create or replace view reporting.moonarq_website_daily as
select
  date_pt,
  source_id,
  source_name,
  source_mode,
  unique_visitors,
  page_views,
  sessions,
  custom_events,
  top_page,
  top_referrer,
  top_country,
  top_device,
  last_event_at_pt,
  last_sync_at_pt
from reporting.platform_website_daily
where data_space_slug = 'moonarq';

create or replace view reporting.moonarq_supabase_daily as
select
  date_pt,
  source_id,
  source_name,
  new_signups,
  users_total,
  confirmed_users,
  provider_email,
  provider_google,
  provider_other,
  last_sync_at_pt
from reporting.platform_supabase_daily
where data_space_slug = 'moonarq';
