import { getConnector } from "@/collection/connectors/registry";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { getSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = await getSource(id);
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  const connector = getConnector(source.source_type_key);
  const result = await connector.testConnection({
    source,
    credentials: await getDecryptedCredentialMap(source.id),
    isDemoMode: source.status === "demo" || !process.env.DATABASE_URL,
  });
  return Response.json({ result });
}
