import { getConnector } from "@/collection/connectors/registry";
import type { SourceTypeKey, SyncMode } from "@/storage/db/schema";
import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getDataSpaceBySlug, getDefaultDataSpace } from "@/storage/repositories/data-spaces-repository";
import { createSource, listSources } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  return Response.json({ sources: await listSources({ dataSpaceId: dataSpace.id }) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const connector = getConnector(body.source_type_key as SourceTypeKey);
    const dataSpace = typeof body.data_space_slug === "string"
      ? await getDataSpaceBySlug(body.data_space_slug)
      : await getDefaultDataSpace();
    if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 400 });
    const needsCredentials = connector.requiredFields.some((field) => field.required) || connector.key === "supabase";
    const source = await createSource({
      data_space_id: dataSpace.id,
      source_type_key: connector.key,
      display_name: String(body.display_name ?? connector.displayName),
      input_url: body.input_url ?? null,
      normalized_url: body.normalized_url ?? null,
      external_account_id: body.external_account_id ?? null,
      account_name: body.account_name ?? null,
      sync_mode: (body.sync_mode ?? "hybrid") as SyncMode,
      supports_webhook: connector.capabilities.supportsWebhook,
      status: needsCredentials ? "needs_credentials" : "demo",
      metadata: body.metadata ?? undefined,
    });
    return Response.json({ source }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create source." }, { status: 400 });
  }
}
