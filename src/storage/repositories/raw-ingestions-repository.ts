import { createHash, randomUUID } from "node:crypto";
import type { RawPayload } from "@/collection/connectors/types";
import type { RawIngestion, Source } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function storeRawPayloads(source: Source, payloads: RawPayload[]): Promise<{ inserted: number; duplicates: number; rows: RawIngestion[] }> {
  const store = getDemoStore();
  const rows: RawIngestion[] = [];
  let inserted = 0;
  let duplicates = 0;
  for (const payload of payloads) {
    const payloadHash = payload.payloadHash ?? hashPayload(payload.payload);
    const duplicate = store.rawIngestions.find(
      (row) => row.source_id === source.id && row.payload_hash === payloadHash,
    );
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
