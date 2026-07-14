# Connector Registry

Every platform connector exports a `ConnectorDefinition` and must support detection, connection testing, sync, normalization, setup instructions, and metric definitions.

MVP real connectors:
- `supabase`: signup/user metrics through `public.profiles` webhooks or server-side service-role fallback.
- `website`: first-party tracking through `POST /api/track`.
- `instagram`: official Meta/Instagram Graph API metrics through OAuth.
- `tiktok`: official TikTok Login Kit and Display API account/video metrics through OAuth.
- `shopify`: official Admin GraphQL API order metrics through encrypted Dev Dashboard client credentials.

Scaffolded connectors:
- `vercel-project`, `custom-api`, `custom-csv`.
