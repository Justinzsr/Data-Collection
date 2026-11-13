# Connectors

Every connector implements `ConnectorDefinition`.

MVP:
- Supabase: signup/user metrics through `public.profiles` webhook mode or service-role admin fallback.
- Website: first-party tracking through `/api/track`.
- Instagram: official Meta Graph API OAuth and manual sync for isolated source-specific Instagram accounts.
- TikTok: official TikTok Login Kit OAuth and API v2 sync for data-space-scoped TikTok sources.
- Shopify: official Admin GraphQL API with a store-owned Dev Dashboard app and encrypted client credentials.
- ChatGPT Ads: read-only official OpenAI Advertiser API for daily spend, impressions, clicks, campaign-goal conversions, and attributed order value.

## ChatGPT Ads

Create a source at `/w/moonarq/dashboard/sources/new?template=chatgpt_ads` using an official `https://ads.openai.com/` URL. The source stores the canonical Ads Manager origin without query parameters. Account identity comes from the official account API, not a URL query or an inferred account name.

In the selected Ads Manager account, create an **Advertiser API key** under Settings and save it through the source's encrypted credential form. This is separate from an OpenAI model/API-platform key and from the ChatGPT Ads Manager plugin connection. A plugin connection does not grant the deployed DataHub server ongoing API access. Keep the key server-side; never paste real keys into documentation, chat, source metadata, URLs, or public environment variables. Ask the account owner before entering or moving a real credential.

Use Test Connection and then Sync on the source detail page. The first successful report sync binds the source to the API-reported ad account; later syncs reject keys for a different account. An optional expected-account credential can also enforce identity before the first sync. Manual, initial, retry, and hourly scheduled syncs use the shared sync engine, lock lease, raw-payload hashes, and idempotent daily metric replacement. The connector only reads documented endpoints under `https://api.ads.openai.com/v1`; it does not scrape Ads Manager or change campaigns, bids, budgets, or advertising status.

The stored facts are:

- `chatgpt_ads_spend`, `chatgpt_ads_impressions`, and `chatgpt_ads_clicks` for daily delivery.
- `chatgpt_ads_conversions`, `chatgpt_ads_click_through_conversions`, and `chatgpt_ads_view_through_conversions` for campaign-goal conversion reporting.
- `chatgpt_ads_purchase_value` for reported `order_created_attributed_sales`, including goal and non-goal order conversions. Missing order values remain unreported.

Spend is reported in the account currency's main units, not the micros used for campaign budgets. Attributed order value is also a decimal currency amount and keeps its separately reported currency. Attribution settings and account timezone remain in the stored dimensions and sync evidence. CTR, CPC, CPM, conversion rate, and ROAS are calculated from compatible aggregate numerators and denominators rather than by adding daily ratios. Platform conversion goals are not necessarily purchases, and platform-attributed order value does not replace Shopify's order, payment, or refund records.

The existing Website Tracker can record `utm_source=chatgpt`, `utm_medium=paid`, and a stable campaign label without a platform whitelist. Include these tags on advertisement destinations so the first-party acquisition and commerce funnel can distinguish ChatGPT traffic. OpenAI platform attribution remains a separate reporting layer; aggregate ad clicks and conversions do not create a person-level Website-to-Shopify identity match. Promotion and credit data are outside this connector's scope.

