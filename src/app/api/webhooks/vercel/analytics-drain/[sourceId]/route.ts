import {
  assertVercelDrainRequestCanIngest,
  createVercelDrainWebhookPayload,
  VercelDrainIngestionError,
} from "@/collection/tracking/vercel-drain-endpoint";
import { runWebhookSync } from "@/collection/sync/webhook-sync";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { getSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

const MAX_DRAIN_PAYLOAD_BYTES = 1_000_000;

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  const source = await getSource(sourceId);
  if (!source) {
    return Response.json({ error: "Source not found." }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_DRAIN_PAYLOAD_BYTES) {
    return Response.json({ error: "Vercel Drain payload is too large." }, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_DRAIN_PAYLOAD_BYTES) {
    return Response.json({ error: "Vercel Drain payload is too large." }, { status: 413 });
  }
  try {
    const credentials = await getDecryptedCredentialMap(sourceId);
    const signature = request.headers.get("x-vercel-signature");
    assertVercelDrainRequestCanIngest({
      source,
      rawBody,
      signature,
      signatureSecret: credentials.drain_signature_secret,
    });
    const run = await runWebhookSync(
      sourceId,
      createVercelDrainWebhookPayload(rawBody, signature!),
    );
    const status = run.status === "error" ? 500 : run.status === "skipped" ? 409 : run.status === "success" ? 200 : 202;
    return Response.json(
      {
        ok: run.status !== "error" && run.status !== "skipped",
        count: run.records_fetched,
        error: run.status === "error" ? "Vercel Drain processing failed." : null,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process Vercel drain payload.";
    if (error instanceof VercelDrainIngestionError) {
      return Response.json({ error: message }, { status: error.statusCode });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
