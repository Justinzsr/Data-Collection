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
