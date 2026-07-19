\set ON_ERROR_STOP on

\if :{?baseline_cutoff}
\else
  \echo 'baseline_cutoff is required (reuse the pre-0009 UTC cutoff).'
  \quit 3
\endif

-- PostgreSQL does not allow CREATE TEMP TABLE after BEGIN READ ONLY. This
-- transaction writes only to the session-local scratch table below and always
-- rolls back; every production object is queried without mutation.
begin;
set local timezone = 'UTC';
set local lock_timeout = '5s';
set local statement_timeout = '2min';

create temporary table verification_0009_checks (
  check_name text primary key,
  passed boolean not null,
  expectation text not null
) on commit drop;

insert into verification_0009_checks
with expected(filename) as (
  values
    ('0001_initial.sql'::text),
    ('0002_reporting_layer.sql'),
    ('0003_data_spaces.sql'),
    ('0004_tiktok_data_integrity.sql'),
    ('0005_foreign_key_indexes.sql'),
    ('0006_shopify_official_connector.sql'),
    ('0007_repair_time_zone_rollups.sql'),
    ('0008_meta_ads_attribution.sql'),
    ('0009_website_event_contract_v1.sql')
), expected_state as (
  select array_agg(filename order by filename) as filenames from expected
), actual_state as (
  select array_agg(filename order by filename) as filenames
  from public.schema_migrations
)
select
  'migration_phase_state',
  actual_state.filenames = expected_state.filenames,
  'Exactly 0001 through 0009 are applied, and 0010 is absent.'
from expected_state
cross join actual_state;

