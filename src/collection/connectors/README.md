# Connector Registry

Every platform connector exports a `ConnectorDefinition` and must support detection, connection testing, sync, normalization, setup instructions, and metric definitions.

MVP real connectors:
- `supabase`: signup/user metrics through `public.profiles` webhooks or server-side service-role fallback.
- `website`: first-party tracking through `POST /api/track`.

Scaffolded connectors:
- `vercel-project`, `shopify`, `tiktok`, `instagram`, `custom-api`, `custom-csv`.
