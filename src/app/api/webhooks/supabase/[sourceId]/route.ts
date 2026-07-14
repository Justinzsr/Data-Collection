import { timingSafeEqual } from "node:crypto";
import { getSourceOperationBlockReason } from "@/collection/connectors/registry";
import { runWebhookSync } from "@/collection/sync/webhook-sync";
import type { JsonRecord } from "@/storage/db/schema";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { getSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfileInsertPayload(payload: JsonRecord) {
  if (payload.type !== "INSERT" || payload.table !== "profiles") return false;
  if (payload.schema !== undefined && payload.schema !== "public") return false;
  const record = payload.record;
  return (
    isRecord(record) &&
    typeof record.id === "string" &&
    typeof record.created_at === "string" &&
    Number.isFinite(Date.parse(record.created_at))
  );
}

function providedSecret(request: Request) {
  const explicit = request.headers.get("x-moonarq-webhook-secret")?.trim();
  if (explicit) return explicit;
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function secretsMatch(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  const source = await getSource(sourceId);
  if (!source || source.source_type_key !== "supabase") {
    return Response.json({ error: "Webhook source not found." }, { status: 404 });
  }
  const blocked = getSourceOperationBlockReason(source);
  if (blocked) return Response.json({ error: blocked }, { status: 409 });

  const credentials = await getDecryptedCredentialMap(source.id);
  const expectedSecret = credentials.webhook_secret;
  if (!expectedSecret) {
    return Response.json({ error: "Webhook signing secret is not configured." }, { status: 503 });
  }
  if (!secretsMatch(providedSecret(request), expectedSecret)) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
    return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
  }
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) {
    return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }
  if (!isRecord(payload)) {
    return Response.json({ error: "Webhook payload must be a JSON object." }, { status: 400 });
  }
  if (!isProfileInsertPayload(payload)) {
    return Response.json(
      { error: "Expected a public.profiles INSERT webhook payload." },
      { status: 422 },
    );
  }

  await recordConnectorEvent({
    source_id: sourceId,
    event_type: "supabase_webhook_received",
    severity: "info",
    message: "Supabase public.profiles webhook received.",
    metadata: { payloadType: typeof payload },
  });
  const run = await runWebhookSync(sourceId, payload);
  const status = run.status === "error" ? 500 : run.status === "skipped" ? 409 : run.status === "success" ? 200 : 202;
  return Response.json(
    {
      ok: run.status !== "error" && run.status !== "skipped",
      error: run.status === "error" ? "Supabase webhook processing failed." : null,
      run: {
        id: run.id,
        trigger: run.trigger,
        status: run.status,
        records_fetched: run.records_fetched,
        records_inserted: run.records_inserted,
      },
    },
    { status },
  );
}