insert into verification_0009_checks
with expected(column_name, data_type, is_not_null, default_expression) as (
  values
    ('event_id'::name, 'uuid'::text, true, 'gen_random_uuid()'::text),
    ('schema_version'::name, 'text', true, '''legacy''::text'),
    ('event_source'::name, 'text', true, '''first_party_tracker''::text'),
    ('attribution_context'::name, 'jsonb', true, '''{}''::jsonb'),
    (
      'consent_status'::name,
      'jsonb',
      true,
      '''{"analytics": "unknown", "marketing": "unknown"}''::jsonb'
    ),
    ('client_context'::name, 'jsonb', true, '''{}''::jsonb'),
    ('received_at'::name, 'timestamp with time zone', true, 'now()')
), actual as (
  select
    attributes.attname as column_name,
    format_type(attributes.atttypid, attributes.atttypmod) as data_type,
    attributes.attnotnull as is_not_null,
    pg_get_expr(defaults.adbin, defaults.adrelid, true) as default_expression
  from pg_attribute attributes
  left join pg_attrdef defaults
    on defaults.adrelid = attributes.attrelid
    and defaults.adnum = attributes.attnum
  where attributes.attrelid = 'public.web_events'::regclass
    and attributes.attnum > 0
    and not attributes.attisdropped
    and attributes.attname in (select column_name from expected)
), comparison as (
  select
    expected.column_name,
    actual.column_name is not null
      and actual.data_type = expected.data_type
      and actual.is_not_null = expected.is_not_null
      and actual.default_expression = expected.default_expression as matches
  from expected
  left join actual using (column_name)
)
select
  'column_types_defaults_nullability',
  count(*) = 7 and coalesce(bool_and(matches), false),
  'All seven v1 columns have the exact type, default, and NOT NULL state.'
from comparison;

insert into verification_0009_checks
with expected(constraint_name, constraint_expression) as (
  values
    (
      'web_events_schema_version_check'::name,
      'schema_version = ANY (ARRAY[''legacy''::text, ''1.0''::text, ''vercel.analytics.v2''::text])'::text
    ),
    (
      'web_events_event_source_check'::name,
      'event_source = ANY (ARRAY[''first_party_tracker''::text, ''vercel_drain''::text])'::text
    )
), actual as (
  select
    constraints.conname as constraint_name,
    constraints.convalidated,
    pg_get_expr(constraints.conbin, constraints.conrelid, true) as constraint_expression
  from pg_constraint constraints
  where constraints.conrelid = 'public.web_events'::regclass
    and constraints.contype = 'c'
    and constraints.conname in (select constraint_name from expected)
), comparison as (
  select
    expected.constraint_name,
    actual.constraint_name is not null
      and actual.convalidated
      and actual.constraint_expression = expected.constraint_expression as matches
  from expected
  left join actual using (constraint_name)
)
select
  'validated_check_constraints',
  count(*) = 2 and coalesce(bool_and(matches), false),
  'Both named CHECK constraints are validated and allow only the documented values.'
from comparison;

insert into verification_0009_checks
with function_state as (
  select
    procedures.oid,
    procedures.prokind,
    procedures.provolatile,
    procedures.proparallel,
    procedures.prosecdef,
    procedures.proleakproof,
    procedures.pronargs,
    pg_get_function_result(procedures.oid) as result_type,
    languages.lanname as language_name,
    coalesce(array_to_string(procedures.proconfig, ','), '') as function_config,
    regexp_replace(btrim(procedures.prosrc), '\s+', ' ', 'g') as normalized_body
  from pg_proc procedures
  join pg_language languages on languages.oid = procedures.prolang
  where procedures.oid = to_regprocedure('public.set_web_event_contract_defaults()')
)
select
  'compatibility_function_definition',
  count(*) = 1
    and coalesce(bool_and(
      prokind = 'f'
      and provolatile = 'v'
      and proparallel = 'u'
      and not prosecdef
      and not proleakproof
      and pronargs = 0
      and result_type = 'trigger'
      and language_name = 'plpgsql'
      and function_config = 'search_path=""'
      and normalized_body = 'declare resolved_source_type text; begin if new.source_id is not null and new.schema_version = ''legacy'' and new.event_source = ''first_party_tracker'' then select source_type_key into resolved_source_type from public.sources where id = new.source_id; if resolved_source_type = ''vercel_web_analytics_drain'' then new.schema_version := ''vercel.analytics.v2''; new.event_source := ''vercel_drain''; end if; end if; return new; end;'
    ), false),
  'The compatibility function has the exact language, security, search_path, and body.'
from function_state;

insert into verification_0009_checks
with trigger_state as (
  select
    triggers.tgenabled,
    triggers.tgisinternal,
    triggers.tgtype,
    triggers.tgfoid,
    triggers.tgqual,
    octet_length(triggers.tgargs) as argument_bytes
  from pg_trigger triggers
  where triggers.tgrelid = 'public.web_events'::regclass
    and triggers.tgname = 'set_web_event_contract_defaults'
)
select
  'compatibility_trigger_definition',
  count(*) = 1
    and coalesce(bool_and(
      tgenabled = 'O'
      and not tgisinternal
      and tgtype = 7
      and tgfoid = to_regprocedure('public.set_web_event_contract_defaults()')
      and tgqual is null
      and argument_bytes = 0
    ), false),
  'Exactly one enabled row-level BEFORE INSERT trigger calls the compatibility function.'
from trigger_state;

insert into verification_0009_checks
select
  'required_column_backfill',
  count(*) filter (
    where event_id is null
      or schema_version is null
      or event_source is null
      or attribution_context is null
      or consent_status is null
      or client_context is null
      or received_at is null
  ) = 0,
  'No existing row is missing a required v1 value.'
from public.web_events;

insert into verification_0009_checks
with settings as (
  select :'baseline_cutoff'::timestamptz as baseline_cutoff
)
select
  'settled_backfill_invariants',
  count(*) filter (
    where sources.id is null
      or events.event_id <> events.id
      or events.received_at <> events.created_at
      or events.attribution_context <> case
        when jsonb_typeof(events.properties -> 'attribution') = 'object'
          then events.properties -> 'attribution'
        else '{}'::jsonb
      end
      or events.consent_status <> '{"analytics":"unknown","marketing":"unknown"}'::jsonb
      or events.client_context <> jsonb_strip_nulls(
        jsonb_build_object('device_category', events.device_type)
      )
      or events.event_source <> case
        when sources.source_type_key = 'vercel_web_analytics_drain' then 'vercel_drain'
        else 'first_party_tracker'
      end
      or events.schema_version <> case
        when sources.source_type_key = 'vercel_web_analytics_drain' then 'vercel.analytics.v2'
        else 'legacy'
      end
  ) = 0,
  'Every settled pre-0009 row has the exact deterministic expand-phase backfill.'
from public.web_events events
left join public.sources sources on sources.id = events.source_id
cross join settings
where events.created_at < settings.baseline_cutoff;

insert into verification_0009_checks
select
  'event_source_classification',
  count(*) filter (
    where sources.id is null
      or events.source_id is null
      or (
        sources.source_type_key = 'vercel_web_analytics_drain'
        and (
          events.event_source <> 'vercel_drain'
          or events.schema_version <> 'vercel.analytics.v2'
        )
      )
      or (
        sources.source_type_key <> 'vercel_web_analytics_drain'
        and events.event_source <> 'first_party_tracker'
      )
  ) = 0,
  'Every retained event has a source and the expected authoritative or auxiliary classification.'
from public.web_events events
left join public.sources sources on sources.id = events.source_id;

insert into verification_0009_checks
select
  'source_scoped_event_id_uniqueness',
  not exists (
    select 1
    from public.web_events events
    where events.source_id is not null
    group by events.source_id, events.event_id
    having count(*) > 1
  ),
  'No non-null source contains a duplicate event_id.';

insert into verification_0009_checks
with expected(index_name, column_names, descending, is_unique, index_definition) as (
  values
    (
      'idx_web_events_source_time'::name,
      array['source_id', 'occurred_at']::name[],
      array[false, true]::boolean[],
      false,
      'create index idx_web_events_source_time on public.web_events using btree (source_id, occurred_at desc)'::text
    ),
    (
      'idx_web_events_source_event_id'::name,
      array['source_id', 'event_id']::name[],
      array[false, false]::boolean[],
      true,
      'create unique index idx_web_events_source_event_id on public.web_events using btree (source_id, event_id)'::text
    ),
    (
      'idx_web_events_event_time'::name,
      array['event_name', 'occurred_at']::name[],
      array[false, true]::boolean[],
      false,
      'create index idx_web_events_event_time on public.web_events using btree (event_name, occurred_at desc)'::text
    ),
    (
      'idx_web_events_session_time'::name,
      array['source_id', 'session_id', 'occurred_at']::name[],
      array[false, false, true]::boolean[],
      false,
      'create index idx_web_events_session_time on public.web_events using btree (source_id, session_id, occurred_at desc)'::text
    ),
    (
      'idx_web_events_anonymous_time'::name,
      array['source_id', 'anonymous_id', 'occurred_at']::name[],
      array[false, false, true]::boolean[],
      false,
      'create index idx_web_events_anonymous_time on public.web_events using btree (source_id, anonymous_id, occurred_at desc)'::text
    ),
    (
      'idx_web_events_source_received_time'::name,
      array['source_id', 'received_at']::name[],
      array[false, true]::boolean[],
      false,
      'create index idx_web_events_source_received_time on public.web_events using btree (source_id, received_at desc)'::text
    )
), actual as (
  select
    index_class.relname as index_name,
    array_agg(attributes.attname order by keys.ordinality) as column_names,
    array_agg(
      ((index_state.indoption[keys.ordinality - 1] & 1) = 1)
      order by keys.ordinality
    ) as descending,
    index_state.indisunique as is_unique,
    index_state.indisvalid,
    index_state.indisready,
    index_state.indislive,
    index_state.indisprimary,
    index_state.indnullsnotdistinct,
    index_state.indnkeyatts,
    index_state.indnatts,
    index_state.indpred,
    index_state.indexprs,
    access_methods.amname,
    regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g') as index_definition
  from pg_index index_state
  join pg_class index_class on index_class.oid = index_state.indexrelid
  join pg_am access_methods on access_methods.oid = index_class.relam
  cross join lateral unnest(index_state.indkey::smallint[]) with ordinality
    as keys(attribute_number, ordinality)
  join pg_attribute attributes
    on attributes.attrelid = index_state.indrelid
    and attributes.attnum = keys.attribute_number
  where index_state.indrelid = 'public.web_events'::regclass
    and index_class.relname in (select index_name from expected)
  group by
    index_class.relname,
    index_state.indisunique,
    index_state.indisvalid,
    index_state.indisready,
    index_state.indislive,
    index_state.indisprimary,
    index_state.indnullsnotdistinct,
    index_state.indnkeyatts,
    index_state.indnatts,
    index_state.indpred,
    index_state.indexprs,
    access_methods.amname,
    index_state.indexrelid
), comparison as (
  select
    expected.index_name,
    actual.index_name is not null
      and actual.column_names = expected.column_names
      and actual.descending = expected.descending
      and actual.is_unique = expected.is_unique
      and actual.indisvalid
      and actual.indisready
      and actual.indislive
      and not actual.indisprimary
      and not actual.indnullsnotdistinct
      and actual.indnkeyatts = cardinality(expected.column_names)
      and actual.indnatts = cardinality(expected.column_names)
      and actual.indpred is null
      and actual.indexprs is null
      and actual.amname = 'btree'
      and actual.index_definition = expected.index_definition as matches
  from expected
  left join actual using (index_name)
)
select
  'required_index_definitions',
  count(*) = 6 and coalesce(bool_and(matches), false),
  'All six indexes have the exact full definition and are live, ready, and valid.'
from comparison;

insert into verification_0009_checks
select
  'row_level_security_enabled',
  table_class.relrowsecurity and not table_class.relforcerowsecurity,
  'web_events has RLS enabled without forcing table owners through policies.'
from pg_class table_class
where table_class.oid = 'public.web_events'::regclass;

insert into verification_0009_checks
with policy_state as (
  select policyname, cmd, roles, qual, with_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'web_events'
), exact_policies as (
  select
    count(*) = 2
      and count(*) filter (
        where policyname = 'web_events_service_role_select'
          and cmd = 'SELECT'
          and roles = array['service_role']::name[]
          and qual = 'true'
          and with_check is null
      ) = 1
      and count(*) filter (
        where policyname = 'web_events_service_role_insert'
          and cmd = 'INSERT'
          and roles = array['service_role']::name[]
          and qual is null
          and with_check = 'true'
      ) = 1 as matches
  from policy_state
)
select
  'row_level_security_policies',
  matches,
  'Only the exact service_role SELECT and INSERT policies exist.'
from exact_policies;

insert into verification_0009_checks
with target_roles as (
  select roles.oid, roles.rolname
  from pg_roles roles
  where roles.rolname in ('anon', 'authenticated', 'service_role')
), target_acl as (
  select
    expanded.grantee,
    grantee_roles.rolname,
    expanded.privilege_type,
    expanded.is_grantable
  from pg_class table_class
  cross join lateral aclexplode(
    coalesce(table_class.relacl, acldefault('r', table_class.relowner))
  ) expanded
  left join pg_roles grantee_roles on grantee_roles.oid = expanded.grantee
  where table_class.oid = 'public.web_events'::regclass
    and (expanded.grantee = 0 or expanded.grantee in (select oid from target_roles))
), effective_privilege_mismatch as (
  select 1
  from target_roles roles
  where case
    when roles.rolname in ('anon', 'authenticated') then
      has_table_privilege(roles.oid, 'public.web_events'::regclass, 'SELECT')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'INSERT')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'UPDATE')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'DELETE')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'TRUNCATE')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'REFERENCES')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'TRIGGER')
      or case when current_setting('server_version_num')::integer >= 170000
        then has_table_privilege(roles.oid, 'public.web_events'::regclass, 'MAINTAIN')
        else false
      end
    when roles.rolname = 'service_role' then
      not has_table_privilege(roles.oid, 'public.web_events'::regclass, 'SELECT')
      or not has_table_privilege(roles.oid, 'public.web_events'::regclass, 'INSERT')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'UPDATE')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'DELETE')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'TRUNCATE')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'REFERENCES')
      or has_table_privilege(roles.oid, 'public.web_events'::regclass, 'TRIGGER')
      or case when current_setting('server_version_num')::integer >= 170000
        then has_table_privilege(roles.oid, 'public.web_events'::regclass, 'MAINTAIN')
        else false
      end
    else true
  end
)
select
  'table_acl',
  (select count(*) from target_roles) = 3
    and count(*) = 2
    and count(*) filter (
      where rolname = 'service_role'
        and privilege_type in ('SELECT', 'INSERT')
        and not is_grantable
    ) = 2
    and not exists (select 1 from effective_privilege_mismatch),
  'PUBLIC and browser roles have no direct or inherited table access; service_role effectively has only non-grantable SELECT and INSERT.'
from target_acl;

insert into verification_0009_checks
with target_roles as (
  select roles.oid, roles.rolname
  from pg_roles roles
  where roles.rolname in ('anon', 'authenticated', 'service_role')
), columns as (
  select attributes.attnum
  from pg_attribute attributes
  where attributes.attrelid = 'public.web_events'::regclass
    and attributes.attnum > 0
    and not attributes.attisdropped
), explicit_browser_column_acl as (
  select 1
  from pg_attribute attributes
  cross join lateral aclexplode(attributes.attacl) expanded
  left join pg_roles grantee_roles on grantee_roles.oid = expanded.grantee
  where attributes.attrelid = 'public.web_events'::regclass
    and (expanded.grantee = 0 or grantee_roles.rolname in ('anon', 'authenticated'))
), browser_effective_access as (
  select 1
  from target_roles roles
  cross join columns
  where roles.rolname in ('anon', 'authenticated')
    and (
      has_column_privilege(roles.oid, 'public.web_events'::regclass, columns.attnum, 'SELECT')
      or has_column_privilege(roles.oid, 'public.web_events'::regclass, columns.attnum, 'INSERT')
      or has_column_privilege(roles.oid, 'public.web_events'::regclass, columns.attnum, 'UPDATE')
      or has_column_privilege(roles.oid, 'public.web_events'::regclass, columns.attnum, 'REFERENCES')
    )
), service_role_mismatch as (
  select 1
  from target_roles roles
  cross join columns
  where roles.rolname = 'service_role'
    and (
      not has_column_privilege(roles.oid, 'public.web_events'::regclass, columns.attnum, 'SELECT')
      or not has_column_privilege(roles.oid, 'public.web_events'::regclass, columns.attnum, 'INSERT')
      or has_column_privilege(roles.oid, 'public.web_events'::regclass, columns.attnum, 'UPDATE')
      or has_column_privilege(roles.oid, 'public.web_events'::regclass, columns.attnum, 'REFERENCES')
    )
)
select
  'column_acl',
  (select count(*) from target_roles) = 3
    and not exists (select 1 from explicit_browser_column_acl)
    and not exists (select 1 from browser_effective_access)
    and not exists (select 1 from service_role_mismatch),
  'Browser roles have no column access; service_role has SELECT/INSERT and no UPDATE/REFERENCES on every column.';

insert into verification_0009_checks
with views as (
  select table_class.oid, table_class.relname, table_class.relowner, table_class.relacl, table_class.reloptions
  from pg_class table_class
  join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
  where table_namespace.nspname = 'reporting'
    and table_class.relname in ('platform_website_daily', 'moonarq_website_daily')
), target_roles as (
  select roles.oid, roles.rolname
  from pg_roles roles
  where roles.rolname in ('anon', 'authenticated', 'service_role')
), target_acl as (
  select
    views.relname,
    expanded.grantee,
    grantee_roles.rolname,
    expanded.privilege_type,
    expanded.is_grantable
  from views
  cross join lateral aclexplode(coalesce(views.relacl, acldefault('r', views.relowner))) expanded
  left join pg_roles grantee_roles on grantee_roles.oid = expanded.grantee
  where expanded.grantee = 0 or expanded.grantee in (select oid from target_roles)
), effective_privilege_mismatch as (
  select 1
  from views
  cross join target_roles roles
  where case
    when roles.rolname in ('anon', 'authenticated') then
      has_table_privilege(roles.oid, views.oid, 'SELECT')
      or has_table_privilege(roles.oid, views.oid, 'INSERT')
      or has_table_privilege(roles.oid, views.oid, 'UPDATE')
      or has_table_privilege(roles.oid, views.oid, 'DELETE')
      or has_table_privilege(roles.oid, views.oid, 'TRUNCATE')
      or has_table_privilege(roles.oid, views.oid, 'REFERENCES')
      or has_table_privilege(roles.oid, views.oid, 'TRIGGER')
      or case when current_setting('server_version_num')::integer >= 170000
        then has_table_privilege(roles.oid, views.oid, 'MAINTAIN')
        else false
      end
    when roles.rolname = 'service_role' then
      not has_table_privilege(roles.oid, views.oid, 'SELECT')
      or has_table_privilege(roles.oid, views.oid, 'INSERT')
      or has_table_privilege(roles.oid, views.oid, 'UPDATE')
      or has_table_privilege(roles.oid, views.oid, 'DELETE')
      or has_table_privilege(roles.oid, views.oid, 'TRUNCATE')
      or has_table_privilege(roles.oid, views.oid, 'REFERENCES')
      or has_table_privilege(roles.oid, views.oid, 'TRIGGER')
      or case when current_setting('server_version_num')::integer >= 170000
        then has_table_privilege(roles.oid, views.oid, 'MAINTAIN')
        else false
      end
    else true
  end
)
select
  'reporting_view_security_and_acl',
  (select count(*) from views) = 2
    and (select bool_and(reloptions @> array['security_invoker=true']) from views)
    and (select count(*) from target_roles) = 3
    and count(*) = 2
    and count(*) filter (
      where rolname = 'service_role'
        and privilege_type = 'SELECT'
        and not is_grantable
    ) = 2
    and not exists (select 1 from effective_privilege_mismatch),
  'Both reporting views are security-invoker; browser roles have no direct or inherited access and service_role effectively has only non-grantable SELECT.'
from target_acl;

insert into verification_0009_checks
with table_state as (
  select table_class.relowner, table_class.relrowsecurity
  from pg_class table_class
  where table_class.oid = 'public.web_events'::regclass
), runtime_role as (
  select roles.oid, roles.rolsuper, roles.rolbypassrls
  from pg_roles roles
  where roles.rolname = current_user
), applicable_policy_commands as (
  select policies.polcmd
  from pg_policy policies
  cross join runtime_role
  where policies.polrelid = 'public.web_events'::regclass
    and (
      0 = any(policies.polroles)
      or exists (
        select 1
        from unnest(policies.polroles) policy_role(role_oid)
        where pg_has_role(runtime_role.oid, policy_role.role_oid, 'MEMBER')
      )
    )
)
select
  'runtime_role_rls_and_acl_compatibility',
  has_table_privilege(current_user, 'public.web_events', 'SELECT')
    and has_table_privilege(current_user, 'public.web_events', 'INSERT')
    and has_schema_privilege(current_user, 'reporting', 'USAGE')
    and has_table_privilege(current_user, 'reporting.platform_website_daily', 'SELECT')
    and has_table_privilege(current_user, 'reporting.moonarq_website_daily', 'SELECT')
    and (
      not table_state.relrowsecurity
      or runtime_role.rolsuper
      or runtime_role.rolbypassrls
      or pg_has_role(runtime_role.oid, table_state.relowner, 'MEMBER')
      or (
        exists (select 1 from applicable_policy_commands where polcmd in ('*', 'r'))
        and exists (select 1 from applicable_policy_commands where polcmd in ('*', 'a'))
      )
    ),
  'The connected runtime role can SELECT/INSERT raw events and SELECT both caller-privilege reporting views under RLS.'
from table_state
cross join runtime_role;

-- These statements perform real permission checks without reading or returning rows.
do $verification$
begin
  perform * from reporting.platform_website_daily limit 0;
  perform * from reporting.moonarq_website_daily limit 0;
end
$verification$;

insert into verification_0009_checks values (
  'runtime_role_reporting_view_execution',
  true,
  'The connected runtime role executed zero-row reads against both reporting views.'
);

select check_name, passed, expectation
from verification_0009_checks
order by check_name;

do $verification$
begin
  if exists (select 1 from verification_0009_checks where not passed) then
    raise exception 'Post-0009 verification failed; review only the safe check results above.';
  end if;
end
$verification$;

rollback;
