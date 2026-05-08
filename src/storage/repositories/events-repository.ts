import { randomUUID } from "node:crypto";
import { isRuntimeDatabaseConfigured, queryRows } from "@/storage/db/client";
import type { ConnectorEvent, JsonRecord, WebEvent } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listSources } from "@/storage/repositories/sources-repository";

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

  if (!isRuntimeDatabaseConfigured()) {
    getDemoStore().connectorEvents.unshift(event);
    return event;
  }

  const rows = await queryRows<ConnectorEvent>(
    `
      insert into connector_events (id, source_id, event_type, severity, message, metadata, created_at)
      values ($1, $2, $3, $4, $5, $6::jsonb, $7)
      returning *
    `,
    [event.id, event.source_id, event.event_type, event.severity, event.message, JSON.stringify(event.metadata), event.created_at],
  );
  return rows[0];
}

export async function listConnectorEvents(limit = 50, options: { dataSpaceId?: string } = {}): Promise<ConnectorEvent[]> {
  if (!isRuntimeDatabaseConfigured()) {
    if (!options.dataSpaceId) return getDemoStore().connectorEvents.slice(0, limit);
    const sourceIds = new Set((await listSources({ dataSpaceId: options.dataSpaceId })).map((source) => source.id));
    return getDemoStore().connectorEvents.filter((event) => event.source_id && sourceIds.has(event.source_id)).slice(0, limit);
  }
  if (options.dataSpaceId) {
    return queryRows<ConnectorEvent>(
      `
        select e.*
        from connector_events e
        join sources s on s.id = e.source_id
        where s.data_space_id = $1
        order by e.created_at desc
        limit $2
      `,
      [options.dataSpaceId, limit],
    );
  }
  return queryRows<ConnectorEvent>(
    `
      select *
      from connector_events
      order by created_at desc
      limit $1
    `,
    [limit],
  );
}

export async function storeWebEvent(input: Omit<WebEvent, "id" | "created_at">): Promise<WebEvent> {
  const event: WebEvent = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    ...input,
  };

  if (!isRuntimeDatabaseConfigured()) {
    getDemoStore().webEvents.unshift(event);
    return event;
  }

  const rows = await queryRows<WebEvent>(
    `
      insert into web_events (
        id,
        source_id,
        public_tracking_key,
        anonymous_id,
        session_id,
        user_id,
        event_name,
        path,
        url,
        referrer,
        user_agent,
        ip_hash,
        country,
        device_type,
        properties,
        occurred_at,
        created_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17
      )
      returning *
    `,
    [
      event.id,
      event.source_id,
      event.public_tracking_key,
      event.anonymous_id,
      event.session_id,
      event.user_id,
      event.event_name,
      event.path,
      event.url,
      event.referrer,
      event.user_agent,
      event.ip_hash,
      event.country,
      event.device_type,
      JSON.stringify(event.properties),
      event.occurred_at,
      event.created_at,
    ],
  );
  return rows[0];
}

export async function listWebEvents(limit = 100, options: { dataSpaceId?: string } = {}): Promise<WebEvent[]> {
  if (!isRuntimeDatabaseConfigured()) {
    if (!options.dataSpaceId) return getDemoStore().webEvents.slice(0, limit);
    const sourceIds = new Set((await listSources({ dataSpaceId: options.dataSpaceId })).map((source) => source.id));
    return getDemoStore().webEvents.filter((event) => event.source_id && sourceIds.has(event.source_id)).slice(0, limit);
  }
  if (options.dataSpaceId) {
    return queryRows<WebEvent>(
      `
        select e.*
        from web_events e
        join sources s on s.id = e.source_id
        where s.data_space_id = $1
        order by e.occurred_at desc
        limit $2
      `,
      [options.dataSpaceId, limit],
    );
  }
  return queryRows<WebEvent>(
    `
      select *
      from web_events
      order by occurred_at desc
      limit $1
    `,
    [limit],
  );
}

export async function findWebEvents(options: {
  limit?: number;
  sourceId?: string | null;
  sourceIds?: string[];
  startOccurredAt?: string;
  endOccurredAt?: string;
  dataSpaceId?: string;
} = {}): Promise<WebEvent[]> {
  if (!isRuntimeDatabaseConfigured()) {
    const sourceIdsForSpace = options.dataSpaceId
      ? new Set((await listSources({ dataSpaceId: options.dataSpaceId })).map((source) => source.id))
      : null;
    return getDemoStore().webEvents
      .filter((event) => {
        if (sourceIdsForSpace && (!event.source_id || !sourceIdsForSpace.has(event.source_id))) return false;
        if (options.sourceId && event.source_id !== options.sourceId) return false;
        if (options.sourceIds?.length && (!event.source_id || !options.sourceIds.includes(event.source_id))) return false;
        if (options.startOccurredAt && event.occurred_at < options.startOccurredAt) return false;
        if (options.endOccurredAt && event.occurred_at > options.endOccurredAt) return false;
        return true;
      })
      .slice(0, options.limit ?? 500);
  }

  const where: string[] = [];
  const values: unknown[] = [];
  if (options.sourceId) {
    values.push(options.sourceId);
    where.push(`e.source_id = $${values.length}`);
  }
  if (options.sourceIds?.length) {
    values.push(options.sourceIds);
    where.push(`e.source_id = any($${values.length}::uuid[])`);
  }
  if (options.startOccurredAt) {
    values.push(options.startOccurredAt);
    where.push(`e.occurred_at >= $${values.length}`);
  }
  if (options.endOccurredAt) {
    values.push(options.endOccurredAt);
    where.push(`e.occurred_at <= $${values.length}`);
  }
  if (options.dataSpaceId) {
    values.push(options.dataSpaceId);
    where.push(`s.data_space_id = $${values.length}`);
  }
  values.push(options.limit ?? 500);
  return queryRows<WebEvent>(
    `
      select e.*
      from web_events e
      ${options.dataSpaceId ? "join sources s on s.id = e.source_id" : ""}
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by e.occurred_at desc
      limit $${values.length}
    `,
    values,
  );
}

export async function hasWebEventIdentity(options: {
  sourceId: string | null;
  occurredDate: string;
  anonymousId?: string;
  sessionId?: string;
}) {
  if (!options.anonymousId && !options.sessionId) return false;
  const start = `${options.occurredDate}T00:00:00.000Z`;
  const end = `${options.occurredDate}T23:59:59.999Z`;

  if (!isRuntimeDatabaseConfigured()) {
    return getDemoStore().webEvents.some((event) => {
      if (event.source_id !== options.sourceId) return false;
      if (event.occurred_at < start || event.occurred_at > end) return false;
      if (options.anonymousId && event.anonymous_id === options.anonymousId) return true;
      if (options.sessionId && event.session_id === options.sessionId) return true;
      return false;
    });
  }

  const conditions: string[] = ["source_id is not distinct from $1", "occurred_at >= $2", "occurred_at <= $3"];
  const values: unknown[] = [options.sourceId, start, end];
  if (options.anonymousId && options.sessionId) {
    values.push(options.anonymousId, options.sessionId);
    conditions.push(`(anonymous_id = $${values.length - 1} or session_id = $${values.length})`);
  } else if (options.anonymousId) {
    values.push(options.anonymousId);
    conditions.push(`anonymous_id = $${values.length}`);
  } else if (options.sessionId) {
    values.push(options.sessionId);
    conditions.push(`session_id = $${values.length}`);
  }
  const rows = await queryRows<{ matched: number }>(
    `
      select 1 as matched
      from web_events
      where ${conditions.join(" and ")}
      limit 1
    `,
    values,
  );
  return Boolean(rows[0]);
}
