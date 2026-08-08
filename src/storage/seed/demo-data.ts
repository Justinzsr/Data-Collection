import { createHash, randomUUID } from "node:crypto";
import type {
  ConnectorEvent,
  ContentItem,
  ContentMetric,
  DemoWorkspace,
  JsonRecord,
  MetricDaily,
  RawIngestion,
  Source,
  SyncRun,
  WebEvent,
} from "@/storage/db/schema";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";
import { DATA_SPACE_IDS, staticDataSpaces } from "@/storage/data-spaces";

export function getDemoNow() {
  const override = process.env.DEMO_NOW;
  if (override) {
    const date = new Date(override);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

export const DEMO_SOURCE_IDS = {
  website: "11111111-1111-4111-8111-111111111111",
  supabase: "22222222-2222-4222-8222-222222222222",
  tiktok: "33333333-3333-4333-8333-333333333333",
  instagram: "44444444-4444-4444-8444-444444444444",
} as const;

function iso(date: Date) {
  return date.toISOString();
}

function day(offsetFromToday: number, base = getDemoNow()) {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + offsetFromToday);
  return date.toISOString().slice(0, 10);
}

function at(offsetMinutes: number) {
  return iso(new Date(getDemoNow().getTime() + offsetMinutes * 60_000));
}

export function dimensionsHash(dimensions: JsonRecord = {}) {
  return createHash("sha256").update(JSON.stringify(dimensions, Object.keys(dimensions).sort())).digest("hex");
}

function metric(
  date: string,
  source_id: string | null,
  source_type_key: MetricDaily["source_type_key"],
  metric_key: string,
  metric_value: number,
  unit = "count",
  dimensions: JsonRecord = { demo: true },
): MetricDaily {
  const now = iso(getDemoNow());
  return {
    id: randomUUID(),
    date,
    source_id,
    source_type_key,
    metric_key,
    metric_value,
    unit,
    dimensions,
    dimensions_hash: dimensionsHash(dimensions),
    created_at: now,
    updated_at: now,
  };
}

function source(partial: Partial<Source> & Pick<Source, "id" | "source_type_key" | "display_name">): Source {
  const created = at(-60 * 24 * 28);
  return {
    id: partial.id,
    data_space_id: partial.data_space_id ?? DATA_SPACE_IDS.moonarq,
    source_type_key: partial.source_type_key,
    display_name: partial.display_name,
    input_url: partial.input_url ?? null,
    normalized_url: partial.normalized_url ?? null,
    external_account_id: partial.external_account_id ?? null,
    account_name: partial.account_name ?? null,
    status: partial.status ?? "demo",
    sync_mode: partial.sync_mode ?? "hybrid",
    sync_frequency_minutes: partial.sync_frequency_minutes ?? 60,
    supports_webhook: partial.supports_webhook ?? false,
    webhook_url: partial.webhook_url ?? null,
    webhook_secret_hint: partial.webhook_secret_hint ?? null,
    last_manual_sync_at: partial.last_manual_sync_at ?? at(-130),
    last_cron_sync_at: partial.last_cron_sync_at ?? at(-52),
    last_webhook_sync_at: partial.last_webhook_sync_at ?? null,
    last_success_at: partial.last_success_at ?? at(-52),
    last_error_at: partial.last_error_at ?? null,
    last_error: partial.last_error ?? null,
    next_sync_at: partial.next_sync_at ?? at(8),
    metadata: partial.metadata ?? { demo: true },
    created_at: partial.created_at ?? created,
    updated_at: partial.updated_at ?? at(-52),
  };
}

function makeSources(): Source[] {
  return [
    source({
      id: DEMO_SOURCE_IDS.website,
      source_type_key: "website",
      display_name: "MoonArq Website / Vercel",
      input_url: "https://moonarqstudio.com",
      normalized_url: "https://moonarqstudio.com",
      account_name: "moonarqstudio.com",
      status: "demo",
      sync_mode: "hybrid",
      supports_webhook: true,
      last_webhook_sync_at: at(-4),
      metadata: {
        demo: true,
        public_tracking_key: "mq_demo_public_website",
        website_mode: "website",
        monitored_source: "moonarq_website",
        allowed_origins: ["https://moonarqstudio.com", "http://127.0.0.1:4000", "http://localhost:4000"],
      },
    }),
    source({
      id: DEMO_SOURCE_IDS.supabase,
      source_type_key: "supabase",
      display_name: "MoonArq Supabase",
      input_url: "https://xxxxx.supabase.co",
      normalized_url: "https://xxxxx.supabase.co",
      external_account_id: "xxxxx",
      account_name: "xxxxx",
      status: "needs_credentials",
      supports_webhook: true,
      webhook_url: "/api/webhooks/supabase/22222222-2222-4222-8222-222222222222",
      webhook_secret_hint: "supabase_webhook_••••",
      metadata: { demo: true, mode: "public_profiles_or_service_role" },
    }),
    source({
      id: DEMO_SOURCE_IDS.tiktok,
      source_type_key: "tiktok",
      display_name: "TikTok Placeholder",
      input_url: "https://www.tiktok.com/@moonarq",
      normalized_url: "https://www.tiktok.com/@moonarq",
      account_name: "@moonarq",
      status: "demo",
      sync_mode: "manual",
      metadata: { demo: true, scaffoldOnly: true },
    }),
    source({
      id: DEMO_SOURCE_IDS.instagram,
      source_type_key: "instagram",
      display_name: "Instagram Placeholder",
      input_url: "https://www.instagram.com/moonarq",
      normalized_url: "https://www.instagram.com/moonarq",
      account_name: "moonarq",
      status: "demo",
      sync_mode: "manual",
      metadata: { demo: true, scaffoldOnly: true },
    }),
  ];
}

function makeMetrics(): MetricDaily[] {
  const rows: MetricDaily[] = [];
  for (let index = 59; index >= 0; index -= 1) {
    const offset = -index;
    const date = day(offset);
    const age = 59 - index;
    const wave = Math.sin(age / 4) * 90;
    const pageViews = Math.round(780 + age * 18 + wave);
    const visitors = Math.round(pageViews * 0.42 + (index % 4) * 12);
    const sessions = Math.round(visitors * 1.28);
    const customEvents = Math.round(pageViews * 0.12 + (index % 5) * 8);
    const signups = Math.max(3, Math.round(12 + age * 0.55 + Math.cos(age / 3) * 4));
    const usersTotal = 500 + age * 13;
    rows.push(
      metric(date, DEMO_SOURCE_IDS.website, "website", "page_views", pageViews),
      metric(date, DEMO_SOURCE_IDS.website, "website", "unique_visitors", visitors),
      metric(date, DEMO_SOURCE_IDS.website, "website", "sessions", sessions),
      metric(date, DEMO_SOURCE_IDS.website, "website", "custom_events", customEvents),
      metric(date, DEMO_SOURCE_IDS.website, "website", "events_by_path", Math.round(pageViews * 0.44), "count", {
        demo: true,
        path: "/",
      }),
      metric(date, DEMO_SOURCE_IDS.website, "website", "events_by_path", Math.round(pageViews * 0.28), "count", {
        demo: true,
        path: "/pricing",
      }),
      metric(date, DEMO_SOURCE_IDS.website, "website", "events_by_referrer", Math.round(pageViews * 0.31), "count", {
        demo: true,
        referrer: "direct",
      }),
      metric(date, DEMO_SOURCE_IDS.supabase, "supabase", "signups", signups),
      metric(date, DEMO_SOURCE_IDS.supabase, "supabase", "users_total", usersTotal),
      metric(date, DEMO_SOURCE_IDS.supabase, "supabase", "confirmed_users", Math.round(usersTotal * 0.78)),
      metric(date, DEMO_SOURCE_IDS.supabase, "supabase", "signups_by_provider", Math.round(signups * 0.68), "count", {
        demo: true,
        provider: "email",
      }),
      metric(date, DEMO_SOURCE_IDS.supabase, "supabase", "signups_by_provider", Math.round(signups * 0.32), "count", {
        demo: true,
        provider: "google",
      }),
      metric(date, DEMO_SOURCE_IDS.tiktok, "tiktok", "tiktok_video_views", 1200 + age * 33),
      metric(date, DEMO_SOURCE_IDS.tiktok, "tiktok", "tiktok_likes", 80 + age * 3),
      metric(date, DEMO_SOURCE_IDS.tiktok, "tiktok", "tiktok_comments", 12 + age),
      metric(date, DEMO_SOURCE_IDS.tiktok, "tiktok", "tiktok_shares", 6 + age),
      metric(date, DEMO_SOURCE_IDS.tiktok, "tiktok", "tiktok_engagement_rate", 8.4, "percent"),
      metric(date, DEMO_SOURCE_IDS.instagram, "instagram", "reach", 900 + age * 21),
    );
  }
  return rows;
}

function makeSyncRuns(sources: Source[]): SyncRun[] {
  const runnableSources = sources.filter(
    (sourceItem) => sourceItem.status !== "disabled" && sourceItem.metadata.future !== true,
  );
  if (runnableSources.length === 0) return [];
  return Array.from({ length: 20 }, (_, index) => {
    const sourceItem = runnableSources[index % runnableSources.length];
    const started = new Date(getDemoNow().getTime() - (index + 1) * 38 * 60_000);
    const failed = index === 6;
    return {
      id: randomUUID(),
      source_id: sourceItem.id,
      source_type_key: sourceItem.source_type_key,
      trigger: index % 5 === 0 ? "manual" : index % 3 === 0 ? "webhook" : "cron",
      status: failed ? "error" : "success",
      idempotency_key: `demo-${sourceItem.id}-${index}`,
      lock_key: null,
      started_at: iso(started),
      finished_at: iso(new Date(started.getTime() + (failed ? 9000 : 2300 + index * 90))),
      duration_ms: failed ? 9000 : 2300 + index * 90,
      records_fetched: failed ? 0 : 12 + index,
      records_inserted: failed ? 0 : 8 + index,
      records_updated: failed ? 0 : index % 4,
      metrics_upserted: failed ? 0 : 4 + (index % 7),
      error_message: failed ? "Demo warning: missing credentials for a scaffolded source." : null,
      error_stack: null,
      cursor_before: { demo: true, index },
      cursor_after: failed ? null : { demo: true, index: index + 1 },
      metadata: { demo: true },
      created_at: iso(started),
    };
  });
}

function makeEvents(): WebEvent[] {
  type EventInput = {
    sessionId: string;
    anonymousId: string;
    eventName: string;
    occurredAt: Date;
    path?: string;
    properties?: JsonRecord;
    attribution?: JsonRecord;
    device?: "mobile" | "tablet" | "desktop" | "unknown";
    pageType?: string;
  };
  const events: WebEvent[] = [];
  const demoOrigin = "https://storefront.example";
  const now = getDemoNow();
  const products = [
    { item_id: "LUNAR-SILVER", item_name: "Lunar Silver Bracelet", item_category: "Ready-made", price: 88 },
    { item_id: "TIDAL-PEARL", item_name: "Tidal Pearl Bracelet", item_category: "Ready-made", price: 96 },
    { item_id: "ORBIT-GOLD", item_name: "Orbit Gold Bracelet", item_category: "Ready-made", price: 112 },
  ] as const;

  function addEvent(input: EventInput) {
    const id = randomUUID();
    const path = input.path ?? "/";
    const receivedAt = new Date(input.occurredAt.getTime() + 1_500);
    events.push({
      id,
      event_id: id,
      schema_version: "1.0",
      event_source: "first_party_tracker",
      source_id: DEMO_SOURCE_IDS.website,
      public_tracking_key: "mq_demo_public_website",
      anonymous_id: input.anonymousId,
      session_id: input.sessionId,
      user_id: null,
      event_name: input.eventName,
      path,
      url: `${demoOrigin}${path}`,
      referrer: typeof input.attribution?.first_referrer === "string" ? input.attribution.first_referrer : null,
      user_agent: "MoonArq deterministic demo client",
      ip_hash: null,
      country: null,
      device_type: input.device ?? "unknown",
      properties: input.properties ?? {},
      attribution_context: input.attribution ?? {},
      consent_status: { analytics: "unknown", marketing: "unknown" },
      client_context: {
        language: "en-US",
        currency: "USD",
        viewport_category: input.device === "mobile" ? "small" : input.device === "tablet" ? "medium" : "large",
        device_category: input.device ?? "unknown",
        page_type: input.pageType ?? "landing",
      },
      occurred_at: iso(input.occurredAt),
      received_at: iso(receivedAt),
      created_at: iso(receivedAt),
    });
  }

  function eventTime(dayOffset: number, minuteOffset: number, index: number) {
    return new Date(now.getTime() - dayOffset * 24 * 60 * 60_000 - 3 * 60 * 60_000 - (index % 6) * 12 * 60_000 + minuteOffset * 60_000);
  }

  function sessionAt(input: {
    cohort: "current" | "previous";
    index: number;
    dayOffset: number;
    readyIntentCount: number;
    builderStart: number;
    cartCount: number;
    checkoutCount: number;
  }) {
    const { cohort, index } = input;
    const sessionId = `demo_${cohort}_session_${String(index).padStart(2, "0")}`;
    const anonymousId = `demo_${cohort}_visitor_${String(index % 37).padStart(2, "0")}`;
    const device = (["desktop", "mobile", "tablet", "unknown"] as const)[index % 4];
    const acquisition: JsonRecord = index % 3 === 0
      ? {
          utm: { source: "instagram", medium: "paid_social", campaign: "lunar_launch" },
          landing_page: index % 2 === 0 ? "/collections/lunar" : "/products/lunar-silver",
          first_referrer: "https://social.example/",
        }
      : index % 3 === 1
        ? {
            utm: { source: "search", medium: "organic", campaign: "evergreen" },
            landing_page: "/collections/core",
            first_referrer: "https://search.example/",
          }
        : {};
    const visitAt = eventTime(input.dayOffset, 0, index);
    const product = products[index % products.length];
    const productPath = `/products/${product.item_id.toLowerCase()}`;
    const hasReadyIntent = index < input.readyIntentCount;
    const hasBuilderIntent = index >= input.builderStart && index < input.builderStart + 12;
    const pagePath = hasReadyIntent && index % 4 === 0 ? productPath : "/collections/core";

    addEvent({
      sessionId,
      anonymousId,
      eventName: "page_view",
      occurredAt: visitAt,
      path: pagePath,
      attribution: acquisition,
      device,
      pageType: pagePath.startsWith("/products/") ? "product" : "collection",
    });
    if (index === 0 && cohort === "current") {
      addEvent({
        sessionId,
        anonymousId,
        eventName: "page_view",
        occurredAt: eventTime(input.dayOffset, 1, index),
        path: pagePath,
        attribution: acquisition,
        device,
        pageType: "product",
      });
    }

    if (index < 20) {
      addEvent({
        sessionId,
        anonymousId,
        eventName: "view_item_list",
        occurredAt: eventTime(input.dayOffset, 1, index),
        path: "/collections/core",
        properties: {
          item_list_name: "Core Collection",
          items: [{ ...product, item_list_name: "Core Collection", quantity: 1 }],
        },
        attribution: acquisition,
        device,
        pageType: "collection",
      });
    }

    if (hasReadyIntent) {
      const occurredAt = cohort === "current" && index === 31
        ? visitAt
        : eventTime(input.dayOffset, 2, index);
      addEvent({
        sessionId,
        anonymousId,
        eventName: "view_item",
        occurredAt,
        path: productPath,
        properties: {
          currency: "USD",
          value: product.price,
          items: [{
            ...product,
            ...(index < 20 ? { item_list_name: "Core Collection" } : {}),
            quantity: 1,
          }],
        },
        attribution: acquisition,
        device,
        pageType: "product",
      });
      if (index === 0 && cohort === "current") {
        addEvent({
          sessionId,
          anonymousId,
          eventName: "view_item",
          occurredAt: eventTime(input.dayOffset, 3, index),
          path: productPath,
          properties: {
            currency: "USD",
            value: product.price,
            items: [{ ...product, quantity: 1 }],
          },
          attribution: acquisition,
          device,
          pageType: "product",
        });
      }
    }

    if (hasBuilderIntent) {
      addEvent({
        sessionId,
        anonymousId,
        eventName: "build_start",
        occurredAt: eventTime(input.dayOffset, 2, index),
        path: "/build",
        properties: { item_category: "Build Your Own" },
        attribution: acquisition,
        device,
        pageType: "builder",
      });
      if (index < input.builderStart + 7) {
        addEvent({
          sessionId,
          anonymousId,
          eventName: "build_complete",
          occurredAt: eventTime(input.dayOffset, 5, index),
          path: "/build",
          properties: {
            currency: "USD",
            item_category: "Build Your Own",
            stone_count: 7 + (index % 4),
            value: 140 + index,
          },
          attribution: acquisition,
          device,
          pageType: "builder",
        });
      }
      if (index < input.builderStart + 5) {
        addEvent({
          sessionId,
          anonymousId,
          eventName: "save_design",
          occurredAt: eventTime(input.dayOffset, 3, index),
          path: "/build",
          properties: {
            currency: "USD",
            item_category: "Build Your Own",
            stone_count: 7 + (index % 4),
            value: 140 + index,
          },
          attribution: acquisition,
          device,
          pageType: "builder",
        });
      }
    }

    if (index < input.cartCount) {
      const cartItem = cohort === "current" && index === input.cartCount - 1
        ? { ...product, item_id: `product-${product.item_id.toLowerCase()}` }
        : product;
      addEvent({
        sessionId,
        anonymousId,
        eventName: "add_to_cart",
        occurredAt: eventTime(input.dayOffset, 4, index),
        path: "/cart",
        properties: {
          currency: "USD",
          value: product.price,
          items: [{ ...cartItem, quantity: 1 }],
        },
        attribution: acquisition,
        device,
        pageType: "cart",
      });
    }

    if (index < input.checkoutCount) {
      addEvent({
        sessionId,
        anonymousId,
        eventName: "begin_checkout",
        occurredAt: eventTime(input.dayOffset, 6, index),
        path: "/checkout",
        properties: {
          currency: "USD",
          value: product.price,
          items: [{
            ...product,
            item_id: `product-${product.item_id.toLowerCase()}`,
            quantity: 1,
          }],
        },
        attribution: acquisition,
        device,
        pageType: "checkout",
      });
    }

    if (index % 5 === 0) {
      addEvent({
        sessionId,
        anonymousId,
        eventName: "email_signup",
        occurredAt: eventTime(input.dayOffset, 7, index),
        path: pagePath,
        properties: { discount_code: "LUNAR10", method: "footer_form" },
        attribution: acquisition,
        device,
        pageType: "engagement",
      });
    }
    if (cohort === "current" && [3, 11, 27].includes(index)) {
      addEvent({
        sessionId,
        anonymousId,
        eventName: "cta_click",
        occurredAt: eventTime(input.dayOffset, 8, index),
        path: pagePath,
        properties: { component: "hero" },
        attribution: acquisition,
        device,
      });
    }
  }

  for (let index = 0; index < 48; index += 1) {
    sessionAt({
      cohort: "current",
      index,
      dayOffset: index % 24,
      readyIntentCount: 19,
      builderStart: 19,
      cartCount: 14,
      checkoutCount: 6,
    });
  }
  for (let index = 0; index < 40; index += 1) {
    sessionAt({
      cohort: "previous",
      index,
      dayOffset: 32 + (index % 26),
      readyIntentCount: 18,
      builderStart: 18,
      cartCount: 10,
      checkoutCount: 4,
    });
  }

  addEvent({
    sessionId: "demo_current_session_31",
    anonymousId: "demo_current_visitor_31",
    eventName: "view_item",
    occurredAt: eventTime(7, 0, 31),
    path: "/products/lunar-silver",
    properties: {
      currency: "USD",
      value: products[0].price,
      items: [{ ...products[0], quantity: 1 }],
    },
    device: "unknown",
    pageType: "product",
  });
  addEvent({
    sessionId: "demo_coverage_seed",
    anonymousId: "demo_coverage_visitor",
    eventName: "page_view",
    occurredAt: eventTime(70, 0, 0),
    path: "/",
    device: "unknown",
  });
  addEvent({
    sessionId: "demo_invalid_properties",
    anonymousId: "demo_invalid_visitor",
    eventName: "view_item",
    occurredAt: eventTime(4, 2, 41),
    path: "/products/unmapped",
    properties: { currency: "USD", value: 54, items: [] },
    device: "unknown",
    pageType: "product",
  });
  addEvent({
    sessionId: "demo_out_of_order_cart",
    anonymousId: "demo_out_of_order_visitor",
    eventName: "add_to_cart",
    occurredAt: eventTime(3, 1, 42),
    path: "/cart",
    properties: {
      currency: "USD",
      value: 88,
      items: [{ ...products[0], quantity: 1 }],
    },
    device: "mobile",
    pageType: "cart",
  });
  addEvent({
    sessionId: "demo_skipped_checkout",
    anonymousId: "demo_skipped_visitor",
    eventName: "begin_checkout",
    occurredAt: eventTime(2, 1, 43),
    path: "/checkout",
    properties: {
      currency: "USD",
      value: 96,
      items: [{ ...products[1], quantity: 1 }],
    },
    device: "desktop",
    pageType: "checkout",
  });

  return events.sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
}

function makeContent(): { items: ContentItem[]; metrics: ContentMetric[] } {
  const now = iso(getDemoNow());
  const items: ContentItem[] = [
    {
      id: randomUUID(),
      source_id: DEMO_SOURCE_IDS.tiktok,
      source_type_key: "tiktok",
      external_content_id: "tk_demo_001",
      content_type: "video",
      title: "Founder workflow demo",
      caption: "Demo placeholder for future TikTok API metrics.",
      url: "https://www.tiktok.com/@moonarq",
      thumbnail_url: null,
      published_at: at(-60 * 24 * 5),
      metadata: { demo: true, scaffoldOnly: true },
      created_at: now,
      updated_at: now,
    },
    {
      id: randomUUID(),
      source_id: DEMO_SOURCE_IDS.instagram,
      source_type_key: "instagram",
      external_content_id: "ig_demo_001",
      content_type: "media",
      title: "Internal analytics teaser",
      caption: "Demo placeholder for future Instagram Graph API metrics.",
      url: "https://www.instagram.com/moonarq",
      thumbnail_url: null,
      published_at: at(-60 * 24 * 8),
      metadata: { demo: true, scaffoldOnly: true },
      created_at: now,
      updated_at: now,
    },
  ];
  const metrics: ContentMetric[] = items.flatMap((item, itemIndex) =>
    Array.from({ length: 12 }, (_, index) => ({
      id: randomUUID(),
      date: day(-index),
      content_item_id: item.id,
      source_id: item.source_id,
      source_type_key: item.source_type_key,
      metric_key: item.source_type_key === "tiktok" ? "tiktok_video_views" : "instagram_media_reach",
      metric_value: 700 + index * 44 + itemIndex * 160,
      unit: "count",
      dimensions: { demo: true, scaffoldOnly: true },
      created_at: now,
      updated_at: now,
    })),
  );
  return { items, metrics };
}

function makeConnectorEvents(sources: Source[]): ConnectorEvent[] {
  return [
    {
      id: randomUUID(),
      source_id: DEMO_SOURCE_IDS.website,
      event_type: "tracking_ready",
      severity: "info",
      message: "Website tracker is accepting demo events.",
      metadata: { demo: true },
      created_at: at(-4),
    },
    {
      id: randomUUID(),
      source_id: DEMO_SOURCE_IDS.supabase,
      event_type: "needs_credentials",
      severity: "warning",
      message: "Supabase link identifies the project; real private metrics need public.profiles setup or a service role key.",
      metadata: { demo: true },
      created_at: at(-50),
    },
    ...sources
      .filter((sourceItem) => sourceItem.metadata.scaffoldOnly === true)
      .map((sourceItem) => ({
        id: randomUUID(),
        source_id: sourceItem.id,
        event_type: "scaffold_ready",
        severity: "info" as const,
        message: `${sourceItem.display_name} is scaffolded for future official API implementation.`,
        metadata: { demo: true, scaffoldOnly: true },
        created_at: at(-60),
      })),
  ];
}

function makeRawIngestions(): RawIngestion[] {
  const payload = { demo: true, type: "initial_seed" };
  return [
    {
      id: randomUUID(),
      source_id: DEMO_SOURCE_IDS.website,
      source_type_key: "website",
      external_id: "demo-initial-website",
      fetched_at: at(-60),
      payload,
      payload_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      status: "stored",
      cursor: { demo: true },
      created_at: at(-60),
    },
  ];
}

export function createDemoWorkspace(): DemoWorkspace {
  const sources = makeSources();
  const content = makeContent();
  return {
    dataSpaces: staticDataSpaces(),
    sources,
    credentials: [],
    syncRuns: makeSyncRuns(sources),
    sourceLocks: [],
    rawIngestions: makeRawIngestions(),
    metricsDaily: makeMetrics(),
    contentItems: content.items,
    contentMetrics: content.metrics,
    webEvents: makeEvents(),
    commerceOrders: [],
    commerceOrderLines: [],
    metricDefinitions,
    connectorEvents: makeConnectorEvents(sources),
    platformChangeEvents: [],
    dailyReportRuns: [],
    dailyReportSections: [],
    dailyReportMetrics: [],
  };
}
