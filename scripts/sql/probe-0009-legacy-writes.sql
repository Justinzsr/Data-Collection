\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $verification$
declare
  tracker_source_id uuid;
  drain_source_id uuid;
  tracker_event public.web_events%rowtype;
  drain_event public.web_events%rowtype;
begin
  select sources.id
  into tracker_source_id
  from public.sources sources
  where sources.source_type_key = 'website'
  order by sources.id
  limit 1;

  select sources.id
  into drain_source_id
  from public.sources sources
  where sources.source_type_key = 'vercel_web_analytics_drain'
  order by sources.id
  limit 1;

  if tracker_source_id is null or drain_source_id is null then
    raise exception 'Legacy compatibility probes require Website Tracker and Vercel Drain sources.';
  end if;

  -- Deliberately use only the pre-0009 columns written by the legacy application.
  insert into public.web_events (
    source_id,
    anonymous_id,
    session_id,
    event_name,
    path,
    url,
    properties,
    occurred_at
  ) values (
    tracker_source_id,
    'verification-0009-rollback-only',
    'verification-0009-legacy-tracker',
    'page_view',
    '/__verification__/legacy-tracker',
    'https://verification.invalid/__verification__/legacy-tracker',
    '{}'::jsonb,
    now()
  )
  returning * into tracker_event;

  insert into public.web_events (
    source_id,
    anonymous_id,
    session_id,
    event_name,
    path,
    url,
    properties,
    occurred_at
  ) values (
    drain_source_id,
    'verification-0009-rollback-only',
    'verification-0009-legacy-drain',
    'page_view',
    '/__verification__/legacy-drain',
    'https://verification.invalid/__verification__/legacy-drain',
    '{}'::jsonb,
    now()
  )
  returning * into drain_event;

  if tracker_event.event_id is null
    or tracker_event.schema_version <> 'legacy'
    or tracker_event.event_source <> 'first_party_tracker'
    or tracker_event.received_at is null
    or tracker_event.attribution_context <> '{}'::jsonb
    or tracker_event.consent_status <> '{"analytics":"unknown","marketing":"unknown"}'::jsonb
    or tracker_event.client_context <> '{}'::jsonb
  then
    raise exception 'Legacy Website Tracker defaults are incompatible with 0009.';
  end if;

  if drain_event.event_id is null
    or drain_event.schema_version <> 'vercel.analytics.v2'
    or drain_event.event_source <> 'vercel_drain'
    or drain_event.received_at is null
    or drain_event.attribution_context <> '{}'::jsonb
    or drain_event.consent_status <> '{"analytics":"unknown","marketing":"unknown"}'::jsonb
    or drain_event.client_context <> '{}'::jsonb
  then
    raise exception 'Legacy Vercel Drain defaults are incompatible with 0009.';
  end if;
end
$verification$;

select true as rollback_only_legacy_probes_passed;

rollback;
