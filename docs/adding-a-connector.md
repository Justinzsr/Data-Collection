# Adding A Connector

1. Create `src/collection/connectors/<platform>/connector.ts`.
2. Implement `ConnectorDefinition`.
3. Add metric definitions in `src/aggregation/metric-definitions/definitions.ts`.
4. Register the connector in `src/collection/connectors/registry.ts`.
5. Add normalizer tests and detection tests.
6. Add setup instructions and credential fields.
7. Ensure sync is idempotent and secrets stay server-side.

Also register a new source key in `src/storage/db/schema.ts`, the source-creation route's accepted types, and the Add Source platform order and icon map. Source creation upserts its `source_types` catalog entry; `pnpm db:seed` updates the complete source and metric catalog when a database rollout requires it. Reuse the generic encrypted credential form, source test action, and shared sync engine instead of creating a separate collection path.

The ChatGPT Ads connector is an example of a read-only, API-key integration: source URLs are canonicalized, credentials stay encrypted per source, API account identity is checked, overlapping daily snapshots replace only the connector's declared metric window, and ratio metrics are derived in aggregation. Register base facts rather than daily averages, and document attribution, timezone, units, optional/missing values, and the distinction between advertising-platform conversions and authoritative commerce outcomes.
