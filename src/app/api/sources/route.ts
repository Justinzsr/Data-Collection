import { z } from "zod";
import {
  getConnector,
  getConnectorUnavailableReason,
  getInitialSourceStatus,
} from "@/collection/connectors/registry";
import type { JsonRecord, SyncMode } from "@/storage/db/schema";
import { isRuntimeDatabaseConfigured } from "@/storage/db/client";
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
    const requestedSyncMode = body.sync_mode ?? connector.defaultSyncMode;
    if (!supportsSyncMode(requestedSyncMode, connector.capabilities)) {
      return Response.json({ error: `${requestedSyncMode} sync is not supported by this connector.` }, { status: 400 });
    }
    const syncMode = connector.key === "website" ? connector.defaultSyncMode : requestedSyncMode;
    const shopifyDetection = connector.key === "shopify" && body.input_url
      ? connector.detect(body.input_url)
      : null;
    if (connector.key === "shopify" && !shopifyDetection) {
      return Response.json(
        { error: "Shopify sources require a canonical https://*.myshopify.com URL or an official admin.shopify.com/store/... URL." },
        { status: 400 },
      );
    }
    const websiteDetection = connector.key === "website" && body.input_url
      ? connector.detect(body.input_url)
      : null;
    if (connector.key === "website" && !websiteDetection) {
      return Response.json(
        { error: "Website Tracker sources require a valid HTTP(S) URL." },
        { status: 400 },
      );
    }
    const dataSpace = body.data_space_slug
      ? await getDataSpaceBySlug(body.data_space_slug)
      : await getDefaultDataSpace();
    if (!dataSpace) return Response.json({ error: "Unknown data space." }, { status: 400 });
    const databaseConfigured = isRuntimeDatabaseConfigured();
    const metadata = { ...(body.metadata ?? {}) } as JsonRecord;
    if (connector.key === "website") {
      delete metadata.demo;
      delete metadata.public_tracking_key;
      delete metadata.allowed_origins;
    }
    const source = await createSource({
      data_space_id: dataSpace.id,
      source_type_key: connector.key,
      display_name: body.display_name ?? connector.displayName,
      input_url: body.input_url ?? null,
      normalized_url: shopifyDetection?.normalizedUrl ?? websiteDetection?.normalizedUrl ?? body.normalized_url ?? null,
      external_account_id: shopifyDetection?.externalAccountId ?? body.external_account_id ?? null,
      account_name: shopifyDetection?.accountName ?? body.account_name ?? null,
      sync_mode: syncMode,
      supports_webhook: connector.capabilities.supportsWebhook,
      status: getInitialSourceStatus(connector, databaseConfigured),
      metadata,
    });
    return Response.json({ source }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create source." }, { status: 400 });
  }
}
