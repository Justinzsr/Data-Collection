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

Commerce metrics are scaffolded but not dominant until Shopify is connected.

Auto Lab TikTok metrics from official TikTok API sync:

- `tiktok_video_views`
- `tiktok_likes`
- `tiktok_comments`
- `tiktok_shares`
- `tiktok_engagement_rate`
- `tiktok_followers` when `user.info.stats` is granted
- `tiktok_video_count` when `user.info.stats` is granted
- `tiktok_profile_likes` when `user.info.stats` is granted
