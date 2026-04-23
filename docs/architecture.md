# Architecture

MoonArq Data Command Center is an extensible source-monitoring base, not a one-off dashboard.

## Two Separate Concerns

### 1. Monitored MoonArq sources

- MoonArq Website / Vercel
- MoonArq Supabase
- future MoonArq social, commerce, and custom sources

### 2. The Data Hub app's own runtime/storage

- where this app runs
- where this app stores sources, credentials, sync runs, raw ingestions, web events, and metrics
- where snippets and webhook endpoints are served from

## Collection Layer

`src/collection` contains source onboarding concepts, connector registry, platform connectors, sync triggers, Vercel Drain ingestion, and first-party tracking.

## Storage Layer

`src/storage` contains the app runtime schema, migrations, repositories, encrypted credential handling, raw ingestions, sync runs, locks, source configs, events, and demo seed data.

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

## Website Ingestion Modes

MoonArq Website / Vercel can use one of two ingestion modes:

1. `vercel_web_analytics_drain`
   official Vercel Web Analytics Drain payloads delivered to the Data Hub app.
2. `website`
   first-party Website Tracker fallback/helper events sent to `/api/track`.

The dashboard chooses one primary website source module and avoids double counting by preferring the active Vercel Drain source when both are configured.
