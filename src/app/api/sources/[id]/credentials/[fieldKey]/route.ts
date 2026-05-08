import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { deleteCredential } from "@/storage/repositories/credentials-repository";
import { getSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; fieldKey: string }> }) {
  const { id, fieldKey } = await context.params;
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  const source = await getSource(id, { dataSpaceId: dataSpace.id });
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  const deleted = await deleteCredential(id, fieldKey);
  return Response.json({ deleted });
}
