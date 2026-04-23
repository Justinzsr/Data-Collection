# Sync Engine

All triggers route through one engine:

`enqueueSyncRun -> createSyncRun -> acquireSourceLock -> connector.sync -> storeRawPayloads -> normalize -> upsertMetrics -> releaseSourceLock -> recordConnectorEvent`

Supported triggers:
- webhook
- cron
- manual
- initial
- retry

Do not duplicate sync logic inside route handlers.
