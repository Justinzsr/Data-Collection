# Available campaign history

Campaign history is a read-only official report, fetched inside the existing
per-source shared sync lease with the encrypted server-side credentials. It
does not alter ads, budgets, bids, delivery or platform connections.

Meta requests campaign totals (`level=campaign`, `time_increment=all_days`) over
an explicit account-local date range ending yesterday. Its start is 37 calendar
months before that end date, with month-end clamping, plus one day to stay inside
the API's retention boundary. The start is raised when needed to stay after the
same clamped boundary relative to today's account-local date. The official `lifetime` preset was removed in
Graph API v10; `maximum` is limited to 37 months. ChatGPT requests campaign
aggregation with no segmentation, `time_granularity=none`, and
`zero_impression_items`, covering the latest 365 completed account-local days.
These are **available history** windows. Neither proves complete campaign
lifetime coverage. Account-local current-day results remain separate and may be
partial; spend can be revised after initial reporting.

Storage keys are `meta_ads_history_spend`, `_impressions`, `_clicks`, and
`_campaign_count`, with corresponding `chatgpt_ads_history_*` keys. They are
snapshot metrics outside the existing daily replacement keys. Each batch has
one `campaign_history_report` count marker and three `campaign_history_total`
facts per unique campaign. Their dimensions carry `account_id`,
`account_currency`, `account_timezone`, `report_start`, `report_end` and
`report_hash`; campaign facts also carry `campaign_id` and `campaign_name`.
Meta account IDs use bare digits; ChatGPT keeps the official account ID.
The storage date is the fetched account-local date. The shared engine persists
the marker and all facts together. A content SHA-256 covers canonical platform,
account, currency, timezone, report dates and campaign-ID-sorted rows, excluding
capture time and credentials. Identical duplicate campaign rows are removed;
conflicting duplicates invalidate the report. An empty complete report has only
a count marker of zero and does not fabricate zero-valued campaign metrics.

Use only the latest complete successful report batch for each platform/account;
never sum snapshot dates or add campaign totals to ad/day or account/day facts.
Meta historical clicks mean all clicks, while the current outbound-click funnel
keeps its existing definition. Different currencies are never combined.
Missing metrics do not become zero. Failure of this optional history query
leaves daily collection working, stores no new history batch, and records a
sanitized `historyStatus=unavailable` cursor. Existing reports can be displayed
as stale, with their actual coverage and capture time. Legacy raw snapshots
without a campaign-history field continue to normalize daily facts only.

Official references: [Meta Ads Insights](https://developers.facebook.com/docs/graph-api/reference/adaccount/insights),
[OpenAI Insights](https://developers.openai.com/ads/api-reference/insights), and
[OpenAI reporting retention](https://developers.openai.com/ads/reporting#data-freshness--retention).