Official references: [Advertiser API overview](https://developers.openai.com/ads/api-overview), [Insights API](https://learn.chatgpt.com/ads/api-reference/insights), and [conversion reporting and attribution](https://learn.chatgpt.com/ads/reporting#conversion-reporting--attribution).

## Instagram Meta app profiles

Instagram OAuth chooses a server-side Meta app profile from the source and data space:

- Auto Lab Instagram uses the default `META_*` profile and remains locked to the existing `auto-lab` source id `29f678e5-820c-4de7-a128-0e56654fc51a` / `just.4is`.
- MoonArq Instagram uses `MOONARQ_META_*` when those variables are configured. If they are absent, it falls back to the default `META_*` profile.
- Optional source metadata `meta_app_profile` can be set to `default` or `moonarq` if a future source needs an explicit profile.

Default / Auto Lab server-side environment variables:

```bash
META_APP_ID=1287137936945850
META_APP_SECRET=your-meta-app-secret
META_GRAPH_API_VERSION=v25.0
META_REDIRECT_URI=https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback
```

MoonArq server-side environment variables:

```bash
MOONARQ_META_APP_ID=your-moonarq-meta-app-id
MOONARQ_META_APP_SECRET=your-moonarq-meta-app-secret
MOONARQ_META_GRAPH_API_VERSION=v25.0
MOONARQ_META_REDIRECT_URI=https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback
```

Configure the same redirect URI in each Meta Developer app's Instagram/Facebook Login OAuth settings:

`https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback`

The connector stores Meta tokens encrypted as source credentials and only returns masked hints/status to the UI. Use official Graph API/OAuth only; do not scrape Instagram or Meta dashboards.

## MoonArq Instagram

Create the source in `/w/moonarq/dashboard/sources/new` with display name `MoonArq Instagram` and `source_type_key = instagram`. After saving, open the source detail page and choose `Connect Instagram`. The OAuth callback validates the signed state, reloads the source inside the MoonArq data space, verifies it is an Instagram source, and saves tokens only to that source.

If the source metadata includes `expected_username` or `expected_account_id`, OAuth validates the connected account against those values. Otherwise, the connector discovers and stores the Instagram account ID and username from Meta during OAuth.

## TikTok app profiles

TikTok OAuth chooses a server-side app profile from the source and data space:

- Auto Lab TikTok uses the default `TIKTOK_*` profile and keeps the existing source id `dfb2d0d1-471e-4905-9a8a-1875a39e66b5`.
- MoonArq TikTok uses the separate `MOONARQ_TIKTOK_*` profile when those env vars are configured, including sandbox credentials while the production app is in review.
- If `MOONARQ_TIKTOK_*` is absent, MoonArq TikTok falls back to the default `TIKTOK_*` profile. That fallback still requires the authorizing TikTok account to be allowed by the default app.
- Optional source metadata `tiktok_app_profile` can be set to `default` or `moonarq` if a source needs an explicit profile.

Auto Lab TikTok source:

`dfb2d0d1-471e-4905-9a8a-1875a39e66b5`

The start route requires dashboard auth and accepts `sourceId` plus `dataSpaceSlug`. The signed OAuth state binds `sourceId`, `dataSpaceSlug`, `returnPath`, nonce, and the TikTok app profile used to build the authorization URL. The callback validates the state, reloads the source inside that data space, rejects cross-space or non-TikTok sources, exchanges the authorization code server-side, and saves tokens only as encrypted credentials for that source.

Default / Auto Lab server-side environment variables:

```bash
TIKTOK_CLIENT_KEY=your-tiktok-client-key
TIKTOK_CLIENT_SECRET=your-tiktok-client-secret
TIKTOK_REDIRECT_URI=https://moonarq-data-hub.vercel.app/api/oauth/tiktok/callback
TIKTOK_API_BASE_URL=https://open.tiktokapis.com
```

Optional MoonArq server-side environment variables:

```bash
MOONARQ_TIKTOK_CLIENT_KEY=your-moonarq-tiktok-client-key
MOONARQ_TIKTOK_CLIENT_SECRET=your-moonarq-tiktok-client-secret
MOONARQ_TIKTOK_REDIRECT_URI=https://moonarq-data-hub.vercel.app/api/oauth/tiktok/callback
MOONARQ_TIKTOK_API_BASE_URL=https://open.tiktokapis.com
```

Configure this redirect URI in TikTok Developer Login Kit settings:

`https://moonarq-data-hub.vercel.app/api/oauth/tiktok/callback`

Requested scopes:

- `user.info.basic`
- `user.info.profile`
- `user.info.stats`
- `video.list`

TikTok scope behavior:

- `user.info.basic` returns core account identity such as open id and display name.
- `user.info.profile` can return username/profile links.
- `user.info.stats` can return follower count, likes count, and video count when approved.
- `video.list` returns public video rows and statistics such as view, like, comment, and share counts.

The connector normalizes official API responses into `raw_ingestions`, `content_items`, `content_metrics`, `metrics_daily`, connector events, and platform change events through the shared sync engine. It does not scrape TikTok dashboards and never returns token values to UI/API responses.

## MoonArq TikTok

Create the source in `/w/moonarq/dashboard/sources/new?template=tiktok` with display name `MoonArq TikTok` and `source_type_key = tiktok`. After saving, open the source detail page and choose `Connect TikTok`.

MoonArq TikTok should use `MOONARQ_TIKTOK_*` when a separate MoonArq production or sandbox app profile is available. If those env vars are absent, it uses the default profile fallback. In either case, synced records remain scoped by `source_id` and `data_space_id`, so MoonArq and Auto Lab reports, exports, dashboards, health, sync, content, and Data Explorer views stay isolated.

## Shopify client credentials

Create the source at `/w/moonarq/dashboard/sources/new?template=shopify` using the store's canonical `https://your-store.myshopify.com` URL. In Shopify Dev Dashboard, create an app owned by the same organization as the store, release a version with only `read_orders`, and install it on that store. Save the app Client ID and Client secret on the MoonArq source detail page; both are encrypted server-side.

The connector exchanges those credentials for a 24-hour access token on the server for each test or sync. Tokens and client credentials are never written to raw ingestion payloads or returned to the UI. Each run fetches a complete overlapping 60-day order window, excludes test orders, and upserts store-local daily rollups so retries do not double count.

The API projection includes order IDs, timestamps, currency totals, and line-item names and quantities. It deliberately excludes customer names, emails, phones, addresses, IP data, notes, and payment details. Older order history requires Shopify's separately approved `read_all_orders` access and is not requested by this connector.

Scaffolded:
- Vercel project: deployment metadata later.
- Custom API: generic JSON API later.
- Custom CSV: manual upload later.
