# Source Data Verification

MoonArq Data Hub stores collected platform data in the Data Hub runtime Supabase/Postgres database. That database is the durable system of record for collected events, sync payloads, raw ingestions, sync runs, metrics, reporting views, and generated daily reports. Metric authority still follows the per-source [source-of-truth policy](website-event-contract-v1.md#source-of-truth-policy).

This is separate from the monitored MoonArq Supabase project. The monitored MoonArq Supabase project is one source; the Data Hub database is where Data Hub stores its own records.

Data Hub data is split into data spaces:

- `moonarq` / `MoonArq`: existing company data, including MoonArq Website / Vercel, MoonArq Supabase, current reports, exports, syncs, and health.
- `auto-lab` / `Auto Lab`: personal car/content account testing space for future TikTok and Instagram sources.

Use the Data Hub UI first:

- `/w/moonarq/dashboard/data` for MoonArq read-only source data inspection.
- `/w/moonarq/dashboard/reports/daily` for MoonArq generated daily reports.
- `/w/moonarq/dashboard/health` for MoonArq connector events and source health.
- `/w/auto-lab/dashboard` to confirm Auto Lab is empty until its own sources are added.

If you need manual verification, use the Supabase SQL Editor on the Data Hub runtime project.

## Data Spaces

```sql
select
  id,
  slug,
  display_name,
  category,
  is_default,
  status
from data_spaces
order by is_default desc, display_name asc;
```

Expected seeded spaces:

- `moonarq`, display name `MoonArq`, category `business`, default `true`.
- `auto-lab`, display name `Auto Lab`, category `personal`, default `false`.

## Migration Count Checks

Record these counts before and after any production `pnpm db:migrate` run:

```sql
select 'sources' as table_name, count(*) from sources
union all select 'source_credentials', count(*) from source_credentials
union all select 'metrics_daily', count(*) from metrics_daily
union all select 'web_events', count(*) from web_events
union all select 'raw_ingestions', count(*) from raw_ingestions
union all select 'sync_runs', count(*) from sync_runs
union all select 'connector_events', count(*) from connector_events
union all select 'daily_report_runs', count(*) from daily_report_runs
order by table_name;
```

For migrations that only add schema, these counts should be unchanged. A migration may explicitly rebuild derived metrics; when it does, raw and source counts must remain unchanged while metric differences must reconcile to the documented source data.

## Website Event Contract v1 migrations 0009 and 0010

`0009_website_event_contract_v1.sql` is an expand migration. It adds event identity, contract/source versions, normalized contexts, receipt time, idempotency, lookup indexes, a legacy-write compatibility trigger, and server-only raw-table access controls. `0010_rebuild_authoritative_website_metrics.sql` is the post-deploy contract phase: it rebuilds first-party Website Tracker metrics from retained rows, including historical page views that older code may have excluded when Vercel Drain was primary.

Both migrations run inside the migration runner's transaction, so PostgreSQL retains their table locks until that transaction commits. `0009` first takes `SHARE ROW EXCLUSIVE`, then its first `ALTER TABLE` upgrades to `ACCESS EXCLUSIVE`; that blocks reads and writes to `web_events` while the columns are backfilled, constraints are validated, and non-concurrent indexes are built. `0010` takes `SHARE` on `web_events`, which permits reads but blocks event writes, and `SHARE ROW EXCLUSIVE` on `metrics_daily`, which permits reads but blocks metric writes from every connector while rollups are reconciled.

Both phases use a 10-second lock-acquisition timeout. The 15-minute statement timeout applies to each statement rather than the whole migration, so total lock duration can be longer. Measure each phase against production-like data first and run it in a low-traffic window. A lock timeout or any later statement failure rolls back the phase.

### Rollout order

1. Create and verify a database backup or provider restore point. Record the general counts above and the website-specific baseline below.
2. Configure `DATABASE_URL` through the normal server-side secret mechanism. Do not paste it into shell history, logs, screenshots, documentation, or a PR.
3. From the release commit, apply only the expand phase: `pnpm db:migrate -- --to 0009_website_event_contract_v1.sql`. The compatibility trigger keeps legacy application writes correctly classified during the short gap.
4. Run the 0009 phase-state, settled-cutoff preservation, schema, access, and index verification queries below. At this point the phase-state query must report `expand_applied = true` and `rebuild_applied = false`. Stop if settled raw-event counts changed, required values are missing, duplicates exist, access is broader than intended, or indexes are invalid.
5. Release the v1 application code through the normal deployment process. This repository task does not deploy.
6. Wait until the old application deployment can no longer receive traffic and all of its in-flight requests have exceeded the platform's maximum execution lifetime. This matters because an old instance can store a suppressed raw page view after a reconciliation that ran too early. Legacy client snippets do not need to disappear; the v1 server continues to accept them and updates metrics correctly.
7. Apply only the contract phase: `pnpm db:migrate -- --to 0010_rebuild_authoritative_website_metrics.sql`. Do not use a bare `pnpm db:migrate` for this staged release because it would also apply any unrelated migration added later.
8. Run the phase-state and all-six-metric reconciliation queries. The phase-state query must now report both values as true, and the reconciliation query must return no rows.
9. During rollout, monitor safe HTTP status counts for `/api/track`, especially 4xx, 429, and 5xx. Never log or inspect request bodies, public-key values, IP addresses, credential values, raw URLs, or raw referrers as part of monitoring.

### Executable 0009 release checks

Run `pnpm db:preflight:0009` with the same protected `DATABASE_URL` that would run the migration. The command opens a bounded, read-only transaction, requires the production migration history to be exactly 0001–0008, and computes the pending set with the same planner as `pnpm db:migrate`. It succeeds only when targeting 0009 would apply exactly `0009_website_event_contract_v1.sql`; a missing earlier migration is a hard stop rather than an implicit part of the rollout.

The preflight and migration commands reject Transaction Pooler connections (including port 6543) because transaction-scoped DDL and session behavior are not safe through that mode. Use a direct connection or Supabase Session Pooler on port 5432. Remote migrations also reject disabled or no-verify TLS. Because the existing application runtime retains its established Supabase connection behavior, migration and preflight commands separately require `DATABASE_SSL_CA` for a Supabase connection and pass it to the verified-TLS client branch. Inject `DATABASE_SSL_CA` ephemerally with `DATABASE_URL`; do not change the deployed runtime variables merely to run a migration. Never put the CA, connection URL, or credentials in Git or a command transcript.

The migration runner wraps every planned file and its `schema_migrations` insert in one transaction. Migration 0009 uses transaction-local `lock_timeout = '10s'` and `statement_timeout = '15min'`; PostgreSQL rolls back the entire phase if lock acquisition or any statement fails. The runner prints `Applied migration ...` only after the transaction commits. The phase-state query remains the authoritative database record.

Before 0009, run [`scripts/sql/capture-0009-website-event-baseline.sql`](../scripts/sql/capture-0009-website-event-baseline.sql) through a protected `psql` session with `baseline_cutoff` set to the saved UTC cutoff. The script returns only counts, occurrence bounds, and SHA-256 fingerprints; it hashes raw URLs, identifiers, dimensions, and keys inside PostgreSQL and never returns their values. Save the single result outside Git. Run the same file with the exact same cutoff after 0009 and require every returned value to match.

Never reuse an earlier release-readiness baseline. The previously observed change from 1,411 to 1,404 metric rows was expected live operational drift, not a code defect or a value to repair. After this patch is finalized, capture a fresh protected backup and fresh fixed-cutoff event and metric baseline immediately before the eventual production 0009 run, while no sync is in flight. This task's production-like backup is restore-test input only and is not a final production baseline.

After 0009, run [`scripts/sql/verify-0009-website-event-contract-v1.sql`](../scripts/sql/verify-0009-website-event-contract-v1.sql) using the exact runtime/migration role and pass the same saved cutoff as `-v baseline_cutoff='<SETTLED_BASELINE_CUTOFF_ISO>'`. PostgreSQL does not permit creating its session-local results table inside a read-only transaction, so the script uses a normal transaction, writes only to that temporary scratch table, never mutates a production object, and ends with `ROLLBACK`. It fails closed unless all of these are exact: migration phase, column types/defaults/nullability, validated CHECK expressions, compatibility function and trigger, fixed-cutoff deterministic backfills, source classification, scoped event-ID uniqueness, full index definitions and validity, direct/effective table and column ACLs, RLS policies, security-invoker view ACLs, runtime-role RLS compatibility, exact SELECT-only service-role grants on reporting dependencies, actual service-role view execution, and actual browser-role denial.

Finally, run [`scripts/sql/probe-0009-legacy-writes.sql`](../scripts/sql/probe-0009-legacy-writes.sql) using that same role. It requires the seeded Website and Vercel Drain source-type catalog entries and the MoonArq data space, but it does not require either source to be configured. Inside a named savepoint it creates two minimal disabled source fixtures with no credentials, keys, origins, URLs, webhook configuration, or metadata; inserts one old-shape event for each; and validates every 0009 default and source classification. It rolls the fixture savepoint back, proves the fixture source, event, credential, and metric rows are absent, and requires full source/event counts and fingerprints to match their before-state before the final outer `ROLLBACK`. `ON_ERROR_STOP` is mandatory; any SQL error, missing prerequisite, failed assertion, or missing rollback is a failed compatibility check. The probe must never be edited to commit.

Before applying 0009, choose a UTC cutoff older than the maximum request execution lifetime plus an operational buffer. This ensures all writes whose `created_at` precedes the cutoff have settled. Replace `<SETTLED_BASELINE_CUTOFF_ISO>` with that exact timestamp and save the timestamp and results outside the migration transaction. Reuse the same timestamp after 0009; do not recompute it.

```sql
with settings as (
  select '<SETTLED_BASELINE_CUTOFF_ISO>'::timestamptz as baseline_cutoff
)
select
  settings.baseline_cutoff,
  count(events.id) as settled_web_event_count,
  count(events.id) filter (where events.event_name = 'page_view') as settled_page_view_count,
  min(events.occurred_at) as first_occurred_at,
  max(events.occurred_at) as last_occurred_at
from settings
left join web_events events on events.created_at < settings.baseline_cutoff
group by settings.baseline_cutoff;

select
  s.source_type_key,
  m.metric_key,
  count(*) as metric_row_count,
  sum(m.metric_value) as metric_value_sum
from metrics_daily m
join sources s on s.id = m.source_id
where s.source_type_key in ('website', 'vercel_web_analytics_drain')
  and m.metric_key in (
    'page_views',
    'unique_visitors',
    'sessions',
    'custom_events',
    'events_by_path',
    'events_by_referrer'
  )
group by s.source_type_key, m.metric_key
order by s.source_type_key, m.metric_key;
```

Confirm the staged migration state. Run this after each phase:

```sql
select
  exists (
    select 1 from schema_migrations
    where filename = '0009_website_event_contract_v1.sql'
  ) as expand_applied,
  exists (
    select 1 from schema_migrations
    where filename = '0010_rebuild_authoritative_website_metrics.sql'
  ) as rebuild_applied;
```

After 0009, verify the settled baseline is preserved by rerunning the first baseline query with the exact saved cutoff. `settled_web_event_count`, `settled_page_view_count`, and the occurrence bounds must equal the saved values. Events received after the cutoff are intentionally excluded from this equality check and remain available in the table.

Confirm the required columns were backfilled for every row visible after 0009:

```sql
select
  count(*) as current_web_event_count,
  count(*) filter (where event_id is null) as missing_event_id,
  count(*) filter (where schema_version is null) as missing_schema_version,
  count(*) filter (where event_source is null) as missing_event_source,
  count(*) filter (where received_at is null) as missing_received_at
from web_events;

select schema_version, event_source, count(*)
from web_events
group by schema_version, event_source
order by schema_version, event_source;
```

All `missing_*` values must be zero. Existing first-party rows should be `legacy`/`first_party_tracker`; existing Drain rows should be `vercel.analytics.v2`/`vercel_drain`. New tracker rows should be `1.0`/`first_party_tracker`.

Confirm idempotency and indexes:

```sql
select source_id, event_id, count(*)
from web_events
group by source_id, event_id
having count(*) > 1;

select
  index_class.relname as index_name,
  index_state.indisvalid,
  index_state.indisunique,
  index_state.indnullsnotdistinct,
  pg_get_indexdef(index_state.indexrelid) as index_definition
from pg_index index_state
join pg_class table_class on table_class.oid = index_state.indrelid
join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
join pg_class index_class on index_class.oid = index_state.indexrelid
where table_namespace.nspname = 'public'
  and table_class.relname = 'web_events'
  and index_class.relname in (
    'idx_web_events_source_time',
    'idx_web_events_source_event_id',
    'idx_web_events_event_time',
    'idx_web_events_session_time',
    'idx_web_events_anonymous_time',
    'idx_web_events_source_received_time'
  )
order by index_class.relname;
```

The duplicate query must return no rows and all six indexes must be listed with `indisvalid = true`. `idx_web_events_source_event_id` must also have `indisunique = true`, `indnullsnotdistinct = false`, and the definition `(source_id, event_id)`. Ingestion always resolves a non-null source; keeping PostgreSQL's normal null-distinct behavior also preserves `ON DELETE SET NULL` for retained events when two deleted sources happened to reuse the same client event UUID.

Confirm browser-facing roles cannot read raw events, the service-role policy is exact when that role exists, and both reporting views use caller privileges:

```sql
select relrowsecurity
from pg_class
where oid = 'public.web_events'::regclass;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'web_events'
order by policyname;

select
  coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
  expanded_acl.privilege_type,
  expanded_acl.is_grantable
from pg_class table_class
cross join lateral aclexplode(
  coalesce(table_class.relacl, acldefault('r', table_class.relowner))
) expanded_acl
left join pg_roles grantee_role on grantee_role.oid = expanded_acl.grantee
where table_class.oid = 'public.web_events'::regclass
  and (
    expanded_acl.grantee = 0
    or grantee_role.rolname in ('anon', 'authenticated', 'service_role')
  )
order by grantee, expanded_acl.privilege_type;

select
  roles.rolname,
  has_table_privilege(roles.rolname, 'public.web_events', 'SELECT') as can_select,
  has_table_privilege(roles.rolname, 'public.web_events', 'INSERT') as can_insert,
  has_table_privilege(roles.rolname, 'public.web_events', 'UPDATE') as can_update,
  has_table_privilege(roles.rolname, 'public.web_events', 'DELETE') as can_delete,
  has_table_privilege(roles.rolname, 'public.web_events', 'TRUNCATE') as can_truncate,
  has_table_privilege(roles.rolname, 'public.web_events', 'REFERENCES') as can_reference,
  has_table_privilege(roles.rolname, 'public.web_events', 'TRIGGER') as can_trigger
from pg_roles roles
where roles.rolname in ('anon', 'authenticated', 'service_role')
order by roles.rolname;

select table_class.relname as view_name, table_class.reloptions
from pg_class table_class
join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
where table_namespace.nspname = 'reporting'
  and table_class.relname in ('platform_website_daily', 'moonarq_website_daily')
order by table_class.relname;

select
  table_class.relname as view_name,
  coalesce(grantee_role.rolname, 'PUBLIC') as grantee,
  expanded_acl.privilege_type,
  expanded_acl.is_grantable
from pg_class table_class
join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
cross join lateral aclexplode(
  coalesce(table_class.relacl, acldefault('r', table_class.relowner))
) expanded_acl
left join pg_roles grantee_role on grantee_role.oid = expanded_acl.grantee
where table_namespace.nspname = 'reporting'
  and table_class.relname in ('platform_website_daily', 'moonarq_website_daily')
  and (
    expanded_acl.grantee = 0
    or grantee_role.rolname in ('anon', 'authenticated', 'service_role')
  )
order by table_class.relname, grantee, expanded_acl.privilege_type;

select
  roles.rolname,
  has_table_privilege(
    roles.rolname,
    'reporting.platform_website_daily',
    'SELECT'
  ) as can_select_platform_view,
  has_table_privilege(
    roles.rolname,
    'reporting.moonarq_website_daily',
    'SELECT'
  ) as can_select_moonarq_view
from pg_roles roles
where roles.rolname in ('anon', 'authenticated', 'service_role')
order by roles.rolname;

select
  table_class.relname as dependency,
  has_table_privilege('service_role', table_class.oid, 'SELECT') as can_select,
  has_table_privilege(
    'service_role',
    table_class.oid,
    'SELECT WITH GRANT OPTION'
  ) as can_grant_select,
  has_table_privilege('service_role', table_class.oid, 'INSERT') as can_insert,
  has_table_privilege('service_role', table_class.oid, 'UPDATE') as can_update,
  has_table_privilege('service_role', table_class.oid, 'DELETE') as can_delete,
  has_table_privilege('service_role', table_class.oid, 'TRUNCATE') as can_truncate,
  has_table_privilege('service_role', table_class.oid, 'REFERENCES') as can_reference,
  has_table_privilege('service_role', table_class.oid, 'TRIGGER') as can_trigger,
  has_table_privilege('service_role', table_class.oid, 'MAINTAIN') as can_maintain
from pg_class table_class
join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
where table_namespace.nspname = 'public'
  and table_class.relname in ('sources', 'data_spaces', 'metrics_daily')
order by table_class.relname;
```

`relrowsecurity` must be true. If `service_role` exists, `pg_policies` must include exactly `web_events_service_role_select` (`SELECT`, `qual = true`) and `web_events_service_role_insert` (`INSERT`, `with_check = true`) for it; an environment without that role should not list those policies. Any additional policy requires explicit review. `PUBLIC`, `anon`, and `authenticated` must have no raw-table or website-view ACL rows, and the effective-privilege checks for `anon` and `authenticated` must all be false. When `service_role` exists, it must have only non-grantable `SELECT`/`INSERT` on `web_events`, only non-grantable `SELECT` on `sources`, `data_spaces`, `metrics_daily`, and both reporting views, and no effective write, maintenance, trigger, reference, column-level write, or grant-option privilege beyond raw-event `INSERT`. The executable verifier uses `SET LOCAL ROLE service_role` to run both security-invoker views and `SET LOCAL ROLE anon`/`authenticated` to prove both browser roles are denied raw-event and reporting-view reads. Both views' `reloptions` must include `security_invoker=true`. Never expose a service-role key to a browser.

After 0010, reconcile all six first-party metric families against raw events. The query hashes path/referrer dimensions before returning them so verification output does not reveal raw URLs. Differences from the pre-migration derived metrics are expected only when previously retained events are now included by the authoritative first-party policy; the post-migration query itself must return no rows.

```sql
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
), daily_rollups as (
  select
    source_id,
    metric_date,
    count(*) filter (where event_name = 'page_view')::numeric as page_views,
    count(*) filter (where event_name <> 'page_view')::numeric as custom_events,
    count(distinct anonymous_id)::numeric as unique_visitors,
    count(distinct session_id)::numeric as sessions
  from tracker_events
  group by source_id, metric_date
), path_rollups as (
  select source_id, metric_date, path, count(*)::numeric as metric_value
  from tracker_events
  group by source_id, metric_date, path
), referrer_rollups as (
  select source_id, metric_date, referrer, count(*)::numeric as metric_value
  from tracker_events
  group by source_id, metric_date, referrer
), expected_metrics as (
  select
    daily.source_id,
    daily.metric_date,
    metric.metric_key,
    metric.metric_value,
    '{"rollup":"daily"}'::jsonb as dimensions,
    encode(digest('{"rollup":"daily"}', 'sha256'), 'hex') as dimensions_hash
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
    encode(digest('{"path":' || to_json(path.path)::text || '}', 'sha256'), 'hex')
  from path_rollups path

  union all

  select
    referrer.source_id,
    referrer.metric_date,
    'events_by_referrer'::text,
    referrer.metric_value,
    jsonb_build_object('referrer', referrer.referrer),
    encode(digest('{"referrer":' || to_json(referrer.referrer)::text || '}', 'sha256'), 'hex')
  from referrer_rollups referrer
), actual_metrics as (
  select
    m.source_id,
    m.date as metric_date,
    m.metric_key,
    m.metric_value,
    m.dimensions,
    m.dimensions_hash
  from metrics_daily m
  join sources s on s.id = m.source_id
  where s.source_type_key = 'website'
    and (
      (m.metric_key in ('page_views', 'unique_visitors', 'sessions', 'custom_events')
        and m.dimensions = '{"rollup":"daily"}'::jsonb)
      or (m.metric_key = 'events_by_path'
        and m.dimensions = jsonb_build_object('path', m.dimensions -> 'path'))
      or (m.metric_key = 'events_by_referrer'
        and m.dimensions = jsonb_build_object('referrer', m.dimensions -> 'referrer'))
    )
)
select
  coalesce(expected.source_id, actual.source_id) as source_id,
  coalesce(expected.metric_date, actual.metric_date) as metric_date,
  coalesce(expected.metric_key, actual.metric_key) as metric_key,
  encode(
    digest(coalesce(expected.dimensions, actual.dimensions)::text, 'sha256'),
    'hex'
  ) as dimensions_fingerprint,
  expected.metric_value as expected_value,
  actual.metric_value as actual_value,
  expected.dimensions_hash as expected_dimensions_hash,
  actual.dimensions_hash as actual_dimensions_hash
from expected_metrics expected
full join actual_metrics actual
  on actual.source_id = expected.source_id
  and actual.metric_date = expected.metric_date
  and actual.metric_key = expected.metric_key
  and actual.dimensions = expected.dimensions
where expected.metric_key is null
  or actual.metric_key is null
  or actual.metric_value is distinct from expected.metric_value
  or actual.dimensions_hash is distinct from expected.dimensions_hash
order by source_id, metric_date, metric_key, dimensions_fingerprint;
```

No rows should be returned. Any row is a rollout stop condition and requires a separately reviewed forward repair before metrics are trusted.

There is no automated down migration. Because 0009 backfills and secures rows and 0010 replaces derived website rollups, rollback is not equivalent to dropping columns or deleting `schema_migrations` rows. If rollback is required after application code begins using v1, stop writes, preserve the failed-state database, restore the verified backup or execute a separately reviewed forward repair, and run the reconciliation queries again.

## Source Assignment

All existing production sources should be assigned to the MoonArq data space by the migration. Do not duplicate or delete sources.

```sql
select
  s.id,
  s.display_name,
  s.source_type_key,
  ds.slug as data_space_slug
from sources s
join data_spaces ds on ds.id = s.data_space_id
order by s.display_name;
```

Check the current MoonArq source ids stay unchanged:

```sql
select
  s.id,
  s.display_name,
  s.source_type_key,
  ds.slug as data_space_slug,
  s.status,
  s.webhook_url
from sources s
join data_spaces ds on ds.id = s.data_space_id
where s.display_name in ('MoonArq Website / Vercel', 'MoonArq Supabase')
order by s.display_name;
```

Auto Lab should have no sources until an Auto Lab source is intentionally added:

```sql
select
  s.id,
  s.display_name,
  s.source_type_key
from sources s
join data_spaces ds on ds.id = s.data_space_id
where ds.slug = 'auto-lab'
order by s.display_name;
```

## Recent Raw Ingestions

```sql
select
  fetched_at,
  source_type_key,
  external_id,
  payload_hash,
  status
from raw_ingestions
join sources on sources.id = raw_ingestions.source_id
join data_spaces on data_spaces.id = sources.data_space_id
where data_spaces.slug = 'moonarq'
order by fetched_at desc
limit 100;
```

## Website Events

Both first-party and auxiliary Drain rows are expected. Verify their contract/source version and compare event time with server receipt time without selecting raw payloads or credential data:

```sql
select
  event_id,
  schema_version,
  event_source,
  occurred_at,
  received_at,
  event_name,
  path,
  country,
  device_type
from web_events
join sources on sources.id = web_events.source_id
join data_spaces on data_spaces.id = sources.data_space_id
where data_spaces.slug = 'moonarq'
order by occurred_at desc
limit 100;
```

## Daily Metrics

```sql
select
  date,
  source_type_key,
  metric_key,
  metric_value,
  dimensions
from metrics_daily
join sources on sources.id = metrics_daily.source_id
join data_spaces on data_spaces.id = sources.data_space_id
where data_spaces.slug = 'moonarq'
order by date desc, source_type_key, metric_key
limit 200;
```

## Sync Runs

```sql
select
  created_at,
  started_at,
  finished_at,
  source_type_key,
  trigger,
  status,
  records_fetched,
  metrics_upserted,
  error_message
from sync_runs
join sources on sources.id = sync_runs.source_id
join data_spaces on data_spaces.id = sources.data_space_id
where data_spaces.slug = 'moonarq'
order by created_at desc
limit 100;
```

## Auto Lab Instagram

Auto Lab Instagram uses official Meta Graph API OAuth and is scoped to `auto-lab` only. Verify source placement and connection status without reading credential values:

```sql
select
  s.id,
  s.display_name,
  s.source_type_key,
  s.status,
  s.external_account_id,
  s.account_name,
  ds.slug as data_space_slug
from sources s
join data_spaces ds on ds.id = s.data_space_id
where s.id = '29f678e5-820c-4de7-a128-0e56654fc51a';
```

Expected account fields after OAuth:

- `data_space_slug = 'auto-lab'`
- `source_type_key = 'instagram'`
- `external_account_id = '17841471505463499'`
- `account_name = 'just.4is'`

Verify stored credential field names only; never select `encrypted_value`, token values, or secrets:

```sql
select
  field_key,
  value_hint,
  updated_at
from source_credentials
where source_id = '29f678e5-820c-4de7-a128-0e56654fc51a'
order by field_key;
```

Verify Auto Lab Instagram metrics without mixing MoonArq rows:

```sql
select
  m.date,
  m.metric_key,
  m.metric_value,
  m.dimensions
from metrics_daily m
join sources s on s.id = m.source_id
join data_spaces ds on ds.id = s.data_space_id
where ds.slug = 'auto-lab'
  and s.source_type_key = 'instagram'
order by m.date desc, m.metric_key
limit 100;
```

## TikTok

TikTok uses official TikTok Login Kit OAuth and TikTok API v2. Auto Lab continues to use the default `TIKTOK_*` app profile for source id `dfb2d0d1-471e-4905-9a8a-1875a39e66b5`. MoonArq TikTok uses `MOONARQ_TIKTOK_*` when those env vars are configured, including sandbox credentials while the production app is in review; otherwise it falls back to the default profile.

Every TikTok read should join through `sources` and `data_spaces`; never verify TikTok rows without a `data_space_slug` predicate.

Verify source placement and connection status without reading credential values:

```sql
select
  s.id,
  s.display_name,
  s.source_type_key,
  s.status,
  s.external_account_id,
  s.account_name,
  ds.slug as data_space_slug,
  s.metadata->>'oauth_connected' as oauth_connected
from sources s
join data_spaces ds on ds.id = s.data_space_id
where s.id = 'dfb2d0d1-471e-4905-9a8a-1875a39e66b5';
```

Expected fields after Auto Lab OAuth:

- `data_space_slug = 'auto-lab'`
- `source_type_key = 'tiktok'`
- `status = 'healthy'`
- `external_account_id` stores the TikTok `open_id` returned for this app.

For MoonArq TikTok, filter by `ds.slug = 'moonarq'` and `s.display_name = 'MoonArq TikTok'`; do not use the Auto Lab source id.

Verify stored credential field names only; never select `encrypted_value`, token values, or secrets:

```sql
select
  field_key,
  value_hint,
  updated_at
from source_credentials
where source_id = 'dfb2d0d1-471e-4905-9a8a-1875a39e66b5'
order by field_key;
```

Expected credential field names include:

- `tiktok_access_token`
- `tiktok_refresh_token`
- `open_id`
- `scope`
- `expires_at`
- `refresh_expires_at`

Verify Auto Lab TikTok metrics without mixing MoonArq rows:

```sql
select
  m.date,
  m.metric_key,
  m.metric_value,
  m.dimensions
from metrics_daily m
join sources s on s.id = m.source_id
join data_spaces ds on ds.id = s.data_space_id
where ds.slug = 'auto-lab'
  and s.source_type_key = 'tiktok'
order by m.date desc, m.metric_key
limit 100;
```

Verify MoonArq TikTok metrics without mixing Auto Lab rows by changing the predicate:

```sql
where ds.slug = 'moonarq'
  and s.source_type_key = 'tiktok'
```

Expected metric keys after a successful TikTok sync:

- `tiktok_video_views`
- `tiktok_likes`
- `tiktok_comments`
- `tiktok_shares`
- `tiktok_engagement_rate`
- `tiktok_followers` when `user.info.stats` is granted
- `tiktok_video_count` when `user.info.stats` is granted

Verify TikTok content rows:

```sql
select
  c.external_content_id,
  c.title,
  c.caption,
  c.url,
  c.published_at
from content_items c
join sources s on s.id = c.source_id
join data_spaces ds on ds.id = s.data_space_id
where ds.slug = 'auto-lab'
  and s.source_type_key = 'tiktok'
order by c.published_at desc nulls last, c.created_at desc
limit 100;
```

For cross-space leakage checks, run both the Auto Lab and MoonArq queries and confirm source ids never appear in the opposite data space.

## Reporting Views

```sql
select * from reporting.moonarq_website_daily order by date_pt desc limit 30;
select * from reporting.moonarq_supabase_daily order by date_pt desc limit 30;
select * from reporting.platform_website_daily where data_space_slug = 'moonarq' order by date_pt desc limit 30;
select * from reporting.platform_supabase_daily where data_space_slug = 'moonarq' order by date_pt desc limit 30;
select * from reporting.platform_website_daily where data_space_slug = 'auto-lab' order by date_pt desc limit 30;
select * from reporting.platform_supabase_daily where data_space_slug = 'auto-lab' order by date_pt desc limit 30;
```

Generic reporting views include:

- `data_space_id`
- `data_space_slug`
- `data_space_name`

## Change Ledger

```sql
select
  changed_at,
  changed_at_pt,
  source_type_key,
  platform_record_type,
  external_record_id,
  change_type,
  previous_hash,
  new_hash,
  changed_fields
from platform_change_events
join sources on sources.id = platform_change_events.source_id
join data_spaces on data_spaces.id = sources.data_space_id
where data_spaces.slug = 'moonarq'
order by changed_at desc
limit 100;
```

## Cross-Space Leakage Checks

MoonArq data should not appear in Auto Lab views:

```sql
select count(*) as moonarq_named_sources_in_auto_lab
from sources s
join data_spaces ds on ds.id = s.data_space_id
where ds.slug = 'auto-lab'
  and s.display_name in ('MoonArq Website / Vercel', 'MoonArq Supabase');
```

Auto Lab data should not appear in MoonArq views:

```sql
select count(*) as auto_lab_named_sources_in_moonarq
from sources s
join data_spaces ds on ds.id = s.data_space_id
where ds.slug = 'moonarq'
  and s.display_name in ('Auto Lab TikTok', 'Auto Lab Instagram');
```

Auto Lab TikTok and Instagram data should not appear in MoonArq metrics or content:

```sql
select count(*) as auto_lab_social_metrics_in_moonarq
from metrics_daily m
join sources s on s.id = m.source_id
join data_spaces ds on ds.id = s.data_space_id
where ds.slug = 'moonarq'
  and s.id in (
    'dfb2d0d1-471e-4905-9a8a-1875a39e66b5',
    '29f678e5-820c-4de7-a128-0e56654fc51a'
  );
```

Rows with `null` source ids are intentionally excluded from data-space-specific explorer, health, sync center, and report views unless a future migration adds a safe explicit data-space mapping.

## Daily Reports

Daily report runs are scoped directly by `daily_report_runs.data_space_id`.

```sql
select
  r.report_date,
  ds.slug as data_space_slug,
  r.status,
  r.source_count,
  r.health_status,
  r.generated_at_pt
from daily_report_runs r
join data_spaces ds on ds.id = r.data_space_id
order by r.report_date desc, ds.slug asc
limit 60;
```

## Warnings

- Do not edit rows manually unless you are intentionally debugging.
- Do not query `source_credentials` except to verify row existence.
- Never expose `service_role_key`, `encrypted_value`, drain secrets, API tokens, or credential values.
- Supabase Table Editor and SQL Editor are verification tools, not the primary Data Hub UI.
- Excel exports are manual, authenticated downloads. They are not the database and should not be shared publicly.
