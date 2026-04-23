import { getConnector } from "@/collection/connectors/registry";
import type { SourceTypeKey, SyncMode } from "@/storage/db/schema";
import { createSource, listSources } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ sources: await listSources() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const connector = getConnector(body.source_type_key as SourceTypeKey);
    const source = await createSource({
      source_type_key: connector.key,
      display_name: String(body.display_name ?? connector.displayName),
      input_url: body.input_url ?? null,
      normalized_url: body.normalized_url ?? null,
      external_account_id: body.external_account_id ?? null,
      account_name: body.account_name ?? null,
      sync_mode: (body.sync_mode ?? "hybrid") as SyncMode,
      supports_webhook: connector.capabilities.supportsWebhook,
      status: connector.requiredFields.some((field) => field.required) ? "needs_credentials" : "demo",
      metadata: { demo: true },
    });
    return Response.json({ source }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create source." }, { status: 400 });
  }
}
