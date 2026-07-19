-- Expand phase for Website Event Contract v1. Apply this migration before the
-- application deploy; 0010 performs the post-deploy authoritative rebuild.
set local lock_timeout = '10s';
set local statement_timeout = '15min';

lock table web_events in share row exclusive mode;

alter table web_events add column if not exists event_id uuid;
alter table web_events add column if not exists schema_version text;
alter table web_events add column if not exists event_source text;
alter table web_events add column if not exists attribution_context jsonb;
alter table web_events add column if not exists consent_status jsonb;
alter table web_events add column if not exists client_context jsonb;
alter table web_events add column if not exists received_at timestamptz;

update web_events
set
  event_id = coalesce(event_id, id),
  received_at = coalesce(received_at, created_at),
  attribution_context = coalesce(
    attribution_context,
    case
      when jsonb_typeof(properties -> 'attribution') = 'object' then properties -> 'attribution'
      else '{}'::jsonb
    end
  ),
  consent_status = coalesce(consent_status, '{"analytics":"unknown","marketing":"unknown"}'::jsonb),
  client_context = coalesce(
    client_context,
    jsonb_strip_nulls(jsonb_build_object('device_category', device_type))
  );

update web_events e
set
  event_source = coalesce(
    e.event_source,
    case when s.source_type_key = 'vercel_web_analytics_drain' then 'vercel_drain' else 'first_party_tracker' end
  ),
  schema_version = coalesce(
    e.schema_version,
    case when s.source_type_key = 'vercel_web_analytics_drain' then 'vercel.analytics.v2' else 'legacy' end
  )
from sources s
where s.id = e.source_id;

update web_events
set
  event_source = coalesce(event_source, 'first_party_tracker'),
  schema_version = coalesce(schema_version, 'legacy');

alter table web_events
  alter column event_id set default gen_random_uuid(),
  alter column event_id set not null,
  alter column schema_version set default 'legacy',
  alter column schema_version set not null,
  alter column event_source set default 'first_party_tracker',
  alter column event_source set not null,
  alter column attribution_context set default '{}'::jsonb,
  alter column attribution_context set not null,
  alter column consent_status set default '{"analytics":"unknown","marketing":"unknown"}'::jsonb,
  alter column consent_status set not null,
  alter column client_context set default '{}'::jsonb,
  alter column client_context set not null,
  alter column received_at set default now(),
  alter column received_at set not null;

-- Keep the old application binary safe during the expand/deploy gap. Legacy
-- inserts omit the new columns, so identify Drain rows from their source before
-- the defaults can misclassify them. V1 and updated Drain writes bypass the lookup.
create or replace function public.set_web_event_contract_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  resolved_source_type text;
begin
  if new.source_id is not null
    and new.schema_version = 'legacy'
    and new.event_source = 'first_party_tracker'
  then
    select source_type_key
    into resolved_source_type
    from public.sources
    where id = new.source_id;

    if resolved_source_type = 'vercel_web_analytics_drain' then
      new.schema_version := 'vercel.analytics.v2';
      new.event_source := 'vercel_drain';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists set_web_event_contract_defaults on public.web_events;
create trigger set_web_event_contract_defaults
before insert on public.web_events
for each row execute function public.set_web_event_contract_defaults();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'web_events_schema_version_check'
      and conrelid = 'web_events'::regclass
  ) then
    alter table web_events
      add constraint web_events_schema_version_check
      check (schema_version in ('legacy', '1.0', 'vercel.analytics.v2'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'web_events_event_source_check'
      and conrelid = 'web_events'::regclass
  ) then
    alter table web_events
      add constraint web_events_event_source_check
      check (event_source in ('first_party_tracker', 'vercel_drain'));
  end if;
end $$;

create unique index if not exists idx_web_events_source_event_id
  on web_events (source_id, event_id);

create index if not exists idx_web_events_event_time
  on web_events (event_name, occurred_at desc);

create index if not exists idx_web_events_session_time
  on web_events (source_id, session_id, occurred_at desc);

create index if not exists idx_web_events_anonymous_time
  on web_events (source_id, anonymous_id, occurred_at desc);

create index if not exists idx_web_events_source_received_time
  on web_events (source_id, received_at desc);

-- The reporting views aggregate web_events. Run them with caller privileges so
-- they cannot bypass the raw table's RLS, and remove browser-role ACLs even if
-- an earlier environment granted them through custom default privileges.
alter view reporting.platform_website_daily set (security_invoker = true);
alter view reporting.moonarq_website_daily set (security_invoker = true);
revoke all privileges on table reporting.platform_website_daily from public;
revoke all privileges on table reporting.moonarq_website_daily from public;

-- web_events carries raw URLs and pseudonymous identity. Keep it off the
-- Supabase Data API for browser roles while preserving direct owner access and
-- the server-only service_role path when those standard Supabase roles exist.
alter table public.web_events enable row level security;
revoke all privileges on table public.web_events from public;
drop policy if exists web_events_service_role_all on public.web_events;
drop policy if exists web_events_service_role_select on public.web_events;
drop policy if exists web_events_service_role_insert on public.web_events;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all privileges on table public.web_events from anon';
    execute 'revoke all privileges on table reporting.platform_website_daily from anon';
    execute 'revoke all privileges on table reporting.moonarq_website_daily from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all privileges on table public.web_events from authenticated';
    execute 'revoke all privileges on table reporting.platform_website_daily from authenticated';
    execute 'revoke all privileges on table reporting.moonarq_website_daily from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all privileges on table public.web_events from service_role';
    execute 'grant select, insert on table public.web_events to service_role';
    execute 'grant usage on schema public to service_role';
    execute 'revoke all privileges on table public.sources from service_role';
    execute 'revoke all privileges on table public.data_spaces from service_role';
    execute 'revoke all privileges on table public.metrics_daily from service_role';
    execute 'grant select on table public.sources to service_role';
    execute 'grant select on table public.data_spaces to service_role';
    execute 'grant select on table public.metrics_daily to service_role';
    execute 'grant usage on schema reporting to service_role';
    execute 'revoke all privileges on table reporting.platform_website_daily from service_role';
    execute 'revoke all privileges on table reporting.moonarq_website_daily from service_role';
    execute 'grant select on table reporting.platform_website_daily to service_role';
    execute 'grant select on table reporting.moonarq_website_daily to service_role';
    execute 'create policy web_events_service_role_select on public.web_events for select to service_role using (true)';
    execute 'create policy web_events_service_role_insert on public.web_events for insert to service_role with check (true)';
  end if;
end $$;
