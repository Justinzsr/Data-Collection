# First-Party Tracking

The Website Tracker sends the backward-compatible [Website Event Contract v1](../../../docs/website-event-contract-v1.md) to `POST /api/track`.

New integrations should use the generated JavaScript snippet or React/Next helper. They preserve the existing `window.moonarqTrack(name, properties)` and `trackEvent(name, properties)` APIs while adding:

- client UUID `event_id` and `schema_version: "1.0"`
- pseudonymous anonymous, session, and optional user identity
- event time, path, privacy-scrubbed URL and referrer
- top-level attribution, consent, and client context

Legacy payloads without `event_id` or `schema_version` remain accepted and are stored with `schema_version = 'legacy'`. Stable client event IDs are required for delivery deduplication.

`web_events` is the raw store. First-party events use `event_source = 'first_party_tracker'`; Vercel Drain events use `event_source = 'vercel_drain'`. Never discard a first-party `page_view` because Drain observed a related request. Aggregation applies the source-of-truth policy instead.

Vercel Drain persistence is an infrastructure-diagnostic allowlist, not a copy of the webhook body. Stored Drain rows omit custom `eventData`, raw query parameters, session identifiers, and unknown fields; strip query strings, fragments, credentials, PII, and secrets from URL-like values; HMAC-pseudonymize device identifiers with the server-only application encryption key; and retain only bounded platform metadata plus safe `utm_*` campaign values. Depth, field-count, embedded-field, and sanitized-output size limits are enforced before any raw ingestion, change event, or website event is written. Drain remains auxiliary and must not become authoritative for funnel, session, identity, or attribution metrics.

The endpoint validates JSON content type, body and property limits, event and field formats, timestamp sanity, source/key matching, and allowed origins. It enforces a lightweight per-source/client rate limit and returns safe errors without request bodies or secrets. Raw IP addresses and prohibited personal data must never be stored or logged.
