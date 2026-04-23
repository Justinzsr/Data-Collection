# Sync Engine

All routes call shared services. Route handlers should not implement connector-specific sync logic.

Triggers:
- `webhook -> enqueueSyncRun({ trigger: "webhook" })`
- `cron -> enqueueSyncRun({ trigger: "cron" })`
- `manual -> enqueueSyncRun({ trigger: "manual" })`
- `source setup -> enqueueSyncRun({ trigger: "initial" })`

Concurrency:
- source-level locks prevent two syncs for the same source.
- locks include lease expiry.

Idempotency:
- raw payloads store `payload_hash`.
- daily metrics upsert by date/source/metric/dimensions hash.
