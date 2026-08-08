# Website Commerce Funnel V2

Status: implementation foundation. V2 is not production-enabled until every release gate in this document passes.

## Goal

V2 adds deterministic commerce linkage to the existing first-party storefront funnel:

`Website visit -> product intent -> add to cart -> checkout started -> Shopify order`

The first four stages retain the V1 session-funnel definitions. The fifth stage is eligible only when a specific first-party checkout event is carried into, and later read back from, the authoritative Shopify order. Time proximity, Email, Shopify Customer ID, IP, user agent, and fuzzy UTM matching are never substitutes for that exact link.

## Source authority

- Website Tracker owns sessions, browser behavior, consent state, and first-party acquisition context.
- Shopify owns orders, order status, payments, refunds, and recognized revenue.
- Meta Ads owns delivery, spend, and Meta's platform-attributed outcomes.
- Data Hub owns the deterministic join, coverage diagnostics, and presentation of the three distinct measurement views.

Shopify order and revenue values never come from Website events. Meta-reported purchases never overwrite Shopify orders.

## Exact linkage contract

### Checkout handoff

MoonArq already generates a UUIDv4 `event_id` for every `begin_checkout` event. When, and only when, the event payload records `consent.analytics = granted`, MoonArq may copy that one event ID into the Shopify Draft Order custom attribute:

- Shopify attribute key: `_mq_checkout_event_id`
- Value: the exact UUIDv4 of the first-party `begin_checkout` event

MoonArq must not copy `anonymous_id`, `session_id`, Email, customer ID, UTM values, Meta click IDs, cookies, or tokens into Shopify.

Data Hub reads only the exact allowlisted attribute key. It requires exactly one UUIDv4 value, normalizes it to lowercase, hashes it with SHA-256 in memory, and discards the raw value and every other custom attribute before storing the Shopify snapshot or normalized facts.

The public checkout route validates format but is not a trusted consent attestation boundary. A Shopify attribute by itself is therefore never sufficient: reporting must also find the exact stored Website event with `consent.analytics = granted`; otherwise the order remains unlinked.

### Build Your Own item continuity

MoonArq normally creates an opaque UUIDv4 for each saved/cart bracelet snapshot. V2 may carry that existing value as `item_instance_id` through:

- `build_complete` or `save_design`
- the matching `add_to_cart` item
- the matching `begin_checkout` item
- Shopify line custom attribute `_mq_item_instance_id`

The producer must generate this UUIDv4 with `crypto.randomUUID()` or, where that API is unavailable, an RFC 4122 UUIDv4 assembled from `crypto.getRandomValues()`. It must never fall back to `Math.random()`, timestamps, counters, or another predictable source. If neither secure crypto API is available, the producer omits `item_instance_id` and the path remains unlinked.

The catalog `item_id` is unchanged. `item_instance_id` identifies one bracelet design/cart instance and must never become a product dimension or a displayed table value.

Without explicitly granted analytics consent, MoonArq omits the instance UUID from both structured Shopify attributes and the Draft Order note; the checkout remains operational but unlinked.

Data Hub applies the same exact-one, UUIDv4, lowercase, SHA-256, raw-discard rule to the line attribute.

`build_start` remains an unlinked intent event because no persisted bracelet instance exists yet. A future journey ID is required before V2 can claim instance-level continuity beginning at the first builder interaction.

## Link states

Both order and line linkage use fail-closed states:

- `matched`: exactly one allowlisted attribute exists and is a valid UUIDv4; only its SHA-256 is stored.
- `missing`: the allowlisted attribute is absent.
- `invalid`: exactly one allowlisted attribute exists but is not a UUIDv4.
- `ambiguous`: the allowlisted key occurs more than once, even if the values are identical.

Missing, invalid, ambiguous, pre-coverage, consent-blocked, and fallback-checkout records are unavailable for deterministic attribution. They are not zero orders.

## Internal commerce facts

V2 stores Shopify order facts separately from `metrics_daily` so a daily aggregate is never used as a row-level identity source.

The internal tables contain only:

- source ownership
- hashed Shopify order and line identifiers
- order time, cancellation state, currency, totals, net payment, and refunds
- quantity
- hashed checkout event or item instance linkage
- linkage state and definition version

They contain no customer name, Email, phone, address, note, arbitrary custom attribute, raw linkage UUID, URL, cookie, or Meta click ID. Browser roles have no table privileges; row-level security remains enabled.

The Shopify connector replaces the overlapping 60-day fact window under the existing source lock. Test orders remain identifiable and are excluded from business conversion metrics.

