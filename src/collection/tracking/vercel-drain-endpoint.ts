import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { RawPayload } from "@/collection/connectors/types";
import type { WebsiteEventIngestionInput } from "@/collection/tracking/website-event-ingestion";
import type { JsonRecord, Source } from "@/storage/db/schema";

export const VERCEL_DRAIN_WEBHOOK_PAYLOAD_KIND = "vercel_analytics_drain";

const MAX_DRAIN_EVENTS = 500;
const MAX_DRAIN_EVENT_DEPTH = 6;
const MAX_DRAIN_EVENT_KEYS = 64;
const MAX_DRAIN_EVENT_NODES = 256;
const MAX_DRAIN_EVENT_DATA_BYTES = 16 * 1024;
const MAX_DRAIN_QUERY_PARAMS_BYTES = 8 * 1024;
const MAX_DRAIN_QUERY_PARAMS = 32;
const MAX_PERSISTED_PROPERTIES_BYTES = 8 * 1024;
const MAX_PERSISTED_RAW_EVENT_BYTES = 12 * 1024;
const MAX_DIAGNOSTIC_VALUE_LENGTH = 256;
const MAX_UTM_VALUE_LENGTH = 100;
const MAX_PATH_LENGTH = 500;
const MAX_URL_LENGTH = 1_200;
const REDACTED_VALUE = "[redacted]";

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

function decodedTextVariants(value: string) {
  const variants = new Set([value]);
  let candidate = value;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      variants.add(decoded);
      candidate = decoded;
    } catch {
      // Invalid percent encoding is treated as the last valid variant.
      break;
    }
  }
  return [...variants];
}

function looksLikeHighEntropySecret(value: string) {
  const compact = value.replace(/\s+/gu, "");
  if (compact.length < 24) return false;
  if (/^(?:prj|team|user|dpl)_[A-Za-z0-9_-]{8,80}$/u.test(compact)) return false;
  if (/^[A-Fa-f0-9]{32,}$/u.test(compact) || /^[A-Za-z0-9+/=_-]{32,}$/u.test(compact)) return true;
  const characterClasses = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(compact)).length;
  if (characterClasses < 3) return false;
  const counts = new Map<string, number>();
  for (const character of compact) counts.set(character, (counts.get(character) ?? 0) + 1);
  const entropy = [...counts.values()].reduce((total, count) => {
    const probability = count / compact.length;
    return total - probability * Math.log2(probability);
  }, 0);
  return entropy >= 3.5;
}

function containsIpLiteral(value: string) {
  const ipv4Candidates = value.match(/(?:\d{1,3}\.){3}\d{1,3}/gu) ?? [];
  if (ipv4Candidates.some((candidate) => isIP(candidate) === 4)) return true;

  return value
    .split(/[\s/?&#()[\]{},="'<>]+/u)
    .filter(Boolean)
    .some((rawCandidate) => {
      const candidate = rawCandidate.replace(/^\[|\]$/gu, "");
      if (isIP(candidate) !== 0) return true;
      const ipv4WithPort = candidate.match(/^((?:\d{1,3}\.){3}\d{1,3}):\d{1,5}$/u);
      return ipv4WithPort ? isIP(ipv4WithPort[1]) === 4 : false;
    });
}

function containsSensitiveText(value: string) {
  return decodedTextVariants(value).some((candidate) => {
    const normalized = candidate.normalize("NFKC");
    const addressCandidate = normalized.replace(/[-_/]+/gu, " ");
    return (
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(normalized) ||
      /(?:^|\D)\+?\d[\d\s().-]{7,}\d(?:\D|$)/u.test(normalized) ||
      /\b\d{1,6}\s+[A-Z0-9.'-]+(?:\s+[A-Z0-9.'-]+){0,4}\s+(?:STREET|ST|ROAD|RD|AVENUE|AVE|BOULEVARD|BLVD|LANE|LN|DRIVE|DR|COURT|CT|HIGHWAY|HWY)\b/iu.test(addressCandidate) ||
      /\b(?:bearer|basic)\s+[A-Z0-9._~+/=-]{8,}\b/iu.test(normalized) ||
      /\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9_-]{8,}\b/iu.test(normalized) ||
      /\beyJ[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}\.[A-Z0-9_-]{8,}\b/iu.test(normalized) ||
      /(?:^|[?&#/_.-])(?:authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|access[_-]?key|session[_-]?id)(?:[=:/_.-]|$)/iu.test(normalized) ||
      /[?&][^=&#]{1,120}=[^&#]*/u.test(normalized) ||
      containsIpLiteral(normalized) ||
      looksLikeHighEntropySecret(normalized)
    );
  });
}

function isSafeUtmValue(value: string) {
  return (
    value.length <= MAX_UTM_VALUE_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9 ._~:+-]*$/u.test(value) &&
    !containsSensitiveText(value) &&
    !looksLikeHighEntropySecret(value)
  );
}

function sanitizeDiagnosticValue(value: unknown, maxLength = MAX_DIAGNOSTIC_VALUE_LENGTH) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[\u0000-\u001F\u007F]/gu, "");
  if (!trimmed) return null;
  if (containsSensitiveText(trimmed)) return REDACTED_VALUE;
  return trimmed.slice(0, maxLength);
}

