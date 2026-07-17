import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getConnector } from "@/collection/connectors/registry";
import { listCredentialHints, saveCredential } from "@/storage/repositories/credentials-repository";
import { getSource, updateSource } from "@/storage/repositories/sources-repository";
import { normalizeAllowedOrigins } from "@/collection/tracking/website-sources";

export const runtime = "nodejs";

function credentialFields(sourceTypeKey: Parameters<typeof getConnector>[0]) {
  const connector = getConnector(sourceTypeKey);
  return [...connector.requiredFields, ...connector.optionalFields];
}

function filterSavedCredentials<T extends { field_key: string }>(saved: T[], fields: ReturnType<typeof credentialFields>) {
  const fieldKeys = new Set(fields.map((field) => field.key));
  return saved.filter((item) => fieldKeys.has(item.field_key));
}

function withWebsiteSettingHints<T extends { field_key: string }>(source: Awaited<ReturnType<typeof getSource>>, saved: T[]) {
  if (!source || source.source_type_key !== "website") return saved;
  const origins = source.metadata.allowed_origins;
  if (!Array.isArray(origins) || origins.length === 0) return saved;
  return [
    ...saved.filter((item) => item.field_key !== "allowed_origins"),
    {
      field_key: "allowed_origins",
      value_hint: origins.filter((value): value is string => typeof value === "string").join(", "),
      created_at: source.created_at,
      updated_at: source.updated_at,
    },
  ];
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

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  const source = await getSource(id, { dataSpaceId: dataSpace.id });
  if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
  const fields = credentialFields(source.source_type_key);
  const saved = withWebsiteSettingHints(source, filterSavedCredentials(await listCredentialHints(source.id), fields));
  return Response.json({ fields, saved });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const dataSpace = await resolveDataSpaceFromRequest(request);
    if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
    const source = await getSource(id, { dataSpaceId: dataSpace.id });
    if (!source) return Response.json({ error: "Source not found." }, { status: 404 });
    const fields = credentialFields(source.source_type_key);
    const fieldKeys = new Set(fields.map((field) => field.key));
    const credentials = normalizeCredentials(await request.json().catch(() => ({})));
    const unknown = Object.keys(credentials).filter((key) => !fieldKeys.has(key));
    if (unknown.length > 0) return Response.json({ error: `Unknown credential field(s): ${unknown.join(", ")}` }, { status: 400 });
    let currentSource = source;
    for (const [fieldKey, value] of Object.entries(credentials)) {
      if (!value.trim()) continue;
      if (source.source_type_key === "website" && fieldKey === "allowed_origins") {
        const origins = normalizeAllowedOrigins(value);
        currentSource = await updateSource(source.id, {
          metadata: { ...currentSource.metadata, allowed_origins: origins },
        }, { dataSpaceId: dataSpace.id }) ?? currentSource;
      } else {
        await saveCredential(source.id, fieldKey, value.trim());
      }
    }
    const saved = withWebsiteSettingHints(currentSource, filterSavedCredentials(await listCredentialHints(source.id), fields));
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
