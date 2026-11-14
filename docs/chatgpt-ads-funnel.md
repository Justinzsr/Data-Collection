# ChatGPT Ads and the visitor funnel

Connect **ChatGPT Ads** from Add Source using an account-scoped Advertiser API key
created in Ads Manager Settings. This is distinct from a model API key or the
ChatGPT Ads Manager plugin connection. The existing credential store encrypts the
key per source, and only the server uses it. The source pins the first verified
account and rejects keys for a different account on subsequent syncs.

The connector only reads official account and reporting APIs. It never creates
ads, changes bids or budgets, activates delivery, or scrapes dashboards. Initial,
manual, retry and scheduled syncs use the shared engine's source lease, raw
payload hashes and idempotent daily-window replacement. A 30-day overlapping
lookback lets delayed spend and attribution be updated. An empty successful
report does not fabricate daily zeros; failed reports retain the previous data.
Unsegmented account/day delivery requests include `zero_impression_items` so
OpenAI can return explicit zero-delivery rows. Those reported zeros are stored;
missing rows and null or absent metric fields remain unknown.

## Performance

The ChatGPT Ads platform page shows spend, impressions, clicks, weighted CTR,
CPC, CPM, attributed goals, click/view-through goal counts, post-click goal CVR,
attributed order value and platform ROAS when those facts are available. The
Overview gains a platform card once the source is connected. The Website page
also shows the paid visitor funnel for that source.

Money uses the account's reported currency units, with no micros conversion or
cross-currency summation. Reports use the verified account's calendar. Ratios
use sums on matching reported dates; daily percentages are never averaged.
Fractional attributed goals remain fractional in tiles, charts and daily tables.
Missing measurements and unknown denominators render as unavailable.

Goal attribution is fixed to a 30-day click window, 1-day view window and
`ad_event_time`. Goal conversions are the account's configured campaign goals,
not necessarily purchases. Post-click CVR uses click-through goal conversions
divided by clicks. Platform-attributed order value includes eligible
`order_created` events and is distinct from authoritative Shopify revenue.

## Connect the journey

Tag every ad destination with:

```text
utm_source=chatgpt&utm_medium=paid&utm_campaign=your_campaign_name
```

The existing first-party tracker retains these values. The paid cohort selects
the first accepted visit's exact `chatgpt` source and `paid` medium, then follows
the existing production, consent, bot and sequence checks through product
intent, cart and checkout. Organic ChatGPT referrals or later-added tags do not
enter this paid cohort. Existing filters still expose the underlying visit
breakdowns.

Shopify orders join only through the consent-gated checkout-event bridge, never
by UTM, email, customer ID or temporal proximity alone. Its verified coverage,
source freshness and feature gates stay in force. Missing, ambiguous or
pre-coverage orders cannot be assigned to this channel and remain unavailable
rather than becoming zero. Orders with replayed checkout hashes remain excluded
across the whole Shopify source, even when the other order belongs to a
different traffic cohort.

The platform and first-party layers intentionally retain their own time zones,
reporting delays and attribution definitions. Ad clicks are not claimed to be
individual matched website sessions.

No production credentials or deployment are required for local review. The
existing opt-in local fixture flag can show synthetic examples at the ChatGPT
Ads page with `demo_state=ads-live`; fixtures require an unconfigured database
and are visibly labelled Sample data.

Official references: [Advertiser API](https://developers.openai.com/ads/api-overview),
[Insights](https://developers.openai.com/ads/api-reference/insights),
[reporting and attribution](https://developers.openai.com/ads/reporting).
