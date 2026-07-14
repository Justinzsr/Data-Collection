import { createHash } from "node:crypto";
import type { ConnectorDefinition, RawPayload } from "@/collection/connectors/types";
import {
  prepareVercelAnalyticsDrain,
  readVercelDrainWebhookPayload,
} from "@/collection/tracking/vercel-drain-endpoint";
import type { MetricDefinition, Source } from "@/storage/db/schema";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";

function websiteMetricDefinitions(): MetricDefinition[] {
  return metricDefinitions.filter((metric) => metric.source_type_key === "website");
}

export const vercelWebAnalyticsDrainConnector: ConnectorDefinition = {
  key: "vercel_web_analytics_drain",
  displayName: "Vercel Web Analytics Drain",
  description: "Official Vercel Web Analytics Drain endpoint for MoonArq's existing Vercel-hosted website analytics.",
  category: "Website",
  icon: "Orbit",
  availability: "live",
  setupKind: "webhook",
  defaultSyncMode: "webhook",
  urlPatterns: [],
  requiredFields: [
    {
      key: "drain_signature_secret",
      label: "Drain signature secret",
      description: "Required. Used to verify every x-vercel-signature header server-side before ingestion.",
      required: true,
      secret: true,
      type: "password",
      placeholder: "Generated in Vercel Drains",
    },
  ],
  optionalFields: [
    {
      key: "vercel_project_id",
      label: "Vercel project id",
      description: "Optional project identifier for debugging and payload matching.",
      required: false,
      secret: false,
      type: "text",
      placeholder: "prj_...",
    },
  ],
  authType: "vercel_web_analytics_drain",
  docsUrl: "https://vercel.com/docs/drains/reference/analytics",
  capabilities: {
    supportsWebhook: true,
    supportsPolling: false,
    supportsManualSync: true,
    recommendedSyncFrequencyMinutes: 60,
    canBackfill: false,
    canTestConnection: true,
  },
  detect() {
    return null;
  },
  async testConnection(ctx) {
    if (!ctx.credentials.drain_signature_secret?.trim()) {
      return {
        ok: false,
        status: "needs_credentials",
        message: "A Vercel Drain signature secret is required before this endpoint can accept events.",
        details: {
          webhookUrl: ctx.source.webhook_url,
          sourceMode: "vercel_web_analytics_drain",
        },
      };
    }
    return {
      ok: true,
      status: ctx.source.status === "demo" ? "demo" : "connected",
      message: "Drain endpoint is configured with required signature verification.",
      details: {
        webhookUrl: ctx.source.webhook_url,
        sourceMode: "vercel_web_analytics_drain",
      },
    };
  },
  async sync(ctx) {
    if (ctx.trigger === "webhook") {
      const payload = readVercelDrainWebhookPayload(ctx.webhookPayload);
      const result = prepareVercelAnalyticsDrain({
        source: ctx.source,
        rawBody: payload.rawBody,
        signature: payload.signature,
        signatureSecret: ctx.credentials.drain_signature_secret,
      });
      return {
        rawPayloads: result.rawPayloads,
        webEvents: result.webEvents,
        cursorAfter: result.cursorAfter,
        recordsFetched: result.count,
        message: `Processed ${result.count} verified Vercel drain event(s).`,
      };
    }

    const fetchedAt = new Date().toISOString();
    const payload = {
      type: "vercel_web_analytics_drain_health",
      sourceId: ctx.source.id,
      trigger: ctx.trigger,
      note: "Vercel Drain sources are event-driven. Manual sync records health/freshness only.",
    };
    return {
      rawPayloads: [
        {
          externalId: `vercel-drain-health-${ctx.source.id}-${ctx.trigger}`,
          fetchedAt,
          payload,
          payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
          cursor: { fetchedAt },
        },
      ],
      cursorAfter: { fetchedAt },
      recordsFetched: 1,
      message: "Vercel Drain source health checked.",
    };
  },
  async normalize(rawPayloads: RawPayload[], source: Source) {
    const today = new Date().toISOString().slice(0, 10);
    const healthPayloads = rawPayloads.filter(
      (rawPayload) => rawPayload.payload.type === "vercel_web_analytics_drain_health",
    );
    return {
      metrics: healthPayloads.map(() => ({
        date: today,
        sourceId: source.id,
        sourceTypeKey: "vercel_web_analytics_drain" as const,
        metricKey: "custom_events",
        metricValue: 0,
        unit: "count",
        dimensions: { sync_health_check: true, mode: "vercel_drain", demo: source.status === "demo" },
      })),
    };
  },
  getMetricDefinitions() {
    return websiteMetricDefinitions();
  },
  getSetupInstructions(source) {
    return [
      "Use this mode when the existing MoonArq Vercel project has Web Analytics Drains available on Pro or Enterprise.",
      `Drain endpoint: ${source?.webhook_url ?? "/api/webhooks/vercel/analytics-drain/{sourceId}"}`,
      "In Vercel, add a Web Analytics Drain with JSON or NDJSON delivery and point it at the endpoint above.",
      "Set a Signature Verification Secret in Vercel and save the same secret here as a required encrypted per-source credential. Unsigned requests are rejected.",
      "If Vercel Drain mode is active, keep the Website Tracker fallback disabled for this monitored source to avoid double counting.",
    ];
  },
};
