import "server-only";

import {
  WEBSITE_FUNNEL_STAGES,
  calculateDeltaPercent,
  calculateRatePercent,
  validateWebsiteFunnelEventProperties,
  type WebsiteFunnelCommerceProperties,
  type WebsiteFunnelEventValidation,
  type WebsiteFunnelItemListProperties,
  type WebsiteFunnelStageKey,
} from "@/aggregation/metric-definitions/website-funnel-definitions";
import type {
  WebsiteAcquisitionRow,
  WebsiteBuilderJourney,
  WebsiteCollectionPerformanceRow,
  WebsiteDeviceRow,
  WebsiteEmailSignupOutcome,
  WebsiteFunnelComparisonMode,
  WebsiteFunnelDevice,
  WebsiteFunnelFilters,
  WebsiteFunnelFilterOptions,
  WebsiteFunnelOverview,
  WebsiteFunnelQuality,
  WebsiteFunnelRangeKey,
  WebsiteFunnelReconciliation,
  WebsiteFunnelSegment,
  WebsiteFunnelSourceState,
  WebsiteFunnelStage,
  WebsiteFunnelTrendPoint,
  WebsiteFunnelTrendValues,
  WebsiteJourneyStage,
  WebsitePaginatedRows,
  WebsiteProductPerformanceRow,
  WebsiteReadyMadeJourney,
} from "@/aggregation/services/website-funnel-types";
import { resolveAuthoritativeWebsiteSource } from "@/collection/tracking/website-sources";
import { isRuntimeDatabaseConfigured } from "@/storage/db/client";
import type { JsonRecord, Source, WebEvent } from "@/storage/db/schema";
import { getDemoStore } from "@/storage/repositories/demo-store";
import {
  getWebsiteFunnelAggregate,
  type WebsiteFunnelAggregateRow,
  type WebsiteFunnelJourneyRow as RepositoryJourneyRow,
  type WebsiteFunnelPeriodKey,
  type WebsiteFunnelStageRow as RepositoryStageRow,
} from "@/storage/repositories/website-funnel-repository";
import {
  APP_TIME_ZONE,
  addDaysToDateKey,
  dateKeyInAppTimeZone,
  endExclusiveOfAppDateUtc,
  getAppDateRange,
  getComparableAppDateRangesUtc,
  getHalfOpenAppDateRangeUtc,
  startOfAppDateUtc,
  type AppDateRange,
  type ComparableAppDateRangesUtc,
  type HalfOpenAppDateRangeUtc,
} from "@/storage/runtime/app-time";

export type WebsiteFunnelDemoState = "populated" | "empty" | "low-volume";

export type WebsiteFunnelOverviewInput = {
  dataSpaceId: string;
  range?: WebsiteFunnelRangeKey;
  comparison?: WebsiteFunnelComparisonMode;
  segment?: WebsiteFunnelSegment;
  device?: WebsiteFunnelDevice;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  landingPath?: string;
  referrerHost?: string;
  productPage?: number;
  collectionPage?: number;
  acquisitionPage?: number;
  pageSize?: number;
  demoState?: WebsiteFunnelDemoState;
  now?: string | number | Date;
};

type PreparedRequest = {
  dataSpaceId: string;
  rangeKey: WebsiteFunnelRangeKey;
  comparisonMode: WebsiteFunnelComparisonMode;
  segment: WebsiteFunnelSegment;
  filters: WebsiteFunnelFilters;
  dateRange: AppDateRange;
  comparableRanges: ComparableAppDateRangesUtc;
  repositoryComparison: HalfOpenAppDateRangeUtc;
  productPage: number;
  collectionPage: number;
  acquisitionPage: number;
  pageSize: number;
  demoState: WebsiteFunnelDemoState;
};

type ClassifiedEvent = {
  event: WebEvent;
  validation: WebsiteFunnelEventValidation;
};

type SessionContext = {
  sessionId: string;
  anonymousId: string | null;
  visitAt: number;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  landingPath: string;
  referrerHost: string;
  device: Exclude<WebsiteFunnelDevice, "all">;
};

type SessionFunnel = {
  context: SessionContext;
  visitEvents: ClassifiedEvent[];
  intentEvents: ClassifiedEvent[];
  cartEvents: ClassifiedEvent[];
  checkoutEvents: ClassifiedEvent[];
  visitAt: number;
  intentAt: number | null;
  cartAt: number | null;
  checkoutAt: number | null;
};

type StageCounts = {
  sessions: number;
  visitors: number;
  events: number;
};

type DemoPeriod = {
  rawEvents: WebEvent[];
  classified: ClassifiedEvent[];
  allContexts: SessionContext[];
  filteredContexts: SessionContext[];
  filteredEvents: ClassifiedEvent[];
  selectedContexts: SessionContext[];
  selectedEvents: ClassifiedEvent[];
  funnels: SessionFunnel[];
  stages: Record<WebsiteFunnelStageKey, StageCounts>;
  acceptedEvents: number;
  unfilteredEvents: number;
  uniqueVisitors: number;
  duplicateDeliveriesRemoved: number;
  quality: WebsiteFunnelQuality;
};

const UNKNOWN = "Unknown";
const DEMO_LOW_VOLUME_SESSION_COUNT = 5;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1_000;
const MAX_REPOSITORY_OFFSET = 10_000;

const STAGE_DESCRIPTIONS: Record<WebsiteFunnelStageKey, string> = {
  visit: "Sessions with a qualifying first-party page_view.",
  product_intent: "A valid view_item or build_start strictly after the visit.",
  add_to_cart: "A valid add_to_cart strictly after product intent.",
  begin_checkout: "A valid begin_checkout strictly after add to cart.",
};

function validDate(value: WebsiteFunnelOverviewInput["now"]) {
  const date = value === undefined ? new Date() : value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Website funnel cutoff must be a valid timestamp.");
  return date;
}

function boundedPage(value: number | undefined, fallback = 1) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE) {
    throw new RangeError(`Website funnel page must be an integer between 1 and ${MAX_PAGE}.`);
  }
  return value;
}

