# MoonArq Data Command Center

MoonArq Data Command Center monitors MoonArq's existing sources first:

- MoonArq Website / Vercel (`moonarqstudio.com`)
- MoonArq Supabase
- future MoonArq social, commerce, and custom sources

This app is not just a generic dashboard template. It is a source-first command center with two separate concerns:

1. Monitored MoonArq sources:
   the website/Vercel analytics path, Supabase signups/users, and future MoonArq source systems.
2. The Data Hub app's own runtime/storage:
   where this app runs, stores credentials, writes sync runs, persists raw ingestions/web events, and serves snippets/webhooks.

## Four Layers

- Collection Layer / 采集层: `src/collection`
  Source onboarding, connector registry, platform connectors, webhooks, scheduled sync, manual sync, and website tracking.
- Storage Layer / 存储层: `src/storage`
  Postgres schema, migrations, repositories, encrypted credentials, raw ingestions, sync runs, source configs, locks, runtime config, and demo data.
- Aggregation Layer / 聚合层: `src/aggregation`
  Normalizers, metric definitions, idempotent metric upserts, summary services, timeseries services, content, commerce, and health services.
- Presentation Layer / 展示层: `src/presentation`
  Dashboard UI, source management, add-source wizard, sync center, event dashboard, charts, tables, cards, responsive layout, motion, and theme.

## Local Setup

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://127.0.0.1:3100`.

Demo mode works without real credentials when `DATABASE_URL` is missing. When `DATABASE_URL` is configured, repositories switch to real Postgres-backed persistence automatically.

Keep `DEV_AUTH_BYPASS=true` locally. Set it to `false` before deployment.

## Demo Mode

When `DATABASE_URL` is missing, the app seeds in-memory demo data for MoonArq website traffic, unique visitors, sessions, custom events, Supabase signups/users, source health, sync runs, content placeholders, and future source placeholders.

```bash
pnpm db:seed
```

When `DATABASE_URL` is configured, `pnpm db:seed` seeds the runtime catalog tables (`source_types`, `metric_definitions`) for the real app database.

## Add A Source

Go to `/dashboard/sources/new`, paste a link, and the app detects likely monitored source:

- `https://moonarqstudio.com`
- `https://xxxxx.supabase.co`
- `https://vercel.com/team/project`
- `https://your-store.myshopify.com`

Links identify the source. Private metrics still require the right ingestion path: Vercel Drain, Website Tracker, service role key, webhook secret, or another official API credential.

## Credentials

Credentials are per-source, encrypted with AES-256-GCM, and stored server-side. Saved values are never shown again; the UI only displays masked hints.

## MoonArq Supabase Setup

MoonArq Supabase is a monitored source. It is not the same thing as the Data Hub app's own storage/auth runtime.

The Supabase source connector supports:

- server-side Auth admin mode with an encrypted `service_role_key`
- optional `public.profiles` webhook mode

`auth.users` is not available through normal public APIs. Use the SQL setup instructions in the source detail UI to mirror signups into `public.profiles` when you want the event-driven path.

## MoonArq Website / Vercel

The website module supports two ingestion modes:

1. `vercel_web_analytics_drain`
   the official Vercel Web Analytics Drain path for the existing MoonArq Vercel project.
2. `website`
   the first-party Website Tracker fallback/helper path.

Only one of these should be treated as the primary live website ingestion mode at a time to avoid double counting.

### Vercel Drain

After saving the source in Drain mode, the source detail page shows the endpoint in this form:

`{PUBLIC_APP_URL}/api/webhooks/vercel/analytics-drain/{sourceId}`

If you set a Signature Verification Secret in Vercel, save the same value as the encrypted `drain_signature_secret` for that source.

### Website Tracker

Use `/dashboard/events` to copy the lightweight JavaScript snippet or the React/Next helper with `usePageViewTracking()` and `trackEvent(name, properties)`. The tracker posts to `POST /api/track`.

The tracker path remains available as the fallback/helper even when Vercel Drain is the preferred production mode.

## Manual Sync

Every source card has “Run Sync Now”. The dashboard also has “Run All Due Sources”. Manual sync uses the same engine as cron and webhooks.

## Cron / Scheduler

`GET /api/cron/sync` syncs enabled due sources and is protected with `CRON_SECRET` in production.

`vercel.json` includes hourly cron:

```json
{
  "crons": [{ "path": "/api/cron/sync", "schedule": "0 * * * *" }]
}
```

As of Vercel’s 2026 docs, cron jobs are available on all plans, but Hobby has a daily execution minimum; hourly cron requires Pro or another scheduler. Alternatives: Supabase `pg_cron` + `pg_net`, external scheduler, or GitHub Actions.

## Open From Phone On Same Wi-Fi

```bash
pnpm dev:lan
ipconfig getifaddr en0
```

Open `http://MAC_LOCAL_IP:3000` only if you launch a dev server on 3000 yourself.

For this repo's default local workflow:

```bash
pnpm dev -- --port 3100 --hostname 0.0.0.0
ipconfig getifaddr en0
```

Then open `http://MAC_LOCAL_IP:3100` on your phone.

## Future Connectors

Add new connectors under `src/collection/connectors/<platform>` and register them in `src/collection/connectors/registry.ts`. Every metric must be added to `src/aggregation/metric-definitions/definitions.ts`.

## Quality Gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```