The fact writer is dormant by default. Unless the server-only environment variable `ENABLE_SHOPIFY_COMMERCE_FACTS_V2` is exactly `true`, the connector does not build commerce facts or a replacement window, and the sync engine does not call the commerce repository. This keeps the backward-compatible V1 Shopify sync independent of V2 required-money validation until the schema and recovery gates below have passed.

The 60-day query is an explicit freshness boundary, not indefinite order-ledger reconciliation. Facts older than the current window may be retained for history, but a cancellation or refund first reported after an order leaves that window will not be refreshed by this foundation. Any UI range outside the actively reconciled window must therefore be `Partial coverage` until a separate updated-order/backfill process is implemented and verified.

## Fifth-stage eligibility

An order can enter the strict fifth stage only when all of the following are true:

1. Exactly one authoritative Website source and one authoritative Shopify source resolve inside the same data space.
2. The Website row is a valid, first-party `begin_checkout` event whose stored analytics consent is explicitly `granted`.
3. The order has `checkout_link_state = matched`.
4. The stored checkout hash exactly equals the lowercase SHA-256 of that event's UUID.
5. The order is non-test and is not earlier than the checkout event.
6. The Website session satisfied the V1 strictly-later visit, intent, cart, and checkout sequence for the selected segment.
7. For a Build Your Own item-level claim, at least one valid instance hash also matches the build/cart/checkout path and the Shopify order line.

Duplicate/replayed IDs, cross-source matches, cross-data-space matches, late or reversed timestamps, and ambiguous identities fail closed.

## Coverage and display rules

The V2 UI must show linkage coverage next to any linked order count or revenue value:

- checkout events eligible for linking
- Shopify orders carrying a valid link
- exactly linked checkout sessions and orders
- unlinked, invalid, ambiguous, consent-blocked, fallback, and pre-coverage counts when measurable

The Shopify fifth-stage row is `Not measured` while the handoff has not been verified or when the selected cohort lacks sufficient linkage coverage. A partial linked count may be shown as a diagnostic, but must not be presented as the complete conversion rate.

Historical orders without the attribute remain pre-coverage. V2 does not backfill them with UTM or timestamp guesses.

An absent source, missing metric row, disabled module, failed sync, or not-yet-covered date must render as `Not measured` or `Unavailable`; it must never be coerced to numeric zero. A true zero is displayable only when an authoritative, healthy source returned a complete covered interval whose measured value is zero.

Website `visitors` remain observed browser identities, not verified people or customers. Known bot, synthetic, local-development, and test traffic must be excluded from the business conversion view and reported as separate quality diagnostics. V2 must not silently change the existing V1 population: any stricter business segment is a new, versioned definition with its own denominator and excluded-count disclosure.

The V2 business segment requires `client_context.traffic_type = production` on every event in the session and excludes any session classified as `device_category = bot`. MoonArq emits the production marker only from the canonical production-origin tracker. Synthetic, local, test, legacy-unmarked, mixed-marker, and known-bot sessions do not enter the V2 funnel; their excluded session counts remain aggregate diagnostics. This is a stricter V2 population and does not relabel V1 visitors as verified people.

### KPI dictionary

- `linked Shopify orders placed`: distinct non-test Shopify orders that satisfy the exact fifth-stage rules, regardless of a later cancellation; counted by order time.
- `active linked Shopify orders`: linked orders placed whose `cancelled_at` remains null. This is a separate operational status, not a rewrite of the historical conversion event.
- `linked order rate`: linked Shopify orders divided by eligible first-party checkout events in the same declared cohort. Both numerator and denominator, cohort basis, and coverage must be shown.
- `link coverage`: orders with one valid checkout bridge divided by all eligible Shopify orders after the verified rollout boundary. Invalid and ambiguous bridges are separate diagnostics, not matches.
- `gross sales`, `current total`, `net payment`, and `refunds`: separate Shopify-authoritative monetary fields. V2 must label the selected revenue field explicitly and must not collapse them into an unlabeled `revenue` value.
- `Build Your Own linked lines`: distinct Shopify order lines whose exact item-instance hash matches the reviewed builder/cart/checkout path. It is an item-level diagnostic, not an additional order.

Cancelled, refunded, test, and pre-coverage orders remain visible in reconciliation diagnostics with their own status; they are never silently removed from source totals or mixed into the strict conversion numerator.

## Meta boundary

Meta Marketing API Insights is aggregate reporting and does not provide a person-level click log that Data Hub can join to each `fbclid`. V2 therefore exposes three different views:

