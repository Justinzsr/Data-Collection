import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getConnector, getSourceOperationBlockReason } from "@/collection/connectors/registry";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { getSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  const source = await getSource(id, { dataSpaceId: dataSpace.id });
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  const blocked = getSourceOperationBlockReason(source);
  if (blocked) return Response.json({ error: blocked, code: "connector_unavailable" }, { status: 409 });
  const connector = getConnector(source.source_type_key);
  const result = await connector.testConnection({
    source,
    credentials: await getDecryptedCredentialMap(source.id),
    isDemoMode: source.status === "demo" || !process.env.DATABASE_URL,
  });
  return Response.json({ result });
}
