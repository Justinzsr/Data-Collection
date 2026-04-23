---
name: data-collection-base
description: Use when changing MoonArq collection, storage, aggregation, sync engine, migrations, repositories, or data model architecture.
---

# Data Collection Base Skill

## Standards

- Preserve `src/collection`, `src/storage`, `src/aggregation`, `src/presentation`.
- Route handlers stay thin.
- Sync triggers share one engine.
- Credentials are encrypted and server-only.
- Raw payloads are hash-keyed.
- Metrics are idempotent upserts.
- Demo mode should keep the product usable without credentials.

## Inputs

- Source type or workflow being added.
- Data shape.
- Trigger type.
- Metrics needed.

## Outputs

- Schema/repository updates.
- Connector or service updates.
- Metric definitions.
- Focused tests.

## Checklist

- No secret reaches client code.
- Source lock prevents concurrent sync.
- Re-run does not duplicate raw records or metrics.
- Errors are recorded in sync runs and connector events.
- Docs updated if workflow changes.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
```
