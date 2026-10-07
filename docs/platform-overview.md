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
| Whatnot card (once Whatnot is added) | Completed sales, orders, net earnings, through the last day the imported reports cover | `platforms/whatnot` |
| Instagram card | Followers, post reach, engagement | `platforms/instagram` |
| TikTok card | Followers, video views, engagement | `platforms/tiktok` |
| Supabase card | New signups, total users, confirmed users | `platforms/supabase` |

MoonArq always shows the five core cards, with a setup prompt when a platform is not
connected, and adds Whatnot once a Whatnot source exists. Other spaces (Auto Lab) show only the platforms they have. A connection
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

## Whatnot

Whatnot data comes from the Seller Weekly Orders Report the seller uploads each week (see
`docs/connector-roadmap.md`). Each report holds the transactions that completed from Monday 00:00
to Sunday 23:59 UTC. An order completes about four hours after delivery is confirmed (or when its
label is created with Early Payout), so it lands in the report of the week it completed, often days
after it was placed. Every Whatnot value is therefore dated by the Pacific day the transaction
completed, the same clock the reports are cut on.

| Value | Definition |
| --- | --- |
| Completed sales | Post Coupon Price (item price after seller coupons, the amount Whatnot charges commission on) on Order Earnings rows, giveaways excluded |
| Orders | Distinct Order IDs on Order Earnings rows, per day, giveaways excluded |
| Items sold | Quantity Sold on Order Earnings rows (one when blank), giveaways excluded |
| Avg. order value | Completed sales ÷ orders |
| Net earnings | Signed Transaction Amount on every row: what reached the Whatnot balance after fees, refunds, tips, shipping charges, and the shipping the seller paid for giveaways |
| Fees | Commission, payment processing, and the taxes on both, on Order Earnings rows |
| Refunds | Amounts returned to buyers on Order Refund rows |
| Tips | Tips rows |
| Completed sales by show | Sales, orders, and items per Livestream ID that completed in the period, labelled with the day the show ran (its earliest order); sales outside a show are one marketplace row |

Giveaways are Order Earnings rows with Buy Format "Giveaway": a $0 price and a negative amount,
because the seller pays the shipping. They are not sales or orders.

- **Covered days.** A report covers Monday through Saturday on Pacific dates completely; its Sunday
  is split with the next report, so a Sunday counts once the reports on both sides of it are
  imported. Totals add up covered days only. Days inside a week that was never imported are unknown
  rather than zero: the daily chart leaves them empty and its table reads "Not imported". The chart
  ends at the last covered day. The Today range has no Whatnot data, because reports arrive weekly,
  and a 7-day range only reaches as far as the latest report.
- **Changes.** The covered part of the range is compared with the same days one period earlier.
  When that earlier window is not fully covered, the change reads "No earlier data"; when the range
  itself has a missing week inside it, the value reads "Incomplete" and is not compared.
- **Report weeks.** The page lists every week from the newest one Whatnot has published back to the
  first one imported: imported, recorded as having no sales, missing between imports, or ready to
  import. Missing weeks turn the card amber ("1 week missing"); a newer published report turns it
  amber too ("New report ready"). A week the seller sold nothing in has no rows for a report, so it
  can be recorded as **No sales that week** (from the first imported week onward), which stores zeros
  marked as such. An imported week can be removed when it was imported by mistake. Both ask for
  confirmation, and both check the week again while holding the source's sync lock, so neither can
  overwrite an import of the same week that finished a moment earlier.
- **One week per file.** An upload must be one Weekly Orders Report, as downloaded: a file whose
  transactions span two report weeks, or a week that has not ended, is refused. The report week
  comes from the completion times; Report Start Date (the week's Monday in UTC) must agree with them.
- **Re-imports.** Importing a week again, recording it as having no sales, or removing it first
  deletes everything stored for that week (in one transaction, while the source's sync lock is
  held), then writes the new rows. A corrected report therefore replaces the old one completely,
  renamed and dropped shows included, and never touches the neighbouring week that shares its Sunday.
- **Files that would import wrong numbers are refused.** The importer rejects the whole file, with
  the row number, when a completion time or a value a metric reads (amount, price, fees, quantity)
  cannot be read, when amounts use decimal commas (`48,00`), when dates are written day first
  (`28/09/2026`) or do not match Report Start Date, when an ID was rewritten in scientific notation
  (`1.23E+17`), when a row has a different number of columns than the header (an unquoted comma
  shifts the columns), when a quoted value is never closed, and when two sales share a Ledger
  Transaction ID but differ. Exact repeats of a row count once, and so does a charge or tip listed
  once per order it covers. Lines without a Ledger Transaction ID (totals, notes, rows without a
  completion time or amount) are left out and counted in the import message; more than one such
  line, and more than 10% of the file, rejects it. Columns no metric reads, such as Cost of Goods,
  are never parsed, so they cannot reject a file. Error messages never repeat the file's contents.
- **Known limits.** A file re-saved with day-first dates still imports misdated if every day number
  is 12 or less, all transactions completed on one day, and Report Start Date is blank; that week
  then shows up as imported and can be removed. Removing a week deletes its numbers but keeps its
  raw snapshot (order IDs, amounts, show titles; never buyer details) in the import history.

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