function assertStringBytes(value: unknown, maximum: number, label: string) {
  if (typeof value === "string" && Buffer.byteLength(value, "utf8") > maximum) {
    throw new VercelDrainIngestionError(`${label} exceeds the permitted size.`, 413);
  }
}

function assertPayloadComplexity(value: unknown, label: string) {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let keyCount = 0;
  let nodeCount = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > MAX_DRAIN_EVENT_NODES) {
      throw new VercelDrainIngestionError(`${label} contains too many values.`, 413);
    }
    if (current.depth > MAX_DRAIN_EVENT_DEPTH) {
      throw new VercelDrainIngestionError(`${label} exceeds the permitted nesting depth.`, 413);
    }
    if (Array.isArray(current.value)) {
      for (const nested of current.value) pending.push({ value: nested, depth: current.depth + 1 });
      continue;
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    const entries = Object.entries(current.value as Record<string, unknown>);
    keyCount += entries.length;
    if (keyCount > MAX_DRAIN_EVENT_KEYS) {
      throw new VercelDrainIngestionError(`${label} contains too many fields.`, 413);
    }
    for (const [, nested] of entries) pending.push({ value: nested, depth: current.depth + 1 });
  }
}

function assertEmbeddedJsonComplexity(value: string | undefined, label: string) {
  if (!value?.trim()) return;
  try {
    assertPayloadComplexity(JSON.parse(value), label);
  } catch (error) {
    if (error instanceof VercelDrainIngestionError) throw error;
    // Malformed embedded JSON is never persisted and is recorded only as a
    // boolean diagnostic marker.
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
  safeEntries: Array<[string, string]>;
  utm: JsonRecord | null;
  receivedCount: number;
  retainedCount: number;
  discardedCount: number;
  malformed: boolean;
};

function queryParamScalar(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parseVercelQueryParams(input: unknown): ParsedQueryParams {
  const empty = {
    safeEntries: [],
    utm: null,
    receivedCount: 0,
    retainedCount: 0,
    discardedCount: 0,
    malformed: false,
  } satisfies ParsedQueryParams;
  if (typeof input !== "string") return empty;

  const trimmed = input.trim();
  if (!trimmed) return empty;

  let parsedInput: unknown = trimmed;
  let parsedAsJson = false;
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) {
    try {
      parsedInput = JSON.parse(trimmed);
      parsedAsJson = true;
    } catch {
      return {
        ...empty,
        receivedCount: 1,
        discardedCount: 1,
        malformed: true,
      };
    }
  }
  if (parsedAsJson) assertPayloadComplexity(parsedInput, "Vercel Drain queryParams");

  let entries: Array<[string, unknown]> = [];
  if (typeof parsedInput === "string") {
    const queryString = parsedInput.startsWith("?") ? parsedInput.slice(1) : parsedInput;
    entries = Array.from(new URLSearchParams(queryString).entries());
  } else if (typeof parsedInput === "object" && parsedInput !== null && !Array.isArray(parsedInput)) {
    entries = Object.entries(parsedInput);
  } else {
    return {
      ...empty,
      receivedCount: 1,
      discardedCount: 1,
      malformed: true,
    };
  }
  if (entries.length > MAX_DRAIN_QUERY_PARAMS) {
    throw new VercelDrainIngestionError("Vercel Drain queryParams contains too many fields.", 413);
  }

  const utm: JsonRecord = {};
  const safeEntries: Array<[string, string]> = [];
  let discardedCount = 0;
  for (const [rawKey, unknownValue] of entries) {
    const key = rawKey.trim().toLowerCase() as keyof typeof UTM_PROPERTY_KEYS;
    const propertyKey = UTM_PROPERTY_KEYS[key];
    const scalar = queryParamScalar(unknownValue);
    const value = scalar?.trim() ?? "";
    if (
      propertyKey &&
      value &&
      isSafeUtmValue(value) &&
      utm[propertyKey] === undefined
    ) {
      utm[propertyKey] = value;
      safeEntries.push([key, value]);
    } else {
      discardedCount += 1;
    }
  }

  return {
    safeEntries,
    utm: Object.keys(utm).length > 0 ? utm : null,
    receivedCount: entries.length,
    retainedCount: safeEntries.length,
    discardedCount,
    malformed: false,
  };
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
  if (events.length > MAX_DRAIN_EVENTS) {
    throw new VercelDrainIngestionError("Vercel Drain payload contains too many events.", 413);
  }
  for (const event of events) {
    if (typeof event !== "object" || event === null || Array.isArray(event)) {
      throw new VercelDrainIngestionError("Vercel Drain events must be JSON objects.", 400);
    }
    assertPayloadComplexity(event, "Vercel Drain event");
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
    assertStringBytes(event.eventData, MAX_DRAIN_EVENT_DATA_BYTES, "Vercel Drain eventData");
    assertStringBytes(event.queryParams, MAX_DRAIN_QUERY_PARAMS_BYTES, "Vercel Drain queryParams");
    assertEmbeddedJsonComplexity(event.eventData, "Vercel Drain eventData");
    parseVercelQueryParams(event.queryParams);
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

function sanitizePath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "/";
  const sanitizedInput = value.trim().replace(/[\u0000-\u001F\u007F]/gu, "");
  if (!sanitizedInput) return "/";
  let pathname: string;
  try {
    pathname = new URL(sanitizedInput, "https://drain.invalid").pathname;
  } catch {
    pathname = sanitizedInput.split(/[?#]/u, 1)[0] ?? "/";
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (containsSensitiveText(pathname)) return "/[redacted]";
  return pathname.slice(0, MAX_PATH_LENGTH) || "/";
}

function sanitizeHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    if (isIP(hostname)) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = sanitizePath(url.pathname);
    const sanitized = url.toString();
    return sanitized.length <= MAX_URL_LENGTH ? sanitized : null;
  } catch {
    return null;
  }
}

function sanitizeUrlLikeValue(value: unknown) {
  const httpUrl = sanitizeHttpUrl(value);
  if (httpUrl) return httpUrl;
  if (typeof value !== "string") return null;
  if (/^https?:\/\//iu.test(value.trim())) return null;
  return sanitizeDiagnosticValue(value.split(/[?#]/u, 1)[0]);
}

function resolvedUrl(event: VercelDrainEvent, source: Source, queryParams: ParsedQueryParams) {
  const baseUrl = sanitizeHttpUrl(event.origin)
    ?? sanitizeHttpUrl(source.normalized_url)
    ?? "https://moonarqstudio.com/";
  const url = new URL(sanitizePath(event.path), baseUrl);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  for (const [key, value] of queryParams.safeEntries) {
    url.searchParams.set(key, value);
    if (url.toString().length > MAX_URL_LENGTH) url.searchParams.delete(key);
  }
  return url.toString();
}

function eventName(event: VercelDrainEvent) {
  if (event.eventType === "pageview") return "page_view";
  const candidate = sanitizeDiagnosticValue(event.eventName, 80);
  if (!candidate || candidate === REDACTED_VALUE) return "custom_event";
  return candidate.replace(/[^A-Za-z0-9_.:-]+/gu, "_").replace(/^_+|_+$/gu, "") || "custom_event";
}

function queryDiagnostics(queryParams: ParsedQueryParams) {
  return {
    received: queryParams.receivedCount,
    retained: queryParams.retainedCount,
    discarded: queryParams.discardedCount,
    malformed: queryParams.malformed,
  } satisfies JsonRecord;
}

function eventProperties(event: VercelDrainEvent, queryParams: ParsedQueryParams) {
  const properties = {
    vercel: {
      schema: sanitizeDiagnosticValue(event.schema) ?? "vercel.analytics.v2",
      project_id: sanitizeDiagnosticValue(event.projectId),
      owner_id: sanitizeDiagnosticValue(event.ownerId),
      route: event.route ? sanitizePath(event.route) : null,
      os_name: sanitizeDiagnosticValue(event.osName),
      os_version: sanitizeDiagnosticValue(event.osVersion),
      client_name: sanitizeDiagnosticValue(event.clientName),
      client_type: sanitizeDiagnosticValue(event.clientType),
      client_version: sanitizeDiagnosticValue(event.clientVersion),
      vercel_environment: sanitizeDiagnosticValue(event.vercelEnvironment),
      vercel_url: sanitizeUrlLikeValue(event.vercelUrl),
      sdk_name: sanitizeDiagnosticValue(event.sdkName),
      sdk_version: sanitizeDiagnosticValue(event.sdkVersion),
      deployment: sanitizeDiagnosticValue(event.deployment),
      query_parameters: queryDiagnostics(queryParams),
      event_data_discarded: Boolean(event.eventData?.trim()),
    },
    ...(queryParams.utm
      ? {
          attribution: {
            utm: queryParams.utm,
          },
        }
      : {}),
  } as JsonRecord;
  if (Buffer.byteLength(JSON.stringify(properties), "utf8") > MAX_PERSISTED_PROPERTIES_BYTES) {
    throw new VercelDrainIngestionError("Sanitized Vercel Drain properties exceed the permitted size.", 413);
  }
  return properties;
}

function pseudonymousDeviceId(
  sourceId: string,
  deviceId: VercelDrainEvent["deviceId"],
) {
  if (deviceId === undefined || deviceId === null || String(deviceId).trim() === "") return "vercel-device";
  const pseudonymKey = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!pseudonymKey) {
    throw new VercelDrainIngestionError("Vercel Drain pseudonymization is unavailable.", 503);
  }
  const digest = createHmac("sha256", pseudonymKey)
    .update("vercel-drain-device\0")
    .update(sourceId)
    .update("\0")
    .update(String(deviceId))
    .digest("hex")
    .slice(0, 32);
  return `vercel-device-${digest}`;
}

function diagnosticRawEvent(
  event: VercelDrainEvent,
  source: Source,
  queryParams: ParsedQueryParams,
  anonymousId: string,
) {
  const payload = {
    schema: sanitizeDiagnosticValue(event.schema) ?? "vercel.analytics.v2",
    eventType: event.eventType ?? "event",
    eventName: eventName(event),
    timestamp: event.timestamp ?? null,
    projectId: sanitizeDiagnosticValue(event.projectId),
    ownerId: sanitizeDiagnosticValue(event.ownerId),
    deviceId: anonymousId,
    origin: sanitizeHttpUrl(event.origin) ?? sanitizeHttpUrl(source.normalized_url),
    path: sanitizePath(event.path),
    referrer: sanitizeHttpUrl(event.referrer),
    route: event.route ? sanitizePath(event.route) : null,
    country: sanitizeDiagnosticValue(event.country, 80),
    osName: sanitizeDiagnosticValue(event.osName),
    osVersion: sanitizeDiagnosticValue(event.osVersion),
    clientName: sanitizeDiagnosticValue(event.clientName),
    clientType: sanitizeDiagnosticValue(event.clientType),
    clientVersion: sanitizeDiagnosticValue(event.clientVersion),
    deviceType: sanitizeDiagnosticValue(event.deviceType),
    vercelEnvironment: sanitizeDiagnosticValue(event.vercelEnvironment),
    vercelUrl: sanitizeUrlLikeValue(event.vercelUrl),
    sdkName: sanitizeDiagnosticValue(event.sdkName),
    sdkVersion: sanitizeDiagnosticValue(event.sdkVersion),
    deployment: sanitizeDiagnosticValue(event.deployment),
    queryParameters: queryDiagnostics(queryParams),
    utm: queryParams.utm,
    eventDataDiscarded: Boolean(event.eventData?.trim()),
  } as JsonRecord;
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PERSISTED_RAW_EVENT_BYTES) {
    throw new VercelDrainIngestionError("Sanitized Vercel Drain event exceeds the permitted size.", 413);
  }
  return payload;
}

function deterministicEventId(sourceId: string, event: JsonRecord, index: number) {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(sourceId)
      .update("\0")
      .update(JSON.stringify(event))
      .update("\0")
      .update(String(index))
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  const normalizedEvents = events.map((event, index) => {
    const queryParams = parseVercelQueryParams(event.queryParams);
    const anonymousId = pseudonymousDeviceId(input.source.id, event.deviceId);
    const rawEvent = diagnosticRawEvent(event, input.source, queryParams, anonymousId);
    const eventId = deterministicEventId(input.source.id, rawEvent, index);
    const occurredAt =
      typeof event.timestamp === "number" ? new Date(event.timestamp).toISOString() : new Date().toISOString();
    const properties = eventProperties(event, queryParams);
    const attribution = properties.attribution;
    const clientName = sanitizeDiagnosticValue(event.clientName);
    const clientVersion = sanitizeDiagnosticValue(event.clientVersion);
    const deviceCategory = sanitizeDiagnosticValue(event.deviceType ?? event.clientType)?.toLowerCase();
    return {
      rawPayload: {
        externalId: eventId,
        fetchedAt,
        payload: rawEvent,
        cursor: { timestamp: event.timestamp ?? null },
      } satisfies RawPayload,
      webEvent: {
        eventId,
        schemaVersion: "vercel.analytics.v2",
        eventSource: "vercel_drain",
        sourceTypeKey: "vercel_web_analytics_drain",
        sourceId: input.source.id,
        publicTrackingKey: null,
        anonymousId,
        sessionId: "vercel-session-unavailable",
        includeSessionMetric: false,
        eventName: eventName(event),
        path: sanitizePath(event.path),
        url: resolvedUrl(event, input.source, queryParams),
        referrer: sanitizeHttpUrl(event.referrer),
        userAgent: clientName
          ? `${clientName}${clientVersion ? ` ${clientVersion}` : ""}`.slice(0, MAX_DIAGNOSTIC_VALUE_LENGTH)
          : null,
        country: sanitizeDiagnosticValue(event.country, 80),
        deviceType: sanitizeDiagnosticValue(event.deviceType, 80),
        properties,
        attributionContext: attribution && typeof attribution === "object" && !Array.isArray(attribution)
          ? attribution as JsonRecord
          : {},
        consentStatus: { analytics: "unknown", marketing: "unknown" },
        clientContext: {
          device_category: deviceCategory && ["mobile", "tablet", "desktop", "bot"].includes(deviceCategory)
            ? deviceCategory
            : "unknown",
        },
        occurredAt,
        receivedAt: fetchedAt,
      } satisfies WebsiteEventIngestionInput,
    };
  });

  const rawPayloads = normalizedEvents.map((event) => event.rawPayload);
  const webEvents = normalizedEvents.map((event) => event.webEvent);

  return {
    count: webEvents.length,
    webEvents,
    rawPayloads,
    cursorAfter: { fetchedAt, eventCount: webEvents.length } satisfies JsonRecord,
  };
}
