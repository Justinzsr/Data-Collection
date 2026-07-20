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
pnpm dev # http://localhost:4000
```

All local startup scripts are pinned to port `4000`; do not silently switch ports. Open `http://localhost:4000`.

To verify the production server locally, use the same port:

```bash
pnpm build
pnpm start # http://localhost:4000
```

Demo mode works without real credentials when `DATABASE_URL` is missing. When `DATABASE_URL` is configured, repositories switch to real Postgres-backed persistence automatically.

Keep `DEV_AUTH_BYPASS=true` locally. Production ignores dev bypass and requires `DASHBOARD_ADMIN_PASSWORD` plus `DASHBOARD_SESSION_SECRET`.

## Private Access

Production dashboard pages and private APIs are protected by an app-level password session gate. A successful `/login` sets an httpOnly session cookie; `/api/auth/logout` clears it.

Set these Vercel environment variables before relying on the deployed dashboard:

```bash
DASHBOARD_ADMIN_PASSWORD=use-a-long-private-password
DASHBOARD_SESSION_SECRET=generate-at-least-32-random-bytes
```

Do not use Vercel Deployment Protection for the whole app if it would block webhook delivery. The app-level gate keeps `/dashboard`, `/settings`, and private APIs locked while leaving Vercel Drain, tracker validation, and cron authentication on their own paths.

## Demo Mode

When `DATABASE_URL` is missing, the app seeds in-memory demo data for MoonArq website traffic, unique visitors, sessions, custom events, Supabase signups/users, source health, sync runs, and content placeholders. The demo Website source and its generated-looking public key exist only in memory. Shopify remains an empty live-connector state until a real store is configured.

```bash
pnpm db:seed
```

When `DATABASE_URL` is configured, `pnpm db:seed` seeds only the runtime catalog tables (`source_types`, `metric_definitions`) for the real app database. It does not create source rows or tracking credentials.

## Add A Source

Go to `/dashboard/sources/new`, paste a link, and the app detects likely monitored source:

- `https://moonarqstudio.com`
- `https://xxxxx.supabase.co`
- `https://vercel.com/team/project`
- `https://your-store.myshopify.com`

Links identify the source. Private metrics still require the right ingestion path: Vercel Drain, Website Tracker, service role key, webhook secret, or another official API credential. Shopify uses an installed store-owned Dev Dashboard app with encrypted client credentials and the minimum `read_orders` scope.

## Credentials

Credentials are per-source, encrypted with AES-256-GCM, and stored server-side. Saved values are never shown again; the UI only displays masked hints.

## Instagram OAuth

Instagram uses the official Meta Graph API OAuth flow. Credentials are saved per source, encrypted server-side, and scoped through the source's data space. Auto Lab Instagram continues to use the existing Auto Lab Meta app and still validates the `just.4is` account. MoonArq Instagram can use a separate MoonArq Meta app without changing Auto Lab credentials, MoonArq Website / Vercel Drain, or MoonArq Supabase credentials.

Default / Auto Lab Meta app profile:

```bash
META_APP_ID=1287137936945850
META_APP_SECRET=your-meta-app-secret
META_GRAPH_API_VERSION=v25.0
META_REDIRECT_URI=https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback
```

MoonArq Meta app profile:

```bash
MOONARQ_META_APP_ID=your-moonarq-meta-app-id
MOONARQ_META_APP_SECRET=your-moonarq-meta-app-secret
MOONARQ_META_GRAPH_API_VERSION=v25.0
MOONARQ_META_REDIRECT_URI=https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback
```

If the `MOONARQ_META_*` variables are configured, MoonArq Instagram sources use that profile. If they are absent, Instagram falls back to the default `META_*` profile. Do not commit or paste app secrets or access tokens. Add secrets only in Vercel Project Settings, then redeploy so the server-side OAuth routes can read them.

In each Meta Developer app used for Instagram OAuth, add this Valid OAuth Redirect URI in the Instagram/Facebook Login settings area:

`https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback`

Use the public compliance URLs in Meta app settings:

- Privacy Policy URL: `https://moonarq-data-hub.vercel.app/privacy`
- Terms of Service URL: `https://moonarq-data-hub.vercel.app/terms`
- User Data Deletion URL: `https://moonarq-data-hub.vercel.app/data-deletion`

The connector uses the official Meta Graph API. It does not collect Instagram passwords, scrape dashboards, or expose token values in UI/API responses.

To connect MoonArq Instagram, create an Instagram source in `/w/moonarq/dashboard/sources/new`, save it as `MoonArq Instagram`, then use the source detail page's `Connect Instagram` button. The source discovers and stores the Instagram account ID and username during OAuth unless `expected_username` or `expected_account_id` metadata is set on the source.

## TikTok OAuth

TikTok uses official TikTok Login Kit OAuth and TikTok API v2. Auto Lab continues to use the existing default TikTok app profile for the current Auto Lab TikTok source:

`dfb2d0d1-471e-4905-9a8a-1875a39e66b5`

MoonArq TikTok can be added later as a separate MoonArq source. The OAuth callback reloads the source inside the signed state data space and saves tokens only to that source, so Auto Lab and MoonArq TikTok data stay isolated.

Default / Auto Lab server-side Vercel environment variables:

