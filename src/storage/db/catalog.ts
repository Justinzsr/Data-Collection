import type { PoolClient } from "pg";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";
import { listSourceTypes } from "@/collection/connectors/registry";
import { query, withDatabaseTransaction } from "@/storage/db/client";

async function seedSourceTypes(client: PoolClient) {
  for (const sourceType of listSourceTypes()) {
    await query(
      `
        insert into source_types (
          key,
          display_name,
          description,
          category,
          icon,
          url_patterns,
          required_fields,
          optional_fields,
          supported_metrics,
          auth_type,
          docs_url,
          enabled,
          created_at,
          updated_at
        ) values (
          $1, $2, $3, $4, $5,
          $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
          $10, $11, $12, $13, $14
        )
        on conflict (key) do update set
          display_name = excluded.display_name,
          description = excluded.description,
          category = excluded.category,
          icon = excluded.icon,
          url_patterns = excluded.url_patterns,
          required_fields = excluded.required_fields,
          optional_fields = excluded.optional_fields,
          supported_metrics = excluded.supported_metrics,
          auth_type = excluded.auth_type,
          docs_url = excluded.docs_url,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `,
      [
        sourceType.key,
        sourceType.display_name,
        sourceType.description,
        sourceType.category,
        sourceType.icon,
        JSON.stringify(sourceType.url_patterns),
        JSON.stringify(sourceType.required_fields),
        JSON.stringify(sourceType.optional_fields),
        JSON.stringify(sourceType.supported_metrics),
        sourceType.auth_type,
        sourceType.docs_url,
        sourceType.enabled,
        sourceType.created_at,
        sourceType.updated_at,
      ],
      client,
    );
  }
}

async function seedMetricDefinitions(client: PoolClient) {
  for (const definition of metricDefinitions) {
    await query(
      `
        insert into metric_definitions (
          key,
          display_name,
          description,
          source_type_key,
          category,
          unit,
          higher_is_better,
          created_at,
          updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
        on conflict (key) do update set
          display_name = excluded.display_name,
          description = excluded.description,
          source_type_key = excluded.source_type_key,
          category = excluded.category,
          unit = excluded.unit,
          higher_is_better = excluded.higher_is_better,
          updated_at = excluded.updated_at
      `,
      [
        definition.key,
        definition.display_name,
        definition.description,
        definition.source_type_key,
        definition.category,
        definition.unit,
        definition.higher_is_better,
        definition.created_at,
        definition.updated_at,
      ],
      client,
    );
  }
}

export async function seedRuntimeCatalog() {
  await withDatabaseTransaction(async (client) => {
    await seedSourceTypes(client);
    await seedMetricDefinitions(client);
  });
}
