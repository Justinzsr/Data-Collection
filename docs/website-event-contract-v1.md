# Website Event Contract v1

Website Event Contract v1 is the versioned, first-party analytics contract for `POST /api/track`. It is backward compatible with the legacy tracker payload while giving new installations stable event identity, explicit event and receipt times, consent, attribution, and client context.

Use the generated JavaScript snippet or React/Next helper from the Website Tracker source. Both emit v1 events and keep the existing `window.moonarqTrack(name, properties)` and `trackEvent(name, properties)` interfaces.

## Website source lifecycle

Initial lifecycle state is decided by the server during source creation. A Website Tracker persisted to runtime Postgres is inserted as `healthy` with `metadata.demo = false`; the credential-free in-memory fixture remains `demo` with `metadata.demo = true`. The same insert stores the server-generated source UUID, public tracking key, exact allowed origin, and webhook URL. Clients cannot submit an initial status or use the public update route to promote a source. Credential-required connectors retain their existing `needs_credentials` lifecycle, and this policy does not require a migration or backfill.

## Canonical payload

```json
{
  "event_id": "66b9fb4a-d506-4ebd-bcc5-7cd744b95a57",
  "schema_version": "1.0",
  "event_name": "page_view",
  "occurred_at": "2026-07-17T18:30:00.000Z",
  "anonymous_id": "pseudonymous-browser-id",
  "session_id": "pseudonymous-session-id",
  "source_id": "00000000-0000-4000-8000-000000000000",
  "public_tracking_key": "replace-with-source-public-key",
  "path": "/collections/core",
  "url": "https://www.example.com/collections/core",
  "referrer": "https://www.example.com/",
  "properties": {
    "component": "collection_grid"
  },
  "attribution": {
    "utm": {
      "source": "instagram",
      "medium": "paid_social",
      "campaign": "launch"
    },
    "click_ids": {
      "fbclid": "pseudonymous-click-id"
    },
    "landing_page": "/collections/core",
    "first_referrer": "https://www.example.com/",
    "touchpoint": "current"
  },
  "consent": {
    "analytics": "granted",
    "marketing": "unknown",
    "do_not_track": false
  },
  "client_context": {
    "language": "en-CA",
    "currency": "CAD",
    "viewport_category": "large",
    "device_category": "desktop",
    "traffic_type": "production",
    "page_type": "collection"
  }
}
```

`user_id` may be added as an optional, pseudonymous application identifier. Never use an email address, phone number, Shopify customer details, or another directly identifying value as `user_id`.

## Fields

| Field | v1 requirement | Definition |
| --- | --- | --- |
| `event_id` | Required | Client-generated UUID. Reuse it when retrying the same delivery. |
| `schema_version` | Required | Literal `"1.0"`. |
| `event_name` | Required | Stable event name such as `page_view`, `product_view`, or `add_to_cart`. |
| `occurred_at` | Required | ISO 8601 timestamp with an offset for when the browser observed the event. |
| `anonymous_id` | Required | Pseudonymous browser or device identifier. |
| `session_id` | Required | Pseudonymous browsing-session identifier. |
| `user_id` | Optional | Pseudonymous signed-in user identifier; never raw account or contact data. |
| `source_id` | Required | Website Tracker source UUID. It must resolve to the same source as `public_tracking_key`. |
| `public_tracking_key` | Required | Public, source-scoped tracker key. It is not a server secret, but it is validated with the source UUID and origin configuration. |
| `path` | Required | Site-relative pathname beginning with `/`, without a query string or fragment. |
| `url` | Required | Full HTTP(S) page URL. V1 ingestion removes its query string, URL credentials, and fragment before storage; supported campaign values belong in `attribution`. |
| `referrer` | Optional | HTTP(S) referrer, empty string, or `null`. |
| `properties` | Optional | Event-specific JSON object. Keep it minimal and free of personal data. |
| `attribution` | Optional | Top-level UTM, click ID, landing-page, first-referrer, and touchpoint context. |
| `consent` | Required | Analytics and marketing status: `granted`, `denied`, or `unknown`; optional `do_not_track` boolean. |
| `client_context` | Required | Optional values within the object: language, ISO-style three-letter currency, viewport category, device category, traffic type, and page type. |

Attribution `touchpoint` is `first`, `session`, or `current`. Viewport categories are `small`, `medium`, `large`, `wide`, or `unknown`; device categories are `mobile`, `tablet`, `desktop`, `bot`, or `unknown`.
Traffic types are `production`, `synthetic`, `local`, or `test`. The field remains optional for backward compatibility, but the stricter V2 business funnel requires `production` on every event in a session and treats absent or mixed markers as excluded traffic.
`attribution.landing_page` is a site-relative pathname without a query string or fragment. `attribution.first_referrer`, when present, must be an HTTP(S) URL and is subject to the same nested-URL privacy rules.

The generated tracker checks analytics consent and Do Not Track before reading or creating browser identifiers or attribution state. MoonArq's reviewed producer transmits only after analytics consent is explicitly `granted`; `unknown`, `denied`, and Do Not Track all fail closed without tracker storage access. Consent collection and legal requirements remain the responsibility of the website operator.

## Backward-compatible commerce instance field

The reviewed MoonArq commerce shapes may include an optional `item_instance_id` UUIDv4 on an item inside `add_to_cart` or `begin_checkout`, and on `build_complete` or `save_design`. It identifies one Build Your Own bracelet snapshot; it does not replace the catalog `item_id`, identify a customer, or become a display dimension. Legacy events without it remain valid.