```bash
TIKTOK_CLIENT_KEY=your-tiktok-client-key
TIKTOK_CLIENT_SECRET=your-tiktok-client-secret
TIKTOK_REDIRECT_URI=https://moonarq-data-hub.vercel.app/api/oauth/tiktok/callback
TIKTOK_API_BASE_URL=https://open.tiktokapis.com
```

Optional MoonArq-specific server-side Vercel environment variables:

```bash
MOONARQ_TIKTOK_CLIENT_KEY=your-moonarq-tiktok-client-key
MOONARQ_TIKTOK_CLIENT_SECRET=your-moonarq-tiktok-client-secret
MOONARQ_TIKTOK_REDIRECT_URI=https://moonarq-data-hub.vercel.app/api/oauth/tiktok/callback
MOONARQ_TIKTOK_API_BASE_URL=https://open.tiktokapis.com
```

MoonArq TikTok uses `MOONARQ_TIKTOK_*` when those variables are configured; otherwise it falls back to the default `TIKTOK_*` app profile. For sandbox testing, put the MoonArq TikTok sandbox client key and secret in the MoonArq env vars. If any MoonArq TikTok override is configured, the MoonArq key, secret, and redirect URI must all be configured.

Configure the same redirect URI in TikTok Developer Login Kit settings:

`https://moonarq-data-hub.vercel.app/api/oauth/tiktok/callback`

The connector requests these scopes:

- `user.info.basic`
- `user.info.profile`
- `user.info.stats`
- `video.list`

`user.info.stats` provides follower, likes, and video counts when TikTok grants the scope. `video.list` provides public video rows and video metrics such as views, likes, comments, and shares. TikTok may require app review before these scopes work for production accounts.

To connect Auto Lab TikTok, open `/w/auto-lab/dashboard/sources/dfb2d0d1-471e-4905-9a8a-1875a39e66b5`, choose `Connect TikTok`, authorize through TikTok, then use `Test Connection` and `Run Sync Now`.

To prepare MoonArq TikTok, open `/w/moonarq/dashboard/sources/new?template=tiktok`, save the source as `MoonArq TikTok`, then use the source detail page's `Connect TikTok` button. Credentials and synced records remain scoped to the MoonArq source.

The connector does not collect TikTok passwords, scrape dashboards, or expose token values in UI/API responses.

## MoonArq Supabase Setup

MoonArq Supabase is a monitored source. It is not the same thing as the Data Hub app's own storage/auth runtime.

The Supabase source connector supports:

- server-side Auth admin mode with an encrypted `service_role_key`
- optional `public.profiles` webhook mode

Admin fallback mode uses only the monitored MoonArq Supabase project URL plus encrypted `service_role_key`. It does not require anon keys, database passwords, JWT secrets, publishable keys, or direct Postgres connection strings.

`auth.users` is not available through normal public APIs. Use the SQL setup instructions in the source detail UI to mirror signups into `public.profiles` when you want the event-driven path.

## MoonArq Website / Vercel

The website module retains two complementary event streams:

1. `vercel_web_analytics_drain`
   the official Vercel Web Analytics Drain path for auxiliary infrastructure and request-level evidence.
2. `website`
   the authoritative first-party source for funnel behavior, pseudonymous identity, sessions, and attribution.

Raw events from both streams are retained. First-party `page_view` events are never discarded because a Drain source also exists; aggregation selects the authoritative source for each metric so overlapping observations are not summed.

### Vercel Drain

After saving the source in Drain mode, the source detail page shows the endpoint in this form:

`{PUBLIC_APP_URL}/api/webhooks/vercel/analytics-drain/{sourceId}`

If you set a Signature Verification Secret in Vercel, save the same value as the encrypted `drain_signature_secret` for that source.

### Website Tracker

Use `/dashboard/events` to copy the lightweight JavaScript snippet or the React/Next helper with `usePageViewTracking()` and `trackEvent(name, properties)` after a real Website Tracker source exists. The tracker posts Website Event Contract v1 events to `POST /api/track` while preserving the existing helper APIs.

The source lifecycle is server-owned. A Website Tracker created through the normal flow is inserted atomically as `healthy` with `metadata.demo = false` when runtime Postgres persistence is configured; without runtime Postgres it remains the in-memory `demo` fixture with `metadata.demo = true`. The server generates its source UUID, public tracking key, exact allowed origin, and webhook URL. Credential-required connectors continue to start as `needs_credentials`, and public create/update requests cannot promote a source by submitting a lifecycle status.

In production, v1 tracker events must include a valid `source_id` and matching `public_tracking_key`, and must come from an allowed origin configured on that Website Tracker source. Legacy payloads remain accepted with either source identifier. New payloads include a client UUID `event_id`, `schema_version: "1.0"`, event time, consent, attribution, and client context; retries reuse `event_id` for idempotent delivery.

See [Website Event Contract v1](docs/website-event-contract-v1.md) for payload, privacy, validation, rate-limit, and compatibility details. Set optional `WEBSITE_TRACKING_RATE_LIMIT_PER_MINUTE` to tune the default 600 requests per minute per source/client.

Source roles are explicit: the first-party tracker is authoritative for funnel/session/identity/attribution; Vercel Drain is auxiliary; Shopify is authoritative for commerce; and Meta is authoritative for paid media delivery and spend.

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
pnpm dev:lan # http://0.0.0.0:4000
ipconfig getifaddr en0
```

Then open `http://MAC_LOCAL_IP:4000` on your phone.

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
