# Storage Layer / 存储层

Owns database schema, migrations, repository access, encrypted credentials, raw ingestions, sync runs, locks, source configs, metrics, web events, and connector events.

The current MVP uses an in-memory demo repository when `DATABASE_URL` is missing. Supabase Postgres migrations and setup docs are included so the same interfaces can be backed by a real database next.
