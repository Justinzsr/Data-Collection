import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { deleteSource, getSource, updateSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  const source = await getSource(id, { dataSpaceId: dataSpace.id });
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  return Response.json({ source });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const existing = await getSource(id, { dataSpaceId: dataSpace.id });
  if (!existing) return Response.json({ error: "Source not found." }, { status: 404 });
  const source = await updateSource(id, body);
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  return Response.json({ source });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  const existing = await getSource(id, { dataSpaceId: dataSpace.id });
  if (!existing) return Response.json({ deleted: false });
  const deleted = await deleteSource(id);
  return Response.json({ deleted });
}
