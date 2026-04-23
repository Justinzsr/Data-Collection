import { ingestVercelAnalyticsDrain } from "@/collection/tracking/vercel-drain-endpoint";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { getSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  const source = await getSource(sourceId);
  if (!source) {
    return Response.json({ error: "Source not found." }, { status: 404 });
  }

  const rawBody = await request.text();
  try {
    const credentials = await getDecryptedCredentialMap(sourceId);
    const result = await ingestVercelAnalyticsDrain({
      source,
      rawBody,
      signature: request.headers.get("x-vercel-signature"),
      signatureSecret: credentials.drain_signature_secret,
    });
    await recordConnectorEvent({
      source_id: sourceId,
      event_type: "vercel_web_analytics_drain_received",
      severity: "info",
      message: `Received ${result.count} Vercel drain event(s).`,
      metadata: { count: result.count },
    });
    return Response.json({ ok: true, count: result.count });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process Vercel drain payload.";
    await recordConnectorEvent({
      source_id: sourceId,
      event_type: "vercel_web_analytics_drain_error",
      severity: "error",
      message,
      metadata: { bodyLength: rawBody.length },
    });
    return Response.json({ error: message }, { status: 400 });
  }
}
