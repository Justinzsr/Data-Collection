-- Contract phase: apply after the v1 application code is live. This final
-- reconciliation captures any legacy tracker events received during rollout.
set local lock_timeout = '10s';
set local statement_timeout = '15min';

lock table web_events in share mode;
lock table metrics_daily in share row exclusive mode;

-- Replace only the exact first-party rollup shapes owned by event ingestion;
-- unrelated or future metric dimensions are preserved.
delete from metrics_daily m
using sources s
where m.source_id = s.id
  and s.source_type_key = 'website'
  and (
    (m.metric_key in ('page_views', 'unique_visitors', 'sessions', 'custom_events')
      and m.dimensions = '{"rollup":"daily"}'::jsonb)
    or (m.metric_key = 'events_by_path'
      and m.dimensions = jsonb_build_object('path', m.dimensions -> 'path'))
    or (m.metric_key = 'events_by_referrer'
      and m.dimensions = jsonb_build_object('referrer', m.dimensions -> 'referrer'))
  );

with tracker_events as (
  select
    e.source_id,
    (e.occurred_at at time zone 'America/Los_Angeles')::date as metric_date,
    e.event_name,
    e.anonymous_id,
    e.session_id,
    e.path,
    coalesce(nullif(e.referrer, ''), 'direct') as referrer
  from web_events e
  join sources s on s.id = e.source_id
  where s.source_type_key = 'website'
    and e.event_source = 'first_party_tracker'
),
daily_rollups as (
  select
    source_id,
    metric_date,
    count(*) filter (where event_name = 'page_view')::numeric as page_views,
    count(*) filter (where event_name <> 'page_view')::numeric as custom_events,
    count(distinct anonymous_id)::numeric as unique_visitors,
    count(distinct session_id)::numeric as sessions
  from tracker_events
  group by source_id, metric_date
),
path_rollups as (
  select source_id, metric_date, path, count(*)::numeric as metric_value
  from tracker_events
  group by source_id, metric_date, path
),
referrer_rollups as (
  select source_id, metric_date, referrer, count(*)::numeric as metric_value
  from tracker_events
  group by source_id, metric_date, referrer
),
desired_metrics as (
  select
    daily.source_id,
    daily.metric_date,
    metric.metric_key,
    metric.metric_value,
    '{"rollup":"daily"}'::jsonb as dimensions,
    '{"rollup":"daily"}'::text as dimensions_text
  from daily_rollups daily
  cross join lateral (
    values
      ('page_views'::text, daily.page_views),
      ('custom_events'::text, daily.custom_events),
      ('unique_visitors'::text, daily.unique_visitors),
      ('sessions'::text, daily.sessions)
  ) as metric(metric_key, metric_value)

  union all

  select
    path.source_id,
    path.metric_date,
    'events_by_path'::text,
    path.metric_value,
    jsonb_build_object('path', path.path),
    ('{"path":' || to_json(path.path)::text || '}')::text
  from path_rollups path

  union all

  select
    referrer.source_id,
    referrer.metric_date,
    'events_by_referrer'::text,
    referrer.metric_value,
    jsonb_build_object('referrer', referrer.referrer),
    ('{"referrer":' || to_json(referrer.referrer)::text || '}')::text
  from referrer_rollups referrer
)
insert into metrics_daily (
  id,
  date,
  source_id,
  source_type_key,
  metric_key,
  metric_value,
  unit,
  dimensions,
  dimensions_hash,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  desired.metric_date,
  desired.source_id,
  'website',
  desired.metric_key,
  desired.metric_value,
  'count',
  desired.dimensions,
  encode(digest(desired.dimensions_text, 'sha256'), 'hex'),
  now(),
  now()
from desired_metrics desired
on conflict (date, source_id, metric_key, dimensions_hash) do update set
  source_type_key = excluded.source_type_key,
  metric_value = excluded.metric_value,
  unit = excluded.unit,
  dimensions = excluded.dimensions,
  updated_at = excluded.updated_at;
