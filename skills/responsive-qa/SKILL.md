---
name: responsive-qa
description: Use before finalizing MoonArq UI work or when testing responsive dashboard behavior with Playwright or Computer Use.
---

# Responsive QA Skill

## Standards

Check:
- 1440 desktop
- 1024 laptop/tablet
- 768 small tablet
- 390 mobile
- 360 or 320 narrow mobile
- ultrawide if possible

## Checklist

- No horizontal overflow.
- Sidebar full desktop, compact/drawer mobile.
- KPI grid collapses correctly.
- Tables are cards or safe scroll on mobile.
- Charts resize and labels remain readable.
- Add Source wizard works on mobile.
- Sync center works on mobile.
- Text and buttons do not overlap.

## Commands

```bash
pnpm test:e2e
pnpm dev
```

Use Computer Use only for local QA and inspection, not production data collection.
