import { createHmac } from "node:crypto";
import { getSourceOperationBlockReason } from "@/collection/connectors/registry";
import { normalizeWebsiteEventPayload } from "@/collection/tracking/website-event-contract";
import { ingestWebsiteEvent } from "@/collection/tracking/website-event-ingestion";
import { consumeWebsiteTrackingRateLimit } from "@/collection/tracking/website-rate-limit";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { listSources } from "@/storage/repositories/sources-repository";

export class TrackingIngestionError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly responseHeaders: Record<string, string> = {},
  ) {
    super(message);
    this.name = "TrackingIngestionError";
  }
}

function hashIp(ip: string | null | undefined) {
  const salt = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!ip || !salt) return null;
  return createHmac("sha256", salt)
    .update("website-event-ip\0")
    .update(ip)
    .digest("hex");
}

function publicTrackingKey(source: Source) {
  const value = source.metadata.public_tracking_key;
  return typeof value === "string" ? value : null;
}

function findTrackingSource(input: { sourceId: string | null; publicTrackingKey: string | null }, sources: Source[]) {
  if (input.sourceId) {
    const source = sources.find((candidate) => candidate.id === input.sourceId) ?? null;
    if (!source) return null;
    if (input.publicTrackingKey && publicTrackingKey(source) !== input.publicTrackingKey) return null;
    return source;
  }
  if (!input.publicTrackingKey) return null;
  return sources.find((source) => publicTrackingKey(source) === input.publicTrackingKey) ?? null;
}

function allowedOrigins(source: Source) {
  const configured = source.metadata.allowed_origins;
  if (!Array.isArray(configured)) return [];
  return configured.flatMap((value) => {
    if (typeof value !== "string") return [];
    try {
      const url = new URL(value.trim());
      return [url.origin];
    } catch {
      return [];
    }
  });
}

function assertAllowedOrigin(source: Source, origin: string | null) {
  const allowed = allowedOrigins(source);
  if (process.env.NODE_ENV === "production" && (!origin || allowed.length === 0)) {
    throw new TrackingIngestionError("This website tracker is not configured for the request origin.", 403);
  }
  if (!origin || allowed.length === 0) return;
  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    throw new TrackingIngestionError("This website tracker is not configured for the request origin.", 403);
  }
  if (!allowed.includes(normalizedOrigin)) {
    throw new TrackingIngestionError("This website tracker is not configured for the request origin.", 403);
  }
}

function normalizeContract(input: unknown, receivedAt: Date) {
  try {
    return normalizeWebsiteEventPayload(input, { receivedAt });
  } catch (error) {
    const tooLarge = error instanceof Error && /(too large|too many|string that is too long)/iu.test(error.message);
    throw new TrackingIngestionError(
      tooLarge ? "Tracking payload is too large." : "Tracking payload is invalid.",
      tooLarge ? 413 : 400,
    );
  }
}

export async function ingestTrackEvent(
  input: unknown,
  meta: {
    origin?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    receivedAt?: Date;
  },
) {
  const receivedAt = meta.receivedAt ?? new Date();
  const event = normalizeContract(input, receivedAt);
  const sources = await listSources();
  const source = findTrackingSource(event, sources);
  if (!source) {
    throw new TrackingIngestionError("Tracking source credentials are invalid.", 403);
  }
  const blocked = getSourceOperationBlockReason(source);
  if (blocked) {
    throw new TrackingIngestionError(blocked, 409);
  }
  if (source.source_type_key !== "website") {
    throw new TrackingIngestionError("The selected source does not accept first-party website events.", 403);
  }
  assertAllowedOrigin(source, meta.origin ?? null);

  const rateLimit = consumeWebsiteTrackingRateLimit({
    sourceId: source.id,
    ip: meta.ip,
    anonymousId: event.anonymousId,
    now: receivedAt.getTime(),
  });
  if (!rateLimit.allowed) {
    throw new TrackingIngestionError("Tracking rate limit exceeded.", 429, {
      "retry-after": String(rateLimit.retryAfterSeconds),
    });
  }

  return ingestWebsiteEvent({
    eventId: event.eventId,
    schemaVersion: event.schemaVersion,
    eventSource: "first_party_tracker",
    sourceTypeKey: "website",
    sourceId: source.id,
    publicTrackingKey: event.publicTrackingKey,
    anonymousId: event.anonymousId,
    sessionId: event.sessionId,
    userId: event.userId,
    eventName: event.eventName,
    path: event.path,
    url: event.url,
    referrer: event.referrer,
    // Only a legacy body field that passed contract/PII validation may be
    // retained. The raw HTTP header is untrusted transport metadata.
    userAgent: event.schemaVersion === "legacy" ? event.userAgent : null,
    ipHash: hashIp(meta.ip),
    country: null,
    deviceType: event.clientContext.device_category ?? null,
    properties: event.properties,
    attributionContext: event.attributionContext as JsonRecord,
    consentStatus: event.consentStatus as JsonRecord,
    clientContext: event.clientContext as JsonRecord,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
  });
}
