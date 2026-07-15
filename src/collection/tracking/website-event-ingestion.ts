import { incrementMetrics } from "@/storage/repositories/metrics-repository";
import { hasWebEventIdentity, storeWebEvent } from "@/storage/repositories/events-repository";
import type { JsonRecord, WebEvent } from "@/storage/db/schema";
import type { WebsiteSourceKey } from "@/collection/tracking/website-sources";
import { dateKeyInAppTimeZone } from "@/storage/runtime/app-time";
import { isRuntimeDatabaseConfigured, query, withDatabaseTransaction, type DatabaseExecutor } from "@/storage/db/client";

export interface WebsiteEventIngestionInput {
  sourceTypeKey: WebsiteSourceKey;
  sourceId: string | null;
  publicTrackingKey: string | null;
  anonymousId: string;
  sessionId: string;
  includeSessionMetric?: boolean;
  userId?: string | null;
  eventName: string;
  path: string;
  url: string;
  referrer?: string | null;
  userAgent?: string | null;
  ipHash?: string | null;
  country?: string | null;
  deviceType?: string | null;
  properties?: JsonRecord;
  occurredAt: string;
}

async function ingestWebsiteEventWithExecutor(
  input: WebsiteEventIngestionInput,
  executor?: DatabaseExecutor,
): Promise<WebEvent> {
  const date = dateKeyInAppTimeZone(input.occurredAt);
  if (executor) {
    await query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`website-daily-identity:${input.sourceId ?? "none"}:${date}`],
      executor,
    );
  }
  const hasVisitorAlready = await hasWebEventIdentity(
    { sourceId: input.sourceId, occurredDate: date, anonymousId: input.anonymousId },
    executor,
  );
  const hasSessionAlready = input.includeSessionMetric === false
    ? true
    : await hasWebEventIdentity(
        { sourceId: input.sourceId, occurredDate: date, sessionId: input.sessionId },
        executor,
      );

  const event = await storeWebEvent({
    source_id: input.sourceId,
    public_tracking_key: input.publicTrackingKey,
    anonymous_id: input.anonymousId,
    session_id: input.sessionId,
    user_id: input.userId ?? null,
    event_name: input.eventName,
    path: input.path,
    url: input.url,
    referrer: input.referrer ?? null,
    user_agent: input.userAgent ?? null,
    ip_hash: input.ipHash ?? null,
    country: input.country ?? null,
    device_type: input.deviceType ?? null,
    properties: input.properties ?? {},
    occurred_at: input.occurredAt,
  }, executor);

  const metrics = [
    {
      date,
      sourceId: event.source_id,
      sourceTypeKey: input.sourceTypeKey,
      metricKey: input.eventName === "page_view" ? "page_views" : "custom_events",
      metricValue: 1,
      unit: "count",
      dimensions: { rollup: "daily" } as JsonRecord,
    },
    {
      date,
      sourceId: event.source_id,
      sourceTypeKey: input.sourceTypeKey,
      metricKey: "events_by_path",
      metricValue: 1,
      unit: "count",
      dimensions: { path: input.path } as JsonRecord,
    },
    {
      date,
      sourceId: event.source_id,
      sourceTypeKey: input.sourceTypeKey,
      metricKey: "events_by_referrer",
      metricValue: 1,
      unit: "count",
      dimensions: { referrer: input.referrer || "direct" } as JsonRecord,
    },
  ];

  if (!hasVisitorAlready) {
    metrics.push({
      date,
      sourceId: event.source_id,
      sourceTypeKey: input.sourceTypeKey,
      metricKey: "unique_visitors",
      metricValue: 1,
      unit: "count",
      dimensions: { rollup: "daily" } as JsonRecord,
    });
  }
  if (input.includeSessionMetric !== false && !hasSessionAlready) {
    metrics.push({
      date,
      sourceId: event.source_id,
      sourceTypeKey: input.sourceTypeKey,
      metricKey: "sessions",
      metricValue: 1,
      unit: "count",
      dimensions: { rollup: "daily" } as JsonRecord,
    });
  }

  await incrementMetrics(metrics, executor);
  return event;
}

export async function ingestWebsiteEvent(
  input: WebsiteEventIngestionInput,
  executor?: DatabaseExecutor,
): Promise<WebEvent> {
  if (executor) return ingestWebsiteEventWithExecutor(input, executor);
  if (!isRuntimeDatabaseConfigured()) return ingestWebsiteEventWithExecutor(input);
  return withDatabaseTransaction((client) => ingestWebsiteEventWithExecutor(input, client));
}
