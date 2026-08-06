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

## Website Event Ingestion

MoonArq Website / Vercel retains two complementary event streams:

1. `vercel_web_analytics_drain`
   official Vercel Web Analytics Drain payloads used as auxiliary infrastructure and request-level evidence.
2. `website`
   versioned first-party Website Event Contract events sent to `/api/track`.

The first-party tracker is authoritative for funnel behavior, pseudonymous identity, sessions, and attribution. Vercel Drain is not a replacement for that browser context. Both streams are retained in `web_events` with an explicit `event_source`; first-party `page_view` rows are never suppressed because Drain exists. Aggregation chooses the authoritative stream for a metric instead of deleting raw evidence or summing overlaps.

```txt
Website Event Contract v1 or legacy payload
  -> validate JSON, size, fields, timestamp, source/key, and origin
  -> apply source/client abuse limit
  -> normalize legacy or v1 event
  -> insert web_events on conflict (source_id, event_id) do nothing
  -> increment first-party metrics only after a new insert
```

`occurred_at` records client event time and drives event-day aggregation. `received_at` records server receipt time for latency and replay checks. The full contract and privacy policy are in [Website Event Contract v1](website-event-contract-v1.md).

## Metric Source Roles

- First-party MoonArq tracker: authoritative funnel, identity, session, and attribution source.
- Vercel Drain: auxiliary infrastructure and request-level source.
- Shopify: authoritative commerce source.
- Meta: authoritative paid media delivery and spend source.

These roles govern aggregation, not raw retention. Source-specific metrics may coexist, but overlapping observations must not be combined into one logical total.
