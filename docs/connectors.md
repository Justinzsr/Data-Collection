# Connectors

Every connector implements `ConnectorDefinition`.

MVP:
- Supabase: signup/user metrics through `public.profiles` webhook mode or service-role admin fallback.
- Website: first-party tracking through `/api/track`.
- Instagram: official Meta Graph API OAuth and manual sync for isolated source-specific Instagram accounts.
- TikTok: official TikTok Login Kit OAuth and API v2 sync for data-space-scoped TikTok sources.

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
- MoonArq TikTok also uses the default `TIKTOK_*` profile by default so it can share the reviewed TikTok OAuth app while saving tokens and data only to the MoonArq source.
- Optional source metadata `tiktok_app_profile` can be set to `moonarq` later if a source needs the separate `MOONARQ_TIKTOK_*` app profile after that TikTok app is ready.

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

By default, MoonArq TikTok uses the same reviewed TikTok app profile as Auto Lab. Synced records remain scoped by `source_id` and `data_space_id`, so MoonArq and Auto Lab reports, exports, dashboards, health, sync, content, and Data Explorer views stay isolated. Set source metadata `tiktok_app_profile = "moonarq"` only after the separate MoonArq TikTok app profile is ready.

Scaffolded:
- Vercel project: deployment metadata later.
- Shopify: Admin API later.
- Custom API: generic JSON API later.
- Custom CSV: manual upload later.
