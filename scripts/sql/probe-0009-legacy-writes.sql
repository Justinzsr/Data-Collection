\set ON_ERROR_STOP on

begin;
set transaction isolation level repeatable read;
set local timezone = 'UTC';
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Keep fixture identity and the before-state only in this session. Fingerprints
-- hash complete rows inside PostgreSQL and are compared without being returned.
create temporary table verification_0009_probe_state (
  tracker_source_id uuid not null,
  drain_source_id uuid not null,
  marker text not null,
  data_space_id uuid not null,
  source_count bigint not null,
  source_fingerprint text not null,
  event_count bigint not null,
  event_fingerprint text not null
) on commit drop;

do $verification$
begin
  if not exists (
    select 1 from public.source_types where key = 'website'
  ) or not exists (
    select 1 from public.source_types where key = 'vercel_web_analytics_drain'
  ) then
    raise exception 'Legacy compatibility probes require both website source-type catalog entries.';
  end if;

  if not exists (
    select 1 from public.data_spaces where slug = 'moonarq'
  ) then
    raise exception 'Legacy compatibility probes require the MoonArq data space.';
  end if;
end
$verification$;

with fixture_identity as (
  select gen_random_uuid() as tracker_source_id, gen_random_uuid() as drain_source_id
), source_snapshot as (
  select
    count(*) as row_count,
    encode(
      digest(
        coalesce(
          string_agg(
            encode(digest(to_jsonb(sources)::text, 'sha256'), 'hex'),
            '' order by sources.id
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    ) as row_fingerprint
  from public.sources sources
), event_snapshot as (
  select
    count(*) as row_count,
    encode(
      digest(
        coalesce(
          string_agg(
            encode(digest(to_jsonb(events)::text, 'sha256'), 'hex'),
            '' order by events.id
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    ) as row_fingerprint
  from public.web_events events
)
insert into verification_0009_probe_state (
  tracker_source_id,
  drain_source_id,
  marker,
  data_space_id,
  source_count,
  source_fingerprint,
  event_count,
  event_fingerprint
)
select
  fixture_identity.tracker_source_id,
  fixture_identity.drain_source_id,
  'verification-0009-' || fixture_identity.tracker_source_id::text,
  data_spaces.id,
  source_snapshot.row_count,
  source_snapshot.row_fingerprint,
  event_snapshot.row_count,
  event_snapshot.row_fingerprint
from fixture_identity
cross join public.data_spaces data_spaces
cross join source_snapshot
cross join event_snapshot
where data_spaces.slug = 'moonarq';

savepoint legacy_probe_fixtures;

-- These disabled fixtures contain no credentials, keys, origins, URLs, webhook
-- configuration, or metadata. The compatibility trigger needs only source type.
insert into public.sources (
  id,
  source_type_key,
  display_name,
  status,
  sync_mode,
  data_space_id
)
select
  tracker_source_id,
  'website',
  '0009 rollback-only Website fixture ' || tracker_source_id::text,
  'disabled',
  'manual',
  data_space_id
from verification_0009_probe_state
union all
select
  drain_source_id,
  'vercel_web_analytics_drain',
  '0009 rollback-only Drain fixture ' || drain_source_id::text,
  'disabled',
  'manual',
  data_space_id
from verification_0009_probe_state;

do $verification$
declare
  probe_state verification_0009_probe_state%rowtype;
  tracker_event public.web_events%rowtype;
  drain_event public.web_events%rowtype;
begin
  select * into strict probe_state from verification_0009_probe_state;

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
    probe_state.tracker_source_id,
    probe_state.marker,
    probe_state.marker || '-tracker',
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
    probe_state.drain_source_id,
    probe_state.marker,
    probe_state.marker || '-drain',
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

-- Remove every production-table fixture before checking absence. The final
-- outer ROLLBACK then removes the session-local state as well.
rollback to savepoint legacy_probe_fixtures;
release savepoint legacy_probe_fixtures;

do $verification$
declare
  probe_state verification_0009_probe_state%rowtype;
  current_source_count bigint;
  current_source_fingerprint text;
  current_event_count bigint;
  current_event_fingerprint text;
begin
  select * into strict probe_state from verification_0009_probe_state;

  if exists (
    select 1
    from public.sources
    where id in (probe_state.tracker_source_id, probe_state.drain_source_id)
  ) or exists (
    select 1
    from public.web_events
    where source_id in (probe_state.tracker_source_id, probe_state.drain_source_id)
      or anonymous_id = probe_state.marker
  ) or exists (
    select 1
    from public.source_credentials
    where source_id in (probe_state.tracker_source_id, probe_state.drain_source_id)
  ) or exists (
    select 1
    from public.metrics_daily
    where source_id in (probe_state.tracker_source_id, probe_state.drain_source_id)
  ) then
    raise exception 'Legacy compatibility probe left fixture rows after savepoint rollback.';
  end if;

  select
    count(*),
    encode(
      digest(
        coalesce(
          string_agg(
            encode(digest(to_jsonb(sources)::text, 'sha256'), 'hex'),
            '' order by sources.id
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
  into current_source_count, current_source_fingerprint
  from public.sources sources;

  select
    count(*),
    encode(
      digest(
        coalesce(
          string_agg(
            encode(digest(to_jsonb(events)::text, 'sha256'), 'hex'),
            '' order by events.id
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
  into current_event_count, current_event_fingerprint
  from public.web_events events;

  if current_source_count <> probe_state.source_count
    or current_source_fingerprint <> probe_state.source_fingerprint
    or current_event_count <> probe_state.event_count
    or current_event_fingerprint <> probe_state.event_fingerprint
  then
    raise exception 'Legacy compatibility probe changed source or event state.';
  end if;
end
$verification$;

select
  true as rollback_only_legacy_probes_passed,
  true as fixture_rows_absent,
  true as source_event_fingerprints_unchanged;

rollback;
