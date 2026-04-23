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

- Supabase Auth is the production target.
- `DEV_AUTH_BYPASS=true` is a local development convenience only.
- Use `ALLOWED_EMAILS` when auth is enabled.
- Disable dev bypass before deployment.

## Cron

- `GET /api/cron/sync` is protected by `CRON_SECRET` in production.
- Cron failures should be recorded in `sync_runs` and `connector_events`.

## Computer Use

Computer Use may be used for setup, local browser checks, terminal/editor inspection, localhost QA, and dashboard configuration after approval. It must not become the production data collection method.

## Production Checklist

- Set `APP_ENCRYPTION_KEY` to a 32-byte secret.
- Set `CRON_SECRET`.
- Configure Supabase Auth and `ALLOWED_EMAILS`.
- Set `DEV_AUTH_BYPASS=false`.
- Apply database migrations.
- Verify RLS policies.
- Confirm no `.env.local` or real keys are committed.
- Run lint, typecheck, tests, build, and responsive QA.
