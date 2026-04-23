# MoonArq Data Collection Base

Private internal data hub for connecting platforms, collecting data through official APIs, webhooks, scheduled syncs, manual syncs, and first-party tracking, storing the data in a structured database, aggregating it into business metrics, and visualizing it in a futuristic responsive dashboard.

## Four Layers

- Collection Layer / 采集层: `src/collection`
  Source onboarding, connector registry, platform connectors, webhooks, scheduled sync, manual sync, and website tracking.
- Storage Layer / 存储层: `src/storage`
  Supabase Postgres schema, migrations, repositories, encrypted credentials, raw ingestions, sync runs, source configs, locks, and demo data.
- Aggregation Layer / 聚合层: `src/aggregation`
  Normalizers, metric definitions, idempotent metric upserts, summary services, timeseries services, content, commerce, and health services.
- Presentation Layer / 展示层: `src/presentation`
  Dashboard UI, source management, add-source wizard, sync center, event dashboard, charts, tables, cards, responsive layout, motion, and theme.

## Local Setup

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`.

Demo mode works without real credentials. Keep `DEV_AUTH_BYPASS=true` locally. Set it to `false` before deployment.

## Demo Mode

The app seeds in-memory demo data for website page views, unique visitors, sessions, custom events, Supabase signups/users, source health, sync runs, content placeholders, and future Shopify/TikTok/Instagram placeholders.

```bash
pnpm db:seed
```

## Add A Source

Go to `/dashboard/sources/new`, paste a link, and the app detects likely platform type:

- `https://xxxxx.supabase.co`
- `https://example.com`
- `https://vercel.com/team/project`
- `https://your-store.myshopify.com`
- `https://www.tiktok.com/@account`
- `https://www.instagram.com/account`

Links identify the source. Private metrics usually require an API key, OAuth token, webhook secret, service role key, or tracking snippet.

## Credentials

Credentials are per-source, encrypted with AES-256-GCM, and stored server-side. Saved values are never shown again; the UI only displays masked hints.

## Supabase Setup

The Supabase connector supports public `profiles` webhook mode and server-side Auth admin fallback when a service role key is provided. `auth.users` is not available through normal public APIs. Use the SQL setup instructions in the connector docs/UI to mirror signups into `public.profiles`.

## Website Tracking

Use `/dashboard/events` to copy the lightweight JavaScript snippet or the React/Next helper with `usePageViewTracking()` and `trackEvent(name, properties)`. The tracker posts to `POST /api/track`.

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

Open `http://MAC_LOCAL_IP:3000` on your phone.

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
