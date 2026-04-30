# Source Data Verification

MoonArq Data Hub stores collected platform data in the Data Hub runtime Supabase/Postgres database. That database is the source of truth for Vercel Drain events, Supabase sync payloads, raw ingestions, sync runs, metrics, reporting views, and generated daily reports.

This is separate from the monitored MoonArq Supabase project. The monitored MoonArq Supabase project is one source; the Data Hub database is where Data Hub stores its own records.

Use the Data Hub UI first:

- `/dashboard/data` for safe read-only source data inspection.
- `/dashboard/reports/daily` for generated daily reports.
- `/dashboard/health` for connector events and source health.

If you need manual verification, use the Supabase SQL Editor on the Data Hub runtime project.

## Recent Raw Ingestions

```sql
select
  fetched_at,
  source_type_key,
  external_id,
  payload_hash,
  status
from raw_ingestions
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
order by created_at desc
limit 100;
```

## Reporting Views

```sql
select * from reporting.moonarq_website_daily order by date_pt desc limit 30;
select * from reporting.moonarq_supabase_daily order by date_pt desc limit 30;
```

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
order by changed_at desc
limit 100;
```

## Warnings

- Do not edit rows manually unless you are intentionally debugging.
- Do not query `source_credentials` except to verify row existence.
- Never expose `service_role_key`, `encrypted_value`, drain secrets, API tokens, or credential values.
- Supabase Table Editor and SQL Editor are verification tools, not the primary Data Hub UI.
- Excel exports are manual, authenticated downloads. They are not the database and should not be shared publicly.
