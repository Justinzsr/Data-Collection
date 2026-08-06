# Metric Definitions

Metrics are defined in `src/aggregation/metric-definitions/definitions.ts`.

Primary MVP KPIs:

- `page_views`
- `unique_visitors`
- `custom_events`
- `signups`
- `users_total`
- `active_sources`
- `last_sync_status`
- `sync_errors`

## Website event metrics

First-party Website Tracker events are authoritative for browser funnel metrics:

- `page_views`: stored first-party events with `event_name = 'page_view'`.
- `custom_events`: stored first-party events whose event name is not `page_view`.
- `unique_visitors`: distinct first-party `anonymous_id` values per reporting day.
- `sessions`: distinct first-party `session_id` values per reporting day.
- `events_by_path`: first-party event count grouped by path and reporting day.
- `events_by_referrer`: first-party event count grouped by normalized referrer and reporting day.

Website event-day grouping uses `occurred_at`, not `received_at`. Idempotent duplicates with the same `(source_id, event_id)` do not increment these metrics. `received_at` is reserved for ingestion latency and operational verification.

Vercel Drain events remain available as auxiliary request and infrastructure evidence but must not be added to these first-party funnel totals. Raw first-party events are retained even when Drain reports a related request.

### MoonArq Storefront funnel V1

The MoonArq Overview derives an on-demand, first-party, distinct-session funnel
from valid Contract V1 events:

1. `page_view`
2. `view_item` or `build_start` strictly after the visit
3. `add_to_cart` strictly after product intent
4. `begin_checkout` strictly after add to cart

Repeated events count once per session at each stage. Progression requires
`occurred_at` to be strictly greater than the preceding stage timestamp;
equal-time, skipped, and out-of-order signals are excluded from the monotonic
funnel and disclosed separately. Stage rates use starting or immediately
preceding distinct-session counts as documented in
[MoonArq Website Funnel Overview V1](website-funnel-overview-v1.md).

Ready-made uses `page_view -> view_item -> add_to_cart -> begin_checkout`.
Build starts, completions, and saves are separate outcomes; builder cart and
checkout are not measured until a reliable shared identity/order contract is
proven. `email_signup` is Website engagement, not a confirmed persisted
subscriber. Shopify orders and revenue remain separately labelled commerce
outcomes and are never presented as a session-linked fifth stage.

## Source-of-truth policy

- First-party MoonArq tracker: funnel behavior, pseudonymous identity, sessions, and attribution context.
- Vercel Drain: infrastructure and request-level diagnostics.
- Shopify: orders, commerce state, payments, refunds, and revenue.
- Meta: paid media delivery and spend; Meta-attributed outcomes remain platform-reported attribution.

Never sum overlapping source observations into one metric. Choose the authoritative source for the metric, preserve auxiliary raw evidence, and label source-specific attribution estimates.

Shopify commerce metrics use non-test orders from the latest overlapping 60-day window and are grouped by the store's IANA time zone:

- `orders`: order count by order creation date.
- `gross_sales`: subtotal plus pre-return discounts; shipping is excluded and separately added tax is excluded when prices are tax-exclusive.
- `current_total`: current order total after edits, returns, refunds, and cancellations.
- `net_payment`: amount received minus refunded amount.
- `refunds`: total refunded amount attributed to the original order creation date, not the refund event date.
- `top_products`: ordered line-item units grouped by order, line item, and product name.

Currency metrics are never summed across different Shopify shop currencies. Test orders are excluded.

TikTok metrics from official TikTok API sync, scoped by source and data space:

- `tiktok_video_views`
- `tiktok_likes`
- `tiktok_comments`
- `tiktok_shares`
- `tiktok_engagement_rate`
- `tiktok_followers` when `user.info.stats` is granted
- `tiktok_video_count` when `user.info.stats` is granted
- `tiktok_profile_likes` when `user.info.stats` is granted
