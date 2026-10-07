# Liquid Glass design system

The Data Command Center UI follows Apple's Liquid Glass language: content sits on
translucent glass over a soft, colored wallpaper; navigation floats above it; controls
are capsules; titles are large and quiet. Everything is built from semantic tokens so
light and dark appearance come for free.

## Appearance

- The theme follows the operating system by default.
- Settings → Appearance (and the toolbar toggle, and the ⌘K palette) can force Light or Dark.
  The choice is stored in `localStorage` under `moonarq-theme` and applied before first
  paint by the inline script in `src/app/layout.tsx`, so there is no flash.
- `html[data-theme="light" | "dark"]` overrides the OS in both directions.

## Tokens (`src/app/globals.css`)

| Role | Tailwind utility | Notes |
| --- | --- | --- |
| Primary text | `text-label` | Titles, values |
| Secondary text | `text-label-secondary` | Descriptions, table cells |
| Muted text | `text-muted` or `text-[var(--muted)]` | Captions, metadata. Clears 4.5:1 on every glass composite |
| Decorative only | `text-label-quaternary` | Chevrons, placeholders — never for information |
| Hairlines | `border-separator`, `divide-separator` | |
| Inset fills | `bg-fill`, `bg-fill-hover`, `bg-fill-strong` | Tiles and tracks inside cards |
| Accent | `bg-tint`, `text-tint`, `text-tint-text` | `text-tint-text` is the AA text variant |
| Status text | `text-positive`, `text-warning`, `text-negative`, `text-indigo`, `text-pink`, `text-teal`, `text-purple` | |
| Status fills | `bg-positive-fill/15`, `bg-warning-fill/16`, `bg-negative-fill/12`, … | Use the bright `*-fill` color for tinted backgrounds |

Text tokens were chosen by compositing every wallpaper gradient stop under each glass
layer (the same method as the e2e contrast test) and keeping the worst case ≥ 4.5:1.

## Materials

- `.glass` — content cards and panels (`GlassPanel`).
- `.glass-chrome` — navigation: sidebar, toolbar, tab bar, menus, sheets, palette.
- `.glass-control` — capsule buttons and floating controls.
- `.inset-surface` — grouped rows and tiles inside a glass card.
- `.segmented` + `.segmented-item` — iOS segmented controls; the selected item is marked
  with `aria-current="page"`, `aria-pressed="true"`, `aria-selected="true"`, or
  `data-selected="true"`.
- `.field` — text inputs and selects.

Rules:

- Do not nest `.glass` inside `.glass`; nested content uses `.inset-surface`/`bg-fill`.
- Avoid stacking more than two fills behind muted text.
- Never put `filter`, `opacity`, or blend modes on ancestors of text (the e2e contrast
  test rejects them); `backdrop-filter` is fine.
- Background images on text ancestors must be gradients only.

## Layout rules

- Every page must stay free of horizontal page overflow at 360px and up; wide tables,
  code, and tab strips scroll inside their own container.
- A grid that holds truncated text (lists of sources, paths, reports) uses `grid-cols-1`
  (a `minmax(0, 1fr)` track), so long values truncate instead of widening the page.
- Cards that sit in columns of varying width size their inner layout with container
  queries (`@container` on the parent, `@md:`/`@4xl:` on children) rather than viewport
  breakpoints — the storefront funnel stages are the reference.
- Summary tiles run two per row on phones and four per row from `xl`.

## Components (`src/presentation/components/ui`)

- `Button` / `LinkButton` — variants `primary`, `secondary` (glass), `tinted`, `ghost`, `danger`.
- `Badge` — capsule with `tone` and optional status `dot`.
- `GlassPanel`, `SectionHeader` (large title), `SectionTitle`, `StatTile`, `Callout`.
- `PlatformIcon` / `IconTile` — app-icon style squircles for platforms and concepts. Their
  gradients are the `--icon-*` tokens (identical in light and dark, like Apple's Settings
  icons) applied through the `.app-icon` class; they are for icons only, never UI state.
  Bright fills such as `--icon-gold` (Whatnot) take the dark `--icon-glyph-ink` glyph so the
  symbol stays legible.
- `formatRelativeTime` / `daysUntil` — server-rendered relative times.
- `formatMetricValue` / `formatAxisValue` (`format.ts`) — one formatter for counts, percentages,
  ratios, and currencies; `null` always renders as an em dash, never as zero.

## Overview and platform pages

- The Overview leads with the paid-ads monitor (`PaidAdsHero`), the one large element on the
  page, followed by a grid of `PlatformOverviewCard`s (one column on phones, two from `sm`,
  three from `xl`) and an "Add a platform" tile. On phones each card condenses to one row:
  name and status on the left, the headline number and its change on the right.
- A card is a single link: the title carries a stretched `::after` hit area and the card
  draws the focus ring with `has-[a:focus-visible]`. Keep other links and buttons out of
  cards so the hit area never nests interactive elements.
- `MetricDelta` shows change with an arrow and a signed value (`+12.4%`, `−38`, `+0.3 pt`);
  tone comes from whether higher is better, so costs turn green when they fall and spend stays
  neutral. Flat changes read "No change", and unmeasurable ones render nothing.
- Detail pages start with `PlatformPageHeader` (back to Overview, platform icon, title, status,
  date range, actions), then `MetricTileGrid`, then `DailyMetricChart`s.
- Status comes from `platformHealth`, which folds the source status, sync freshness, and OAuth
  renewal dates into one label; `AttentionBanner` lists only the connections someone must act on.

## Navigation

- Desktop: floating glass sidebar + floating toolbar (breadcrumb, ⌘K search, appearance).
- Mobile: toolbar with the navigation sheet (`Open navigation`) and a floating tab bar
  (Overview, Sources, Sync, Data, Search).
- ⌘K / Ctrl+K opens the command palette: pages, sources, actions, and workspaces.
- The sidebar groups pages as Command (Overview), Platforms (one page per platform; Auto Lab
  lists only Instagram and TikTok), Manage, Operations, and Insights.

## Charts

Series colors come from `src/presentation/charts/chart-theme.ts`, which maps each
platform to a fixed slot of the validated categorical palette (`--chart-1…8`). A platform
keeps its color everywhere. Axis ticks use `--chart-axis`, grids `--chart-grid`, and
tooltips share the navigation glass. Meta Ads uses an indigo slot so its series never reads
as the green of an improving change beside it.

`DailyMetricChart` draws one daily series with a single axis: bars for amounts that add up per
day (spend, orders, signups) and a line for running levels (followers). Every chart keeps a
"View daily values" table with the same numbers.
