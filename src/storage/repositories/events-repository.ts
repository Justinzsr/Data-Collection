import { randomUUID } from "node:crypto";
import { isRuntimeDatabaseConfigured, queryRows, type DatabaseExecutor } from "@/storage/db/client";
import type { ConnectorEvent, JsonRecord, WebEvent } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import { listSources } from "@/storage/repositories/sources-repository";
import { addDaysToDateKey, dateKeyInAppTimeZone, endOfAppDateUtc, startOfAppDateUtc } from "@/storage/runtime/app-time";

export async function recordConnectorEvent(input: {
  source_id: string | null;
  event_type: string;
  severity: ConnectorEvent["severity"];
  message: string;
  metadata?: JsonRecord;
}, executor?: DatabaseExecutor): Promise<ConnectorEvent> {
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
    executor,
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

export async function storeWebEvent(
  input: Omit<WebEvent, "id" | "created_at">,
  executor?: DatabaseExecutor,
): Promise<{ event: WebEvent; inserted: boolean }> {
  const event: WebEvent = {
    id: randomUUID(),
    created_at: input.received_at,
    ...input,
  };

  if (!isRuntimeDatabaseConfigured()) {
    const existing = getDemoStore().webEvents.find(
      (candidate) => candidate.source_id === event.source_id && candidate.event_id === event.event_id,
    );
    if (existing) return { event: existing, inserted: false };
    getDemoStore().webEvents.unshift(event);
    return { event, inserted: true };
  }

  const rows = await queryRows<WebEvent>(
    `
      insert into web_events (
        id,
        event_id,
        schema_version,
        event_source,
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
        attribution_context,
        consent_status,
        client_context,
        occurred_at,
        received_at,
        created_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb,
        $19::jsonb, $20::jsonb, $21::jsonb, $22, $23, $24
      )
      on conflict (source_id, event_id) do nothing
      returning *
    `,
    [
      event.id,
      event.event_id,
      event.schema_version,
      event.event_source,
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
      JSON.stringify(event.attribution_context),
      JSON.stringify(event.consent_status),
      JSON.stringify(event.client_context),
      event.occurred_at,
      event.received_at,
      event.created_at,
    ],
    executor,
  );
  if (rows[0]) return { event: rows[0], inserted: true };
  const existing = await queryRows<WebEvent>(
    `
      select *
      from web_events
      where source_id is not distinct from $1
        and event_id = $2
      limit 1
    `,
    [event.source_id, event.event_id],
    executor,
  );
  if (!existing[0]) throw new Error("Duplicate web event could not be resolved after idempotent insert.");
  return { event: existing[0], inserted: false };
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

export type WebEventUtmCounts = {
  pageViews: number;
  visitors: number;
  eligibleReturnDevices1d: number;
  returningDevices1d: number;
  eligibleReturnDevices7d: number;
  returningDevices7d: number;
};

type ExactUtm = {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term?: string | null;
};

function utmFromRecord(value: unknown): Partial<ExactUtm> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as JsonRecord;
  const candidate = {
    source: typeof record.source === "string" ? record.source : typeof record.utm_source === "string" ? record.utm_source : undefined,
    medium: typeof record.medium === "string" ? record.medium : typeof record.utm_medium === "string" ? record.utm_medium : undefined,
    campaign: typeof record.campaign === "string" ? record.campaign : typeof record.utm_campaign === "string" ? record.utm_campaign : undefined,
    content: typeof record.content === "string" ? record.content : typeof record.utm_content === "string" ? record.utm_content : undefined,
    term: typeof record.term === "string" ? record.term : typeof record.utm_term === "string" ? record.utm_term : null,
  };
  return candidate.source || candidate.medium || candidate.campaign || candidate.content || candidate.term ? candidate : null;
}

function utmFromParams(params: URLSearchParams | null): Partial<ExactUtm> | null {
  if (!params) return null;
  const candidate = {
    source: params.get("utm_source") ?? undefined,
    medium: params.get("utm_medium") ?? undefined,
    campaign: params.get("utm_campaign") ?? undefined,
    content: params.get("utm_content") ?? undefined,
    term: params.get("utm_term"),
  };
  return candidate.source || candidate.medium || candidate.campaign || candidate.content || candidate.term ? candidate : null;
}

function eventUtmCandidates(event: WebEvent): Partial<ExactUtm>[] {
  const candidates: Partial<ExactUtm>[] = [];
  const attribution = Object.keys(event.attribution_context).length > 0
    ? event.attribution_context
    : event.properties.attribution;
  if (attribution && typeof attribution === "object" && !Array.isArray(attribution)) {
    const utm = (attribution as JsonRecord).utm;
    const normalized = utmFromRecord(utm);
    if (normalized) candidates.push(normalized);
  }

  try {
    const fromUrl = utmFromParams(new URL(event.url).searchParams);
    if (fromUrl) candidates.push(fromUrl);
  } catch {
    // Legacy drain events may keep query parameters only in properties.
  }
  const vercel = event.properties.vercel;
  const legacy = vercel && typeof vercel === "object" && !Array.isArray(vercel)
    ? (vercel as JsonRecord).query_params
    : null;
  const legacyRecord = utmFromRecord(legacy);
  if (legacyRecord) candidates.push(legacyRecord);
  if (typeof legacy === "string" && legacy.trim()) {
    let candidate = legacy.trim();
    try {
      const decoded = JSON.parse(candidate) as unknown;
      const fromDecoded = utmFromRecord(decoded);
      if (fromDecoded) candidates.push(fromDecoded);
      if (typeof decoded === "string") candidate = decoded;
    } catch {
      // Plain query strings are supported below.
    }
    const fromQuery = utmFromParams(new URLSearchParams(candidate.startsWith("?") ? candidate.slice(1) : candidate));
    if (fromQuery) candidates.push(fromQuery);
  }
  return candidates;
}

function exactUtmMatch(actual: Partial<ExactUtm>, expected: ExactUtm) {
  return actual.source?.toLowerCase() === expected.source.toLowerCase()
    && actual.medium?.toLowerCase() === expected.medium.toLowerCase()
    && actual.campaign === expected.campaign
    && actual.content === expected.content
    && (expected.term == null || actual.term === expected.term);
}

function isEligibleAnonymousDevice(value: string | null): value is string {
  return Boolean(value && value !== "vercel-device");
}

function demoReturnDeviceCounts(options: {
  sourceId: string;
  startOccurredAt: string;
  endOccurredAt: string;
  utm: ExactUtm;
}) {
  const startTimestamp = Date.parse(options.startOccurredAt);
  const endTimestamp = Date.parse(options.endOccurredAt);
  const rangeEndDate = dateKeyInAppTimeZone(options.endOccurredAt);
  const eligibleCutoff1d = addDaysToDateKey(rangeEndDate, -1);
  const eligibleCutoff7d = addDaysToDateKey(rangeEndDate, -7);
  const sourcePageViews = getDemoStore().webEvents.filter((event) =>
    event.source_id === options.sourceId
    && event.event_name === "page_view"
    && Date.parse(event.occurred_at) <= endTimestamp);
  const exactUtmPageViews = sourcePageViews.filter((event) =>
    eventUtmCandidates(event).some((candidate) => exactUtmMatch(candidate, options.utm)));
  const firstTouchByDevice = new Map<string, { occurredAt: number; date: string }>();
  for (const event of exactUtmPageViews) {
    if (!isEligibleAnonymousDevice(event.anonymous_id)) continue;
    const occurredAt = Date.parse(event.occurred_at);
    const existing = firstTouchByDevice.get(event.anonymous_id!);
    if (!existing || occurredAt < existing.occurredAt) {
      firstTouchByDevice.set(event.anonymous_id!, {
        occurredAt,
        date: dateKeyInAppTimeZone(event.occurred_at),
      });
    }
  }

  const pageViewDatesByDevice = new Map<string, Set<string>>();
  for (const event of sourcePageViews) {
    if (!isEligibleAnonymousDevice(event.anonymous_id)) continue;
    const dates = pageViewDatesByDevice.get(event.anonymous_id!) ?? new Set<string>();
    dates.add(dateKeyInAppTimeZone(event.occurred_at));
    pageViewDatesByDevice.set(event.anonymous_id!, dates);
  }

  let eligibleReturnDevices1d = 0;
  let returningDevices1d = 0;
  let eligibleReturnDevices7d = 0;
  let returningDevices7d = 0;
  for (const [device, firstTouch] of firstTouchByDevice) {
    if (firstTouch.occurredAt < startTimestamp || firstTouch.occurredAt > endTimestamp) continue;
    const pageViewDates = pageViewDatesByDevice.get(device) ?? new Set<string>();
    const returnedWithin = (days: number) => {
      const lastReturnDate = addDaysToDateKey(firstTouch.date, days);
      return [...pageViewDates].some((date) => date > firstTouch.date && date <= lastReturnDate);
    };
    if (firstTouch.date <= eligibleCutoff1d) {
      eligibleReturnDevices1d += 1;
      if (returnedWithin(1)) returningDevices1d += 1;
    }
    if (firstTouch.date <= eligibleCutoff7d) {
      eligibleReturnDevices7d += 1;
      if (returnedWithin(7)) returningDevices7d += 1;
    }
  }
  return {
    eligibleReturnDevices1d,
    returningDevices1d,
    eligibleReturnDevices7d,
    returningDevices7d,
  };
}

export async function countWebPageViewsByUtm(options: {
  sourceId: string;
  startOccurredAt: string;
  endOccurredAt: string;
  utm: ExactUtm;
  dataSpaceId?: string;
}): Promise<WebEventUtmCounts> {
  if (!isRuntimeDatabaseConfigured()) {
    const startTimestamp = Date.parse(options.startOccurredAt);
    const endTimestamp = Date.parse(options.endOccurredAt);
    const matching = getDemoStore().webEvents.filter((event) =>
      event.source_id === options.sourceId
      && event.event_name === "page_view"
      && Date.parse(event.occurred_at) >= startTimestamp
      && Date.parse(event.occurred_at) <= endTimestamp
      && eventUtmCandidates(event).some((candidate) => exactUtmMatch(candidate, options.utm)));
    return {
      pageViews: matching.length,
      visitors: new Set(matching.map((event) => event.anonymous_id).filter(isEligibleAnonymousDevice)).size,
      ...demoReturnDeviceCounts(options),
    };
  }

  const exactEventConditions = [
    "e.source_id = $1",
    "e.event_name = 'page_view'",
    "e.occurred_at <= $3",
  ];
  const values: unknown[] = [
    options.sourceId,
    options.startOccurredAt,
    options.endOccurredAt,
    options.utm.source,
    options.utm.medium,
    options.utm.campaign,
    options.utm.content,
  ];
  let termParameter: number | null = null;
  if (options.utm.term != null) {
    values.push(options.utm.term);
    termParameter = values.length;
  }
  const evidenceGroup = (field: (normalizedKey: string, queryKey: string) => string) => {
    const predicates = [
      `lower(${field("source", "utm_source")}) = lower($4)`,
      `lower(${field("medium", "utm_medium")}) = lower($5)`,
      `${field("campaign", "utm_campaign")} = $6`,
      `${field("content", "utm_content")} = $7`,
    ];
    if (termParameter) predicates.push(`${field("term", "utm_term")} = $${termParameter}`);
    return `(${predicates.join(" and ")})`;
  };
  exactEventConditions.push(`(
    ${[
      evidenceGroup((normalizedKey, queryKey) => `coalesce(nullif(e.attribution_context #>> '{utm,${normalizedKey}}', ''), nullif(e.attribution_context #>> '{utm,${queryKey}}', ''))`),
      evidenceGroup((normalizedKey, queryKey) => `coalesce(nullif(e.properties #>> '{attribution,utm,${normalizedKey}}', ''), nullif(e.properties #>> '{attribution,utm,${queryKey}}', ''))`),
      evidenceGroup((_normalizedKey, queryKey) => `substring(coalesce(e.url, '') from '[?&]${queryKey}=([^&#]+)')`),
      evidenceGroup((_normalizedKey, queryKey) => `substring(coalesce(e.properties #>> '{vercel,query_params}', '') from '"${queryKey}"[[:space:]]*:[[:space:]]*"([^"]+)"')`),
      evidenceGroup((_normalizedKey, queryKey) => `substring(coalesce(e.properties #>> '{vercel,query_params}', '') from '${queryKey}=([^&]+)')`),
    ].join(" or ")}
  )`);
  if (options.dataSpaceId) {
    values.push(options.dataSpaceId);
    exactEventConditions.push(`s.data_space_id = $${values.length}`);
  }
  const rows = await queryRows<{
    page_views: string | number;
    visitors: string | number;
    eligible_return_devices_1d: string | number;
    returning_devices_1d: string | number;
    eligible_return_devices_7d: string | number;
    returning_devices_7d: string | number;
  }>(
    `
      with exact_utm_events as (
        select e.source_id, e.anonymous_id, e.occurred_at
        from web_events e
        ${options.dataSpaceId ? "join sources s on s.id = e.source_id" : ""}
        where ${exactEventConditions.join(" and ")}
      ),
      range_matches as (
        select *
        from exact_utm_events
        where occurred_at >= $2 and occurred_at <= $3
      ),
      first_touch_devices as (
        select anonymous_id, min(occurred_at) as first_touch_at
        from exact_utm_events
        where anonymous_id is not null
          and anonymous_id <> ''
          and anonymous_id <> 'vercel-device'
        group by anonymous_id
      ),
      cohort_devices as (
        select
          anonymous_id,
          first_touch_at,
          (first_touch_at at time zone 'America/Los_Angeles')::date as first_touch_date
        from first_touch_devices
        where first_touch_at >= $2 and first_touch_at <= $3
      ),
      return_page_view_dates as (
        select distinct
          anonymous_id,
          (occurred_at at time zone 'America/Los_Angeles')::date as return_date
        from web_events
        where source_id = $1
          and event_name = 'page_view'
          and occurred_at >= $2
          and occurred_at <= $3
          and anonymous_id is not null
          and anonymous_id <> ''
          and anonymous_id <> 'vercel-device'
      ),
      cohort_flags as (
        select
          cohort_devices.*,
          (($3::timestamptz at time zone 'America/Los_Angeles')::date - first_touch_date) >= 1 as eligible_1d,
          (($3::timestamptz at time zone 'America/Los_Angeles')::date - first_touch_date) >= 7 as eligible_7d,
          exists (
            select 1
            from return_page_view_dates return_event
            where return_event.anonymous_id = cohort_devices.anonymous_id
              and (return_event.return_date - first_touch_date) = 1
          ) as returned_1d,
          exists (
            select 1
            from return_page_view_dates return_event
            where return_event.anonymous_id = cohort_devices.anonymous_id
              and (return_event.return_date - first_touch_date) between 1 and 7
          ) as returned_7d
        from cohort_devices
      )
      select
        (select count(*) from range_matches) as page_views,
        (
          select count(distinct anonymous_id)
          from range_matches
          where anonymous_id is not null
            and anonymous_id <> ''
            and anonymous_id <> 'vercel-device'
        ) as visitors,
        count(*) filter (where eligible_1d) as eligible_return_devices_1d,
        count(*) filter (where eligible_1d and returned_1d) as returning_devices_1d,
        count(*) filter (where eligible_7d) as eligible_return_devices_7d,
        count(*) filter (where eligible_7d and returned_7d) as returning_devices_7d
      from cohort_flags
    `,
    values,
  );
  return {
    pageViews: Number(rows[0]?.page_views ?? 0),
    visitors: Number(rows[0]?.visitors ?? 0),
    eligibleReturnDevices1d: Number(rows[0]?.eligible_return_devices_1d ?? 0),
    returningDevices1d: Number(rows[0]?.returning_devices_1d ?? 0),
    eligibleReturnDevices7d: Number(rows[0]?.eligible_return_devices_7d ?? 0),
    returningDevices7d: Number(rows[0]?.returning_devices_7d ?? 0),
  };
}

export async function hasWebEventIdentity(options: {
  sourceId: string | null;
  occurredDate: string;
  anonymousId?: string;
  sessionId?: string;
}, executor?: DatabaseExecutor) {
  if (!options.anonymousId && !options.sessionId) return false;
  const start = startOfAppDateUtc(options.occurredDate);
  const end = endOfAppDateUtc(options.occurredDate);

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
    executor,
  );
  return Boolean(rows[0]);
}