1. Meta platform delivery, spend, and platform attribution.
2. First-party Website sessions carrying exact UTM/click context.
3. Website checkout events deterministically linked to Shopify orders.

Where stable Meta campaign/ad IDs or an exact, unique UTM mapping exist, Data Hub may label a linked first-party path as Meta-tagged click-through attribution. It must never describe that result as a verified Meta impression/person identity join. View-through attribution remains Meta-reported only.

Meta Insights cursor dates are calendar dates in the selected ad account's IANA time zone, while V2 range keys use `America/Los_Angeles`. Each new raw/sync cursor persists `accountTimeZone`; Data Hub may show Meta values only when that cursor zone exactly resolves to `source.metadata.account_timezone`, both resolve to Pacific boundaries, and the latest successful cursor for the same selected account proves the entire Pacific selection. A missing/invalid/mismatched zone or a non-Pacific account zone makes coverage unavailable/partial and suppresses Meta values; metric rows alone never prove range coverage.

Shopify commerce coverage ends at the latest successful matching snapshot cursor's `fetchedAt`, not at the later operational `sources.last_success_at`. The report query and source-readiness display use that same snapshot boundary, so orders created during API fetch and persistence are not claimed until a later snapshot actually observes them. Missing, invalid, stale-run, or source-mismatched cursor evidence fails closed and withholds commerce values.

Checkout bridge uniqueness is evaluated across every retained matched order for the resolved Shopify source before the selected interval, test, or rollout filters are applied. A replayed hash on a test, pre-coverage, or out-of-range order therefore makes the otherwise eligible in-range order ambiguous rather than linked.

## Release gates

Release order is fixed:

1. Deploy the backward-compatible Data Hub reader and hidden writer with `ENABLE_SHOPIFY_COMMERCE_FACTS_V2` absent or set to `false`. Verify a normal Shopify sync still writes only the existing raw/metric/content surfaces and does not evaluate V2 required-money rules or call the commerce tables.
2. Apply migration `0011_shopify_commerce_bridge_facts.sql` to the target Supabase database. Verify both tables exist, RLS is enabled, and `PUBLIC`, `anon`, `authenticated`, and `service_role` have no table privileges. Run the full Data Hub CI matrix against PostgreSQL 17, including flag-off and flag-on tests; do not infer Production ACL state from CI alone.
3. Before enabling the flag, close the partial-write boundary in one of two reviewed ways: place raw ingestion, metric/content replacement, and commerce-fact replacement in one database transaction under the source lock; or implement and prove deterministic partial-write detection, recovery, and reconciliation. The source lock alone is not an atomicity guarantee, so the flag remains off until one path is verified.
4. In an approved Shopify development/test store, create a synthetic Draft Order and complete a test purchase. Prove that the exact order and line custom attributes survive Draft Order invoice checkout into the final Order/LineItem API response, and prove Data Hub's reader retains only hashes/states—not arbitrary attributes or raw linkage UUIDs.
5. Only after steps 1-4 pass, set `ENABLE_SHOPIFY_COMMERCE_FACTS_V2=true` in the Data Hub server environment and redeploy that exact reviewed release. Do not enable the flag before migration `0011` and its ACL checks are complete.
6. Observe a bounded Shopify sync with the fifth-stage UI still hidden. Reconcile raw/metrics/content/facts, verify no partial write, confirm no raw event UUID, item-instance UUID, checkout hash, or item-instance hash appears in `/api/events` or Source Data Explorer, and verify rollback by returning the flag to `false`.
7. Deploy the consent-gated MoonArq handoff only after the dormant reader/writer and enabled consumer have been proven safe. Observe dual-source coverage and reconcile approved synthetic paths.
8. Enable the V2 UI only after coverage, source health, timestamp ordering, privacy, no-leak, transaction/recovery, and rollback tests pass.

The server-only UI flag is `ENABLE_MOONARQ_COMMERCE_FUNNEL_V2`. It defaults to `false` and must remain false until step 8. The writer flag and UI flag are independent so facts can be reconciled while the customer-facing report remains hidden.

Production verification must use approved synthetic data, avoid customer PII, and record before/after evidence for all systems touched.

## Rollback

Rollback the producer before the consumer:

1. Disable or roll back the MoonArq attribute writer.
2. Keep Data Hub's backward-compatible reader and fact tables in place while confirming no new linked rows arrive.
3. Hide the V2 UI if it was enabled.
4. Remove storage only in a separately reviewed migration after the retention and recovery decision is explicit.

The existing V1 funnel and Shopify operational totals must continue to work throughout rollout and rollback.