function boundedPageSize(value: number | undefined) {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new RangeError(`Website funnel pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return value;
}

function boundedOffsetPage(value: number | undefined, pageSize: number) {
  const page = boundedPage(value);
  if ((page - 1) * pageSize > MAX_REPOSITORY_OFFSET) {
    throw new RangeError(`Website funnel page offset cannot exceed ${MAX_REPOSITORY_OFFSET}.`);
  }
  return page;
}

function boundedText(value: string | undefined, maximum: number) {
  const normalized = value?.trim() ?? "";
  if (normalized.length > maximum) throw new RangeError(`Website funnel filter exceeds ${maximum} characters.`);
  return normalized;
}

function prepareRequest(input: WebsiteFunnelOverviewInput): PreparedRequest {
  const now = validDate(input.now);
  const rangeKey = input.range ?? "30d";
  const comparisonMode = input.comparison ?? "previous";
  const segment = input.segment ?? "all";
  const device = input.device ?? "all";
  const dateRange = getAppDateRange(rangeKey, now);
  const comparableRanges = getComparableAppDateRangesUtc(dateRange, now);
  const repositoryComparison = comparableRanges.previous
    ?? getHalfOpenAppDateRangeUtc(comparableRanges.previousDateRange);
  const pageSize = boundedPageSize(input.pageSize);

  return {
    dataSpaceId: input.dataSpaceId,
    rangeKey,
    comparisonMode,
    segment,
    filters: {
      segment,
      device,
      utmSource: boundedText(input.utmSource, 256).toLowerCase(),
      utmMedium: boundedText(input.utmMedium, 256).toLowerCase(),
      utmCampaign: boundedText(input.utmCampaign, 256),
      landingPath: boundedText(input.landingPath, 500),
      referrerHost: boundedText(input.referrerHost, 253).toLowerCase(),
    },
    dateRange,
    comparableRanges,
    repositoryComparison,
    productPage: boundedOffsetPage(input.productPage, pageSize),
    collectionPage: boundedOffsetPage(input.collectionPage, pageSize),
    acquisitionPage: boundedOffsetPage(input.acquisitionPage, pageSize),
    pageSize,
    demoState: input.demoState ?? "populated",
  };
}

function countValue(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function eventOrder(left: WebEvent, right: WebEvent) {
  return timestamp(left.occurred_at) - timestamp(right.occurred_at)
    || timestamp(left.received_at) - timestamp(right.received_at)
    || left.id.localeCompare(right.id);
}

function dedupeEvents(events: WebEvent[]) {
  const selected = new Map<string, WebEvent>();
  for (const event of events) {
    const key = `${event.source_id ?? ""}\u0000${event.event_id}`;
    const existing = selected.get(key);
    if (
      !existing
      || timestamp(event.received_at) < timestamp(existing.received_at)
      || (
        timestamp(event.received_at) === timestamp(existing.received_at)
        && event.id.localeCompare(existing.id) < 0
      )
    ) {
      selected.set(key, event);
    }
  }
  return {
    events: [...selected.values()].sort(eventOrder),
    removed: events.length - selected.size,
  };
}

function classifyEvents(events: WebEvent[]): ClassifiedEvent[] {
  return events.map((event) => ({
    event,
    validation: validateWebsiteFunnelEventProperties(event.event_name, event.properties),
  }));
}

function groupBy<Value, Key>(
  values: Iterable<Value>,
  keyFor: (value: Value) => Key,
) {
  const groups = new Map<Key, Value[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}

function validKnown(entry: ClassifiedEvent) {
  return entry.validation.classification === "known" && entry.validation.valid;
}

function recordValue(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedRecord(record: JsonRecord, key: string) {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function normalizedUtm(event: WebEvent, key: "source" | "medium" | "campaign") {
  const utm = nestedRecord(event.attribution_context, "utm");
  const value = utm
    ? recordValue(utm, key) ?? recordValue(utm, `utm_${key}`)
    : null;
  if (!value) return UNKNOWN;
  return key === "campaign" ? value : value.toLowerCase();
}

function normalizedLandingPath(event: WebEvent) {
  const value = recordValue(event.attribution_context, "landing_page");
  return value && /^\/[^?#]*$/u.test(value) ? value : UNKNOWN;
}

function referrerHost(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.hostname.toLowerCase() || null : null;
  } catch {
    return null;
  }
}

function normalizedReferrerHost(event: WebEvent) {
  return referrerHost(recordValue(event.attribution_context, "first_referrer"))
    ?? referrerHost(event.referrer)
    ?? UNKNOWN;
}

function normalizedDevice(event: WebEvent): Exclude<WebsiteFunnelDevice, "all"> {
  const value = recordValue(event.client_context, "device_category")?.toLowerCase();
  return value === "desktop" || value === "mobile" || value === "tablet" || value === "bot"
    ? value
    : "unknown";
}

function consistent(values: string[]) {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : UNKNOWN;
}

function buildSessionContexts(classified: ClassifiedEvent[]) {
  const pageViews = classified.filter(
    (entry) => entry.event.event_name === "page_view" && validKnown(entry),
  );
  const bySession = groupBy(pageViews, (entry) => entry.event.session_id);
  const contexts: SessionContext[] = [];

  for (const [sessionId, entries] of bySession) {
    const visitAt = Math.min(...entries.map((entry) => timestamp(entry.event.occurred_at)));
    const firstVisits = entries.filter((entry) => timestamp(entry.event.occurred_at) === visitAt);
    const anonymousIds = [...new Set(firstVisits.map((entry) => entry.event.anonymous_id).filter(Boolean))];
    contexts.push({
      sessionId,
      anonymousId: anonymousIds.length === 1 ? anonymousIds[0] : null,
      visitAt,
      utmSource: consistent(firstVisits.map((entry) => normalizedUtm(entry.event, "source"))),
      utmMedium: consistent(firstVisits.map((entry) => normalizedUtm(entry.event, "medium"))),
      utmCampaign: consistent(firstVisits.map((entry) => normalizedUtm(entry.event, "campaign"))),
      landingPath: consistent(firstVisits.map((entry) => normalizedLandingPath(entry.event))),
      referrerHost: consistent(firstVisits.map((entry) => normalizedReferrerHost(entry.event))),
      device: consistent(firstVisits.map((entry) => normalizedDevice(entry.event))) as Exclude<WebsiteFunnelDevice, "all">,
    });
  }

  return contexts.sort((left, right) => left.visitAt - right.visitAt || left.sessionId.localeCompare(right.sessionId));
}

function commerceProperties(entry: ClassifiedEvent) {
  if (
    !validKnown(entry)
    || !["view_item", "add_to_cart", "begin_checkout"].includes(entry.event.event_name)
  ) {
    return null;
  }
  return entry.validation.properties as WebsiteFunnelCommerceProperties;
}

function hasReadyMadeItem(entry: ClassifiedEvent) {
  return commerceProperties(entry)?.items.some(
    (item) => item.item_category.trim().toLowerCase() !== "build your own",
  ) ?? false;
}

function intentCandidate(entry: ClassifiedEvent, segment: WebsiteFunnelSegment) {
  if (!validKnown(entry)) return false;
  if (segment === "builder") return entry.event.event_name === "build_start";
  if (segment === "ready-made") return entry.event.event_name === "view_item" && hasReadyMadeItem(entry);
  return entry.event.event_name === "view_item" || entry.event.event_name === "build_start";
}

function commerceCandidate(
  entry: ClassifiedEvent,
  eventName: "add_to_cart" | "begin_checkout",
  segment: WebsiteFunnelSegment,
) {
  if (!validKnown(entry) || entry.event.event_name !== eventName) return false;
  return segment !== "ready-made" || hasReadyMadeItem(entry);
}

function buildSessionFunnel(
  context: SessionContext,
  entries: ClassifiedEvent[],
  segment: WebsiteFunnelSegment,
): SessionFunnel {
  const ordered = entries
    .filter((entry) => entry.event.session_id === context.sessionId)
    .sort((left, right) => eventOrder(left.event, right.event));
  const visitEvents = ordered.filter(
    (entry) => validKnown(entry) && entry.event.event_name === "page_view",
  );
  const intentsAfterVisit = ordered.filter(
    (entry) => intentCandidate(entry, segment) && timestamp(entry.event.occurred_at) > context.visitAt,
  );
  const intentAt = intentsAfterVisit.length > 0
    ? Math.min(...intentsAfterVisit.map((entry) => timestamp(entry.event.occurred_at)))
    : null;
  const intentEvents = intentAt === null
    ? []
    : ordered.filter(
      (entry) => intentCandidate(entry, segment) && timestamp(entry.event.occurred_at) > context.visitAt,
    );
  const cartsAfterIntent = intentAt === null || segment === "builder"
    ? []
    : ordered.filter(
      (entry) => commerceCandidate(entry, "add_to_cart", segment) && timestamp(entry.event.occurred_at) > intentAt,
    );
  const cartAt = cartsAfterIntent.length > 0
    ? Math.min(...cartsAfterIntent.map((entry) => timestamp(entry.event.occurred_at)))
    : null;
  const checkoutsAfterCart = cartAt === null || segment === "builder"
    ? []
    : ordered.filter(
      (entry) => commerceCandidate(entry, "begin_checkout", segment) && timestamp(entry.event.occurred_at) > cartAt,
    );
  const checkoutAt = checkoutsAfterCart.length > 0
    ? Math.min(...checkoutsAfterCart.map((entry) => timestamp(entry.event.occurred_at)))
    : null;

  return {
    context,
    visitEvents,
    intentEvents,
    cartEvents: cartsAfterIntent,
    checkoutEvents: checkoutsAfterCart,
    visitAt: context.visitAt,
    intentAt,
    cartAt,
    checkoutAt,
  };
}

function contextMatchesFilters(context: SessionContext, filters: WebsiteFunnelFilters) {
  if (filters.device !== "all" && context.device !== filters.device) return false;
  if (filters.utmSource && context.utmSource.toLowerCase() !== filters.utmSource) return false;
  if (filters.utmMedium && context.utmMedium.toLowerCase() !== filters.utmMedium) return false;
  if (filters.utmCampaign && context.utmCampaign !== filters.utmCampaign) return false;
  if (filters.landingPath && context.landingPath !== filters.landingPath) return false;
  if (filters.referrerHost && context.referrerHost.toLowerCase() !== filters.referrerHost) return false;
  return true;
}

function hasCohortFilters(request: PreparedRequest) {
  const { filters } = request;
  return request.segment !== "all"
    || filters.device !== "all"
    || Boolean(
      filters.utmSource
      || filters.utmMedium
      || filters.utmCampaign
      || filters.landingPath
      || filters.referrerHost,
    );
}

function hasAcquisitionFilters(request: PreparedRequest) {
  const { filters } = request;
  return filters.device !== "all"
    || Boolean(
      filters.utmSource
      || filters.utmMedium
      || filters.utmCampaign
      || filters.landingPath
      || filters.referrerHost,
    );
}

function stageCounts(funnels: SessionFunnel[], key: WebsiteFunnelStageKey): StageCounts {
  const qualifying = key === "visit"
    ? funnels
    : key === "product_intent"
      ? funnels.filter((funnel) => funnel.intentAt !== null)
      : key === "add_to_cart"
        ? funnels.filter((funnel) => funnel.cartAt !== null)
        : funnels.filter((funnel) => funnel.checkoutAt !== null);
  const events = qualifying.flatMap((funnel) => (
    key === "visit"
      ? funnel.visitEvents
      : key === "product_intent"
        ? funnel.intentEvents
        : key === "add_to_cart"
          ? funnel.cartEvents
          : funnel.checkoutEvents
  ));
  return {
    sessions: qualifying.length,
    visitors: new Set(qualifying.map((funnel) => funnel.context.anonymousId).filter(Boolean)).size,
    events: events.length,
  };
}

function qualityForPeriod(
  classified: ClassifiedEvent[],
  duplicateDeliveriesRemoved: number,
): WebsiteFunnelQuality {
  const valid = classified.filter(validKnown);
  const bySession = groupBy(valid, (entry) => entry.event.session_id);
  const equalIntent = new Set<string>();
  const equalCart = new Set<string>();
  const equalCheckout = new Set<string>();
  const unsequencedIntent = new Set<string>();
  const unsequencedCart = new Set<string>();
  const unsequencedCheckout = new Set<string>();

  for (const [sessionId, entries] of bySession) {
    const pageViews = entries.filter((entry) => entry.event.event_name === "page_view");
    const intents = entries.filter(
      (entry) => entry.event.event_name === "view_item" || entry.event.event_name === "build_start",
    );
    const carts = entries.filter((entry) => entry.event.event_name === "add_to_cart");
    const checkouts = entries.filter((entry) => entry.event.event_name === "begin_checkout");
    const visitAt = pageViews.length > 0
      ? Math.min(...pageViews.map((entry) => timestamp(entry.event.occurred_at)))
      : null;
    if (visitAt !== null && intents.some((entry) => timestamp(entry.event.occurred_at) === visitAt)) {
      equalIntent.add(sessionId);
    }
    const intentAfterVisit = visitAt === null
      ? []
      : intents.filter((entry) => timestamp(entry.event.occurred_at) > visitAt);
    const intentAt = intentAfterVisit.length > 0
      ? Math.min(...intentAfterVisit.map((entry) => timestamp(entry.event.occurred_at)))
      : null;
    if (intents.length > 0 && intentAt === null) unsequencedIntent.add(sessionId);
    if (intentAt !== null && carts.some((entry) => timestamp(entry.event.occurred_at) === intentAt)) {
      equalCart.add(sessionId);
    }
    const cartsAfterIntent = intentAt === null
      ? []
      : carts.filter((entry) => timestamp(entry.event.occurred_at) > intentAt);
    const cartAt = cartsAfterIntent.length > 0
      ? Math.min(...cartsAfterIntent.map((entry) => timestamp(entry.event.occurred_at)))
      : null;
    if (carts.length > 0 && cartAt === null) unsequencedCart.add(sessionId);
    if (cartAt !== null && checkouts.some((entry) => timestamp(entry.event.occurred_at) === cartAt)) {
      equalCheckout.add(sessionId);
    }
    const checkoutsAfterCart = cartAt === null
      ? []
      : checkouts.filter((entry) => timestamp(entry.event.occurred_at) > cartAt);
    if (checkouts.length > 0 && checkoutsAfterCart.length === 0) unsequencedCheckout.add(sessionId);
  }

  const unknownCounts = new Map<string, number>();
  const invalidCounts = new Map<string, number>();
  for (const entry of classified) {
    if (entry.validation.classification === "unknown") {
      unknownCounts.set(entry.event.event_name, (unknownCounts.get(entry.event.event_name) ?? 0) + 1);
    } else if (!entry.validation.valid) {
      invalidCounts.set(entry.event.event_name, (invalidCounts.get(entry.event.event_name) ?? 0) + 1);
    }
  }

  const diagnosticRows = (counts: Map<string, number>) => [...counts]
    .map(([eventName, events]) => ({ eventName, events }))
    .sort((left, right) => right.events - left.events || left.eventName.localeCompare(right.eventName));
  const unknownEvents = diagnosticRows(unknownCounts);

  return {
    duplicateDeliveriesRemoved,
    equalTimeIntentSessions: equalIntent.size,
    equalTimeCartSessions: equalCart.size,
    equalTimeCheckoutSessions: equalCheckout.size,
    unsequencedIntentSessions: unsequencedIntent.size,
    unsequencedCartSessions: unsequencedCart.size,
    unsequencedCheckoutSessions: unsequencedCheckout.size,
    unknownEvents,
    unknownEventTotalRows: unknownEvents.length,
    invalidPropertyEvents: diagnosticRows(invalidCounts),
  };
}

function demoPeriod(
  sourceEvents: WebEvent[],
  bounds: HalfOpenAppDateRangeUtc,
  request: PreparedRequest,
): DemoPeriod {
  const start = Date.parse(bounds.startInclusive);
  const end = Date.parse(bounds.endExclusive);
  let candidates = sourceEvents.filter((event) => {
    const occurredAt = timestamp(event.occurred_at);
    return occurredAt >= start && occurredAt < end;
  });

  if (request.demoState === "empty") candidates = [];
  if (request.demoState === "low-volume") {
    const sessions = [...new Set(candidates.map((event) => event.session_id))]
      .sort()
      .slice(0, DEMO_LOW_VOLUME_SESSION_COUNT);
    const allowed = new Set(sessions);
    candidates = candidates.filter((event) => allowed.has(event.session_id));
  }

  const deduped = dedupeEvents(candidates);
  const classified = classifyEvents(deduped.events);
  const allContexts = buildSessionContexts(classified);
  const acquisitionFilteredContexts = allContexts.filter((context) => contextMatchesFilters(context, request.filters));
  const acquisitionFilteredIds = new Set(acquisitionFilteredContexts.map((context) => context.sessionId));
  const acquisitionFilteredEvents = classified.filter((entry) => acquisitionFilteredIds.has(entry.event.session_id));
  const selectedContexts = acquisitionFilteredContexts;
  const selectedIds = new Set(selectedContexts.map((context) => context.sessionId));
  const selectedEvents = classified.filter((entry) => selectedIds.has(entry.event.session_id));
  const funnels = selectedContexts.map((context) => buildSessionFunnel(context, selectedEvents, request.segment));
  const stages = Object.fromEntries(
    WEBSITE_FUNNEL_STAGES.map((stage) => [stage.key, stageCounts(funnels, stage.key)]),
  ) as Record<WebsiteFunnelStageKey, StageCounts>;
  const filtered = hasAcquisitionFilters(request);

  return {
    rawEvents: deduped.events,
    classified,
    allContexts,
    filteredContexts: acquisitionFilteredContexts,
    filteredEvents: acquisitionFilteredEvents,
    selectedContexts,
    selectedEvents,
    funnels,
    stages,
    acceptedEvents: filtered ? selectedEvents.length : deduped.events.length,
    unfilteredEvents: deduped.events.length,
    uniqueVisitors: stages.visit.visitors,
    duplicateDeliveriesRemoved: deduped.removed,
    quality: qualityForPeriod(
      filtered ? acquisitionFilteredEvents : classified,
      deduped.removed,
    ),
  };
}

function sourceState(source: Pick<Source, "display_name" | "status">): WebsiteFunnelSourceState {
  return {
    state: source.status === "healthy" || source.status === "demo" ? "ready" : "unhealthy",
    candidateCount: 1,
    displayName: source.display_name,
    status: source.status,
  };
}

function sourceStateFromRepository(row: WebsiteFunnelAggregateRow): WebsiteFunnelSourceState {
  const count = countValue(row.candidate_count);
  if (count === 0) {
    return { state: "missing", candidateCount: 0, displayName: null, status: null };
  }
  if (count !== 1) {
    return { state: "ambiguous", candidateCount: count, displayName: null, status: null };
  }
  if (!row.source) {
    return { state: "missing", candidateCount: 0, displayName: null, status: null };
  }
  return {
    state: row.source.status === "healthy" || row.source.status === "demo" ? "ready" : "unhealthy",
    candidateCount: 1,
    displayName: row.source.display_name,
    status: row.source.status,
  };
}

function comparisonAvailability(
  request: PreparedRequest,
  source: WebsiteFunnelSourceState,
  firstOccurredAt: string | null,
) {
  if (request.comparisonMode === "off") return { available: false, reason: "Previous-period comparison is off." };
  if (source.state === "missing" || source.state === "ambiguous") {
    return { available: false, reason: "Comparison requires exactly one authoritative Website source." };
  }
  if (!request.comparableRanges.previous) {
    return {
      available: false,
      reason: "An equal-elapsed Pacific comparison window is unavailable for this cutoff.",
    };
  }
  if (!firstOccurredAt) return { available: false, reason: "Website tracking coverage has not started." };
  if (Date.parse(firstOccurredAt) > Date.parse(request.comparableRanges.previous.startInclusive)) {
    return { available: false, reason: "Website tracking coverage does not span the complete previous period." };
  }
  return { available: true, reason: null };
}

function rangeLabel(range: WebsiteFunnelRangeKey) {
  if (range === "today") return "Today";
  return range === "7d" ? "Last 7 days" : "Last 30 days";
}

function buildStageRows(
  current: Record<WebsiteFunnelStageKey, StageCounts>,
  previous: Record<WebsiteFunnelStageKey, StageCounts>,
  request: PreparedRequest,
  comparisonAvailable: boolean,
): WebsiteFunnelStage[] {
  const start = current.visit.sessions;
  return WEBSITE_FUNNEL_STAGES.map((definition, index) => {
    const measured = request.segment !== "builder" || index < 2;
    const counts = measured ? current[definition.key] : { sessions: 0, visitors: 0, events: 0 };
    const previousCounts = measured ? previous[definition.key] : { sessions: 0, visitors: 0, events: 0 };
    const prior = index === 0 ? null : current[WEBSITE_FUNNEL_STAGES[index - 1].key];
    return {
      key: definition.key,
      label: definition.label,
      description: measured
        ? STAGE_DESCRIPTIONS[definition.key]
        : "Not measured for the builder segment because cart and checkout linkage is not proven.",
      measured,
      sessions: counts.sessions,
      events: counts.events,
      percentOfStart: measured ? calculateRatePercent(counts.sessions, start) : null,
      fromPrevious: !measured
        ? null
        : index === 0
          ? null
          : calculateRatePercent(counts.sessions, prior?.sessions),
      dropOff: !measured || index === 0 || !prior ? null : Math.max(0, prior.sessions - counts.sessions),
      previousSessions: measured && comparisonAvailable ? previousCounts.sessions : null,
      deltaPercent: measured && comparisonAvailable
        ? calculateDeltaPercent(counts.sessions, previousCounts.sessions)
        : null,
    };
  });
}

function enumerateDateKeys(range: AppDateRange) {
  const dates: string[] = [];
  let date = range.startDate;
  while (date <= range.endDate) {
    dates.push(date);
    date = addDaysToDateKey(date, 1);
  }
  return dates;
}

function unavailableTrendValues(): WebsiteFunnelTrendValues {
  return {
    sessions: null,
    product_intent: null,
    add_to_cart: null,
    checkout: null,
    visit_to_checkout_rate: null,
  };
}

function dateHasTrackingCoverage(
  date: string,
  firstOccurredAt: string | null,
  periodEndExclusive: string,
) {
  if (firstOccurredAt === null) return false;
  const effectiveEnd = Math.min(
    Date.parse(endExclusiveOfAppDateUtc(date)),
    Date.parse(periodEndExclusive),
  );
  return effectiveEnd > Date.parse(firstOccurredAt);
}

function trendValues(
  funnels: SessionFunnel[],
  date: string,
  firstOccurredAt: string | null,
  periodEndExclusive: string,
  segment: WebsiteFunnelSegment,
): WebsiteFunnelTrendValues {
  if (!dateHasTrackingCoverage(date, firstOccurredAt, periodEndExclusive)) return unavailableTrendValues();
  const cohort = funnels.filter((funnel) => dateKeyInAppTimeZone(funnel.visitAt) === date);
  const productIntent = cohort.filter((funnel) => funnel.intentAt !== null).length;
  const addToCart = cohort.filter((funnel) => funnel.cartAt !== null).length;
  const checkout = cohort.filter((funnel) => funnel.checkoutAt !== null).length;
  return {
    sessions: cohort.length,
    product_intent: productIntent,
    add_to_cart: segment === "builder" ? null : addToCart,
    checkout: segment === "builder" ? null : checkout,
    visit_to_checkout_rate: segment === "builder"
      ? null
      : calculateRatePercent(checkout, cohort.length),
  };
}

function buildDemoTrend(
  current: DemoPeriod,
  previous: DemoPeriod,
  request: PreparedRequest,
  comparisonAvailable: boolean,
  firstOccurredAt: string | null,
): WebsiteFunnelTrendPoint[] {
  const currentDates = enumerateDateKeys(request.dateRange);
  const previousDates = enumerateDateKeys(request.comparableRanges.previousDateRange);
  return currentDates.map((date, index) => {
    const comparisonDate = previousDates[index] ?? null;
    return {
      date,
      comparisonDate: comparisonAvailable ? comparisonDate : null,
      current: trendValues(
        current.funnels,
        date,
        firstOccurredAt,
        request.comparableRanges.current.endExclusive,
        request.segment,
      ),
      previous: comparisonAvailable && comparisonDate
        ? trendValues(
          previous.funnels,
          comparisonDate,
          firstOccurredAt,
          request.repositoryComparison.endExclusive,
          request.segment,
        )
        : null,
    };
  });
}

function journeyStage(
  label: string,
  sessions: Set<string>,
  events: number,
  denominator: number | null,
): WebsiteJourneyStage {
  return {
    label,
    sessions: sessions.size,
    events,
    fromPrevious: denominator === null ? null : calculateRatePercent(sessions.size, denominator),
  };
}

function readyMadeJourney(period: DemoPeriod): WebsiteReadyMadeJourney {
  const views = new Map<string, { at: number; events: number }>();
  const carts = new Map<string, { at: number; events: number }>();
  const checkouts = new Map<string, { at: number; events: number }>();
  const entries = period.filteredEvents.filter(validKnown);
  const contexts = new Map(period.filteredContexts.map((context) => [context.sessionId, context]));

  for (const context of period.filteredContexts) {
    const session = entries.filter((entry) => entry.event.session_id === context.sessionId);
    const viewEvents = session.filter(
      (entry) => entry.event.event_name === "view_item"
        && hasReadyMadeItem(entry)
        && timestamp(entry.event.occurred_at) > context.visitAt,
    );
    if (viewEvents.length === 0) continue;
    const viewAt = Math.min(...viewEvents.map((entry) => timestamp(entry.event.occurred_at)));
    views.set(context.sessionId, { at: viewAt, events: viewEvents.length });
    const cartEvents = session.filter(
      (entry) => commerceCandidate(entry, "add_to_cart", "ready-made")
        && timestamp(entry.event.occurred_at) > viewAt,
    );
    if (cartEvents.length === 0) continue;
    const cartAt = Math.min(...cartEvents.map((entry) => timestamp(entry.event.occurred_at)));
    carts.set(context.sessionId, { at: cartAt, events: cartEvents.length });
    const checkoutEvents = session.filter(
      (entry) => commerceCandidate(entry, "begin_checkout", "ready-made")
        && timestamp(entry.event.occurred_at) > cartAt,
    );
    if (checkoutEvents.length > 0) {
      checkouts.set(context.sessionId, {
        at: Math.min(...checkoutEvents.map((entry) => timestamp(entry.event.occurred_at))),
        events: checkoutEvents.length,
      });
    }
  }

  const visitSessions = new Set(contexts.keys());
  const visitEvents = entries.filter(
    (entry) => entry.event.event_name === "page_view"
      && visitSessions.has(entry.event.session_id),
  ).length;
  const viewSessions = new Set(views.keys());
  const cartSessions = new Set(carts.keys());
  const checkoutSessions = new Set(checkouts.keys());
  return {
    stages: [
      journeyStage("Website visits", visitSessions, visitEvents, null),
      journeyStage("Product views", viewSessions, [...views.values()].reduce((sum, row) => sum + row.events, 0), visitSessions.size),
      journeyStage("Added to cart", cartSessions, [...carts.values()].reduce((sum, row) => sum + row.events, 0), viewSessions.size),
      journeyStage("Checkout started", checkoutSessions, [...checkouts.values()].reduce((sum, row) => sum + row.events, 0), cartSessions.size),
    ],
  };
}

function builderJourney(period: DemoPeriod): WebsiteBuilderJourney {
  const entries = period.filteredEvents.filter(validKnown);
  const selectedIds = new Set(period.filteredContexts.map((context) => context.sessionId));
  const starts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.event.event_name !== "build_start" || !selectedIds.has(entry.event.session_id)) continue;
    const occurredAt = timestamp(entry.event.occurred_at);
    starts.set(entry.event.session_id, Math.min(starts.get(entry.event.session_id) ?? occurredAt, occurredAt));
  }
  const completionSessions = new Set<string>();
  const saveSessions = new Set<string>();
  let completionEvents = 0;
  let saveEvents = 0;
  for (const entry of entries) {
    const startAt = starts.get(entry.event.session_id);
    if (startAt === undefined || timestamp(entry.event.occurred_at) <= startAt) continue;
    if (entry.event.event_name === "build_complete") {
      completionSessions.add(entry.event.session_id);
      completionEvents += 1;
    }
    if (entry.event.event_name === "save_design") {
      saveSessions.add(entry.event.session_id);
      saveEvents += 1;
    }
  }
  const startSessions = new Set(starts.keys());
  const startEvents = entries.filter((entry) => entry.event.event_name === "build_start").length;
  return {
    starts: journeyStage("Build starts", startSessions, startEvents, null),
    completions: journeyStage("Build completions", completionSessions, completionEvents, startSessions.size),
    saves: journeyStage("Designs saved", saveSessions, saveEvents, startSessions.size),
    completionRate: calculateRatePercent(completionSessions.size, startSessions.size),
    saveRate: calculateRatePercent(saveSessions.size, startSessions.size),
  };
}

function emailSignupOutcome(period: DemoPeriod): WebsiteEmailSignupOutcome {
  const events = period.filteredEvents.filter(
    (entry) => validKnown(entry) && entry.event.event_name === "email_signup",
  );
  return {
    sessions: new Set(events.map((entry) => entry.event.session_id)).size,
    visitors: new Set(events.map((entry) => entry.event.anonymous_id)).size,
    events: events.length,
  };
}

function paginate<Row>(
  rows: Row[],
  page: number,
  pageSize: number,
): WebsitePaginatedRows<Row> {
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page,
    pageSize,
    totalRows: rows.length,
    hasPreviousPage: page > 1,
    hasNextPage: start + pageSize < rows.length,
  };
}

function productRows(period: DemoPeriod): WebsiteProductPerformanceRow[] {
  type ProductState = {
    names: Set<string>;
    categories: Set<string>;
    views: Map<string, number>;
    carts: Map<string, number>;
    matched: Set<string>;
  };
  const products = new Map<string, ProductState>();
  const validCommerce = period.filteredEvents.filter((entry) => commerceProperties(entry) !== null);
  const bySession = groupBy(validCommerce, (entry) => entry.event.session_id);

  function product(itemId: string) {
    const existing = products.get(itemId);
    if (existing) return existing;
    const created: ProductState = {
      names: new Set(),
      categories: new Set(),
      views: new Map(),
      carts: new Map(),
      matched: new Set(),
    };
    products.set(itemId, created);
    return created;
  }

  for (const [sessionId, entries] of bySession) {
    const viewsByItem = new Map<string, number>();
    const cartsByItem = new Map<string, number>();
    for (const entry of entries) {
      const properties = commerceProperties(entry);
      if (!properties || !["view_item", "add_to_cart"].includes(entry.event.event_name)) continue;
      for (const item of properties.items) {
        const state = product(item.item_id);
        state.names.add(item.item_name);
        state.categories.add(item.item_category);
        const occurredAt = timestamp(entry.event.occurred_at);
        if (entry.event.event_name === "view_item") {
          state.views.set(sessionId, Math.min(state.views.get(sessionId) ?? occurredAt, occurredAt));
          viewsByItem.set(item.item_id, Math.min(viewsByItem.get(item.item_id) ?? occurredAt, occurredAt));
        } else {
          state.carts.set(sessionId, Math.min(state.carts.get(sessionId) ?? occurredAt, occurredAt));
          cartsByItem.set(item.item_id, Math.min(cartsByItem.get(item.item_id) ?? occurredAt, occurredAt));
        }
      }
    }
    for (const [itemId, viewAt] of viewsByItem) {
      const cartAt = cartsByItem.get(itemId);
      if (cartAt !== undefined && cartAt > viewAt) product(itemId).matched.add(sessionId);
    }
  }

  const rows: WebsiteProductPerformanceRow[] = [...products].map(([itemId, state]) => {
    const metadataStable = state.names.size === 1 && state.categories.size === 1;
    const identityState = !metadataStable
      ? "unknown" as const
      : state.views.size > 0 && state.carts.size > 0
        ? "stable" as const
        : state.views.size > 0
          ? "view_only" as const
          : "cart_only" as const;
    return {
      key: "",
      itemId,
      itemName: metadataStable ? [...state.names][0] : "",
      itemCategory: metadataStable ? [...state.categories][0] : "",
      productViewSessions: state.views.size,
      addToCartSessions: state.carts.size,
      viewToCartRate: identityState === "stable"
        ? calculateRatePercent(state.matched.size, state.views.size)
        : null,
      identityState,
    };
  });

  const invalidProductEvents = period.filteredEvents.filter(
    (entry) => entry.validation.classification === "known"
      && !entry.validation.valid
      && (entry.event.event_name === "view_item" || entry.event.event_name === "add_to_cart"),
  );
  if (invalidProductEvents.length > 0) {
    rows.push({
      key: "",
      itemId: null,
      itemName: "",
      itemCategory: "",
      productViewSessions: new Set(
        invalidProductEvents.filter((entry) => entry.event.event_name === "view_item").map((entry) => entry.event.session_id),
      ).size,
      addToCartSessions: new Set(
        invalidProductEvents.filter((entry) => entry.event.event_name === "add_to_cart").map((entry) => entry.event.session_id),
      ).size,
      viewToCartRate: null,
      identityState: "unknown",
    });
  }

  return rows
    .sort(
      (left, right) => right.productViewSessions - left.productViewSessions
        || right.addToCartSessions - left.addToCartSessions
        || (left.itemId ?? "").localeCompare(right.itemId ?? ""),
    )
    .map((row, index) => ({ ...row, key: `product-${index + 1}` }));
}

function collectionRows(period: DemoPeriod): WebsiteCollectionPerformanceRow[] {
  type CollectionState = {
    sessions: Set<string>;
    events: number;
    progressed: Set<string>;
  };
  const collections = new Map<string, CollectionState>();
  const entriesBySession = groupBy(period.filteredEvents, (entry) => entry.event.session_id);
  const invalidSessions = new Set<string>();
  let invalidEvents = 0;

  function collection(name: string) {
    const existing = collections.get(name);
    if (existing) return existing;
    const created = { sessions: new Set<string>(), events: 0, progressed: new Set<string>() };
    collections.set(name, created);
    return created;
  }

  for (const [sessionId, entries] of entriesBySession) {
    const views = entries.filter(
      (entry) => validKnown(entry) && entry.event.event_name === "view_item",
    );
    for (const entry of entries) {
      if (entry.event.event_name !== "view_item_list") continue;
      if (!validKnown(entry)) {
        invalidSessions.add(sessionId);
        invalidEvents += 1;
        continue;
      }
      const properties = entry.validation.properties as WebsiteFunnelItemListProperties;
      const state = collection(properties.item_list_name);
      state.sessions.add(sessionId);
      state.events += 1;
      const listedIds = new Set(properties.items.map((item) => item.item_id));
      const listAt = timestamp(entry.event.occurred_at);
      const progressed = views.some((view) => {
        if (timestamp(view.event.occurred_at) <= listAt) return false;
        const viewed = commerceProperties(view);
        return viewed?.items.some((item) => listedIds.has(item.item_id)) ?? false;
      });
      if (progressed) state.progressed.add(sessionId);
    }
  }

  const rows: WebsiteCollectionPerformanceRow[] = [...collections].map(([name, state]) => ({
    key: "",
    collectionName: name,
    collectionViewSessions: state.sessions.size,
    productViewSessions: state.progressed.size,
    progressionRate: calculateRatePercent(state.progressed.size, state.sessions.size),
    state: "mapped" as const,
  }));
  if (invalidEvents > 0) {
    rows.push({
      key: "",
      collectionName: "",
      collectionViewSessions: invalidSessions.size,
      productViewSessions: 0,
      progressionRate: null,
      state: "unknown",
    });
  }
  return rows
    .sort(
      (left, right) => right.collectionViewSessions - left.collectionViewSessions
        || left.collectionName.localeCompare(right.collectionName),
    )
    .map((row, index) => ({ ...row, key: `collection-${index + 1}` }));
}

function acquisitionRows(
  period: DemoPeriod,
  segment: WebsiteFunnelSegment,
): WebsiteAcquisitionRow[] {
  const groups = new Map<string, { context: SessionContext; funnels: SessionFunnel[] }>();
  for (const funnel of period.funnels) {
    const context = funnel.context;
    const key = [
      context.utmSource,
      context.utmMedium,
      context.utmCampaign,
      context.landingPath,
      context.referrerHost,
    ].join("\u0000");
    const group = groups.get(key);
    if (group) group.funnels.push(funnel);
    else groups.set(key, { context, funnels: [funnel] });
  }
  return [...groups.values()]
    .map(({ context, funnels }) => {
      const intent = funnels.filter((funnel) => funnel.intentAt !== null).length;
      const checkout = funnels.filter((funnel) => funnel.checkoutAt !== null).length;
      return {
        key: "",
        utmSource: context.utmSource,
        utmMedium: context.utmMedium,
        utmCampaign: context.utmCampaign,
        landingPath: context.landingPath,
        referrerHost: context.referrerHost,
        sessions: funnels.length,
        productIntentSessions: intent,
        checkoutSessions: segment === "builder" ? null : checkout,
        visitToCheckoutRate: segment === "builder"
          ? null
          : calculateRatePercent(checkout, funnels.length),
      };
    })
    .sort(
      (left, right) => right.sessions - left.sessions
        || left.utmSource.localeCompare(right.utmSource)
        || left.utmMedium.localeCompare(right.utmMedium)
        || left.utmCampaign.localeCompare(right.utmCampaign)
        || left.landingPath.localeCompare(right.landingPath)
        || left.referrerHost.localeCompare(right.referrerHost),
    )
    .map((row, index) => ({ ...row, key: `acquisition-${index + 1}` }));
}

function deviceRows(
  period: DemoPeriod,
  segment: WebsiteFunnelSegment,
): WebsiteDeviceRow[] {
  const devices: Array<Exclude<WebsiteFunnelDevice, "all">> = ["desktop", "mobile", "tablet", "bot", "unknown"];
  return devices.flatMap((device) => {
    const funnels = period.funnels.filter((funnel) => funnel.context.device === device);
    if (funnels.length === 0) return [];
    const intent = funnels.filter((funnel) => funnel.intentAt !== null).length;
    const checkout = funnels.filter((funnel) => funnel.checkoutAt !== null).length;
    return [{
      device,
      sessions: funnels.length,
      productIntentSessions: intent,
      checkoutSessions: segment === "builder" ? null : checkout,
      visitToCheckoutRate: segment === "builder"
        ? null
        : calculateRatePercent(checkout, funnels.length),
    }];
  });
}

function filterOptions(contexts: SessionContext[]): WebsiteFunnelFilterOptions {
  const sorted = (values: string[]) => [...new Set(values)]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 100);
  return {
    devices: sorted(contexts.map((context) => context.device)) as Exclude<WebsiteFunnelDevice, "all">[],
    utmSources: sorted(contexts.map((context) => context.utmSource)),
    utmMediums: sorted(contexts.map((context) => context.utmMedium)),
    utmCampaigns: sorted(contexts.map((context) => context.utmCampaign)),
    landingPaths: sorted(contexts.map((context) => context.landingPath)),
    referrerHosts: sorted(contexts.map((context) => context.referrerHost)),
  };
}

function demoReconciliation(
  period: DemoPeriod,
  sourceId: string,
  request: PreparedRequest,
): WebsiteFunnelReconciliation {
  const completedEndExclusive = request.comparableRanges.isPartialCurrentDay
    ? startOfAppDateUtc(request.dateRange.endDate)
    : request.comparableRanges.current.endExclusive;
  const completedEvents = period.rawEvents.filter(
    (event) => Date.parse(event.occurred_at) < Date.parse(completedEndExclusive),
  );
  const rawPageViews = completedEvents.filter((event) => event.event_name === "page_view").length;
  const rawCustomEvents = completedEvents.length - rawPageViews;
  const rawPageViewDays = new Set(
    completedEvents
      .filter((event) => event.event_name === "page_view")
      .map((event) => dateKeyInAppTimeZone(event.occurred_at)),
  ).size;
  const rawCustomEventDays = new Set(
    completedEvents
      .filter((event) => event.event_name !== "page_view")
      .map((event) => dateKeyInAppTimeZone(event.occurred_at)),
  ).size;
  if (hasCohortFilters(request)) {
    return {
      state: "unavailable",
      rawPageViews,
      dailyPageViews: null,
      rawCustomEvents,
      dailyCustomEvents: null,
      note: "Completed-day daily reconciliation is source-wide and is suppressed for this filtered cohort.",
    };
  }
  if (
    Date.parse(completedEndExclusive)
      <= Date.parse(request.comparableRanges.current.startInclusive)
  ) {
    return {
      state: "unavailable",
      rawPageViews,
      dailyPageViews: null,
      rawCustomEvents,
      dailyCustomEvents: null,
      note: "Daily reconciliation requires at least one completed Pacific day.",
    };
  }
  const metrics = getDemoStore().metricsDaily.filter(
    (metric) => metric.source_id === sourceId
      && metric.date >= request.dateRange.startDate
      && (
        request.comparableRanges.isPartialCurrentDay
          ? metric.date < request.dateRange.endDate
          : metric.date <= request.dateRange.endDate
      )
      && (metric.metric_key === "page_views" || metric.metric_key === "custom_events")
      && metric.dimensions.rollup === "daily",
  );
  const pageViewMetrics = metrics.filter((metric) => metric.metric_key === "page_views");
  const customEventMetrics = metrics.filter((metric) => metric.metric_key === "custom_events");
  const pageViewMetricsDelayed = pageViewMetrics.length < rawPageViewDays;
  const customEventMetricsDelayed = customEventMetrics.length < rawCustomEventDays;
  const dailyPageViews = pageViewMetrics
    .reduce((sum, metric) => sum + metric.metric_value, 0);
  const dailyCustomEvents = customEventMetrics
    .reduce((sum, metric) => sum + metric.metric_value, 0);
  if (pageViewMetricsDelayed || customEventMetricsDelayed) {
    return {
      state: "delayed",
      rawPageViews,
      dailyPageViews: pageViewMetricsDelayed ? null : dailyPageViews,
      rawCustomEvents,
      dailyCustomEvents: customEventMetricsDelayed ? null : dailyCustomEvents,
      note: "Completed-day raw first-party events are available while one or more daily aggregates are not yet present.",
    };
  }
  const matched = rawPageViews === dailyPageViews && rawCustomEvents === dailyCustomEvents;
  return {
    state: matched ? "matched" : "disagrees",
    rawPageViews,
    dailyPageViews,
    rawCustomEvents,
    dailyCustomEvents,
    note: matched
      ? "Completed-day raw first-party events match persisted daily additive metrics."
      : "Completed-day raw first-party events and persisted daily additive metrics differ.",
  };
}

function coverageState(
  firstOccurredAt: string | null,
  currentBounds: HalfOpenAppDateRangeUtc,
  unfilteredEvents: number,
  selectedContexts: number,
  filtered: boolean,
) {
  if (
    firstOccurredAt
    && Date.parse(currentBounds.endExclusive) <= Date.parse(firstOccurredAt)
  ) {
    return "pre_coverage" as const;
  }
  if (unfilteredEvents === 0) return "no_events" as const;
  if (filtered && selectedContexts === 0) return "filtered_empty" as const;
  return "ready" as const;
}

function baseOverview(
  request: PreparedRequest,
  source: WebsiteFunnelSourceState,
  firstOccurredAt: string | null,
  latestReceivedAt: string | null,
  comparisonAvailable: boolean,
  comparisonReason: string | null,
): Pick<WebsiteFunnelOverview, "source" | "range" | "comparison" | "coverage" | "filters"> {
  const startsDuringSelection = firstOccurredAt !== null
    && Date.parse(firstOccurredAt) >= Date.parse(request.comparableRanges.current.startInclusive)
    && Date.parse(firstOccurredAt) < Date.parse(request.comparableRanges.current.endExclusive);
  return {
    source,
    range: {
      key: request.rangeKey,
      label: rangeLabel(request.rangeKey),
      startDate: request.dateRange.startDate,
      endDate: request.dateRange.endDate,
      startAt: request.comparableRanges.current.startInclusive,
      endExclusive: request.comparableRanges.current.endExclusive,
      timeZone: APP_TIME_ZONE,
      partialDay: request.comparableRanges.isPartialCurrentDay,
    },
    comparison: {
      mode: request.comparisonMode,
      available: comparisonAvailable,
      reason: comparisonReason,
      startAt: comparisonAvailable ? request.comparableRanges.previous?.startInclusive ?? null : null,
      endExclusive: comparisonAvailable ? request.comparableRanges.previous?.endExclusive ?? null : null,
    },
    coverage: {
      firstOccurredAt,
      latestReceivedAt,
      startsDuringSelection,
    },
    filters: request.filters,
  };
}

function emptyOverview(
  request: PreparedRequest,
  source: WebsiteFunnelSourceState,
): WebsiteFunnelOverview {
  const comparison = comparisonAvailability(request, source, null);
  const zero = Object.fromEntries(
    WEBSITE_FUNNEL_STAGES.map((stage) => [stage.key, { sessions: 0, visitors: 0, events: 0 }]),
  ) as Record<WebsiteFunnelStageKey, StageCounts>;
  const page = <Row>(pageNumber: number): WebsitePaginatedRows<Row> => ({
    rows: [],
    page: pageNumber,
    pageSize: request.pageSize,
    totalRows: 0,
    hasPreviousPage: pageNumber > 1,
    hasNextPage: false,
  });
  return {
    ...baseOverview(request, source, null, null, false, comparison.reason),
    dataState: "source_unavailable",
    filterOptions: {
      devices: [],
      utmSources: [],
      utmMediums: [],
      utmCampaigns: [],
      landingPaths: [],
      referrerHosts: [],
    },
    acceptedEvents: 0,
    uniqueVisitors: 0,
    unfilteredEvents: 0,
    stages: buildStageRows(zero, zero, request, false),
    trend: [],
    readyMade: {
      stages: [
        journeyStage("Website visits", new Set(), 0, null),
        journeyStage("Product views", new Set(), 0, 0),
        journeyStage("Added to cart", new Set(), 0, 0),
        journeyStage("Checkout started", new Set(), 0, 0),
      ],
    },
    builder: {
      starts: journeyStage("Build starts", new Set(), 0, null),
      completions: journeyStage("Build completions", new Set(), 0, 0),
      saves: journeyStage("Designs saved", new Set(), 0, 0),
      completionRate: null,
      saveRate: null,
    },
    emailSignup: { sessions: 0, visitors: 0, events: 0 },
    collections: page<WebsiteCollectionPerformanceRow>(request.collectionPage),
    products: page<WebsiteProductPerformanceRow>(request.productPage),
    acquisition: page<WebsiteAcquisitionRow>(request.acquisitionPage),
    devices: [],
    quality: {
      duplicateDeliveriesRemoved: 0,
      equalTimeIntentSessions: 0,
      equalTimeCartSessions: 0,
      equalTimeCheckoutSessions: 0,
      unsequencedIntentSessions: 0,
      unsequencedCartSessions: 0,
      unsequencedCheckoutSessions: 0,
      unknownEvents: [],
      unknownEventTotalRows: 0,
      invalidPropertyEvents: [],
    },
    reconciliation: {
      state: "unavailable",
      rawPageViews: 0,
      dailyPageViews: null,
      rawCustomEvents: 0,
      dailyCustomEvents: null,
      note: "Reconciliation requires exactly one authoritative Website source.",
    },
    lowVolume: false,
  };
}

async function demoOverview(request: PreparedRequest): Promise<WebsiteFunnelOverview> {
  const store = getDemoStore();
  const resolution = resolveAuthoritativeWebsiteSource(
    store.sources.filter((source) => source.data_space_id === request.dataSpaceId),
  );
  if (resolution.status === "missing") {
    return emptyOverview(request, { state: "missing", candidateCount: 0, displayName: null, status: null });
  }
  if (resolution.status === "ambiguous") {
    return emptyOverview(request, {
      state: "ambiguous",
      candidateCount: resolution.candidates.length,
      displayName: null,
      status: null,
    });
  }

  const source = resolution.source;
  const sourceEvents = store.webEvents.filter(
    (event) => event.source_id === source.id && event.event_source === "first_party_tracker",
  );
  const coverageEvents = dedupeEvents(sourceEvents).events;
  const firstOccurredAt = coverageEvents.length > 0
    ? coverageEvents.reduce((earliest, event) => (
      timestamp(event.occurred_at) < timestamp(earliest) ? event.occurred_at : earliest
    ), coverageEvents[0].occurred_at)
    : null;
  const latestReceivedAt = coverageEvents.length > 0
    ? coverageEvents.reduce((latest, event) => (
      timestamp(event.received_at) > timestamp(latest) ? event.received_at : latest
    ), coverageEvents[0].received_at)
    : null;
  const current = demoPeriod(sourceEvents, request.comparableRanges.current, request);
  const previous = demoPeriod(sourceEvents, request.repositoryComparison, request);
  const sourceSummary = sourceState(source);
  const comparison = comparisonAvailability(request, sourceSummary, firstOccurredAt);
  const stages = buildStageRows(current.stages, previous.stages, request, comparison.available);
  const products = productRows(current);
  const collections = collectionRows(current);
  const acquisition = acquisitionRows(current, request.segment);

  return {
    ...baseOverview(
      request,
      sourceSummary,
      firstOccurredAt,
      latestReceivedAt,
      comparison.available,
      comparison.reason,
    ),
    dataState: coverageState(
      firstOccurredAt,
      request.comparableRanges.current,
      current.unfilteredEvents,
      current.selectedContexts.length,
      hasCohortFilters(request),
    ),
    filterOptions: filterOptions(current.allContexts),
    acceptedEvents: current.acceptedEvents,
    uniqueVisitors: current.uniqueVisitors,
    unfilteredEvents: current.unfilteredEvents,
    stages,
    trend: buildDemoTrend(current, previous, request, comparison.available, firstOccurredAt),
    readyMade: readyMadeJourney(current),
    builder: builderJourney(current),
    emailSignup: emailSignupOutcome(current),
    collections: paginate(collections, request.collectionPage, request.pageSize),
    products: paginate(products, request.productPage, request.pageSize),
    acquisition: paginate(acquisition, request.acquisitionPage, request.pageSize),
    devices: deviceRows(current, request.segment),
    quality: current.quality,
    reconciliation: demoReconciliation(current, source.id, request),
    lowVolume: stages[0].sessions > 0 && stages[0].sessions < 20,
  };
}

function repositoryStage(
  rows: RepositoryStageRow[],
  period: WebsiteFunnelPeriodKey,
  key: WebsiteFunnelStageKey,
): StageCounts {
  const row = rows.find((candidate) => candidate.period_key === period && candidate.stage_key === key);
  return {
    sessions: countValue(row?.sessions),
    visitors: countValue(row?.visitors),
    events: countValue(row?.events),
  };
}

function repositoryJourney(
  rows: RepositoryJourneyRow[],
  period: WebsiteFunnelPeriodKey,
  journey: "ready_made" | "builder",
) {
  return rows.find((row) => row.period_key === period && row.journey_key === journey);
}

function repositoryStageCounts(
  row: WebsiteFunnelAggregateRow,
  period: WebsiteFunnelPeriodKey,
) {
  return Object.fromEntries(
    WEBSITE_FUNNEL_STAGES.map((stage) => [stage.key, repositoryStage(row.stages, period, stage.key)]),
  ) as Record<WebsiteFunnelStageKey, StageCounts>;
}

function repositoryTrend(
  row: WebsiteFunnelAggregateRow,
  request: PreparedRequest,
  comparisonAvailable: boolean,
  firstOccurredAt: string | null,
): WebsiteFunnelTrendPoint[] {
  const currentRows = row.daily_trend.filter((candidate) => candidate.period_key === "current");
  const previousRows = row.daily_trend.filter((candidate) => candidate.period_key === "comparison");
  const previousDates = enumerateDateKeys(request.comparableRanges.previousDateRange);
  return enumerateDateKeys(request.dateRange).map((date, index) => {
    const current = currentRows.find((candidate) => candidate.date_pt === date);
    const comparisonDate = previousDates[index] ?? null;
    const previous = comparisonDate
      ? previousRows.find((candidate) => candidate.date_pt === comparisonDate)
      : null;
    const values = (
      candidate: typeof current | null,
      candidateDate: string,
      periodEndExclusive: string,
    ): WebsiteFunnelTrendValues => {
      if (!dateHasTrackingCoverage(candidateDate, firstOccurredAt, periodEndExclusive)) {
        return unavailableTrendValues();
      }
      const sessions = countValue(candidate?.sessions);
      const checkout = countValue(candidate?.checkout_sessions);
      return {
        sessions,
        product_intent: countValue(candidate?.product_intent_sessions),
        add_to_cart: request.segment === "builder"
          ? null
          : countValue(candidate?.add_to_cart_sessions),
        checkout: request.segment === "builder" ? null : checkout,
        visit_to_checkout_rate: request.segment === "builder"
          ? null
          : calculateRatePercent(checkout, sessions),
      };
    };
    return {
      date,
      comparisonDate: comparisonAvailable ? comparisonDate : null,
      current: values(current, date, request.comparableRanges.current.endExclusive),
      previous: comparisonAvailable && comparisonDate
        ? values(previous, comparisonDate, request.repositoryComparison.endExclusive)
        : null,
    };
  });
}

function repositoryReadyMade(row: WebsiteFunnelAggregateRow): WebsiteReadyMadeJourney {
  const journey = repositoryJourney(row.journeys, "current", "ready_made");
  const visits = countValue(journey?.visit_sessions);
  const views = countValue(journey?.product_view_sessions);
  const carts = countValue(journey?.add_to_cart_sessions);
  const checkouts = countValue(journey?.begin_checkout_sessions);
  const stage = (
    label: string,
    sessions: number,
    events: number,
    denominator: number | null,
  ): WebsiteJourneyStage => ({
    label,
    sessions,
    events,
    fromPrevious: denominator === null ? null : calculateRatePercent(sessions, denominator),
  });
  return {
    stages: [
      stage("Website visits", visits, countValue(journey?.visit_events), null),
      stage("Product views", views, countValue(journey?.product_view_events), visits),
      stage("Added to cart", carts, countValue(journey?.add_to_cart_events), views),
      stage("Checkout started", checkouts, countValue(journey?.begin_checkout_events), carts),
    ],
  };
}

function repositoryBuilder(row: WebsiteFunnelAggregateRow): WebsiteBuilderJourney {
  const journey = repositoryJourney(row.journeys, "current", "builder");
  const starts = countValue(journey?.build_start_sessions);
  const completions = countValue(journey?.build_complete_sessions);
  const saves = countValue(journey?.save_design_sessions);
  const stage = (
    label: string,
    sessions: number,
    events: number,
    denominator: number | null,
  ): WebsiteJourneyStage => ({
    label,
    sessions,
    events,
    fromPrevious: denominator === null ? null : calculateRatePercent(sessions, denominator),
  });
  return {
    starts: stage("Build starts", starts, countValue(journey?.build_start_events), null),
    completions: stage("Build completions", completions, countValue(journey?.build_complete_events), starts),
    saves: stage("Designs saved", saves, countValue(journey?.save_design_events), starts),
    completionRate: calculateRatePercent(completions, starts),
    saveRate: calculateRatePercent(saves, starts),
  };
}

function repositoryProducts(
  row: WebsiteFunnelAggregateRow,
  request: PreparedRequest,
): WebsitePaginatedRows<WebsiteProductPerformanceRow> {
  const current = row.products.filter((candidate) => candidate.period_key === "current");
  const totalRows = countValue(row.group_totals.products);
  const rows = current.map((candidate, index) => {
    const itemId = candidate.item_id === "Unknown / unmapped" ? null : candidate.item_id;
    const views = countValue(candidate.product_view_sessions);
    const carts = countValue(candidate.add_to_cart_sessions);
    const metadataKnown = itemId !== null
      && candidate.item_name !== "Unknown / unmapped"
      && candidate.item_category !== "Unknown / unmapped"
      && Boolean(candidate.item_name.trim())
      && Boolean(candidate.item_category.trim());
    const stable = candidate.stable_identity && metadataKnown && views > 0 && carts > 0;
    return {
      key: `product-${(request.productPage - 1) * request.pageSize + index + 1}`,
      itemId,
      itemName: metadataKnown ? candidate.item_name : "",
      itemCategory: metadataKnown ? candidate.item_category : "",
      productViewSessions: views,
      addToCartSessions: carts,
      viewToCartRate: stable
        ? calculateRatePercent(countValue(candidate.matched_view_to_cart_sessions), views)
        : null,
      identityState: !metadataKnown
        ? "unknown" as const
        : stable
          ? "stable" as const
          : views > 0
            ? "view_only" as const
            : "cart_only" as const,
    };
  });
  return {
    rows,
    page: request.productPage,
    pageSize: request.pageSize,
    totalRows,
    hasPreviousPage: request.productPage > 1,
    hasNextPage: request.productPage * request.pageSize < totalRows,
  };
}

function repositoryCollections(
  row: WebsiteFunnelAggregateRow,
  request: PreparedRequest,
): WebsitePaginatedRows<WebsiteCollectionPerformanceRow> {
  const current = row.collections.filter((candidate) => candidate.period_key === "current");
  const totalRows = countValue(row.group_totals.collections);
  return {
    rows: current.map((candidate, index) => {
      const unknown = candidate.item_list_name === "Unknown / unmapped";
      const sessions = countValue(candidate.collection_view_sessions);
      const progressed = countValue(candidate.progressed_to_product_sessions);
      return {
        key: `collection-${(request.collectionPage - 1) * request.pageSize + index + 1}`,
        collectionName: unknown ? "" : candidate.item_list_name,
        collectionViewSessions: sessions,
        productViewSessions: progressed,
        progressionRate: unknown ? null : calculateRatePercent(progressed, sessions),
        state: unknown ? "unknown" as const : "mapped" as const,
      };
    }),
    page: request.collectionPage,
    pageSize: request.pageSize,
    totalRows,
    hasPreviousPage: request.collectionPage > 1,
    hasNextPage: request.collectionPage * request.pageSize < totalRows,
  };
}

function repositoryAcquisition(
  row: WebsiteFunnelAggregateRow,
  request: PreparedRequest,
): WebsitePaginatedRows<WebsiteAcquisitionRow> {
  const current = row.acquisition.filter((candidate) => candidate.period_key === "current");
  const totalRows = countValue(row.group_totals.acquisition);
  return {
    rows: current.map((candidate, index) => {
      const sessions = countValue(candidate.sessions);
      const productIntentSessions = countValue(candidate.product_intent_sessions);
      const checkoutSessions = countValue(candidate.checkout_sessions);
      return {
        key: `acquisition-${(request.acquisitionPage - 1) * request.pageSize + index + 1}`,
        utmSource: candidate.utm_source,
        utmMedium: candidate.utm_medium,
        utmCampaign: candidate.utm_campaign,
        landingPath: candidate.landing_page,
        referrerHost: candidate.referrer_host,
        sessions,
        productIntentSessions,
        checkoutSessions: request.segment === "builder" ? null : checkoutSessions,
        visitToCheckoutRate: request.segment === "builder"
          ? null
          : calculateRatePercent(checkoutSessions, sessions),
      };
    }),
    page: request.acquisitionPage,
    pageSize: request.pageSize,
    totalRows,
    hasPreviousPage: request.acquisitionPage > 1,
    hasNextPage: request.acquisitionPage * request.pageSize < totalRows,
  };
}

function repositoryDevices(
  row: WebsiteFunnelAggregateRow,
  request: PreparedRequest,
): WebsiteDeviceRow[] {
  return row.devices
    .filter((candidate) => candidate.period_key === "current")
    .map((candidate) => {
    const device = ["desktop", "mobile", "tablet", "bot"].includes(candidate.device_category)
      ? candidate.device_category as "desktop" | "mobile" | "tablet" | "bot"
      : "unknown";
    const sessions = countValue(candidate.sessions);
    const productIntentSessions = countValue(candidate.product_intent_sessions);
    const checkoutSessions = countValue(candidate.checkout_sessions);
    return {
      device,
      sessions,
      productIntentSessions,
      checkoutSessions: request.segment === "builder" ? null : checkoutSessions,
      visitToCheckoutRate: request.segment === "builder"
        ? null
        : calculateRatePercent(checkoutSessions, sessions),
    };
  });
}

function repositoryFilterOptions(row: WebsiteFunnelAggregateRow): WebsiteFunnelFilterOptions {
  const unique = (values: string[]) => [...new Set(values)].sort((left, right) => left.localeCompare(right));
  return {
    devices: unique(row.filter_options.devices.map((device) => (
      ["desktop", "mobile", "tablet", "bot"].includes(device) ? device : "unknown"
    ))) as Exclude<WebsiteFunnelDevice, "all">[],
    utmSources: unique(row.filter_options.utm_sources),
    utmMediums: unique(row.filter_options.utm_mediums),
    utmCampaigns: unique(row.filter_options.utm_campaigns),
    landingPaths: unique(row.filter_options.landing_pages),
    referrerHosts: unique(row.filter_options.referrer_hosts),
  };
}

function repositoryQuality(row: WebsiteFunnelAggregateRow): WebsiteFunnelQuality {
  const quality = row.quality.find((candidate) => candidate.period_key === "current");
  return {
    duplicateDeliveriesRemoved: countValue(quality?.duplicate_deliveries_removed),
    equalTimeIntentSessions: countValue(quality?.equal_time_intent_sessions),
    equalTimeCartSessions: countValue(quality?.equal_time_cart_sessions),
    equalTimeCheckoutSessions: countValue(quality?.equal_time_checkout_sessions),
    unsequencedIntentSessions: countValue(quality?.unsequenced_intent_sessions),
    unsequencedCartSessions: countValue(quality?.unsequenced_cart_sessions),
    unsequencedCheckoutSessions: countValue(quality?.unsequenced_checkout_sessions),
    unknownEvents: row.unknown_events
      .filter((candidate) => candidate.period_key === "current")
      .map((candidate) => ({ eventName: candidate.event_name, events: countValue(candidate.events) })),
    unknownEventTotalRows: countValue(
      row.unknown_events.find((candidate) => candidate.period_key === "current")?.total_rows,
    ),
    invalidPropertyEvents: row.invalid_properties
      .filter((candidate) => candidate.period_key === "current")
      .map((candidate) => ({ eventName: candidate.event_name, events: countValue(candidate.events) })),
  };
}

function repositoryReconciliation(
  row: WebsiteFunnelAggregateRow,
  request: PreparedRequest,
): WebsiteFunnelReconciliation {
  const reconciliation = row.reconciliation.find((candidate) => candidate.period_key === "current");
  const rawPageViews = countValue(reconciliation?.raw_page_views);
  const rawCustomEvents = countValue(reconciliation?.raw_custom_events);
  if (hasCohortFilters(request)) {
    return {
      state: "unavailable",
      rawPageViews,
      dailyPageViews: null,
      rawCustomEvents,
      dailyCustomEvents: null,
      note: "Completed-day daily reconciliation is source-wide and is suppressed for this filtered cohort.",
    };
  }
  if (!reconciliation?.comparable) {
    return {
      state: "unavailable",
      rawPageViews,
      dailyPageViews: null,
      rawCustomEvents,
      dailyCustomEvents: null,
      note: "Daily reconciliation requires at least one completed Pacific day.",
    };
  }
  const pageViewMetricsDelayed = rawPageViews > 0
    && countValue(reconciliation.page_view_metric_rows)
      < countValue(reconciliation.raw_page_view_days);
  const customEventMetricsDelayed = rawCustomEvents > 0
    && countValue(reconciliation.custom_event_metric_rows)
      < countValue(reconciliation.raw_custom_event_days);
  if (pageViewMetricsDelayed || customEventMetricsDelayed) {
    return {
      state: "delayed",
      rawPageViews,
      dailyPageViews: pageViewMetricsDelayed
        ? null
        : countValue(reconciliation.metric_page_views),
      rawCustomEvents,
      dailyCustomEvents: customEventMetricsDelayed
        ? null
        : countValue(reconciliation.metric_custom_events),
      note: "Completed-day raw first-party events are available while one or more daily aggregates are not yet present.",
    };
  }
  const dailyPageViews = countValue(reconciliation.metric_page_views);
  const dailyCustomEvents = countValue(reconciliation.metric_custom_events);
  const matched = countValue(reconciliation.page_view_difference) === 0
    && countValue(reconciliation.custom_event_difference) === 0;
  return {
    state: matched ? "matched" : "disagrees",
    rawPageViews,
    dailyPageViews,
    rawCustomEvents,
    dailyCustomEvents,
    note: matched
      ? "Completed-day raw first-party events match persisted daily additive metrics."
      : "Completed-day raw first-party events and persisted daily additive metrics differ.",
  };
}

async function configuredOverview(request: PreparedRequest): Promise<WebsiteFunnelOverview> {
  const row = await getWebsiteFunnelAggregate({
    dataSpaceId: request.dataSpaceId,
    segment: request.segment,
    current: {
      startAt: request.comparableRanges.current.startInclusive,
      endExclusive: request.comparableRanges.current.endExclusive,
    },
    comparison: {
      startAt: request.repositoryComparison.startInclusive,
      endExclusive: request.repositoryComparison.endExclusive,
    },
    filters: {
      utmSource: request.filters.utmSource || null,
      utmMedium: request.filters.utmMedium || null,
      utmCampaign: request.filters.utmCampaign || null,
      landingPage: request.filters.landingPath || null,
      referrerHost: request.filters.referrerHost || null,
      deviceCategory: request.filters.device === "all" ? null : request.filters.device,
    },
    pagination: {
      groupLimit: request.pageSize,
      productOffset: (request.productPage - 1) * request.pageSize,
      collectionOffset: (request.collectionPage - 1) * request.pageSize,
      acquisitionOffset: (request.acquisitionPage - 1) * request.pageSize,
    },
  });
  const source = sourceStateFromRepository(row);
  if (source.state === "missing" || source.state === "ambiguous") return emptyOverview(request, source);

  const firstOccurredAt = row.coverage.first_occurred_at;
  const latestReceivedAt = row.coverage.latest_received_at;
  const comparison = comparisonAvailability(request, source, firstOccurredAt);
  const currentStages = repositoryStageCounts(row, "current");
  const previousStages = repositoryStageCounts(row, "comparison");
  const stages = buildStageRows(currentStages, previousStages, request, comparison.available);
  const reconciliation = repositoryReconciliation(row, request);
  const eventCounts = row.event_counts.find((candidate) => candidate.period_key === "current");
  const acceptedEvents = countValue(eventCounts?.accepted_events);
  const unfilteredEvents = countValue(eventCounts?.unfiltered_events);
  const engagement = row.engagement.find((candidate) => candidate.period_key === "current");

  return {
    ...baseOverview(
      request,
      source,
      firstOccurredAt,
      latestReceivedAt,
      comparison.available,
      comparison.reason,
    ),
    dataState: coverageState(
      firstOccurredAt,
      request.comparableRanges.current,
      unfilteredEvents,
      stages[0].sessions,
      hasCohortFilters(request),
    ),
    filterOptions: repositoryFilterOptions(row),
    acceptedEvents,
    uniqueVisitors: repositoryStage(row.stages, "current", "visit").visitors,
    unfilteredEvents,
    stages,
    trend: repositoryTrend(row, request, comparison.available, firstOccurredAt),
    readyMade: repositoryReadyMade(row),
    builder: repositoryBuilder(row),
    emailSignup: {
      sessions: countValue(engagement?.sessions),
      visitors: countValue(engagement?.visitors),
      events: countValue(engagement?.events),
    },
    collections: repositoryCollections(row, request),
    products: repositoryProducts(row, request),
    acquisition: repositoryAcquisition(row, request),
    devices: repositoryDevices(row, request),
    quality: repositoryQuality(row),
    reconciliation,
    lowVolume: stages[0].sessions > 0 && stages[0].sessions < 20,
  };
}

export async function getWebsiteFunnelOverview(
  input: WebsiteFunnelOverviewInput,
): Promise<WebsiteFunnelOverview> {
  const request = prepareRequest(input);
  return isRuntimeDatabaseConfigured()
    ? configuredOverview(request)
    : demoOverview(request);
}
