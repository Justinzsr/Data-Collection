# Adding A Connector

1. Create `src/collection/connectors/<platform>/connector.ts`.
2. Implement `ConnectorDefinition`.
3. Add metric definitions in `src/aggregation/metric-definitions/definitions.ts`.
4. Register the connector in `src/collection/connectors/registry.ts`.
5. Add normalizer tests and detection tests.
6. Add setup instructions and credential fields.
7. Ensure sync is idempotent and secrets stay server-side.
