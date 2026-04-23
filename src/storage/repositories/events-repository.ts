import { randomUUID } from "node:crypto";
import type { ConnectorEvent, JsonRecord, WebEvent } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";

export async function recordConnectorEvent(input: {
  source_id: string | null;
  event_type: string;
  severity: ConnectorEvent["severity"];
  message: string;
  metadata?: JsonRecord;
}): Promise<ConnectorEvent> {
  const event: ConnectorEvent = {
    id: randomUUID(),
    source_id: input.source_id,
    event_type: input.event_type,
    severity: input.severity,
    message: input.message,
    metadata: input.metadata ?? {},
    created_at: new Date().toISOString(),
  };
  getDemoStore().connectorEvents.unshift(event);
  return event;
}

export async function listConnectorEvents(limit = 50): Promise<ConnectorEvent[]> {
  return getDemoStore().connectorEvents.slice(0, limit);
}

export async function storeWebEvent(input: Omit<WebEvent, "id" | "created_at">): Promise<WebEvent> {
  const event: WebEvent = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    ...input,
  };
  getDemoStore().webEvents.unshift(event);
  return event;
}

export async function listWebEvents(limit = 100): Promise<WebEvent[]> {
  return getDemoStore().webEvents.slice(0, limit);
}
