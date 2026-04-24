import { createHash, randomUUID } from "node:crypto";
import type { RawPayload } from "@/collection/connectors/types";
import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { RawIngestion, Source } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function storeRawPayloads(
  source: Source,
  payloads: RawPayload[],
): Promise<{ inserted: number; duplicates: number; rows: RawIngestion[] }> {
  if (!isRuntimeDatabaseConfigured()) {
    const store = getDemoStore();
    const rows: RawIngestion[] = [];
    let inserted = 0;
    let duplicates = 0;
    for (const payload of payloads) {
      const payloadHash = payload.payloadHash ?? hashPayload(payload.payload);
      const duplicate = store.rawIngestions.find((row) => row.source_id === source.id && row.payload_hash === payloadHash);
      if (duplicate) {
        duplicates += 1;
        rows.push({ ...duplicate, status: "duplicate" });
        continue;
      }
      const row: RawIngestion = {
        id: randomUUID(),
        source_id: source.id,
        source_type_key: source.source_type_key,
        external_id: payload.externalId ?? null,
        fetched_at: payload.fetchedAt,
        payload: payload.payload,
        payload_hash: payloadHash,
        status: payload.status ?? "stored",
        cursor: payload.cursor ?? null,
        created_at: new Date().toISOString(),
      };
      store.rawIngestions.push(row);
      rows.push(row);
      inserted += 1;
    }
    return { inserted, duplicates, rows };
  }

  const rows: RawIngestion[] = [];
  let inserted = 0;
  let duplicates = 0;
  for (const payload of payloads) {
    const payloadHash = payload.payloadHash ?? hashPayload(payload.payload);
    const createdAt = new Date().toISOString();
    const insertedRows = await queryRows<RawIngestion>(
      `
        insert into raw_ingestions (
          id,
          source_id,
          source_type_key,
          external_id,
          fetched_at,
          payload,
          payload_hash,
          status,
          cursor,
          created_at
        ) values (
          $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10
        )
        on conflict (source_id, payload_hash) do nothing
        returning *
      `,
      [
        randomUUID(),
        source.id,
        source.source_type_key,
        payload.externalId ?? null,
        payload.fetchedAt,
        JSON.stringify(payload.payload),
        payloadHash,
        payload.status ?? "stored",
        payload.cursor ? JSON.stringify(payload.cursor) : null,
        createdAt,
      ],
    );
    if (insertedRows[0]) {
      inserted += 1;
      rows.push(insertedRows[0]);
      continue;
    }
    duplicates += 1;
    const existing = await queryRows<RawIngestion>(
      `
        select *
        from raw_ingestions
        where source_id = $1 and payload_hash = $2
        limit 1
      `,
      [source.id, payloadHash],
    );
    if (existing[0]) rows.push({ ...existing[0], status: "duplicate" });
  }
  return { inserted, duplicates, rows };
}
