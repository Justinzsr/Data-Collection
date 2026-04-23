import { createHash } from "node:crypto";
import { z } from "zod";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { upsertMetrics } from "@/storage/repositories/metrics-repository";
import { storeWebEvent } from "@/storage/repositories/events-repository";
import { listSources } from "@/storage/repositories/sources-repository";

export const trackEventSchema = z.object({
  source_id: z.string().uuid().optional(),
  public_tracking_key: z.string().min(4).max(120).optional(),
  anonymous_id: z.string().min(1).max(160),
  session_id: z.string().min(1).max(160),
  user_id: z.string().max(160).nullable().optional(),
  event_name: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/),
  path: z.string().min(1).max(500),
  url: z.string().url().max(1200),
  referrer: z.string().max(1200).nullable().optional(),
  user_agent: z.string().max(1000).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
  occurred_at: z.string().datetime().optional(),
});

export type TrackEventInput = z.infer<typeof trackEventSchema>;

function propertiesAreSmall(properties: Record<string, unknown>) {
  return Buffer.byteLength(JSON.stringify(properties), "utf8") <= 8192;
}

function hashIp(ip: string | null | undefined) {
  if (!ip) return null;
  return createHash("sha256").update(`${process.env.APP_ENCRYPTION_KEY ?? "demo"}:${ip}`).digest("hex");
}

async function findTrackingSource(input: TrackEventInput): Promise<Source | null> {
  const sources = await listSources();
  if (input.source_id) return sources.find((source) => source.id === input.source_id) ?? null;
  if (input.public_tracking_key) {
    return (
      sources.find((source) => source.metadata.public_tracking_key === input.public_tracking_key) ??
      null
    );
  }
  return null;
}

function assertAllowedOrigin(source: Source | null, origin: string | null) {
  if (!source || !origin) return;
  const allowed = source.metadata.allowed_origins;
  if (!Array.isArray(allowed) || allowed.length === 0) return;
  if (!allowed.includes(origin)) {
    throw new Error("Origin is not allowed for this website source.");
  }
}

export async function ingestTrackEvent(input: unknown, meta: { origin?: string | null; ip?: string | null; userAgent?: string | null }) {
  const parsed = trackEventSchema.parse(input);
  if (!propertiesAreSmall(parsed.properties)) {
    throw new Error("Event properties are too large. Limit is 8KB.");
  }
  const source = await findTrackingSource(parsed);
  assertAllowedOrigin(source, meta.origin ?? null);
  const occurredAt = parsed.occurred_at ?? new Date().toISOString();
  const event = await storeWebEvent({
    source_id: source?.id ?? parsed.source_id ?? null,
    public_tracking_key: parsed.public_tracking_key ?? null,
    anonymous_id: parsed.anonymous_id,
    session_id: parsed.session_id,
    user_id: parsed.user_id ?? null,
    event_name: parsed.event_name,
    path: parsed.path,
    url: parsed.url,
    referrer: parsed.referrer ?? null,
    user_agent: parsed.user_agent ?? meta.userAgent ?? null,
    ip_hash: hashIp(meta.ip),
    country: null,
    device_type: null,
    properties: parsed.properties as JsonRecord,
    occurred_at: occurredAt,
  });
  const date = occurredAt.slice(0, 10);
  await upsertMetrics([
    {
      date,
      sourceId: event.source_id,
      sourceTypeKey: "website",
      metricKey: parsed.event_name === "page_view" ? "page_views" : "custom_events",
      metricValue: 1,
      unit: "count",
      dimensions: { event_id: event.id, demo: !process.env.DATABASE_URL },
    },
  ]);
  return event;
}
