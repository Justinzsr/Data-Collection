-- Hold website writes briefly so the destructive rebuild and its source-event
-- snapshot stay atomic inside the migration transaction.
lock table web_events in share row exclusive mode;
lock table metrics_daily in share row exclusive mode;
lock table content_items in share mode;
lock table content_metrics in share row exclusive mode;

-- A Drain event can be retried inside a different webhook batch. Keep the
-- first copy of an otherwise identical page view before rebuilding rollups.
with duplicate_vercel_pageviews as (
  select
    e.id,
    row_number() over (
      partition by
        e.source_id,
        e.public_tracking_key,
        e.anonymous_id,
        e.session_id,
        e.user_id,
        e.event_name,
        e.path,
        e.url,
        e.referrer,
        e.user_agent,
        e.ip_hash,
        e.country,
        e.device_type,
        e.properties,
        e.occurred_at
      order by e.created_at, e.id
    ) as copy_rank
  from web_events e
  join sources s on s.id = e.source_id
  where s.source_type_key = 'vercel_web_analytics_drain'
    and e.event_name = 'page_view'
)
delete from web_events e
using duplicate_vercel_pageviews duplicate
where e.id = duplicate.id
  and duplicate.copy_rank > 1;

-- Rebuild daily website rollups from raw page views using the application's
-- Pacific business-day boundary. Suppressed tracker events remain raw-only.
-- The received Vercel Drain data has no stable session identity, so sessions
-- are intentionally rebuilt only for the first-party website tracker.
delete from metrics_daily m
using sources s
where m.source_id = s.id
  and s.source_type_key in ('website', 'vercel_web_analytics_drain')
  and m.metric_key in ('page_views', 'unique_visitors', 'sessions')
  and m.dimensions = '{"rollup":"daily"}'::jsonb
  and (
    (s.source_type_key = 'vercel_web_analytics_drain' and m.metric_key = 'sessions')
    or exists (select 1 from web_events e where e.source_id = s.id)
  );

with event_rollups as (
  select
    e.source_id,
    s.source_type_key,
    (e.occurred_at at time zone 'America/Los_Angeles')::date as metric_date,
    count(*)::numeric as page_views,
    count(distinct e.anonymous_id)::numeric as unique_visitors,
    count(distinct e.session_id) filter (where e.session_id is not null) as sessions
  from web_events e
  join sources s on s.id = e.source_id
  where s.source_type_key in ('website', 'vercel_web_analytics_drain')
    and e.event_name = 'page_view'
    and not (
      e.properties @> '{"moonarq_ingestion":{"suppressed_rollup":true}}'::jsonb
    )
  group by e.source_id, s.source_type_key, (e.occurred_at at time zone 'America/Los_Angeles')::date
),
desired_metrics as (
  select
    r.source_id,
    r.source_type_key,
    r.metric_date,
    metric.metric_key,
    metric.metric_value
  from event_rollups r
  cross join lateral (
    values
      ('page_views'::text, r.page_views),
      ('unique_visitors'::text, r.unique_visitors::numeric),
      ('sessions'::text, case when r.source_type_key = 'website' then r.sessions::numeric else null end)
  ) as metric(metric_key, metric_value)
  where metric.metric_value is not null
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
  d.metric_date,
  d.source_id,
  d.source_type_key,
  d.metric_key,
  d.metric_value,
  'count',
  '{"rollup":"daily"}'::jsonb,
  encode(digest('{"rollup":"daily"}', 'sha256'), 'hex'),
  now(),
  now()
from desired_metrics d
on conflict (date, source_id, metric_key, dimensions_hash) do update set
  source_type_key = excluded.source_type_key,
  metric_value = excluded.metric_value,
  unit = excluded.unit,
  dimensions = excluded.dimensions,
  updated_at = excluded.updated_at;

-- Older Instagram syncs used UTC dates. Collapse rows whose snapshot date is
-- ahead of their latest Pacific update date, keeping the most recently updated
-- value when both the old and corrected dates already exist.
create temporary table instagram_metric_repair on commit drop as
select
  ranked.id,
  ranked.target_date as date,
  ranked.source_id,
  ranked.source_type_key,
  ranked.metric_key,
  ranked.metric_value,
  ranked.unit,
  ranked.dimensions,
  ranked.dimensions_hash,
  ranked.created_at,
  ranked.updated_at
from (
  select
    m.*,
    case
      when m.date > (m.updated_at at time zone 'America/Los_Angeles')::date
        then (m.updated_at at time zone 'America/Los_Angeles')::date
      else m.date
    end as target_date,
    row_number() over (
      partition by
        case
          when m.date > (m.updated_at at time zone 'America/Los_Angeles')::date
            then (m.updated_at at time zone 'America/Los_Angeles')::date
          else m.date
        end,
        m.source_id,
        m.metric_key,
        m.dimensions_hash
      order by m.updated_at desc, m.id desc
    ) as keep_rank
  from metrics_daily m
  where m.source_type_key = 'instagram'
    and m.dimensions ->> 'rollup' in ('snapshot', 'media_sync_total')
) ranked
where ranked.keep_rank = 1;

delete from metrics_daily m
where m.source_type_key = 'instagram'
  and m.dimensions ->> 'rollup' in ('snapshot', 'media_sync_total');

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
from instagram_metric_repair;

-- Content metrics describe a post's publication day, so derive that day from
-- the stored publication timestamp and collapse any UTC/PT duplicates first.
create temporary table instagram_content_metric_repair on commit drop as
select
  ranked.id,
  ranked.target_date as date,
  ranked.content_item_id,
  ranked.source_id,
  ranked.source_type_key,
  ranked.metric_key,
  ranked.metric_value,
  ranked.unit,
  ranked.dimensions,
  ranked.created_at,
  ranked.updated_at
from (
  select
    cm.*,
    (item.published_at at time zone 'America/Los_Angeles')::date as target_date,
    row_number() over (
      partition by
        (item.published_at at time zone 'America/Los_Angeles')::date,
        cm.content_item_id,
        cm.metric_key
      order by cm.updated_at desc, cm.id desc
    ) as keep_rank
  from content_metrics cm
  join content_items item on item.id = cm.content_item_id
  where cm.source_type_key = 'instagram'
    and item.published_at is not null
) ranked
where ranked.keep_rank = 1;

delete from content_metrics cm
using content_items item
where item.id = cm.content_item_id
  and cm.source_type_key = 'instagram'
  and item.published_at is not null;

insert into content_metrics (
  id,
  date,
  content_item_id,
  source_id,
  source_type_key,
  metric_key,
  metric_value,
  unit,
  dimensions,
  created_at,
  updated_at
)
select
  id,
  date,
  content_item_id,
  source_id,
  source_type_key,
  metric_key,
  metric_value,
  unit,
  dimensions,
  created_at,
  updated_at
from instagram_content_metric_repair;
