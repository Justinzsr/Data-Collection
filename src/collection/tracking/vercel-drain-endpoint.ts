import { createHmac, timingSafeEqual } from "node:crypto";
import { ingestWebsiteEvent } from "@/collection/tracking/website-event-ingestion";
import { storeRawPayloads } from "@/storage/repositories/raw-ingestions-repository";
import { markSourceSyncState } from "@/storage/repositories/sources-repository";
import type { JsonRecord, Source } from "@/storage/db/schema";

type VercelDrainEvent = {
  schema?: string;
  eventType?: string;
  eventName?: string;
  eventData?: string;
  timestamp?: number;
  projectId?: string;
  ownerId?: string;
  sessionId?: number | string;
  deviceId?: number | string;
  origin?: string;
  path?: string;
  referrer?: string;
  queryParams?: string;
  route?: string;
  country?: string;
  osName?: string;
  osVersion?: string;
  clientName?: string;
  clientType?: string;
  clientVersion?: string;
  deviceType?: string;
  vercelEnvironment?: string;
  vercelUrl?: string;
  sdkName?: string;
  sdkVersion?: string;
  deployment?: string;
};

function parseJsonObject(input: string | undefined) {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === "object" && parsed !== null ? (parsed as JsonRecord) : {};
  } catch {
    return { raw: input };
  }
}

function parseBody(rawBody: string) {
  const trimmed = rawBody.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as VercelDrainEvent[]) : [];
  }
  if (trimmed.startsWith("{")) {
    return [JSON.parse(trimmed) as VercelDrainEvent];
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as VercelDrainEvent);
}

function verifySignature(rawBody: string, signature: string | null, secret: string | undefined) {
  if (!secret) return true;
  if (!signature) return false;
  const expected = createHmac("sha1", secret).update(Buffer.from(rawBody, "utf8")).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

function resolvedUrl(event: VercelDrainEvent, source: Source) {
  if (event.origin && event.path) {
    try {
      return new URL(event.path, event.origin).toString();
    } catch {
      return `${event.origin}${event.path}`;
    }
  }
  if (event.origin) return event.origin;
  if (source.normalized_url) {
    try {
      return new URL(event.path ?? "/", source.normalized_url).toString();
    } catch {
      return source.normalized_url;
    }
  }
  return "https://moonarqstudio.com";
}

function eventName(event: VercelDrainEvent) {
  return event.eventType === "pageview" ? "page_view" : event.eventName || "custom_event";
}

function eventProperties(event: VercelDrainEvent) {
  return {
    vercel: {
      schema: event.schema ?? "vercel.analytics.v2",
      project_id: event.projectId ?? null,
      owner_id: event.ownerId ?? null,
      query_params: event.queryParams ?? null,
      route: event.route ?? null,
      os_name: event.osName ?? null,
      os_version: event.osVersion ?? null,
      client_name: event.clientName ?? null,
      client_type: event.clientType ?? null,
      client_version: event.clientVersion ?? null,
      vercel_environment: event.vercelEnvironment ?? null,
      vercel_url: event.vercelUrl ?? null,
      sdk_name: event.sdkName ?? null,
      sdk_version: event.sdkVersion ?? null,
      deployment: event.deployment ?? null,
    },
    ...parseJsonObject(event.eventData),
  } as JsonRecord;
}

export async function ingestVercelAnalyticsDrain(input: {
  source: Source;
  rawBody: string;
  signature: string | null;
  signatureSecret?: string;
}) {
  if (!verifySignature(input.rawBody, input.signature, input.signatureSecret)) {
    throw new Error("Invalid Vercel drain signature.");
  }

  const events = parseBody(input.rawBody);
  await storeRawPayloads(
    input.source,
    events.map((event) => ({
      externalId: `${event.eventType ?? "event"}:${event.timestamp ?? Date.now()}:${event.deviceId ?? "unknown"}:${event.sessionId ?? "unknown"}`,
      fetchedAt: new Date().toISOString(),
      payload: event as JsonRecord,
      cursor: { timestamp: event.timestamp ?? null },
    })),
  );

  const stored = [];
  for (const event of events) {
    const occurredAt =
      typeof event.timestamp === "number" ? new Date(event.timestamp).toISOString() : new Date().toISOString();
    stored.push(
      await ingestWebsiteEvent({
        sourceTypeKey: "vercel_web_analytics_drain",
        sourceId: input.source.id,
        publicTrackingKey: null,
        anonymousId: String(event.deviceId ?? "vercel-device"),
        sessionId: String(event.sessionId ?? "vercel-session"),
        eventName: eventName(event),
        path: event.path ?? "/",
        url: resolvedUrl(event, input.source),
        referrer: event.referrer ?? null,
        userAgent: event.clientName ? `${event.clientName}${event.clientVersion ? ` ${event.clientVersion}` : ""}` : null,
        country: event.country ?? null,
        deviceType: event.deviceType ?? null,
        properties: eventProperties(event),
        occurredAt,
      }),
    );
  }

  await markSourceSyncState(input.source.id, "webhook", { ok: true });
  return {
    count: stored.length,
    events: stored,
  };
}
