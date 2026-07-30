import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWebsiteFunnelOverview,
  type WebsiteFunnelOverviewInput,
} from "@/aggregation/services/website-funnel-service";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import * as databaseClient from "@/storage/db/client";
import type { JsonRecord, Source, WebEvent } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import * as funnelRepository from "@/storage/repositories/website-funnel-repository";
import type { WebsiteFunnelAggregateRow } from "@/storage/repositories/website-funnel-repository";
import { DEMO_SOURCE_IDS } from "@/storage/seed/demo-data";

const NOW = "2026-04-22T16:00:00.000Z";
const ITEM = {
  item_id: "SKU-A",
  item_name: "Moon bracelet",
  item_category: "Ready-made",
  price: 88,
  quantity: 1,
};

let sequence = 0;

function at(hour: number, minute = 0, day = 22) {
  return `2026-04-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

function validProperties(eventName: string): JsonRecord {
  if (eventName === "view_item_list") {
    return {
      item_list_name: "Core Collection",
      items: [{ ...ITEM, item_list_name: "Core Collection" }],
    };
  }
  if (["view_item", "add_to_cart", "begin_checkout"].includes(eventName)) {
    return { currency: "USD", value: 88, items: [ITEM] };
  }
  if (eventName === "build_start") return { item_category: "Build Your Own" };
  if (eventName === "build_complete" || eventName === "save_design") {
    return {
      currency: "USD",
      item_category: "Build Your Own",
      stone_count: 7,
      value: 140,
    };
  }
  if (eventName === "email_signup") return { discount_code: "WELCOME10", method: "footer_form" };
  return {};
}

function webEvent(input: {
  sessionId: string;
  eventName: string;
  occurredAt: string;
  eventId?: string;
  id?: string;
  anonymousId?: string;
  sourceId?: string;
  eventSource?: WebEvent["event_source"];
  properties?: JsonRecord;
  attribution?: JsonRecord;
  clientContext?: JsonRecord;
  referrer?: string | null;
  receivedAt?: string;
  userId?: string | null;
  url?: string;
}): WebEvent {
  sequence += 1;
  const id = input.id ?? `row-${String(sequence).padStart(6, "0")}`;
  return {
    id,
    event_id: input.eventId ?? `event-${String(sequence).padStart(6, "0")}`,
    schema_version: "1.0",
    event_source: input.eventSource ?? "first_party_tracker",
    source_id: input.sourceId ?? DEMO_SOURCE_IDS.website,
    public_tracking_key: "must-never-leave-the-service",
    anonymous_id: input.anonymousId ?? `anonymous-${input.sessionId}`,
    session_id: input.sessionId,
    user_id: input.userId ?? null,
    event_name: input.eventName,
    path: "/storefront",
    url: input.url ?? "https://www.moonarqstudio.com/storefront?private=query",
    referrer: input.referrer ?? null,
    user_agent: "private-user-agent",
    ip_hash: "private-ip-hash",
    country: null,
    device_type: null,
    properties: input.properties ?? validProperties(input.eventName),
    attribution_context: input.attribution ?? {},
    consent_status: { analytics: "granted", marketing: "unknown" },
    client_context: input.clientContext ?? { device_category: "desktop" },
    occurred_at: input.occurredAt,
    received_at: input.receivedAt ?? new Date(Date.parse(input.occurredAt) + 1_000).toISOString(),
    created_at: input.receivedAt ?? new Date(Date.parse(input.occurredAt) + 1_000).toISOString(),
  };
}

function websiteSource() {
  return getDemoStore().sources.find((source) => source.id === DEMO_SOURCE_IDS.website)!;
}

function addSession(
  sessionId: string,
  events: Array<[eventName: string, occurredAt: string, properties?: JsonRecord]>,
  context: {
    attribution?: JsonRecord;
    clientContext?: JsonRecord;
    anonymousId?: string;
  } = {},
) {
  getDemoStore().webEvents.push(...events.map(([eventName, occurredAt, properties]) => webEvent({
    sessionId,
    eventName,
    occurredAt,
    properties,
    attribution: eventName === "page_view" ? context.attribution : undefined,
    clientContext: context.clientContext,
    anonymousId: context.anonymousId,
  })));
}

function input(overrides: Partial<WebsiteFunnelOverviewInput> = {}): WebsiteFunnelOverviewInput {
  return {
    dataSpaceId: DATA_SPACE_IDS.moonarq,
    range: "today",
    comparison: "previous",
    now: NOW,
    ...overrides,
  };
}

function emptyAggregateRow(
  overrides: Partial<WebsiteFunnelAggregateRow> = {},
): WebsiteFunnelAggregateRow {
  return {
    candidate_count: 1,
    source: { display_name: "MoonArq Website", status: "healthy" },
    coverage: {
      first_occurred_at: "2026-04-20T15:00:00.000Z",
      latest_received_at: "2026-04-21T15:00:01.000Z",
    },
    stages: [],
    daily_trend: [],
    quality: [],
    journeys: [],
    engagement: [],
    products: [],
    collections: [],
    acquisition: [],
    devices: [],
    filter_options: {
      devices: [],
      utm_sources: [],
      utm_mediums: [],
      utm_campaigns: [],
      landing_pages: [],
      referrer_hosts: [],
    },
    group_totals: { products: 0, collections: 0, acquisition: 0 },
    event_counts: [],
    unknown_events: [],
    invalid_properties: [],
    reconciliation: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DEMO_NOW", NOW);
  sequence = 0;
  const store = resetDemoStore();
  store.webEvents = [];
  store.metricsDaily = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("website funnel overview service", () => {
  it("aggregates more than 2,000 first-party events without a row cap", async () => {
    getDemoStore().webEvents = Array.from({ length: 2_105 }, (_, index) => webEvent({
      sessionId: `large-${index}`,
      eventName: "page_view",
      occurredAt: at(8, index % 60),
      anonymousId: `visitor-${index}`,
    }));

    const overview = await getWebsiteFunnelOverview(input());

    expect(overview.unfilteredEvents).toBe(2_105);
    expect(overview.acceptedEvents).toBe(2_105);
    expect(overview.uniqueVisitors).toBe(2_105);
    expect(overview.stages.find((stage) => stage.key === "visit")).toMatchObject({
      sessions: 2_105,
      events: 2_105,
    });
    expect(overview.lowVolume).toBe(false);
  });

  it("fails closed for ambiguous sources and isolates sources by data space", async () => {
    const primary = websiteSource();
    const duplicate: Source = {
      ...primary,
      id: "99999999-9999-4999-8999-999999999999",
      display_name: "Second Website source",
    };
    getDemoStore().sources.push(duplicate);
    getDemoStore().webEvents.push(webEvent({
      sessionId: "ambiguous",
      eventName: "page_view",
      occurredAt: at(8),
    }));

    const ambiguous = await getWebsiteFunnelOverview(input());
    expect(ambiguous.source).toEqual({
      state: "ambiguous",
      candidateCount: 2,
      displayName: null,
      status: null,
    });
    expect(ambiguous.dataState).toBe("source_unavailable");
    expect(ambiguous.acceptedEvents).toBe(0);

    const missing = await getWebsiteFunnelOverview(input({ dataSpaceId: DATA_SPACE_IDS.autoLab }));
    expect(missing.source.state).toBe("missing");
    expect(missing.dataState).toBe("source_unavailable");
  });

  it("preserves configured source ambiguity when SQL intentionally withholds a selected source", async () => {
    vi.spyOn(databaseClient, "isRuntimeDatabaseConfigured").mockReturnValue(true);
    vi.spyOn(funnelRepository, "getWebsiteFunnelAggregate").mockResolvedValue(
      emptyAggregateRow({
        candidate_count: 2,
        source: null,
      }),
    );

    const overview = await getWebsiteFunnelOverview(input());

    expect(overview.source).toEqual({
      state: "ambiguous",
      candidateCount: 2,
      displayName: null,
      status: null,
    });
    expect(overview.dataState).toBe("source_unavailable");
  });

  it("excludes Vercel Drain and other-source events even when their timestamps match", async () => {
    const otherSource: Source = {
      ...websiteSource(),
      id: "88888888-8888-4888-8888-888888888888",
      data_space_id: DATA_SPACE_IDS.autoLab,
      display_name: "Auto Lab Website",
    };
    getDemoStore().sources.push(otherSource);
    getDemoStore().webEvents.push(
      webEvent({ sessionId: "authoritative", eventName: "page_view", occurredAt: at(8) }),
      webEvent({
        sessionId: "drain",
        eventName: "page_view",
        occurredAt: at(8),
        eventSource: "vercel_drain",
      }),
      webEvent({
        sessionId: "other-space",
        eventName: "page_view",
        occurredAt: at(8),
        sourceId: otherSource.id,
      }),
    );

    const overview = await getWebsiteFunnelOverview(input());

    expect(overview.unfilteredEvents).toBe(1);
    expect(overview.stages[0].sessions).toBe(1);
  });

  it("uses half-open Pacific bounds with an inclusive start and exclusive cutoff", async () => {
    getDemoStore().webEvents.push(
      webEvent({
        sessionId: "at-pacific-midnight",
        eventName: "page_view",
        occurredAt: "2026-04-22T07:00:00.000Z",
      }),
      webEvent({
        sessionId: "before-cutoff",
        eventName: "page_view",
        occurredAt: "2026-04-22T15:59:59.999Z",
      }),
      webEvent({
        sessionId: "at-cutoff",
        eventName: "page_view",
        occurredAt: NOW,
      }),
    );

    const overview = await getWebsiteFunnelOverview(input());

    expect(overview.range).toMatchObject({
      startAt: "2026-04-22T07:00:00.000Z",
      endExclusive: NOW,
      partialDay: true,
    });
    expect(overview.unfilteredEvents).toBe(2);
    expect(overview.stages[0].sessions).toBe(2);
  });

  it("returns an empty configured Today overview at exact Pacific midnight", async () => {
    vi.spyOn(databaseClient, "isRuntimeDatabaseConfigured").mockReturnValue(true);
    const repository = vi.spyOn(funnelRepository, "getWebsiteFunnelAggregate").mockResolvedValue(
      emptyAggregateRow(),
    );

    const overview = await getWebsiteFunnelOverview(input({
      now: "2026-04-22T07:00:00.000Z",
    }));

    expect(repository).toHaveBeenCalledWith(expect.objectContaining({
      current: {
        startAt: "2026-04-22T07:00:00.000Z",
        endExclusive: "2026-04-22T07:00:00.000Z",
      },
    }));
    expect(overview.range).toMatchObject({
      startAt: "2026-04-22T07:00:00.000Z",
      endExclusive: "2026-04-22T07:00:00.000Z",
    });
    expect(overview.dataState).toBe("no_events");
    expect(overview.comparison).toMatchObject({
      available: false,
      reason: "An equal-elapsed Pacific comparison window is unavailable for this cutoff.",
    });
  });

  it("deduplicates deliveries, counts repeated events, and applies strict sequence ordering", async () => {
    addSession("direct-product", [
      ["page_view", at(8, 0)],
      ["page_view", at(8, 1)],
      ["view_item", at(8, 2)],
      ["view_item", at(8, 3)],
      ["add_to_cart", at(8, 4)],
      ["begin_checkout", at(8, 5)],
    ]);
    const checkout = getDemoStore().webEvents.at(-1)!;
    getDemoStore().webEvents.push({
      ...checkout,
      id: "duplicate-row",
      received_at: at(8, 6),
      created_at: at(8, 6),
    });

    addSession("equal-time", [
      ["page_view", at(9, 0)],
      ["view_item", at(9, 0)],
      ["view_item", at(9, 2)],
      ["add_to_cart", at(9, 2)],
      ["add_to_cart", at(9, 3)],
      ["begin_checkout", at(9, 3)],
    ]);
    addSession("out-of-order", [
      ["view_item", at(10, 0)],
      ["add_to_cart", at(10, 1)],
      ["page_view", at(10, 2)],
      ["begin_checkout", at(10, 3)],
    ]);
    addSession("diagnostics", [
      ["page_view", at(11, 0)],
      ["cta_click", at(11, 1)],
      ["view_item", at(11, 2), { currency: "USD", value: 88, items: [] }],
    ]);

    const overview = await getWebsiteFunnelOverview(input());
    const stages = Object.fromEntries(overview.stages.map((stage) => [stage.key, stage]));

    expect(stages.visit).toMatchObject({ sessions: 4, events: 5 });
    expect(stages.product_intent).toMatchObject({ sessions: 2, events: 3 });
    expect(stages.add_to_cart).toMatchObject({ sessions: 2, events: 2 });
    expect(stages.begin_checkout).toMatchObject({ sessions: 1, events: 1 });
    expect(overview.readyMade.stages.map((stage) => stage.sessions)).toEqual([4, 2, 2, 1]);
    expect(overview.readyMade.stages.map((stage) => stage.events)).toEqual([5, 3, 2, 1]);
    expect(overview.quality).toMatchObject({
      duplicateDeliveriesRemoved: 1,
      equalTimeIntentSessions: 1,
      equalTimeCartSessions: 1,
      equalTimeCheckoutSessions: 1,
      unsequencedIntentSessions: 1,
      unsequencedCartSessions: 1,
      unsequencedCheckoutSessions: 2,
      unknownEvents: [{ eventName: "cta_click", events: 1 }],
      invalidPropertyEvents: [{ eventName: "view_item", events: 1 }],
    });
  });

  it("keeps builder outcomes independent and marks builder cart and checkout stages unmeasured", async () => {
    addSession("ready", [
      ["page_view", at(8, 0)],
      ["view_item", at(8, 1)],
      ["add_to_cart", at(8, 2)],
      ["begin_checkout", at(8, 3)],
      ["email_signup", at(8, 4)],
    ]);
    const builderItem = {
      item_id: "builder-design",
      item_name: "Custom bracelet",
      item_category: "Build Your Own",
      quantity: 1,
    };
    addSession("builder", [
      ["page_view", at(9, 0)],
      ["build_start", at(9, 1)],
      ["save_design", at(9, 2)],
      ["build_complete", at(9, 3)],
      ["add_to_cart", at(9, 4), { currency: "USD", value: 140, items: [builderItem] }],
      ["begin_checkout", at(9, 5), { currency: "USD", value: 140, items: [builderItem] }],
    ]);

    const overview = await getWebsiteFunnelOverview(input({ segment: "builder" }));
    const stages = Object.fromEntries(overview.stages.map((stage) => [stage.key, stage]));

    expect(stages.visit).toMatchObject({ measured: true, sessions: 2 });
    expect(stages.product_intent).toMatchObject({ measured: true, sessions: 1 });
    expect(stages.add_to_cart).toMatchObject({
      measured: false,
      sessions: 0,
      percentOfStart: null,
      fromPrevious: null,
    });
    expect(stages.begin_checkout.measured).toBe(false);
    expect(overview.builder).toMatchObject({
      starts: { sessions: 1, events: 1 },
      completions: { sessions: 1, events: 1 },
      saves: { sessions: 1, events: 1 },
      completionRate: 100,
      saveRate: 100,
    });
    expect(overview.readyMade.stages.map((stage) => stage.sessions)).toEqual([2, 1, 1, 1]);
    expect(overview.emailSignup).toMatchObject({ sessions: 1, events: 1 });
    expect(overview.products.rows.some((row) => row.itemId === "SKU-A")).toBe(true);
    expect(overview.trend.every((point) =>
      point.current.add_to_cart === null
      && point.current.checkout === null
      && point.current.visit_to_checkout_rate === null,
    )).toBe(true);
    expect(overview.acquisition.rows.every((row) =>
      row.checkoutSessions === null && row.visitToCheckoutRate === null,
    )).toBe(true);
    expect(overview.devices.every((row) =>
      row.checkoutSessions === null && row.visitToCheckoutRate === null,
    )).toBe(true);
  });

  it("requires exact item identity for collection and product progression", async () => {
    addSession("stable", [
      ["page_view", at(8, 0)],
      ["view_item_list", at(8, 1)],
      ["view_item", at(8, 2)],
      ["add_to_cart", at(8, 3)],
    ]);
    const itemB = { ...ITEM, item_id: "SKU-B", item_name: "B bracelet" };
    const slugB = { ...itemB, item_id: "product-b" };
    addSession("mismatch", [
      ["page_view", at(9, 0)],
      ["view_item_list", at(9, 1), {
        item_list_name: "Mismatch Collection",
        items: [{ ...ITEM, item_id: "LIST-ONLY", item_list_name: "Mismatch Collection" }],
      }],
      ["view_item", at(9, 2), { currency: "USD", value: 88, items: [itemB] }],
      ["add_to_cart", at(9, 3), { currency: "USD", value: 88, items: [slugB] }],
    ]);
    addSession("conflict", [
      ["page_view", at(10, 0)],
      ["view_item", at(10, 1), {
        currency: "USD",
        value: 88,
        items: [{ ...ITEM, item_id: "SKU-C", item_name: "First name" }],
      }],
      ["add_to_cart", at(10, 2), {
        currency: "USD",
        value: 88,
        items: [{ ...ITEM, item_id: "SKU-C", item_name: "Conflicting name" }],
      }],
    ]);
    addSession("invalid", [
      ["page_view", at(11, 0)],
      ["view_item", at(11, 1), { currency: "USD", value: 88, items: [] }],
    ]);

    const overview = await getWebsiteFunnelOverview(input());
    const stable = overview.products.rows.find((row) => row.itemId === "SKU-A");
    const viewOnly = overview.products.rows.find((row) => row.itemId === "SKU-B");
    const cartOnly = overview.products.rows.find((row) => row.itemId === "product-b");
    const conflict = overview.products.rows.find((row) => row.itemId === "SKU-C");
    const unknown = overview.products.rows.find((row) => row.itemId === null);

    expect(stable).toMatchObject({ identityState: "stable", viewToCartRate: 100 });
    expect(viewOnly).toMatchObject({ identityState: "view_only", viewToCartRate: null });
    expect(cartOnly).toMatchObject({ identityState: "cart_only", viewToCartRate: null });
    expect(conflict).toMatchObject({ identityState: "unknown", itemName: "", viewToCartRate: null });
    expect(unknown).toMatchObject({ identityState: "unknown", productViewSessions: 1 });
    expect(overview.collections.rows.find((row) => row.collectionName === "Core Collection")).toMatchObject({
      collectionViewSessions: 1,
      productViewSessions: 1,
      progressionRate: 100,
    });
    expect(overview.collections.rows.find((row) => row.collectionName === "Mismatch Collection")).toMatchObject({
      productViewSessions: 0,
      progressionRate: 0,
    });
  });

  it("normalizes acquisition/device cohorts, keeps Unknown visible, and recomputes the funnel", async () => {
    addSession("paid-mobile", [
      ["page_view", at(8, 0)],
      ["view_item", at(8, 1)],
      ["add_to_cart", at(8, 2)],
      ["begin_checkout", at(8, 3)],
    ], {
      attribution: {
        utm: { source: "Instagram", medium: "Paid_Social", campaign: "Launch" },
        landing_page: "/products/moon",
        first_referrer: "https://social.example/private/path?token=secret",
      },
      clientContext: { device_category: "mobile" },
    });
    addSession("bot-device", [
      ["page_view", at(9, 0)],
    ], {
      attribution: {},
      clientContext: { device_category: "bot" },
    });

    const overview = await getWebsiteFunnelOverview(input({
      device: "mobile",
      utmSource: "INSTAGRAM",
      utmMedium: "PAID_SOCIAL",
    }));

    expect(overview.stages.map((stage) => stage.sessions)).toEqual([1, 1, 1, 1]);
    expect(overview.acquisition.rows).toEqual([
      expect.objectContaining({
        utmSource: "instagram",
        utmMedium: "paid_social",
        utmCampaign: "Launch",
        landingPath: "/products/moon",
        referrerHost: "social.example",
        sessions: 1,
        productIntentSessions: 1,
        checkoutSessions: 1,
        visitToCheckoutRate: 100,
      }),
    ]);
    expect(overview.filterOptions).toMatchObject({
      devices: ["bot", "mobile"],
      utmSources: ["instagram", "Unknown"],
    });
    expect(JSON.stringify(overview)).not.toContain("/private/path");
    expect(JSON.stringify(overview)).not.toContain("token=secret");

    const botOverview = await getWebsiteFunnelOverview(input({ device: "bot" }));
    expect(botOverview.stages.map((stage) => stage.sessions)).toEqual([1, 0, 0, 0]);
    expect(botOverview.devices).toEqual([
      expect.objectContaining({ device: "bot", sessions: 1 }),
    ]);
  });

  it("distinguishes coverage, comparison availability, pre-coverage, low volume, and zero baselines", async () => {
    addSession("history", [["page_view", at(8, 0, 20)]]);
    addSession("current-one", [["page_view", at(8, 0)]]);
    addSession("current-two", [["page_view", at(9, 0)]]);

    const ready = await getWebsiteFunnelOverview(input());
    expect(ready.comparison).toMatchObject({ available: true, reason: null });
    expect(ready.lowVolume).toBe(true);
    expect(ready.coverage.startsDuringSelection).toBe(false);
    expect(ready.stages[0]).toMatchObject({
      sessions: 2,
      previousSessions: 0,
      deltaPercent: null,
      fromPrevious: null,
    });
    expect(ready.stages[1].fromPrevious).toBe(0);
    expect(ready.stages[2].fromPrevious).toBeNull();

    getDemoStore().webEvents = [
      webEvent({ sessionId: "future", eventName: "page_view", occurredAt: at(20, 0) }),
    ];
    const preCoverage = await getWebsiteFunnelOverview(input());
    expect(preCoverage.dataState).toBe("pre_coverage");
    expect(preCoverage.coverage.firstOccurredAt).toBe(at(20, 0));
    expect(preCoverage.trend[0].current).toEqual({
      sessions: null,
      product_intent: null,
      add_to_cart: null,
      checkout: null,
      visit_to_checkout_rate: null,
    });

    getDemoStore().webEvents = [
      webEvent({ sessionId: "only-current", eventName: "page_view", occurredAt: at(8, 0) }),
    ];
    const incomplete = await getWebsiteFunnelOverview(input());
    expect(incomplete.comparison.available).toBe(false);
    expect(incomplete.comparison.reason).toMatch(/does not span/u);
    expect(incomplete.coverage.startsDuringSelection).toBe(true);
  });

  it("reconciles completed Pacific days and reports delayed partial daily coverage", async () => {
    addSession("completed-day", [
      ["page_view", at(8, 0, 21)],
      ["view_item", at(8, 1, 21)],
    ]);
    addSession("partial-today", [["page_view", at(8, 0, 22)]]);
    const baseMetric = {
      source_id: DEMO_SOURCE_IDS.website,
      source_type_key: "website" as const,
      date: "2026-04-21",
      unit: "count",
      dimensions: { rollup: "daily" },
      created_at: NOW,
      updated_at: NOW,
    };
    getDemoStore().metricsDaily.push(
      {
        ...baseMetric,
        id: "completed-page-views",
        metric_key: "page_views",
        metric_value: 1,
        dimensions_hash: "completed-page-views",
      },
      {
        ...baseMetric,
        id: "completed-custom-events",
        metric_key: "custom_events",
        metric_value: 1,
        dimensions_hash: "completed-custom-events",
      },
    );

    const matched = await getWebsiteFunnelOverview(input({ range: "7d" }));
    expect(matched.reconciliation).toMatchObject({
      state: "matched",
      rawPageViews: 1,
      dailyPageViews: 1,
      rawCustomEvents: 1,
      dailyCustomEvents: 1,
    });

    getDemoStore().metricsDaily = getDemoStore().metricsDaily.filter(
      (metric) => metric.metric_key !== "custom_events",
    );
    const delayed = await getWebsiteFunnelOverview(input({ range: "7d" }));
    expect(delayed.reconciliation).toMatchObject({
      state: "delayed",
      rawPageViews: 1,
      dailyPageViews: 1,
      rawCustomEvents: 1,
      dailyCustomEvents: null,
    });

    const today = await getWebsiteFunnelOverview(input({ range: "today" }));
    expect(today.reconciliation).toMatchObject({
      state: "unavailable",
      rawPageViews: 0,
      rawCustomEvents: 0,
    });
    expect(today.reconciliation.note).toMatch(/completed Pacific day/u);
  });

  it("returns filtered-empty and deterministic low-volume demo states", async () => {
    addSession("desktop", [["page_view", at(8, 0)]], {
      clientContext: { device_category: "desktop" },
    });

    const filtered = await getWebsiteFunnelOverview(input({ device: "mobile" }));
    expect(filtered.dataState).toBe("filtered_empty");
    expect(filtered.unfilteredEvents).toBe(1);
    expect(filtered.acceptedEvents).toBe(0);

    getDemoStore().webEvents = Array.from({ length: 30 }, (_, index) => webEvent({
      sessionId: `demo-state-${String(index).padStart(2, "0")}`,
      eventName: "page_view",
      occurredAt: at(8, index % 60),
    }));
    const lowVolume = await getWebsiteFunnelOverview(input({ demoState: "low-volume" }));
    expect(lowVolume.stages[0].sessions).toBe(LOW_VOLUME_EXPECTED);
    expect(lowVolume.lowVolume).toBe(true);
  });

  it("returns a complete aggregate DTO without raw identities, URLs, credentials, or PII", async () => {
    addSession("private-person@example.com", [
      ["page_view", at(8, 0)],
      ["view_item", at(8, 1)],
      ["email_signup", at(8, 2)],
    ], {
      anonymousId: "202-555-0100",
      attribution: {
        landing_page: "/products/moon",
        first_referrer: "https://safe.example/private-person@example.com",
      },
    });
    getDemoStore().webEvents[0].user_id = "private-user-id";

    const overview = await getWebsiteFunnelOverview(input());
    const serialized = JSON.stringify(overview);

    expect(overview).toEqual(expect.objectContaining({
      source: expect.any(Object),
      range: expect.any(Object),
      comparison: expect.any(Object),
      coverage: expect.any(Object),
      filters: expect.any(Object),
      filterOptions: expect.any(Object),
      stages: expect.any(Array),
      trend: expect.any(Array),
      readyMade: expect.any(Object),
      builder: expect.any(Object),
      emailSignup: expect.any(Object),
      collections: expect.any(Object),
      products: expect.any(Object),
      acquisition: expect.any(Object),
      devices: expect.any(Array),
      quality: expect.any(Object),
      reconciliation: expect.any(Object),
    }));
    for (const forbidden of [
      "private-person@example.com",
      "202-555-0100",
      "private-user-id",
      "must-never-leave-the-service",
      "private-user-agent",
      "private-ip-hash",
      "?private=query",
      "source_id",
      "event_id",
      "session_id",
      "anonymous_id",
      "public_tracking_key",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("uses the configured aggregate repository and maps truthful composite breakdowns", async () => {
    const aggregate: WebsiteFunnelAggregateRow = {
      candidate_count: 1,
      source: { display_name: "MoonArq Website", status: "healthy" },
      coverage: {
        first_occurred_at: at(8, 0, 20),
        latest_received_at: at(10, 0),
      },
      stages: [
        { period_key: "current", stage_key: "visit", sessions: 5, visitors: 4, events: 7 },
        { period_key: "current", stage_key: "product_intent", sessions: 3, visitors: 3, events: 4 },
        { period_key: "current", stage_key: "add_to_cart", sessions: 2, visitors: 2, events: 2 },
        { period_key: "current", stage_key: "begin_checkout", sessions: 1, visitors: 1, events: 1 },
        { period_key: "comparison", stage_key: "visit", sessions: 4, visitors: 4, events: 4 },
        { period_key: "comparison", stage_key: "product_intent", sessions: 2, visitors: 2, events: 2 },
        { period_key: "comparison", stage_key: "add_to_cart", sessions: 1, visitors: 1, events: 1 },
        { period_key: "comparison", stage_key: "begin_checkout", sessions: 0, visitors: 0, events: 0 },
      ],
      daily_trend: [
        {
          period_key: "current",
          date_pt: "2026-04-22",
          sessions: 5,
          product_intent_sessions: 3,
          add_to_cart_sessions: 2,
          checkout_sessions: 1,
        },
      ],
      quality: [{
        period_key: "current",
        duplicate_deliveries_removed: 1,
        equal_time_intent_sessions: 0,
        equal_time_cart_sessions: 0,
        equal_time_checkout_sessions: 0,
        unsequenced_intent_sessions: 0,
        unsequenced_cart_sessions: 0,
        unsequenced_checkout_sessions: 0,
        unknown_events: 0,
      }],
      journeys: [
        {
          period_key: "current",
          journey_key: "ready_made",
          visit_sessions: 5,
          product_view_sessions: 3,
          add_to_cart_sessions: 2,
          begin_checkout_sessions: 1,
          visit_events: 7,
          product_view_events: 4,
          add_to_cart_events: 2,
          begin_checkout_events: 1,
        },
        {
          period_key: "current",
          journey_key: "builder",
          build_start_sessions: 1,
          build_complete_sessions: 1,
          save_design_sessions: 1,
          build_start_events: 2,
          build_complete_events: 1,
          save_design_events: 1,
        },
      ],
      engagement: [{
        period_key: "current",
        event_name: "email_signup",
        sessions: 1,
        visitors: 1,
        events: 2,
      }],
      products: [{
        period_key: "current",
        item_id: "VIEW-ONLY",
        item_name: "View only product",
        item_category: "Ready-made",
        product_view_sessions: 3,
        add_to_cart_sessions: 0,
        matched_view_to_cart_sessions: 0,
        product_view_events: 4,
        add_to_cart_events: 0,
        stable_identity: true,
        total_rows: 1,
      }],
      collections: [{
        period_key: "current",
        item_list_name: "Core Collection",
        collection_view_sessions: 4,
        collection_view_events: 5,
        visitors: 4,
        progressed_to_product_sessions: 2,
        equal_time_progression_sessions: 0,
        total_rows: 2,
      }, {
        period_key: "current",
        item_list_name: "Unknown / unmapped",
        collection_view_sessions: 1,
        collection_view_events: 1,
        visitors: 1,
        progressed_to_product_sessions: 0,
        equal_time_progression_sessions: 0,
        total_rows: 2,
      }],
      acquisition: [{
        period_key: "current",
        utm_source: "instagram",
        utm_medium: "paid_social",
        utm_campaign: "Launch",
        landing_page: "/products/moon",
        referrer_host: "social.example",
        sessions: 5,
        visitors: 4,
        events: 12,
        product_intent_sessions: 3,
        checkout_sessions: 2,
        total_rows: 1,
      }],
      devices: [{
        period_key: "current",
        device_category: "mobile",
        sessions: 5,
        visitors: 4,
        events: 12,
        product_intent_sessions: 3,
        checkout_sessions: 2,
      }],
      filter_options: {
        devices: ["mobile"],
        utm_sources: ["instagram"],
        utm_mediums: ["paid_social"],
        utm_campaigns: ["Launch"],
        landing_pages: ["/products/moon"],
        referrer_hosts: ["social.example"],
      },
      group_totals: { products: 1, collections: 2, acquisition: 1 },
      event_counts: [
        { period_key: "current", accepted_events: 12, unfiltered_events: 15 },
        { period_key: "comparison", accepted_events: 8, unfiltered_events: 8 },
      ],
      unknown_events: [{
        period_key: "current",
        event_name: "cta_click",
        events: 2,
        sessions: 2,
        total_rows: 3,
      }],
      invalid_properties: [],
      reconciliation: [{
        period_key: "current",
        comparable: false,
        raw_page_views: 10,
        raw_page_view_days: 1,
        page_view_metric_rows: 0,
        metric_page_views: null,
        page_view_difference: null,
        raw_custom_events: 5,
        raw_custom_event_days: 1,
        custom_event_metric_rows: 0,
        metric_custom_events: null,
        custom_event_difference: null,
      }],
    };
    vi.spyOn(databaseClient, "isRuntimeDatabaseConfigured").mockReturnValue(true);
    const repository = vi.spyOn(funnelRepository, "getWebsiteFunnelAggregate").mockResolvedValue(aggregate);

    const overview = await getWebsiteFunnelOverview(input({ segment: "ready-made" }));

    expect(repository).toHaveBeenCalledWith(expect.objectContaining({ segment: "ready-made" }));
    expect(overview.acquisition.rows[0]).toMatchObject({
      sessions: 5,
      productIntentSessions: 3,
      checkoutSessions: 2,
      visitToCheckoutRate: 40,
    });
    expect(overview.devices[0]).toMatchObject({
      device: "mobile",
      productIntentSessions: 3,
      checkoutSessions: 2,
      visitToCheckoutRate: 40,
    });
    expect(overview.products.rows[0]).toMatchObject({
      identityState: "view_only",
      viewToCartRate: null,
    });
    expect(overview.readyMade.stages.map((stage) => stage.events)).toEqual([7, 4, 2, 1]);
    expect(overview).toMatchObject({ acceptedEvents: 12, unfilteredEvents: 15 });
    expect(overview.filterOptions).toMatchObject({
      devices: ["mobile"],
      utmSources: ["instagram"],
    });
    expect(overview.collections.rows.find((candidate) => candidate.state === "unknown")).toMatchObject({
      productViewSessions: 0,
      progressionRate: null,
    });
    expect(overview.quality).toMatchObject({
      unknownEvents: [{ eventName: "cta_click", events: 2 }],
      unknownEventTotalRows: 3,
    });
    expect(overview.reconciliation).toMatchObject({
      state: "unavailable",
      dailyPageViews: null,
      dailyCustomEvents: null,
      note: expect.stringContaining("suppressed for this filtered cohort"),
    });

    aggregate.reconciliation = [{
      period_key: "current",
      comparable: true,
      raw_page_views: 10,
      raw_page_view_days: 2,
      page_view_metric_rows: 1,
      metric_page_views: 4,
      page_view_difference: 6,
      raw_custom_events: 5,
      raw_custom_event_days: 1,
      custom_event_metric_rows: 1,
      metric_custom_events: 5,
      custom_event_difference: 0,
    }];

    const delayed = await getWebsiteFunnelOverview(input({ segment: "all" }));
    expect(delayed.reconciliation).toEqual({
      state: "delayed",
      rawPageViews: 10,
      dailyPageViews: null,
      rawCustomEvents: 5,
      dailyCustomEvents: 5,
      note: "Completed-day raw first-party events are available while one or more daily aggregates are not yet present.",
    });

    aggregate.products = [];
    aggregate.group_totals.products = 17;
    const secondPage = await getWebsiteFunnelOverview(input({
      segment: "all",
      productPage: 2,
    }));
    expect(secondPage.products).toMatchObject({
      rows: [],
      page: 2,
      totalRows: 17,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });
});

const LOW_VOLUME_EXPECTED = 5;
