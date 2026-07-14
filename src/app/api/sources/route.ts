import { z } from "zod";
import { getConnector, getConnectorUnavailableReason } from "@/collection/connectors/registry";
import type { JsonRecord, SyncMode } from "@/storage/db/schema";
import { resolveDataSpaceFromRequest } from "@/app/api/data-space";
import { getDataSpaceBySlug, getDefaultDataSpace } from "@/storage/repositories/data-spaces-repository";
import { createSource, listSources } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "URL must use http or https.");

const createSourceSchema = z.strictObject({
  data_space_slug: z.string().trim().min(1).max(80).optional(),
  source_type_key: z.enum([
    "website",
    "vercel_web_analytics_drain",
    "supabase",
    "vercel_project",
    "shopify",
    "tiktok",
    "instagram",
    "xiaohongshu",
    "custom_api",
    "custom_csv",
  ]),
  display_name: z.string().trim().min(1).max(160).optional(),
  input_url: httpUrlSchema.nullable().optional(),
  normalized_url: httpUrlSchema.nullable().optional(),
  external_account_id: z.string().trim().max(255).nullable().optional(),
  account_name: z.string().trim().max(160).nullable().optional(),
  sync_mode: z.enum(["webhook", "hourly", "manual", "hybrid"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function supportsSyncMode(syncMode: SyncMode, capabilities: ReturnType<typeof getConnector>["capabilities"]) {
  if (syncMode === "manual") return capabilities.supportsManualSync;
  if (syncMode === "webhook") return capabilities.supportsWebhook;
  if (syncMode === "hourly") return capabilities.supportsPolling;
  return capabilities.supportsWebhook && capabilities.supportsPolling;
}

export async function GET(request: Request) {
  const dataSpace = await resolveDataSpaceFromRequest(request);
  if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 404 });
  return Response.json({ sources: await listSources({ dataSpaceId: dataSpace.id }) });
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 100_000) {
      return Response.json({ error: "Source configuration is too large." }, { status: 413 });
    }
    const parsed = createSourceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        {
          error: "Invalid source configuration.",
          issues: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
        },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const connector = getConnector(body.source_type_key);
    const unavailable = getConnectorUnavailableReason(connector);
    if (unavailable) {
      return Response.json(
        { error: unavailable, code: "connector_planned" },
        { status: 409 },
      );
    }
    const syncMode = body.sync_mode ?? connector.defaultSyncMode;
    if (!supportsSyncMode(syncMode, connector.capabilities)) {
      return Response.json({ error: `${syncMode} sync is not supported by this connector.` }, { status: 400 });
    }
    const dataSpace = body.data_space_slug
      ? await getDataSpaceBySlug(body.data_space_slug)
      : await getDefaultDataSpace();
    if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 400 });
    const needsCredentials = connector.requiredFields.some((field) => field.required) || connector.key === "supabase";
    const source = await createSource({
      data_space_id: dataSpace.id,
      source_type_key: connector.key,
      display_name: body.display_name ?? connector.displayName,
      input_url: body.input_url ?? null,
      normalized_url: body.normalized_url ?? null,
      external_account_id: body.external_account_id ?? null,
      account_name: body.account_name ?? null,
      sync_mode: syncMode,
      supports_webhook: connector.capabilities.supportsWebhook,
      status: needsCredentials ? "needs_credentials" : "demo",
      metadata: body.metadata as JsonRecord | undefined,
    });
    return Response.json({ source }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create source." }, { status: 400 });
  }
}
