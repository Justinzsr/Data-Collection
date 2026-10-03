# Platform Overview

The Overview at `/w/<space>/dashboard` answers one question: how is each platform
doing right now? It shows the paid-ads monitor first, then one card per platform.
Each card opens a detail page under `/w/<space>/dashboard/platforms/<platform>`.

Everything on these pages is read from rows the shared sync engine has already
stored; rendering a page never calls a platform API itself. Syncs start from the
hourly cron, the **Refresh now** / **Sync now** buttons, and the live paid-delivery
sync described under [Freshness](#freshness). All of them go through the same
locked, idempotent engine.

## Layout

| Section | What it shows | Detail page |
| --- | --- | --- |
| Meta Ads monitor | Spend so far today, delivery status, the selected period with direction of change, daily spend, freshness | `platforms/ads` |
| Website card | Sessions, visitors, checkout starts (first-party tracker) | `platforms/website` (the storefront funnel analysis) |
| Shopify card | Net payment, orders, average order value | `platforms/shopify` |
| Instagram card | Followers, post reach, engagement | `platforms/instagram` |
| TikTok card | Followers, video views, engagement | `platforms/tiktok` |
| Supabase card | New signups, total users, confirmed users | `platforms/supabase` |

MoonArq always shows these five cards, with a setup prompt when a platform is not
connected. Other spaces (Auto Lab) show only the platforms they have. A connection
that needs attention (expired, expiring, or revoked authorization, failed or
overdue sync, unfinished setup) is listed in one line under the header. Only
scheduled sources can be overdue: the website tracker and webhook or manual
sources have no schedule to fall behind, and a webhook or manual source that has
not received anything yet reads "No data yet".

The page re-reads stored data every five minutes while it is visible. Older links
that carried storefront filters (`utm_*`, `segment`, `trend`, and so on) are
forwarded to the Website page after the same privacy sanitization as before.

## How change is measured

Every number shows its direction with an arrow and a signed value. Green means
better for the business, red worse, gray neutral or flat; the hover title and the
screen-reader text say "better" or "worse" in words. Spend is neutral; costs (CPC,
CPM, cost per purchase) are better when lower.

- **Summed values** (spend, clicks, orders, net payment, signups) compare complete
  days only. The current period without today is compared with the previous period
  of the same length without its matching last day: for the last 7 days ending
  Apr 22, Apr 16–21 against Apr 9–14. Both sides cover the same days of the week,
  and a day that is still in progress never makes a period look worse. The headline
  total still includes today.
- **Today** has no period-over-period change. The ads monitor shows yesterday's full
  day beside today so far instead.
- **Snapshots** (followers, totals across recent posts, engagement rate, total users)
  compare the latest value with the last value before the period began, carried
  forward across days without a sync. When history starts inside the period, the
  change is labeled "since <date>".
- **Website** sessions and checkout starts use the Website funnel's own comparison,
  which aligns to the same wall-clock time in the previous period. Visitors are
  distinct per period, so they have no like-for-like previous value.
- A zero baseline never produces a percentage; the change reads "New". A change
  below 0.05% (or 0.05 points) reads "No change".
- An unavailable value renders as an em dash, never as zero.

## Meta Ads definitions

All values come from the ad-level daily insights the Meta Ads connector stores
(`rollup = ad_daily`), filtered to the selected ad account. Days follow the ad
account's time zone: today, the selected period, its comparison, the daily charts,
and the campaigns all use the account's calendar, even when it differs from Pacific
Time. Today and yesterday stay unknown (an em dash, and "Awaiting today's data")
until a sync has run on the account's current day.

| Value | Definition |
| --- | --- |
| Spend | Sum of `meta_ads_spend` |
| Impressions | Sum of `meta_ads_impressions` |
| Link clicks | Sum of `meta_ads_inline_link_clicks` |
| CTR (link) | Link clicks ÷ impressions × 100; change in percentage points |
| CPC (link) | Spend ÷ link clicks |
| CPM | Spend ÷ impressions × 1,000 |
| Landing page views | Sum of `meta_ads_landing_page_views` |
| Purchases | Sum of `meta_ads_purchases` (Meta attribution window) |
| Purchase value | Sum of `meta_ads_purchase_value` |
| ROAS | Purchase value ÷ spend; empty when Meta reports no purchases |
| Cost per purchase | Spend ÷ purchases |
| Delivering | Today has impressions or spend |
| Active campaigns | Campaigns whose latest synced status is `ACTIVE`, among those that delivered in the last 30 days (the window every sync rewrites), whatever range is selected |

Reach is not summed across days or ads here, because that would overstate unique
people; the tracked-campaign attribution panel on the Ads page keeps its labeled
ad-day reach.

### States

`not_connected` → `needs_reconnect` (authorization expired, or a sync failed
because Meta revoked or rejected the token) → `needs_account` → `first_sync` →
`live`, with `stale` when the last sync is overdue (the next sync time plus the
larger of two intervals or three hours) and `error` when the last sync failed for
another reason. Setup states, and an error before anything was ever synced, show a
single prompt; stale and error keep the last stored values and say so.

### Freshness

The hourly cron syncs Meta Ads whether or not anyone is looking. While the
Overview or the Ads page is open in a visible tab and the connection is live or
overdue, the page also keeps delivery no more than about 15 minutes old. Once a
minute it compares the shown data with that age; when it is older, the page calls
`POST /api/sources/<id>/sync?minAgeMinutes=15`.

- The route only syncs when the source's last successful sync is still at least
  15 minutes old, through the shared, locked engine (recorded as a manual run).
  Otherwise it answers `fresh` with the server's `retry_after_ms`; the page re-reads
  only if the stored data is newer than what it shows and asks again when the
  server says the data turns stale, so a browser clock that is off cannot cause
  repeated requests. Any number of open pages, tabs, or people share one sync per
  interval.
- While another sync holds the source lock, the route answers `in_progress`
  without recording a run, and the page checks again a minute later.
- A request that fails is not retried by that tab for 15 minutes. A finished run,
  successful or not, re-reads the page, so a sync error shows its state.
- Setup states, sync errors, fixtures, and demo data never start a sync on their
  own; **Refresh now** stays available for them and always syncs.
- Each sync stores one raw snapshot of the overlapping window, so an open
  Overview adds up to three snapshots an hour beyond the cron's one.

The monitor shows when Meta Ads last synced and how it stays fresh. Meta can take
a short while to report the latest delivery, and conversion values can be revised
for days; every sync recomputes an overlapping window, so revised values replace
older ones.

## Other derived values

| Value | Definition |
| --- | --- |
| Avg. order value (Shopify) | Net payment ÷ orders |
| New signups (Supabase) | Sum of `signups` (`rollup = daily`). The connector writes only days that had signups, so a source that synced during the period shows 0 for a period without any; a source that has not synced since the period began shows an em dash |
| Post reach (Instagram) | `instagram_media_reach`, `rollup = media_sync_total`: reach summed over the recent posts in the latest sync |
| Video views (TikTok) | `tiktok_video_views`, `rollup = video_sync_total`: views summed over the videos in the latest sync |
| Engagement | The connector's engagement rate for the latest sync; change in percentage points |

Shopify values are withheld until the source is healthy and has synced
successfully, exactly as on the Shopify page.

## Local previews and browser tests

With `MOONARQ_OVERVIEW_E2E_FIXTURES=true` and no database configured,
`?demo_state=ads-live` renders deterministic Meta Ads delivery on the Overview and
the Ads page. The fixture never renders in a deployment with a database.
