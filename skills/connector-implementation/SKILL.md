---
name: connector-implementation
description: Use when adding or modifying MoonArq platform connectors, detection rules, setup instructions, sync logic, or normalizers.
---

# Connector Implementation Skill

## Standards

Every connector must implement:
- key
- displayName
- category
- urlPatterns
- requiredFields
- optionalFields
- capabilities
- detect(inputUrl)
- testConnection(ctx)
- sync(ctx)
- normalize(rawPayloads)
- getMetricDefinitions()

## Checklist

- Prefer official APIs, webhooks, and first-party tracking.
- Do not scrape dashboards.
- Required credentials are per-source and encrypted.
- Service role/admin tokens stay server-side.
- Detection returns a confidence score and setup explanation.
- Missing credentials show helpful warnings and demo fallback.
- Metrics have definitions.
- Sync is idempotent.

## Commands

```bash
pnpm test -- tests/unit/collection
pnpm typecheck
```
