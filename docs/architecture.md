# Architecture

MoonArq is an extensible data collection base, not a one-off dashboard.

## Collection Layer

`src/collection` contains source onboarding concepts, connector registry, platform connectors, sync triggers, and first-party tracking.

## Storage Layer

`src/storage` contains Supabase-targeted schema, migrations, repositories, encrypted credential handling, raw ingestions, sync runs, locks, source configs, events, and demo seed data.

## Aggregation Layer

`src/aggregation` contains metric definitions, normalizers, summary queries, timeseries queries, content services, commerce placeholders, and health services.

## Presentation Layer

`src/presentation` contains reusable dashboard UI, charts, layout, source onboarding wizard, and responsive interaction components. App Router pages live in `src/app`.

## Trigger Flow

```txt
webhook/manual/cron/initial
  -> enqueueSyncRun
  -> createSyncRun
  -> acquireSourceLock
  -> connector.sync
  -> storeRawPayloads
  -> connector.normalize
  -> upsertMetrics
  -> releaseSourceLock
  -> recordConnectorEvent
```
