import { createHash } from "node:crypto";
import { enqueueSyncRun } from "@/collection/sync/engine";
import type { JsonRecord } from "@/storage/db/schema";

export async function runWebhookSync(sourceId: string, payload: JsonRecord) {
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return enqueueSyncRun({
    sourceId,
    trigger: "webhook",
    idempotencyKey: `${sourceId}:webhook:${payloadHash}`,
    webhookPayload: payload,
  });
}
