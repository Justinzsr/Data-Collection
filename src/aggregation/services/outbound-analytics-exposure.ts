import type { ConnectorEvent, JsonRecord, WebEvent } from "@/storage/db/schema";

const sensitiveKeyPattern = /(secret|token|password|credential|authorization|service_role|encrypted_value|auth_tag|iv)/i;
const privateIdentityKeys = new Set([
  "eventid",
  "iteminstanceid",
  "checkouteventidhash",
  "iteminstanceidhash",
]);

function normalizedKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/**
 * Final outbound policy for authenticated operational analytics surfaces.
 * Internal repositories retain exact identities for deterministic joins; APIs
 * and explorer views omit them before serialization.
 */
export function redactOutboundAnalyticsJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOutboundAnalyticsJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
      if (privateIdentityKeys.has(normalizedKey(key))) return [];
      return [[
        key,
        sensitiveKeyPattern.test(key) ? "[redacted]" : redactOutboundAnalyticsJson(nested),
      ]];
    }),
  );
}

function jsonRecord(value: unknown): JsonRecord {
  const redacted = redactOutboundAnalyticsJson(value);
  return redacted && typeof redacted === "object" && !Array.isArray(redacted)
    ? redacted as JsonRecord
    : {};
}

export function toPublicWebEvent(event: WebEvent) {
  return {
    schema_version: event.schema_version,
    event_source: event.event_source,
    event_name: event.event_name,
    path: event.path,
    country: event.country,
    device_type: event.device_type,
    properties: jsonRecord(event.properties),
    attribution_context: jsonRecord(event.attribution_context),
    consent_status: jsonRecord(event.consent_status),
    client_context: jsonRecord(event.client_context),
    occurred_at: event.occurred_at,
    received_at: event.received_at,
  };
}

export function toPublicConnectorEvent(event: ConnectorEvent) {
  return {
    event_type: event.event_type,
    severity: event.severity,
    message: event.message,
    metadata: jsonRecord(event.metadata),
    created_at: event.created_at,
  };
}
