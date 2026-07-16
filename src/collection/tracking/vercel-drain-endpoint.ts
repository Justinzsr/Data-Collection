import { createHmac, timingSafeEqual } from "node:crypto";
import type { RawPayload } from "@/collection/connectors/types";
import type { WebsiteEventIngestionInput } from "@/collection/tracking/website-event-ingestion";
import type { JsonRecord, Source } from "@/storage/db/schema";

export const VERCEL_DRAIN_WEBHOOK_PAYLOAD_KIND = "vercel_analytics_drain";

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
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as JsonRecord) : {};
  } catch {
    return { raw: input };
  }
}

const UTM_PROPERTY_KEYS = {
  utm_source: "source",
  utm_medium: "medium",
  utm_campaign: "campaign",
  utm_content: "content",
  utm_term: "term",
} as const;

type ParsedQueryParams = {
  entries: Array<[string, string]>;
  utm: JsonRecord | null;
};

function queryParamScalar(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parseVercelQueryParams(input: unknown): ParsedQueryParams {
  if (typeof input !== "string") return { entries: [], utm: null };

  const trimmed = input.trim();
  if (!trimmed) return { entries: [], utm: null };

  let parsedInput: unknown = trimmed;
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
    try {
      parsedInput = JSON.parse(trimmed);
    } catch {
      // A payload that looks like JSON but is malformed is retained verbatim in
      // properties.vercel.query_params, but is not promoted into a URL or attribution.
      return { entries: [], utm: null };
    }
  }

  let entries: Array<[string, string]> = [];
  if (typeof parsedInput === "string") {
    const queryString = parsedInput.startsWith("?") ? parsedInput.slice(1) : parsedInput;
    entries = Array.from(new URLSearchParams(queryString).entries());
  } else if (typeof parsedInput === "object" && parsedInput !== null && !Array.isArray(parsedInput)) {
    entries = Object.entries(parsedInput).flatMap(([key, value]) => {
      const scalar = queryParamScalar(value);
      return scalar === null ? [] : [[key, scalar] as [string, string]];
    });
  }

  const utm: JsonRecord = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim().toLowerCase() as keyof typeof UTM_PROPERTY_KEYS;
    const propertyKey = UTM_PROPERTY_KEYS[key];
    const value = rawValue.trim();
    if (propertyKey && value && utm[propertyKey] === undefined) {
      utm[propertyKey] = value;
    }
  }

  return { entries, utm: Object.keys(utm).length > 0 ? utm : null };
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

function verifySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac("sha1", secret).update(Buffer.from(rawBody, "utf8")).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

export class VercelDrainIngestionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "VercelDrainIngestionError";
  }
}

function assertVercelDrainPayload(rawBody: string) {
  let events: VercelDrainEvent[];
  try {
    events = parseBody(rawBody);
  } catch {
    throw new VercelDrainIngestionError("Vercel Drain payload is not valid JSON or NDJSON.", 400);
  }
  if (events.length === 0) {
    throw new VercelDrainIngestionError("Vercel Drain payload does not contain any events.", 400);
  }
  for (const event of events) {
    if (typeof event !== "object" || event === null || Array.isArray(event)) {
      throw new VercelDrainIngestionError("Vercel Drain events must be JSON objects.", 400);
    }
    if (event.eventType !== "pageview" && event.eventType !== "event") {
      throw new VercelDrainIngestionError("Vercel Drain eventType must be pageview or event.", 400);
    }
    if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp) || Number.isNaN(new Date(event.timestamp).getTime())) {
      throw new VercelDrainIngestionError("Vercel Drain event timestamp is invalid.", 400);
    }
    if (event.path !== undefined && typeof event.path !== "string") {
      throw new VercelDrainIngestionError("Vercel Drain event path is invalid.", 400);
    }
    if (event.origin !== undefined && typeof event.origin !== "string") {
      throw new VercelDrainIngestionError("Vercel Drain event origin is invalid.", 400);
    }
    if (event.eventData !== undefined && typeof event.eventData !== "string") {
      throw new VercelDrainIngestionError("Vercel Drain eventData must be a JSON string.", 400);
    }
    if (event.queryParams !== undefined && typeof event.queryParams !== "string") {
      throw new VercelDrainIngestionError("Vercel Drain queryParams must be a JSON or query string.", 400);
    }
  }
}

export function assertVercelDrainRequestCanIngest(input: {
  source: Source;
  rawBody: string;
  signature: string | null;
  signatureSecret?: string;
}) {
  if (input.source.source_type_key !== "vercel_web_analytics_drain") {
    throw new VercelDrainIngestionError("Source does not accept Vercel Analytics Drain events.", 404);
  }

  if (input.source.status === "disabled") {
    throw new VercelDrainIngestionError("This source is disabled and cannot receive webhook events.", 409);
  }

  const secret = input.signatureSecret?.trim();
  if (!secret) {
    throw new VercelDrainIngestionError(
      "Vercel Drain signature verification is not configured for this source.",
      503,
    );
  }

  if (!verifySignature(input.rawBody, input.signature, secret)) {
    throw new VercelDrainIngestionError("Invalid Vercel drain signature.", 403);
  }
  assertVercelDrainPayload(input.rawBody);
}

