---
name: uiux-dashboard
description: Use when changing MoonArq dashboard UI, visual hierarchy, charts, source management screens, or responsive presentation components.
---

# UI/UX Dashboard Skill

## Standards

- Apple Liquid Glass language: translucent glass materials over a soft wallpaper, specular rims, capsule controls, large titles. See `docs/design-system.md`.
- Light and dark appearance from semantic tokens (`text-label`, `text-label-secondary`, `text-muted`, `bg-fill`, `border-separator`, `bg-tint`, status `*-fill` colors). Never hardcode palette colors.
- Premium, clean, readable, not childish, not generic admin template.
- No unreadable neon overload; text keeps WCAG AA contrast on the worst-case glass composite.
- KPI grid: 4 columns desktop, 3 laptop, 2 tablet, 1 mobile.
- Tables must become mobile cards or safe scroll.
- Charts must use responsive containers.
- Use subtle motion only.

## Inputs

- Page or component being changed.
- Target user workflow.
- Data states: demo, loading, empty, error, real data.

## Outputs

- Responsive UI changes.
- Clear CTAs.
- Status badges and helpful empty/error states.
- No horizontal overflow.

## Checklist

- Primary action visible.
- Text contrast is strong.
- Long URLs truncate.
- Mobile nav works.
- No glass cards nested inside glass cards; nested content uses `inset-surface` or `bg-fill`.
- Chart colors come from `src/presentation/charts/chart-theme.ts`.
- No fixed-width chart containers.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test:e2e
```
