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

Local development and QA rules:
- Always run and verify the app at `http://localhost:4000`.
- If port 4000 is occupied by a stale local process, stop that process instead of silently switching to another port.

Clean-worktree and release-discipline rules:
- Treat repository cleanliness as a release requirement, not a preference. Inspect `git status`, the active branch, upstream tracking, and the exact diff before making changes and again before handoff.
- Prefer a dedicated clean feature branch/worktree created from the latest `origin/main` for non-trivial implementation work. If the current worktree contains unrelated or user-owned changes, preserve them and move the task to a clean worktree instead of mixing or overwriting them.
- Never stage, commit, revert, or reformat unrelated files. Run `git diff --check` and inspect the staged diff before every commit.
- Scan the changed files and commit range for secrets, private keys, tokens, `.env` files, generated artifacts, debug output, and accidental personal data before push or merge.
- Do not push, merge, or deploy until the user authorizes that action. Authorization to implement does not automatically authorize publishing.
- Before push or merge, fetch the remote and verify branch divergence, mergeability, required checks, migrations, and the full test gate below. A dirty worktree, failing check, unresolved discrepancy, or uncertain credential migration is a hard stop.
- After merge, verify that `origin/main` contains the intended commit and that the production deployment was built from that exact merged SHA. Do not infer success from a green local build alone.
- Perform post-deploy browser smoke tests on the real production alias, reconcile visible headline metrics against their authoritative source, and inspect Vercel runtime errors/5xx plus Supabase source and sync health.
- Preserve existing platform connections and encrypted credentials across code deployments. Never require reconnection unless an OAuth token, scope, account identity, or credential is actually invalid, and explain the evidence before reconnecting.
- If any local, CI, production, data, or UI result disagrees, do not report completion. Diagnose it, fix it, repeat the relevant checks, and only then call the work clean.
- End implementation work with a clean worktree and a concise evidence-based handoff that lists the commit/PR/deployment, tests run, production checks, data-source health, and any explicitly non-blocking debt.

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
