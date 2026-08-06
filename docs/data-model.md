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
- `web_events`: raw first-party Website Tracker and auxiliary Vercel Drain events.
- `metric_definitions`: metric catalog.
- `connector_events`: operational connector log.

## Website Event Contract v1 storage

Migration `0009_website_event_contract_v1.sql` extends and secures `web_events` without replacing existing row IDs or `created_at` values. Migration `0010_rebuild_authoritative_website_metrics.sql` performs the post-deploy first-party metric reconciliation:

- `event_id`: client event UUID; legacy rows are backfilled from the row `id`.
- `schema_version`: `1.0`, `legacy`, or `vercel.analytics.v2`.
- `event_source`: `first_party_tracker` or `vercel_drain`.
- `occurred_at`: when the event happened in the client/source; used for event-day aggregation.
- `received_at`: when Data Hub received the event; used for ingestion latency and replay checks.
- `attribution_context`, `consent_status`, and `client_context`: normalized JSON objects kept separate from event-specific `properties`.

The unique `(source_id, event_id)` index makes v1 retries idempotent. Lookup indexes cover source/occurrence time, source/receipt time, event name/time, session/time, and anonymous visitor/time. A duplicate delivery returns the stored event and does not increment metrics again.

`web_events` is an append-style raw observation store, not the place to resolve source authority. First-party page views remain stored alongside Vercel Drain observations; aggregation uses the [source-of-truth policy](website-event-contract-v1.md#source-of-truth-policy) to prevent double counting.

For the required expand/deploy/reconcile order, verification queries, and rollback cautions, see [Website Event Contract v1 migrations 0009 and 0010](source-data-verification.md#website-event-contract-v1-migrations-0009-and-0010).
