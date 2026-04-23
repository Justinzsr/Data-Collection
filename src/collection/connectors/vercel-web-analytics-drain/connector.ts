import { createHash } from "node:crypto";
import type { ConnectorDefinition, RawPayload } from "@/collection/connectors/types";
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
  urlPatterns: [],
  requiredFields: [],
  optionalFields: [
    {
      key: "drain_signature_secret",
      label: "Drain signature secret",
      description: "Optional but recommended. Used to verify the x-vercel-signature header server-side.",
      required: false,
      secret: true,
      type: "password",
      placeholder: "Generated in Vercel Drains",
    },
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
    return {
      ok: true,
      status: ctx.source.status === "demo" ? "demo" : "connected",
      message: ctx.credentials.drain_signature_secret
        ? "Drain endpoint is configured with signature verification."
        : "Drain endpoint is ready. Add the optional signature secret in Vercel for request verification.",
      details: {
        webhookUrl: ctx.source.webhook_url,
        sourceMode: "vercel_web_analytics_drain",
      },
    };
  },
  async sync(ctx) {
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
    return {
      metrics: rawPayloads.map(() => ({
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
      "Set a Signature Verification Secret in Vercel and save the same secret here as an encrypted per-source credential if you want request verification.",
      "If Vercel Drain mode is active, keep the Website Tracker fallback disabled for this monitored source to avoid double counting.",
    ];
  },
};
