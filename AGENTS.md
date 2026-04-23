<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# MoonArq Data Collection Base Agent Rules

Always preserve the four-layer architecture:
- Collection Layer / 采集层: `src/collection`
- Storage Layer / 存储层: `src/storage`
- Aggregation Layer / 聚合层: `src/aggregation`
- Presentation Layer / 展示层: `src/presentation`

Security rules:
- Never expose secrets in frontend code, commits, logs, screenshots, README examples, or chat messages.
- Never commit `.env.local` or real API keys.
- Store per-source credentials encrypted server-side.
- Supabase service role keys are server-only.
- Ask before entering or moving real credentials.

Collection rules:
- Never scrape dashboards as production data collection.
- Prefer official APIs, webhooks, first-party tracking, cron/scheduler, and manual sync buttons.
- Every connector must implement the shared `ConnectorDefinition` interface.
- Website traffic uses first-party `/api/track`, not private Vercel Analytics APIs.

Aggregation and sync rules:
- Every metric must have a definition.
- All syncs must be idempotent.
- Manual, cron, webhook, retry, and initial triggers must use the shared sync engine.
- Prevent concurrent syncs for the same source with locks and lease timeouts.
- Store raw payload hashes and upsert daily metrics by date/source/metric/dimensions.

UI rules:
- Keep the UI futuristic, premium, readable, responsive, and dark-first.
- Avoid generic admin-template visuals and unreadable neon overload.
- Verify no horizontal overflow on mobile widths.

Project skills:
- Use `skills/uiux-dashboard/SKILL.md` for dashboard UI changes.
- Use `skills/data-collection-base/SKILL.md` for architecture, sync, and storage changes.
- Use `skills/responsive-qa/SKILL.md` before visual QA.
- Use `skills/connector-implementation/SKILL.md` when adding or modifying connectors.

Before final response for implementation work, run:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e` when Playwright is installed and available.
