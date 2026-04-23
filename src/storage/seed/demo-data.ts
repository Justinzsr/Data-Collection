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
  shopify: "55555555-5555-4555-8555-555555555555",
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
      display_name: "MoonArq Website",
      input_url: "https://example.com",
      normalized_url: "https://example.com",
      account_name: "example.com",
      status: "demo",
      sync_mode: "hybrid",
      supports_webhook: true,
      last_webhook_sync_at: at(-4),
      metadata: {
        demo: true,
        public_tracking_key: "mq_demo_public_website",
        allowed_origins: ["https://example.com", "http://localhost:3000"],
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
    source({
      id: DEMO_SOURCE_IDS.shopify,
      source_type_key: "shopify",
      display_name: "Shopify Future Store",
      input_url: "https://your-store.myshopify.com",
      normalized_url: "https://your-store.myshopify.com",
      account_name: "your-store",
      status: "disabled",
      sync_mode: "manual",
      last_success_at: null,
      next_sync_at: null,
      metadata: { demo: true, scaffoldOnly: true, future: true },
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
      metric(date, DEMO_SOURCE_IDS.tiktok, "tiktok", "video_views", 1200 + age * 33),
      metric(date, DEMO_SOURCE_IDS.instagram, "instagram", "reach", 900 + age * 21),
      metric(date, DEMO_SOURCE_IDS.shopify, "shopify", "orders", 0, "count", { demo: true, future: true }),
    );
  }
  return rows;
}

function makeSyncRuns(sources: Source[]): SyncRun[] {
  return Array.from({ length: 20 }, (_, index) => {
    const sourceItem = sources[index % sources.length];
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
  const paths = ["/", "/pricing", "/dashboard", "/blog/source-onboarding", "/contact"];
  const referrers = [null, "https://google.com", "https://x.com", "https://linkedin.com", "direct"];
  return Array.from({ length: 90 }, (_, index) => {
    const occurred = new Date(getDemoNow().getTime() - index * 41 * 60_000);
    return {
      id: randomUUID(),
      source_id: DEMO_SOURCE_IDS.website,
      public_tracking_key: "mq_demo_public_website",
      anonymous_id: `anon_${index % 34}`,
      session_id: `sess_${index % 42}`,
      user_id: index % 13 === 0 ? `user_${index}` : null,
      event_name: index % 5 === 0 ? "cta_click" : "page_view",
      path: paths[index % paths.length],
      url: `https://example.com${paths[index % paths.length]}`,
      referrer: referrers[index % referrers.length],
      user_agent: "Mozilla/5.0 MoonArq Demo",
      ip_hash: null,
      country: index % 4 === 0 ? "US" : null,
      device_type: index % 3 === 0 ? "mobile" : "desktop",
      properties: { demo: true, campaign: index % 6 === 0 ? "launch" : "organic" },
      occurred_at: iso(occurred),
      created_at: iso(occurred),
    };
  });
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
      metric_key: item.source_type_key === "tiktok" ? "video_views" : "reach",
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
    sources,
    credentials: [],
    syncRuns: makeSyncRuns(sources),
    sourceLocks: [],
    rawIngestions: makeRawIngestions(),
    metricsDaily: makeMetrics(),
    contentItems: content.items,
    contentMetrics: content.metrics,
    webEvents: makeEvents(),
    metricDefinitions,
    connectorEvents: makeConnectorEvents(sources),
  };
}
