# Connectors

Every connector implements `ConnectorDefinition`.

MVP:
- Supabase: signup/user metrics through `public.profiles` webhook mode or service-role admin fallback.
- Website: first-party tracking through `/api/track`.
- Instagram: official Meta Graph API OAuth and manual sync for isolated source-specific Instagram accounts.

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

Scaffolded:
- Vercel project: deployment metadata later.
- Shopify: Admin API later.
- TikTok: official API/OAuth later.
- Custom API: generic JSON API later.
- Custom CSV: manual upload later.
