import { getConnector } from "@/collection/connectors/registry";
import { listCredentialHints, saveCredential } from "@/storage/repositories/credentials-repository";
import { getSource, updateSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

function credentialFields(sourceTypeKey: Parameters<typeof getConnector>[0]) {
  const connector = getConnector(sourceTypeKey);
  return [...connector.requiredFields, ...connector.optionalFields];
}

function normalizeCredentials(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const candidate = "credentials" in body ? (body as { credentials?: unknown }).credentials : body;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  return Object.fromEntries(
    Object.entries(candidate)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, String(value)]),
  );
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = await getSource(id);
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  const fields = credentialFields(source.source_type_key);
  const saved = await listCredentialHints(source.id);
  return Response.json({ fields, saved });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const source = await getSource(id);
    if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
    const fields = credentialFields(source.source_type_key);
    const fieldKeys = new Set(fields.map((field) => field.key));
    const credentials = normalizeCredentials(await request.json().catch(() => ({})));
    const unknown = Object.keys(credentials).filter((key) => !fieldKeys.has(key));
    if (unknown.length > 0) return Response.json({ error: `Unknown credential field(s): ${unknown.join(", ")}` }, { status: 400 });
    for (const [fieldKey, value] of Object.entries(credentials)) {
      if (value.trim()) await saveCredential(source.id, fieldKey, value.trim());
    }
    const saved = await listCredentialHints(source.id);
    const savedKeys = new Set(saved.map((item) => item.field_key));
    const missingRequired = fields.filter((field) => field.required && !savedKeys.has(field.key));
    if (missingRequired.length > 0) {
      return Response.json(
        {
          error: `Missing required credential field(s): ${missingRequired.map((field) => field.label).join(", ")}`,
          fields,
          saved,
        },
        { status: 400 },
      );
    }
    if (source.status === "needs_credentials" && saved.length > 0) {
      await updateSource(source.id, { status: "warning" });
    }
    return Response.json({ fields, saved });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save credentials." }, { status: 400 });
  }
}
