# Connector roadmap

Planned connectors are registered through the shared `ConnectorDefinition` (via
`createPlannedConnector`) so they appear in Add Source, URL detection, and the source catalog
with their setup requirements. A planned connector never asks for credentials, never tests a
connection, and never syncs: `POST /api/sources` answers `409 connector_planned`, and the sync
engine skips it.

All of them must use official APIs, webhooks, or exports. Dashboard scraping and password or
cookie collection are not allowed (see `AGENTS.md`).

## Live through report upload

| Platform | Key | Official path | What you need |
| --- | --- | --- | --- |
| Whatnot | `whatnot` | The Seller Weekly Orders Report CSV (Seller Hub → Financials → Statements), published every Monday 06:00 UTC for the previous Monday–Sunday (UTC) | Nothing to authorize. Download the report each week and upload it on the Whatnot page |

Whatnot's Seller API exists but is a closed developer preview that does not accept new
applicants, and Whatnot's terms forbid automated use of its app, so the connector imports the
report Whatnot gives every seller. Uploads go through `POST /api/sources/<id>/import`, which
validates the file (one report week per file, taken from the completion times; no week that has
not ended; signs of a spreadsheet re-save refused) and drops buyer names, locations, shipment IDs,
listing titles and descriptions, SKUs, transaction messages, and cost of goods before the shared
sync engine stores anything: a manual trigger, one raw snapshot per report week, and metrics dated
by the Pacific day each transaction completed. The same route takes a JSON body
(`{ "action": "no_sales" | "remove", "reportWeek": "YYYY-MM-DD" }`) to record a week without sales
or remove a week imported by mistake.
The connector replaces a week as a unit (`replaceMetricWindow` scoped to the `report_week`
dimension), so a re-upload or a corrected report replaces exactly that week and leaves the
neighbouring week's shared Sunday alone. When Whatnot opens API access, a token-based sync can
replace the upload without changing the metrics.

## Live through OAuth

| Platform | Key | Official path | Auth | What you need |
| --- | --- | --- | --- | --- |
| Etsy | `etsy` | Etsy Open API v3 (`getMe`, `getShop`, `getShopReceipts`) | OAuth 2.0 with PKCE (S256); read-only scopes `shops_r`, `listings_r`, `transactions_r`; every request sends `x-api-key: <keystring>:<shared secret>`; access tokens last 1 hour and refresh themselves, refresh tokens last 90 days and renew on each refresh | An app for your own shop at etsy.com/developers/your-apps, its keystring and shared secret (saved in the source's encrypted fields), and the callback URL the source page shows, `https://<data hub>/api/oauth/etsy/callback`, registered on the app exactly |

The source page walks through the three steps in order: register the callback URL, save the app
keys, then Connect Etsy. `GET /api/oauth/etsy/start` signs a state with its own key derived from
`DASHBOARD_SESSION_SECRET` (so the state, which travels in URLs, can never pass as a dashboard
session) and keeps the PKCE verifier in an encrypted, HttpOnly cookie for ten minutes.
`/api/oauth/etsy/callback` checks the state against that cookie, exchanges the code, and refuses an
Etsy account whose shop is not the one the source is for. It answers with a result code
(`etsy_oauth=connected`, or `etsy_oauth=error&reason=<code>`), and the source page supplies the
words for each code, so a link cannot put its own text on the dashboard.

Each hourly sync refreshes the access token when it is within five minutes of expiry (or when Etsy
refuses it), reads the shop and its receipts, and stores one minimized snapshot: order dates,
statuses, subtotals, quantities, and refunds, never buyer names, addresses, emails, messages, gift
notes, or listing titles. The first sync reads a year in month-long windows, as Etsy asks for long
histories, and halves a window whose orders Etsy cannot page through (12,100 per filter). Later syncs
reread from 35 days before the last successful sync (five weeks, normally; more after an outage),
plus older receipts modified since the window began (for refunds issued on them), and replace the
window's daily rows (`replaceMetricWindow`). Sales are gross (an order counts whenever money changed
hands, and refunds count on the day they were issued), so a recomputed day matches the one an
earlier sync kept. The active listing count is a `snapshotMetrics` row for the sync date, outside the window, so
earlier days keep theirs. A refresh token Etsy no longer accepts fails the sync with "Reconnect
Etsy", which the dashboard shows as Reconnect needed, with a Reconnect button on the source and Etsy
pages. A refresh that Etsy refuses because another request (a connection test, a reconnect) just
replaced the token pair picks up the newer pair instead.

## Planned

| Platform | Key | Official path | Auth | What you need to prepare |
| --- | --- | --- | --- | --- |
| Facebook Page | `facebook_page` | Meta Graph API Page Insights | The existing Meta app + Facebook Login (shared with Instagram and Meta Ads) | Page admin role; `pages_show_list`, `pages_read_engagement`, `read_insights` with Advanced Access (Meta App Review) |
| Google Analytics 4 | `google_analytics` | Google Analytics Data API (`runReport`) | Google OAuth or a service account, scope `analytics.readonly` | A Google Cloud project with the Analytics Data API enabled; the GA4 property ID; Viewer access for the account or service account |
| 小红书 / Xiaohongshu | `xiaohongshu` | 电商开放平台 (shop orders; needs an operating 小红书店铺 and a 商家自研 app), 聚光 MarketingAPI (ads; approval is started by Xiaohongshu sales for key accounts), 创作服务平台 数据中心 export (organic notes) | appKey/appSecret with shop authorization, or advertiser OAuth after API approval | No official API serves organic note or follower data, and the platform agreement forbids scraping, so organic data arrives through an uploaded export. A shop or 聚光 API access opens the API paths |

## Planned metrics

- **Facebook Page**: followers, reach, impressions, post engagement, link clicks (daily).
- **GA4**: sessions, users, engaged sessions, key events, revenue by channel (daily). GA4 is
  auxiliary; the Website tracker stays the source of truth for the storefront funnel.
- **Xiaohongshu**: shop orders and ad delivery/spend through the official APIs above; note
  performance through CSV import.

## Turning a planned connector into a live one

1. Implement the connector in `src/collection/connectors/<platform>/` (detect, testConnection,
   sync, normalize, metric definitions) following `skills/connector-implementation/SKILL.md`.
2. Add OAuth start/callback routes where the platform uses OAuth; store tokens encrypted per source.
3. Add metric definitions in `src/aggregation/metric-definitions/definitions.ts`.
4. `sources.source_type_key` references `source_types`; `createSource` upserts that row from the
   registry before inserting a source, so a new connector needs no migration for it. The app
   reads metric definitions from code; `pnpm db:seed` copies them into `metric_definitions`.
5. Give the platform a chart slot in `src/presentation/charts/chart-theme.ts` once it produces series.
6. Cover detection, OAuth, idempotent sync, and normalization with unit tests; keep the
   `planned-connector-safety` expectations for anything still planned.
