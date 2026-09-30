# Connector roadmap

Planned connectors are registered through the shared `ConnectorDefinition` (via
`createPlannedConnector`) so they appear in Add Source, URL detection, and the source catalog
with their setup requirements. A planned connector never asks for credentials, never tests a
connection, and never syncs: `POST /api/sources` answers `409 connector_planned`, and the sync
engine skips it.

All of them must use official APIs, webhooks, or exports. Dashboard scraping and password or
cookie collection are not allowed (see `AGENTS.md`).

| Platform | Key | Official path | Auth | What you need to prepare |
| --- | --- | --- | --- | --- |
| Facebook Page | `facebook_page` | Meta Graph API Page Insights | The existing Meta app + Facebook Login (shared with Instagram and Meta Ads) | Page admin role; `pages_show_list`, `pages_read_engagement`, `read_insights` with Advanced Access (Meta App Review) |
| Etsy | `etsy` | Etsy Open API v3 | OAuth 2.0 with PKCE; scopes `shops_r`, `listings_r`, `transactions_r` | An app at etsy.com/developers (API keystring + shared secret); callback `https://<data-hub>/api/oauth/etsy/callback` |
| Google Analytics 4 | `google_analytics` | Google Analytics Data API (`runReport`) | Google OAuth or a service account, scope `analytics.readonly` | A Google Cloud project with the Analytics Data API enabled; the GA4 property ID; Viewer access for the account or service account |
| 小红书 / Xiaohongshu | `xiaohongshu` | 小红书开放平台 (shop orders), 聚光 Marketing API (ads), 专业号 data-center CSV export (organic notes) | App key/secret or advertiser API approval, depending on the path | A merchant account on 小红书开放平台 and/or 聚光 API access; organic notes arrive through the planned CSV import |

## Planned metrics

- **Facebook Page**: followers, reach, impressions, post engagement, link clicks (daily).
- **Etsy**: orders, gross revenue, units sold, refunds, active listings (daily). Etsy's API has no
  shop-visit data, so storefront traffic stays with the first-party Website tracker.
- **GA4**: sessions, users, engaged sessions, key events, revenue by channel (daily). GA4 is
  auxiliary; the Website tracker stays the source of truth for the storefront funnel.
- **Xiaohongshu**: shop orders and ad delivery/spend through the official APIs above; note
  performance through CSV import.

## Turning a planned connector into a live one

1. Implement the connector in `src/collection/connectors/<platform>/` (detect, testConnection,
   sync, normalize, metric definitions) following `skills/connector-implementation/SKILL.md`.
2. Add OAuth start/callback routes where the platform uses OAuth; store tokens encrypted per source.
3. Add metric definitions in `src/aggregation/metric-definitions/definitions.ts`.
4. Add a migration that inserts the `source_types` row (see `0006_shopify_official_connector.sql`
   and `0008_meta_ads_attribution.sql`) — `sources.source_type_key` references that table.
5. Give the platform a chart slot in `src/presentation/charts/chart-theme.ts` once it produces series.
6. Cover detection, OAuth, idempotent sync, and normalization with unit tests; keep the
   `planned-connector-safety` expectations for anything still planned.
