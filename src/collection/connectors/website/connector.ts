import { createHash } from "node:crypto";
import type { ConnectorDefinition, RawPayload } from "@/collection/connectors/types";
import type { MetricDefinition, Source } from "@/storage/db/schema";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";

function normalizeWebsiteUrl(inputUrl: string) {
  try {
    const url = new URL(inputUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.origin;
  } catch {
    return null;
  }
}

export const websiteConnector: ConnectorDefinition = {
  key: "website",
  displayName: "Website tracking",
  description: "First-party page view and custom event tracking for any website, Vercel-hosted or otherwise.",
  category: "Website",
  icon: "Globe2",
  urlPatterns: [/^https?:\/\/.+/i],
  requiredFields: [],
  optionalFields: [
    {
      key: "allowed_origins",
      label: "Allowed origins",
      description: "Optional comma-separated origins that may send events to /api/track.",
      required: false,
      secret: false,
      type: "text",
      placeholder: "https://example.com",
    },
  ],
  authType: "first_party_tracking",
  docsUrl: null,
  capabilities: {
    supportsWebhook: true,
    supportsPolling: false,
    supportsManualSync: true,
    recommendedSyncFrequencyMinutes: 60,
    canBackfill: false,
    canTestConnection: true,
  },
  detect(inputUrl) {
    const normalized = normalizeWebsiteUrl(inputUrl);
    if (!normalized) return null;
    return {
      sourceTypeKey: "website",
      displayName: "Website tracking",
      confidence: 0.52,
      normalizedUrl: normalized,
      reasons: ["HTTP(S) URL can be instrumented with MoonArq first-party tracking."],
      requiredSetup: [
        "Install the generated JavaScript snippet or React/Next helper on the website.",
        "Links identify the source. Private metrics require first-party tracking events.",
      ],
      possibleMetrics: ["page_views", "unique_visitors", "sessions", "custom_events", "events_by_path", "events_by_referrer"],
      demoAvailable: true,
    };
  },
  async testConnection(ctx) {
    return {
      ok: true,
      status: ctx.isDemoMode ? "demo" : "connected",
      message: "Website tracking is ready. Install the snippet and events will arrive through POST /api/track.",
      details: { endpoint: "/api/track" },
    };
  },
  async sync(ctx) {
    const fetchedAt = new Date().toISOString();
    const payload = {
      type: "website_sync_health",
      sourceId: ctx.source.id,
      trigger: ctx.trigger,
      note: "Website traffic is event-driven through /api/track; manual sync records a health check.",
    };
    return {
      rawPayloads: [
        {
          externalId: `website-health-${ctx.source.id}-${ctx.trigger}`,
          fetchedAt,
          payload,
          payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
          cursor: { fetchedAt },
        },
      ],
      cursorAfter: { fetchedAt },
      recordsFetched: 1,
      message: "Website tracking source health checked.",
    };
  },
  async normalize(rawPayloads: RawPayload[], source: Source) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      metrics: rawPayloads.map(() => ({
        date: today,
        sourceId: source.id,
        sourceTypeKey: "website",
        metricKey: "custom_events",
        metricValue: 0,
        unit: "count",
        dimensions: { sync_health_check: true, demo: source.status === "demo" },
      })),
    };
  },
  getMetricDefinitions(): MetricDefinition[] {
    return metricDefinitions.filter((metric) => metric.source_type_key === "website");
  },
  getSetupInstructions(source) {
    return [
      "Add the generated script before </body> or use the React/Next helper.",
      "The snippet automatically sends page_view events and exposes window.moonarqTrack(eventName, properties).",
      "Configure allowed origins on the website source when moving from demo to production.",
      `Tracking key: ${String(source?.metadata.public_tracking_key ?? "created after saving")}`,
    ];
  },
};
