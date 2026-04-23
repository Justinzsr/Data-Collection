# Storage Layer / 存储层

Owns database schema, migrations, repository access, encrypted credentials, raw ingestions, sync runs, locks, source configs, metrics, web events, and connector events.

This layer is the Data Hub app's own runtime/storage, not the monitored MoonArq Supabase source.

- When `DATABASE_URL` is missing, repositories fall back to the in-memory demo store.
- When `DATABASE_URL` is configured, repositories use real Postgres-backed persistence through `pg`.
- `pnpm db:migrate` now applies `src/storage/db/migrations/*.sql` through a real migration runner with `schema_migrations`.
