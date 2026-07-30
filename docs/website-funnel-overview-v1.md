# MoonArq Website Funnel Overview V1

The canonical MoonArq Overview at `/w/moonarq/dashboard` derives storefront
behavior from the authoritative first-party Website Tracker. It is an on-demand,
read-only view over retained `web_events`; V1 does not add a migration or a
persisted funnel table.

## Source roles

- Website Tracker (`source_type_key = 'website'`,
  `event_source = 'first_party_tracker'`) is authoritative for storefront
  sessions, period-distinct visitors, behavior, sequencing, and normalized
  on-site attribution.
- Vercel Drain is auxiliary request and infrastructure evidence. Its events are
  retained but never added to the first-party funnel.
- Shopify is authoritative for orders, payments, refunds, and recognized
  revenue. Commerce outcomes are shown beside, but never joined to, Website
  sessions.
- Meta is authoritative for paid-media delivery and spend. Existing AIDMA
  results remain platform-attributed proxies rather than first-party funnel
  stages.

The query fails closed when the selected data space does not have exactly one
enabled Website source. A source in a warning or error lifecycle state is shown
as unhealthy; another Website source is never selected by preference or summed
silently.

## Canonical event taxonomy

Only these accepted first-party events participate in Storefront V1 reporting:

- `page_view`
- `view_item_list`
- `view_item`
- `add_to_cart`
- `begin_checkout`
- `build_start`
- `build_complete`
- `save_design`
- `email_signup`

Unknown accepted event names remain in aggregate diagnostics. Known events with
missing, extra, incorrectly typed, or out-of-bounds frozen properties are
retained as raw evidence and counted in invalid-property diagnostics, but are
not inferred into a funnel stage or named product/collection row.

For backward compatibility, ingestion may retain a normalized `attribution`
copy inside `properties` in addition to `attribution_context`. Funnel validation
treats only that transport copy as envelope metadata; it is removed before the
frozen property shape is checked and never used as a commerce property.

## Primary funnel

The primary unit is a distinct Website Tracker `session_id`. Every stage requires
the same session and strict client occurrence order:

1. Website visit: at least one valid `page_view`.
2. Product intent: the first valid `view_item` or `build_start` strictly after
   the visit.
3. Added to cart: the first valid `add_to_cart` strictly after product intent.
4. Checkout started: the first valid `begin_checkout` strictly after add to
   cart.

A session counts at most once per stage. Stage event context reports qualifying
valid raw events, while the headline is always distinct sessions. Rates use:

- percent of start = stage sessions / visit sessions;
- from previous = stage sessions / immediately preceding stage sessions;
- drop-off = preceding stage sessions - stage sessions;
- period change = (current stage sessions - previous stage sessions) / previous
  stage sessions.

A zero denominator returns `null`, rendered as `—` or `No baseline`; it never
becomes infinity, NaN, or an invented 100% change.

`occurred_at` is the only sequence clock. Because Contract V1 has no client
sequence number, equal timestamps are conservatively excluded from progression
and reported separately. Out-of-order and skipped-stage activity is also
reported in the data-quality disclosure rather than forced into a monotonic
path.

The funnel ends at checkout started. A Shopify order is not a fifth stage, and
event `value` is never treated as recognized revenue.

## Journey details

Ready-made uses the strict same-session path
`page_view -> view_item -> add_to_cart -> begin_checkout`. A direct product
landing is valid; `view_item_list` is not required. Product view-to-cart rates
are available only where the validated item records share an exact stable
`item_id`; V1 does not guess across SKU and slug identities and never assigns
checkout or revenue to a product by URL.

Build Your Own reports build starts, completions, and design saves. Completion
and save are separate outcomes strictly after a build start. Save is not assumed
to follow completion. The deployed tracker contract does not yet prove reliable
builder-to-cart identity, so builder cart/checkout stages, trends,
acquisition/device checkout counts, and checkout rates are explicitly
`Not measured`, not zero.

Website Tracker `email_signup` is a separate engagement outcome. It is not a
mandatory commerce stage and is never summed with PR #10's persisted Supabase
email subscription records.

Collection discovery reports valid `view_item_list` sessions and only exact,
strictly later item progression that can be proven from validated item
identities.

## Time ranges, comparison, and filters

Today, 7-day, and 30-day selections use Pacific Time and half-open UTC bounds
`[start, end)`. Event-day grouping uses `occurred_at`; `received_at` supplies the
freshness timestamp. Today is partial through the current instant. Its previous
comparison uses the same elapsed duration from the prior Pacific-day boundary.
If a 25-hour DST day would make that equal-duration window cross the prior
period boundary, or if tracking coverage is unavailable, comparison is
suppressed with an explanation.

The previous-period comparison has the same reporting length as the selected
range. Dates before the first retained first-party event are unavailable, not
zero.

Segment, device, normalized UTM source/medium/campaign, landing path, and
normalized referrer host are server-side query filters. They recompute the
funnel rather than filtering only a rendered table. Missing or conflicting
normalized context remains `Unknown`; the system does not fabricate a Direct
channel, browser, country, or demographic dimension.

## Query, privacy, and performance

Production executes one fixed parameterized aggregate query inside a
repeatable-read, read-only transaction with a local statement timeout. The
repository:

- scopes to the exact data-space-owned Website source;
- requires `event_source = 'first_party_tracker'`;
- applies half-open bounds and the canonical taxonomy;
- defensively deduplicates `(source_id, event_id)`;
- performs grouping, sequencing, and final-group pagination in PostgreSQL;
- bounds each filter-option vocabulary to 100 sorted values while preserving
  any active URL-selected value;
- has no raw-event row cap and does not use `/api/events`,
  `findWebEvents()`, or the bounded platform-module sample;
- returns aggregate rows only.

The existing source/time, event/time, session/time, anonymous/time, and
source/event idempotency indexes support this access pattern, so V1 requires no
schema change.

The aggregate response must not contain source, event, session, anonymous, or
user IDs; tracking keys; IP or user-agent data; raw URLs or referrers; event
properties/contexts/payloads; credentials; or PII. Product and collection labels
come only from the frozen validated event contract. Demo and browser QA use
deterministic sanitized fixtures.

## Honest states and reconciliation

The Overview distinguishes source unavailable/ambiguous, pre-coverage, no
events, filtered-empty, comparison unavailable, low volume, invalid metadata,
and delayed/disagreeing daily aggregate states. Fewer than 20 starting sessions
shows `Limited data — rates are directional` while retaining exact counts and
rates.

Raw event totals are reconciled with `metrics_daily` only for additive,
like-for-like `page_views` and `custom_events` definitions. True period-distinct
visitors and sessions are never compared with sums of daily distinct values.
The daily reconciliation is source-wide, so it is suppressed for filtered
cohorts. When raw events exist before the corresponding daily rows are present,
the state is `delayed` rather than a false disagreement.
