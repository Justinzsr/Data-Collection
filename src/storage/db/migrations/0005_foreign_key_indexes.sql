create index if not exists idx_content_metrics_content_item
  on content_metrics (content_item_id);

create index if not exists idx_content_metrics_source
  on content_metrics (source_id);

create index if not exists idx_metrics_daily_source
  on metrics_daily (source_id);

create index if not exists idx_source_locks_sync_run
  on source_locks (locked_by_sync_run_id);

create index if not exists idx_sources_source_type
  on sources (source_type_key);
