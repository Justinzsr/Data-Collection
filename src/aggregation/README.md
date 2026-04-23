# Aggregation Layer / 聚合层

Owns normalizers, metric definitions, idempotent metric upserts, summary services, timeseries services, content services, commerce services, and health services.

Rules:
- Every metric must have a definition.
- Normalizers convert raw connector payloads into `NormalizedMetricBundle`.
- Daily metrics are upserted by date, source, metric key, and dimensions hash.
