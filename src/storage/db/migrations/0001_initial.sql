create extension if not exists pgcrypto;

create table if not exists source_types (
  key text primary key,
  display_name text not null,
  description text not null,
  category text not null,
  icon text null,
  url_patterns jsonb not null default '[]',
  required_fields jsonb not null default '[]',
  optional_fields jsonb not null default '[]',
  supported_metrics jsonb not null default '[]',
  auth_type text not null,
  docs_url text null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  source_type_key text not null references source_types(key),
  display_name text not null,
  input_url text null,
  normalized_url text null,
  external_account_id text null,
  account_name text null,
  status text not null default 'needs_credentials',
  sync_mode text not null default 'hybrid',
  sync_frequency_minutes integer not null default 60,
  supports_webhook boolean not null default false,
  webhook_url text null,
  webhook_secret_hint text null,
  last_manual_sync_at timestamptz null,
  last_cron_sync_at timestamptz null,
  last_webhook_sync_at timestamptz null,
  last_success_at timestamptz null,
  last_error_at timestamptz null,
  last_error text null,
  next_sync_at timestamptz null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists source_credentials (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  field_key text not null,
  encrypted_value text not null,
  iv text not null,
  auth_tag text not null,
  value_hint text null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, field_key)
);

create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid null references sources(id) on delete set null,
  source_type_key text null,
  trigger text not null,
  status text not null,
  idempotency_key text unique null,
  lock_key text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  duration_ms integer null,
  records_fetched integer not null default 0,
  records_inserted integer not null default 0,
  records_updated integer not null default 0,
  metrics_upserted integer not null default 0,
  error_message text null,
  error_stack text null,
  cursor_before jsonb null,
  cursor_after jsonb null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists source_locks (
  source_id uuid primary key references sources(id) on delete cascade,
  locked_by_sync_run_id uuid not null references sync_runs(id) on delete cascade,
  lock_key text not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists raw_ingestions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid null references sources(id) on delete set null,
  source_type_key text not null,
  external_id text null,
  fetched_at timestamptz not null,
  payload jsonb not null,
  payload_hash text not null,
  status text not null,
  cursor jsonb null,
  created_at timestamptz not null default now(),
  unique(source_id, payload_hash)
);

create table if not exists metrics_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  source_id uuid null references sources(id) on delete set null,
  source_type_key text not null,
  metric_key text not null,
  metric_value numeric not null,
  unit text not null,
  dimensions jsonb not null default '{}',
  dimensions_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(date, source_id, metric_key, dimensions_hash)
);

create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  source_type_key text not null,
  external_content_id text not null,
  content_type text not null,
  title text null,
  caption text null,
  url text null,
  thumbnail_url text null,
  published_at timestamptz null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, external_content_id)
);

create table if not exists content_metrics (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  content_item_id uuid not null references content_items(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  source_type_key text not null,
  metric_key text not null,
  metric_value numeric not null,
  unit text not null,
  dimensions jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(date, content_item_id, metric_key)
);

create table if not exists web_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid null references sources(id) on delete set null,
  public_tracking_key text null,
  anonymous_id text not null,
  session_id text not null,
  user_id text null,
  event_name text not null,
  path text not null,
  url text not null,
  referrer text null,
  user_agent text null,
  ip_hash text null,
  country text null,
  device_type text null,
  properties jsonb not null default '{}',
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists metric_definitions (
  key text primary key,
  display_name text not null,
  description text not null,
  source_type_key text null,
  category text not null,
  unit text not null,
  higher_is_better boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists connector_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid null references sources(id) on delete set null,
  event_type text not null,
  severity text not null,
  message text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_sources_due on sources(status, next_sync_at);
create index if not exists idx_sync_runs_source_created on sync_runs(source_id, created_at desc);
create index if not exists idx_metrics_daily_metric_date on metrics_daily(metric_key, date);
create index if not exists idx_web_events_source_time on web_events(source_id, occurred_at desc);
create index if not exists idx_web_events_key_time on web_events(public_tracking_key, occurred_at desc);
create index if not exists idx_connector_events_source_time on connector_events(source_id, created_at desc);
