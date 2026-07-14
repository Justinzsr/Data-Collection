import { z } from "zod";
import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getConnector } from "@/collection/connectors/registry";
import type { ConnectorDefinition } from "@/collection/connectors/types";
import { deleteSource, getSource, updateSource } from "@/storage/repositories/sources-repository";
import type { SyncMode } from "@/storage/db/schema";

export const runtime = "nodejs";

const sourceUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, {
    message: "URL must use http or https.",
  });

const sourcePatchSchema = z
  .strictObject({
    display_name: z.string().trim().min(1).max(160),
    input_url: sourceUrlSchema.nullable(),
    normalized_url: sourceUrlSchema.nullable(),
    account_name: z.string().trim().max(160).nullable(),
    status: z.enum(["disabled", "warning"]),
    sync_mode: z.enum(["webhook", "hourly", "manual", "hybrid"]),
    sync_frequency_minutes: z.number().int().min(1).max(43_200),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "At least one supported source field is required.",
  });

function supportsSyncMode(connector: ConnectorDefinition, syncMode: SyncMode) {
  if (syncMode === "manual") return connector.capabilities.supportsManualSync;
  if (syncMode === "webhook") return connector.capabilities.supportsWebhook;
  if (syncMode === "hourly") return connector.capabilities.supportsPolling;
  return connector.capabilities.supportsPolling && connector.capabilities.supportsWebhook;
}

function invalidPatchResponse(error: z.ZodError) {
  return Response.json(
    {
      error: "Invalid source update.",
      issues: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

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
  const parsed = sourcePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidPatchResponse(parsed.error);
  const existing = await getSource(id, { dataSpaceId: dataSpace.id });
  if (!existing) return Response.json({ error: "Source not found." }, { status: 404 });
  if (parsed.data.sync_mode && !supportsSyncMode(getConnector(existing.source_type_key), parsed.data.sync_mode)) {
    return Response.json(
      { error: `${parsed.data.sync_mode} sync is not supported by this connector.` },
      { status: 400 },
    );
  }
  const source = await updateSource(id, parsed.data, { dataSpaceId: dataSpace.id });
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