When a producer creates `item_instance_id`, it must use `crypto.randomUUID()` or an RFC 4122 UUIDv4 built from `crypto.getRandomValues()`. If neither secure crypto API is available, it must omit the value and keep the path unlinked; predictable fallbacks such as `Math.random()`, timestamps, or counters are forbidden.

The aggregate-only V1 funnel ignores this value. V2 may hash it internally for an exact Shopify line-item match, but must never return the raw UUID or hash from a reporting response. Invalid or duplicate linkage values fail closed. The complete cross-source contract and consent boundary are defined in [Website Commerce Funnel V2](website-commerce-funnel-v2.md).

## Legacy compatibility

Existing installations may continue sending the legacy fields: `source_id` or `public_tracking_key`, `anonymous_id`, `session_id`, optional `user_id`, `event_name`, `path`, `url`, optional `referrer` and `user_agent`, `properties`, and optional `occurred_at`.

When `schema_version` is omitted, the server stores `schema_version = 'legacy'`. It creates a random `event_id` when one is absent, defaults a missing `occurred_at` to receipt time, treats consent as `unknown`, and reads schema-valid legacy `properties.attribution` into normalized attribution storage. Malformed legacy attribution is omitted rather than copied into the canonical context. Legacy clients may add a stable UUID `event_id` without opting into every v1 field; only deliveries that reuse that ID can be deduplicated safely. The server deliberately does not infer retry identity from matching content or timestamps because that could collapse two real commerce actions.

## Validation and responses

- `Content-Type` must be `application/json`; charset parameters are accepted.
- The full UTF-8 request body is limited to 32 KiB. `properties` is limited to 8 KiB after JSON serialization.
- Event names are 1-80 characters and use letters, numbers, `_`, `.`, `:`, or `-`.
- `anonymous_id`, `session_id`, and `user_id` are limited to 160 characters. `path` is limited to 500 characters and must begin with `/`.
- `url` and `referrer` are limited to 1,200 characters and must use HTTP(S). `user_agent`, retained only for legacy compatibility, is limited to 1,000 characters; v1 storage relies on coarse client context instead of persisting the request User-Agent.
- Properties allow at most 8 nesting levels, 100 fields per object, 100 values per array, 120-character field names, and 2,048-character strings.
- `occurred_at` may be at most 30 days before `received_at` and at most 5 minutes in the future.
- V1 requires both an enabled Website Tracker source UUID and its matching public key. Legacy payloads may send either credential. Production requests must match a configured allowed origin.
- New events return HTTP `202`; an idempotent duplicate returns HTTP `200` with `duplicate: true`. Invalid, forbidden, oversized, or rate-limited requests fail with a safe 4xx response. Unexpected failures return a generic message and never expose server secrets.

## Privacy and PII policy

Do not send raw email addresses, phone numbers, full IP addresses, shipping or billing addresses, payment or card data, credentials, access tokens, passwords, or other unnecessary personal data in any field, URL, or nested property. Nested URL values must not contain credentials, query strings, or fragments.

The generated tracker removes page-URL query strings, URL credentials, and fragments after copying supported UTM and click-ID values into the explicit attribution object. Ingestion rejects known sensitive property names and direct personal-data values. Unknown payload fields are not part of the contract and must not be used to bypass this policy. The application never persists a raw request IP: it uses a process-local one-way hash for rate limiting and stores only a keyed one-way hash when server encryption material is configured. Request bodies and credential values must never be logged.

## Storage, idempotency, and time

`web_events` is the raw event store for both first-party tracker events and Vercel Drain events. First-party `page_view` rows are always retained even when matching request-level Drain data exists.

The server assigns `event_source = 'first_party_tracker'` to `/api/track` events. The database enforces uniqueness on `(source_id, event_id)`, so retries that reuse the same v1 or legacy event ID do not add a second event or increment metrics twice.

`occurred_at` is client event time and drives event-day aggregation. `received_at` is server receipt time and supports ingestion-latency, replay, and operational checks. `created_at` remains for backward compatibility.

## Rate limiting

The endpoint uses a coarse per-IP preflight limit before body parsing or source lookup, followed by a fixed-window limit keyed by source and a privacy-safe client hash. The source/client default is 600 requests per minute. Set optional `WEBSITE_TRACKING_RATE_LIMIT_PER_MINUTE` to an integer from 1 through 10,000 to tune it; invalid values use the default. Both process-local bucket maps are hard-capped at 10,000 clients with constant-time least-recently-used eviction.

The limiter is deliberately process-local, so it adds abuse resistance without a network dependency that could interrupt legitimate commerce tracking. It is not a globally strict quota or a replacement for edge-level abuse controls.

## Source-of-truth policy

- First-party MoonArq tracker: authoritative for funnel behavior, pseudonymous identity, sessions, and attribution context.
- Vercel Drain: auxiliary infrastructure and request-level evidence. Retain its raw events, but do not add them to first-party funnel totals.
- Shopify: authoritative for orders, commerce state, payments, refunds, and revenue.
- Meta: authoritative for paid media delivery and spend. Meta-attributed conversions remain platform-reported attribution, not first-party funnel truth or Shopify commerce truth.

Aggregation must select the authoritative source for each metric instead of deleting raw observations or summing overlapping sources.

## Migration and rollout

Migration `0009_website_event_contract_v1.sql` is the expand phase: it adds v1 identity, source, context, receipt-time, deduplication, lookup indexes, legacy-write compatibility, and raw-table access controls. After the v1 application code is live, `0010_rebuild_authoritative_website_metrics.sql` reconciles first-party rollups from retained events. Follow the staged rollout and verification steps in [Source Data Verification](source-data-verification.md#website-event-contract-v1-migrations-0009-and-0010); do not apply both migrations before deploying the code between them.
