# Source Data Verification

MoonArq Data Hub stores collected platform data in the Data Hub runtime Supabase/Postgres database. That database is the source of truth for Vercel Drain events, Supabase sync payloads, raw ingestions, sync runs, metrics, reporting views, and generated daily reports.

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

Record these counts before and after running `pnpm db:migrate` for the data spaces migration:

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

After migration, source count and credential count should be unchanged. Historical metric, event, raw ingestion, sync run, connector event, and daily report counts should also be unchanged.

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

```sql
select
  occurred_at,
  event_name,
  path,
  referrer,
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
