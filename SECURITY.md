# Security

MoonArq Data Collection Base is private internal infrastructure. Treat source credentials and tracked data as sensitive.

## Credential Handling

- Real credentials must be entered only after explicit approval.
- Per-source credentials are stored in `source_credentials`.
- Values are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY`.
- The UI only shows masked hints such as `abcd••••wxyz`.
- Decrypted values are only loaded inside server-side connector contexts.

## Server-Only Secrets

- `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`, and per-source tokens must never be exposed to browser code.
- Do not add secrets to `NEXT_PUBLIC_*` variables.
- Do not log decrypted credentials.
- Do not include secrets in screenshots, docs, commits, or chat.

## Auth

- Production dashboard access is protected by the app-level single-user password gate.
- Set `DASHBOARD_ADMIN_PASSWORD` and `DASHBOARD_SESSION_SECRET` in Vercel.
- A successful login sets an httpOnly, secure session cookie.
- `DEV_AUTH_BYPASS=true` is a local development convenience only and is ignored in production.
- If production is missing dashboard auth env vars, protected UI redirects to `/login` with a setup warning and private APIs return a safe setup error.
- Do not use whole-app Vercel Deployment Protection if it would block Vercel Drain delivery.

## Public Ingestion Boundaries

- Vercel Drain remains reachable at `/api/webhooks/vercel/analytics-drain/{sourceId}` and uses its drain signature secret when configured.
- `GET /api/cron/sync` remains protected by `CRON_SECRET`.
- `POST /api/track` is public only for valid Website Tracker sources. It rejects orphan events, unknown tracking keys, non-website sources, and disallowed production origins.
- Tracker page views are not counted as primary website page views when Vercel Drain is the active primary ingestion mode.

## Cron

- `GET /api/cron/sync` is protected by `CRON_SECRET` in production.
- Cron failures should be recorded in `sync_runs` and `connector_events`.

## Computer Use

Computer Use may be used for setup, local browser checks, terminal/editor inspection, localhost QA, and dashboard configuration after approval. It must not become the production data collection method.

## Production Checklist

- Set `APP_ENCRYPTION_KEY` to a 32-byte secret.
- Set `CRON_SECRET`.
- Set `DASHBOARD_ADMIN_PASSWORD`.
- Set `DASHBOARD_SESSION_SECRET`.
- Set `DEV_AUTH_BYPASS=false` or leave it unset in production.
- Apply database migrations.
- Verify RLS policies.
- Confirm no `.env.local` or real keys are committed.
- Run lint, typecheck, tests, build, and responsive QA.
