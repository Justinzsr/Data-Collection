# Database

`schema.ts` defines the TypeScript shape for the Supabase Postgres target.

`migrations/` contains SQL for:
- source types and source configs
- encrypted credentials
- sync runs and source locks
- raw ingestions
- daily metrics and content metrics
- web events
- metric definitions
- connector events

Use `pnpm db:migrate` after wiring a real `DATABASE_URL` migration runner.
