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

## Dataset and metric contract

The authenticated API snapshot preserves all 16 source fields: `id`, `email`, `email_normalized`, `source`, `discount_code`, `consent_email_marketing`, `page_url`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `promo_email_sent`, `zapier_sent_at`, `shopify_customer_id`, `created_at`, and `updated_at`. The UI table intentionally displays only its existing subset.

`Promo emails sent` counts every source row whose raw `promo_email_sent` flag is true. `Pending promo emails` counts consented, unsent rows. The send rate and eligible promo-status chart use only consented records: sent means consented and sent, pending means consented and not sent. An anomalous sent flag on a non-consented row remains visible as raw source data but does not enter the eligible rate or pie chart.

## Refresh behavior

The client fetches immediately, then refreshes every 60 seconds while the view is mounted and the browser tab is visible. Polling pauses while hidden, prevents overlapping requests, and cleans up its interval and active request on unmount. Manual refresh uses the same internal endpoint.

If a later refresh fails, the most recent successful dataset remains visible and is marked stale. The application does not silently downgrade to an hourly cadence because the current Next.js/Vercel runtime supports visible-page polling.

Source timestamps remain UTC in the data model and are displayed in `America/Los_Angeles` (PT), matching the rest of the Data Hub.
