\set ON_ERROR_STOP on

\if :{?baseline_cutoff}
\else
  \echo 'baseline_cutoff is required (UTC ISO-8601 timestamp).'
  \quit 3
\endif

begin read only;
set local timezone = 'UTC';
set local statement_timeout = '5min';

with settings as (
  select :'baseline_cutoff'::timestamptz as baseline_cutoff
), settled_event_rows as (
  select
    events.id,
    encode(
      digest(
        jsonb_build_array(
          events.id,
          events.source_id,
          events.public_tracking_key,
          events.anonymous_id,
          events.session_id,
          events.user_id,
          events.event_name,
          events.path,
          events.url,
          events.referrer,
          events.user_agent,
          events.ip_hash,
          events.country,
          events.device_type,
          events.properties,
          events.occurred_at,
          events.created_at
        )::text,
        'sha256'
      ),
      'hex'
    ) as row_fingerprint,
    events.event_name,
    events.occurred_at
  from public.web_events events
  cross join settings
  where events.created_at < settings.baseline_cutoff
), settled_event_baseline as (
  select
    count(*) as row_count,
    count(*) filter (where event_name = 'page_view') as page_view_count,
    min(occurred_at) as first_occurred_at,
    max(occurred_at) as last_occurred_at,
    encode(
      digest(
        coalesce(string_agg(row_fingerprint, '' order by id), ''),
        'sha256'
      ),
      'hex'
    ) as row_fingerprint
  from settled_event_rows
), settled_metric_rows as (
  select
    metrics.id,
    encode(
      digest(
        jsonb_build_array(
          metrics.id,
          metrics.date,
          metrics.source_id,
          metrics.source_type_key,
          metrics.metric_key,
          metrics.metric_value,
          metrics.unit,
          metrics.dimensions,
          metrics.dimensions_hash,
          metrics.created_at,
          metrics.updated_at
        )::text,
        'sha256'
      ),
      'hex'
    ) as row_fingerprint
  from public.metrics_daily metrics
  join public.sources sources on sources.id = metrics.source_id
  cross join settings
  where sources.source_type_key in ('website', 'vercel_web_analytics_drain')
    and metrics.updated_at < settings.baseline_cutoff
), settled_metric_baseline as (
  select
    count(*) as row_count,
    encode(
      digest(
        coalesce(string_agg(row_fingerprint, '' order by id), ''),
        'sha256'
      ),
      'hex'
    ) as row_fingerprint
  from settled_metric_rows
)
select
  settings.baseline_cutoff,
  event_baseline.row_count as settled_web_event_count,
  event_baseline.page_view_count as settled_page_view_count,
  event_baseline.first_occurred_at,
  event_baseline.last_occurred_at,
  event_baseline.row_fingerprint as settled_web_event_fingerprint,
  metric_baseline.row_count as settled_website_metric_count,
  metric_baseline.row_fingerprint as settled_website_metric_fingerprint
from settings
cross join settled_event_baseline event_baseline
cross join settled_metric_baseline metric_baseline;

commit;
