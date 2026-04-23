# Data Model

Core tables are defined in `src/storage/db/migrations/0001_initial.sql`.

- `source_types`: connector metadata.
- `sources`: configured accounts/properties/projects/sites.
- `source_credentials`: encrypted per-source credentials.
- `sync_runs`: sync execution history.
- `source_locks`: source-level lock leases.
- `raw_ingestions`: raw connector payloads keyed by hash.
- `metrics_daily`: daily aggregate metric rows with dimensions hash.
- `content_items`: social/content records.
- `content_metrics`: daily content-level metrics.
- `web_events`: first-party website events.
- `metric_definitions`: metric catalog.
- `connector_events`: operational connector log.
