import { deleteSource, getSource, updateSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = await getSource(id);
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  return Response.json({ source });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const source = await updateSource(id, body);
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  return Response.json({ source });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const deleted = await deleteSource(id);
  return Response.json({ deleted });
}
