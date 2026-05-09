# Connectors

Every connector implements `ConnectorDefinition`.

MVP:
- Supabase: signup/user metrics through `public.profiles` webhook mode or service-role admin fallback.
- Website: first-party tracking through `/api/track`.
- Instagram: official Meta Graph API OAuth and manual sync for the existing isolated Auto Lab `just.4is` source only.

## Auto Lab Instagram

Auto Lab Instagram is intentionally scoped to `data_space_slug = 'auto-lab'` and the existing source id `29f678e5-820c-4de7-a128-0e56654fc51a`. Do not reuse it for MoonArq production data.

Required server-side environment variables:

```bash
META_APP_ID=1287137936945850
META_APP_SECRET=your-meta-app-secret
META_GRAPH_API_VERSION=v25.0
META_REDIRECT_URI=https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback
```

Configure the same redirect URI in the Meta Developer app's Instagram/Facebook Login OAuth settings:

`https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback`

The connector stores Meta tokens encrypted as source credentials and only returns masked hints/status to the UI. Use official Graph API/OAuth only; do not scrape Instagram or Meta dashboards.

Scaffolded:
- Vercel project: deployment metadata later.
- Shopify: Admin API later.
- TikTok: official API/OAuth later.
- Custom API: generic JSON API later.
- Custom CSV: manual upload later.
