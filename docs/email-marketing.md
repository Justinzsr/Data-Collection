# Email Marketing Supabase View

The MoonArq Email Marketing view is available at:

`/w/moonarq/dashboard/supabase/email-marketing`

It is a read-only child view of the existing MoonArq Supabase module. The view reads `public.email_signups` directly from the monitored `moonarq-web` Supabase source that is already stored in the MoonArq data space.

## Source and security

- The source of truth is `moonarq-web.public.email_signups`.
- The Data Hub runtime database is not queried for this table.
- Google Sheets is not used.
- The existing per-source `service_role_key` is decrypted only in the server-only adapter.
- The adapter requires the exact `moonarq-web` project reference and fails closed if a different Supabase project is configured.
- The browser calls the authenticated internal `/api/metrics/email-signups` route and never receives a service-role key.
- The internal response is `private, no-store` and the adapter only performs `select` queries.
- The view does not call Zapier update routes and does not mutate `promo_email_sent`, `zapier_sent_at`, `shopify_customer_id`, or any other source field.

No new environment variables are required when the existing monitored MoonArq Supabase source and encrypted credential are configured. The ambiguous global Supabase variables in `.env.example` are not used for this view.

## Refresh behavior

The client fetches immediately, then refreshes every 60 seconds while the view is mounted and the browser tab is visible. Polling pauses while hidden, prevents overlapping requests, and cleans up its interval and active request on unmount. Manual refresh uses the same internal endpoint.

If a later refresh fails, the most recent successful dataset remains visible and is marked stale. The application does not silently downgrade to an hourly cadence because the current Next.js/Vercel runtime supports visible-page polling.

Source timestamps remain UTC in the data model and are displayed in `America/Los_Angeles` (PT), matching the rest of the Data Hub.