export function createVercelDrainWebhookPayload(rawBody: string, signature: string): JsonRecord {
  return {
    kind: VERCEL_DRAIN_WEBHOOK_PAYLOAD_KIND,
    rawBody,
    signature,
  };
}

export function readVercelDrainWebhookPayload(payload: JsonRecord | null | undefined) {
  if (
    payload?.kind !== VERCEL_DRAIN_WEBHOOK_PAYLOAD_KIND ||
    typeof payload.rawBody !== "string" ||
    typeof payload.signature !== "string" ||
    !payload.signature
  ) {
    throw new Error("Verified Vercel Drain webhook payload is missing or invalid.");
  }
  return { rawBody: payload.rawBody, signature: payload.signature };
}

function resolvedUrl(event: VercelDrainEvent, source: Source) {
  const queryParams = parseVercelQueryParams(event.queryParams);
  let baseUrl: string;
  if (event.origin && event.path) {
    try {
      baseUrl = new URL(event.path, event.origin).toString();
    } catch {
      baseUrl = `${event.origin}${event.path}`;
    }
  } else if (event.origin) {
    baseUrl = event.origin;
  } else if (source.normalized_url) {
    try {
      baseUrl = new URL(event.path ?? "/", source.normalized_url).toString();
    } catch {
      baseUrl = source.normalized_url;
    }
  } else {
    baseUrl = "https://moonarqstudio.com";
  }

  if (queryParams.entries.length === 0) return baseUrl;

  try {
    const url = new URL(baseUrl);
    const replacedKeys = new Set<string>();
    for (const [key, value] of queryParams.entries) {
      if (!replacedKeys.has(key)) {
        url.searchParams.delete(key);
        replacedKeys.add(key);
      }
      url.searchParams.append(key, value);
    }
    return url.toString();
  } catch {
    const queryString = new URLSearchParams(queryParams.entries).toString();
    if (!queryString) return baseUrl;
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${queryString}`;
  }
}

function eventName(event: VercelDrainEvent) {
  return event.eventType === "pageview" ? "page_view" : event.eventName || "custom_event";
}

function eventProperties(event: VercelDrainEvent) {
  const eventData = parseJsonObject(event.eventData);
  const queryParams = parseVercelQueryParams(event.queryParams);
  const rawAttribution = eventData.attribution;
  const attribution =
    typeof rawAttribution === "object" && rawAttribution !== null && !Array.isArray(rawAttribution)
      ? (rawAttribution as JsonRecord)
      : {};

  return {
    ...eventData,
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
    ...(queryParams.utm
      ? {
          attribution: {
            ...attribution,
            utm: queryParams.utm,
          },
        }
      : {}),
  } as JsonRecord;
}

export function prepareVercelAnalyticsDrain(input: {
  source: Source;
  rawBody: string;
  signature: string | null;
  signatureSecret?: string;
}) {
  assertVercelDrainRequestCanIngest(input);

  const events = parseBody(input.rawBody);
  const fetchedAt = new Date().toISOString();
  const rawPayloads: RawPayload[] = events.map((event, index) => ({
    externalId: `${event.eventType ?? "event"}:${event.timestamp ?? "missing"}:${event.deviceId ?? "unknown"}:${event.sessionId ?? "unknown"}:${index}`,
    fetchedAt,
    payload: event as JsonRecord,
    cursor: { timestamp: event.timestamp ?? null },
  }));

  const webEvents: WebsiteEventIngestionInput[] = events.map((event) => {
    const occurredAt =
      typeof event.timestamp === "number" ? new Date(event.timestamp).toISOString() : new Date().toISOString();
    return {
      sourceTypeKey: "vercel_web_analytics_drain",
      sourceId: input.source.id,
      publicTrackingKey: null,
      anonymousId: String(event.deviceId ?? "vercel-device"),
      sessionId: "vercel-session-unavailable",
      includeSessionMetric: false,
      eventName: eventName(event),
      path: event.path ?? "/",
      url: resolvedUrl(event, input.source),
      referrer: event.referrer ?? null,
      userAgent: event.clientName ? `${event.clientName}${event.clientVersion ? ` ${event.clientVersion}` : ""}` : null,
      country: event.country ?? null,
      deviceType: event.deviceType ?? null,
      properties: eventProperties(event),
      occurredAt,
    };
  });

  return {
    count: webEvents.length,
    webEvents,
    rawPayloads,
    cursorAfter: { fetchedAt, eventCount: webEvents.length } satisfies JsonRecord,
  };
}
