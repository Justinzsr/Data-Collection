import { runWebhookSync } from "@/collection/sync/webhook-sync";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  const payload = await request.json().catch(() => ({}));
  await recordConnectorEvent({
    source_id: sourceId,
    event_type: "supabase_webhook_received",
    severity: "info",
    message: "Supabase public.profiles webhook received.",
    metadata: { payloadType: typeof payload },
  });
  const run = await runWebhookSync(sourceId);
  return Response.json({ ok: true, run });
}
