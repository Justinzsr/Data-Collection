import { createHash } from "node:crypto";
import type { ConnectorDefinition, RawPayload } from "@/collection/connectors/types";
import type { MetricDefinition, SourceTypeKey } from "@/storage/db/schema";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";

interface FutureConnectorOptions {
  key: SourceTypeKey;
  displayName: string;
  description: string;
  category: string;
  icon: string;
  urlPatterns: RegExp[];
  authType: string;
  requiredFields?: ConnectorDefinition["requiredFields"];
  optionalFields?: ConnectorDefinition["optionalFields"];
  supportedMetrics: string[];
  detect: (inputUrl: string) => { confidence: number; normalizedUrl: string; reasons: string[]; accountName?: string | null } | null;
  setup: string[];
}

export function createFutureConnector(options: FutureConnectorOptions): ConnectorDefinition {
  return {
    key: options.key,
    displayName: options.displayName,
    description: options.description,
    category: options.category,
    icon: options.icon,
    urlPatterns: options.urlPatterns,
    requiredFields: options.requiredFields ?? [],
    optionalFields: options.optionalFields ?? [],
    authType: options.authType,
    docsUrl: null,
    capabilities: {
      supportsWebhook: false,
      supportsPolling: true,
      supportsManualSync: true,
      recommendedSyncFrequencyMinutes: 60,
      canBackfill: false,
      canTestConnection: true,
    },
    detect(inputUrl) {
      const detected = options.detect(inputUrl);
      if (!detected) return null;
      return {
        sourceTypeKey: options.key,
        displayName: options.displayName,
        confidence: detected.confidence,
        normalizedUrl: detected.normalizedUrl,
        accountName: detected.accountName,
        reasons: detected.reasons,
        requiredSetup: options.setup,
        possibleMetrics: options.supportedMetrics,
        demoAvailable: true,
      };
    },
    async testConnection(ctx) {
      const hasRequired = options.requiredFields?.every((field) => !field.required || ctx.credentials[field.key]);
      return {
        ok: true,
        status: hasRequired ? "demo" : "needs_credentials",
        message: `${options.displayName} is scaffolded for future official API work. Demo mode is available now.`,
        details: { scaffoldOnly: true },
      };
    },
    async sync(ctx) {
      const fetchedAt = new Date().toISOString();
      const payload = {
        connector: options.key,
        mode: "scaffold_demo",
        trigger: ctx.trigger,
        message: `${options.displayName} connector scaffold is ready for official API implementation.`,
      };
      return {
        rawPayloads: [
          {
            externalId: `${options.key}-scaffold-${ctx.source.id}`,
            fetchedAt,
            payload,
            payloadHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
            cursor: { fetchedAt, scaffoldOnly: true },
          },
        ],
        cursorAfter: { fetchedAt, scaffoldOnly: true },
        recordsFetched: 1,
        message: `${options.displayName} scaffold sync recorded.`,
      };
    },
    async normalize(rawPayloads: RawPayload[], source) {
      const today = new Date().toISOString().slice(0, 10);
      return {
        metrics: rawPayloads.flatMap(() =>
          options.supportedMetrics.slice(0, 2).map((metricKey, index) => ({
            date: today,
            sourceId: source.id,
            sourceTypeKey: options.key,
            metricKey,
            metricValue: index === 0 ? 0 : 0,
            unit: metricKey.includes("rate") ? "percent" : "count",
            dimensions: { demo: true, scaffoldOnly: true },
          })),
        ),
      };
    },
    getMetricDefinitions(): MetricDefinition[] {
      return metricDefinitions.filter((metric) => metric.source_type_key === options.key);
    },
    getSetupInstructions() {
      return options.setup;
    },
  };
}

function validUrl(inputUrl: string) {
  try {
    return new URL(inputUrl);
  } catch {
    return null;
  }
}

export const vercelProjectConnector = createFutureConnector({
  key: "vercel_project",
  displayName: "Vercel project",
  description: "Future connector for deployment metadata, build status, deployment counts, and project health.",
  category: "Deployments",
  icon: "Rocket",
  urlPatterns: [/^https:\/\/vercel\.com\/[^/]+\/[^/?#]+/i],
  authType: "vercel_api_token",
  optionalFields: [
    {
      key: "vercel_api_token",
      label: "Vercel API token",
      description: "Future server-only token for deployment metadata.",
      required: false,
      secret: true,
      type: "password",
    },
  ],
  supportedMetrics: ["deployment_count", "latest_deployment_status"],
  detect(inputUrl) {
    const url = validUrl(inputUrl);
    if (!url || url.hostname !== "vercel.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { confidence: 0.94, normalizedUrl: `https://vercel.com/${parts[0]}/${parts[1]}`, reasons: ["Vercel project URL detected."], accountName: parts[1] };
  },
  setup: [
    "This connector is scaffolded for future Vercel project metadata.",
    "Website traffic should use the Website tracking connector, not private Vercel Analytics scraping.",
    "Future setup will use a Vercel API token stored as encrypted server-only credentials.",
  ],
});

export const shopifyConnector = createFutureConnector({
  key: "shopify",
  displayName: "Shopify",
  description: "Future Shopify Admin API connector for orders, sales, refunds, and products.",
  category: "Commerce",
  icon: "ShoppingBag",
  urlPatterns: [/\.myshopify\.com/i, /^https:\/\/admin\.shopify\.com\/store\//i],
  authType: "shopify_admin_api_token",
  requiredFields: [
    {
      key: "admin_api_token",
      label: "Admin API access token",
      description: "Shopify Admin API token with the minimum read scopes needed.",
      required: true,
      secret: true,
      type: "password",
    },
  ],
  supportedMetrics: ["orders", "gross_sales", "current_total", "net_payment", "refunds", "top_products"],
  detect(inputUrl) {
    const url = validUrl(inputUrl);
    if (!url) return null;
    if (url.hostname.endsWith(".myshopify.com")) {
      return { confidence: 0.98, normalizedUrl: url.origin, reasons: [".myshopify.com store URL detected."], accountName: url.hostname.replace(".myshopify.com", "") };
    }
    if (url.hostname === "admin.shopify.com" && url.pathname.startsWith("/store/")) {
      const store = url.pathname.split("/").filter(Boolean)[1];
      return { confidence: 0.98, normalizedUrl: `https://admin.shopify.com/store/${store}`, reasons: ["Shopify admin store URL detected."], accountName: store };
    }
    return null;
  },
  setup: [
    "Shopify is scaffolded only for this MVP because commerce is not operating yet.",
    "Future real sync will use the official Shopify Admin API with a per-source encrypted Admin API token.",
    "Planned metrics: orders, gross_sales, current_total, net_payment, refunds, and top_products.",
  ],
});

export const tiktokConnector = createFutureConnector({
  key: "tiktok",
  displayName: "TikTok",
  description: "Future official TikTok API connector with demo fallback for social content metrics.",
  category: "Content",
  icon: "Video",
  urlPatterns: [/^https:\/\/(www\.)?tiktok\.com\/@/i],
  authType: "tiktok_oauth",
  supportedMetrics: ["video_views", "likes", "comments", "shares", "engagement_rate"],
  detect(inputUrl) {
    const url = validUrl(inputUrl);
    if (!url || !url.hostname.includes("tiktok.com") || !url.pathname.startsWith("/@")) return null;
    return { confidence: 0.96, normalizedUrl: `${url.origin}${url.pathname.split("/").slice(0, 2).join("/")}`, reasons: ["TikTok profile URL detected."], accountName: url.pathname.split("/")[1] };
  },
  setup: [
    "TikTok connector is scaffolded with official API/OAuth structure and demo fallback.",
    "Future metrics: video_views, likes, comments, shares, and engagement_rate.",
  ],
});

export const instagramConnector = createFutureConnector({
  key: "instagram",
  displayName: "Instagram",
  description: "Future Meta/Instagram Graph API connector with demo fallback.",
  category: "Content",
  icon: "Instagram",
  urlPatterns: [/^https:\/\/(www\.)?instagram\.com\/[^/?#]+/i],
  authType: "meta_graph_api",
  supportedMetrics: ["reach", "impressions", "followers", "profile_views", "media_likes", "media_comments", "engagement_rate"],
  detect(inputUrl) {
    const url = validUrl(inputUrl);
    if (!url || !url.hostname.includes("instagram.com")) return null;
    const account = url.pathname.split("/").filter(Boolean)[0];
    if (!account || ["p", "reel", "stories"].includes(account)) return null;
    return { confidence: 0.94, normalizedUrl: `https://www.instagram.com/${account}`, reasons: ["Instagram profile URL detected."], accountName: account };
  },
  setup: [
    "Instagram connector is scaffolded for the Meta/Instagram Graph API.",
    "Future metrics: reach, impressions, followers, profile_views, media_likes, media_comments, and engagement_rate.",
  ],
});

export const customApiConnector = createFutureConnector({
  key: "custom_api",
  displayName: "Custom API",
  description: "Future connector for generic JSON APIs.",
  category: "Custom",
  icon: "Braces",
  urlPatterns: [/^https?:\/\/.+/i],
  authType: "api_key_or_oauth",
  supportedMetrics: [],
  detect() {
    return null;
  },
  setup: ["Custom API support is scaffolded for future JSON API ingestion and mapping."],
});

export const customCsvConnector = createFutureConnector({
  key: "custom_csv",
  displayName: "Custom CSV",
  description: "Future connector for manually uploaded CSV data.",
  category: "Custom",
  icon: "FileSpreadsheet",
  urlPatterns: [/\.csv$/i],
  authType: "manual_upload",
  supportedMetrics: [],
  detect(inputUrl) {
    if (!inputUrl.toLowerCase().endsWith(".csv")) return null;
    return { confidence: 0.72, normalizedUrl: inputUrl, reasons: ["CSV file path or URL detected."] };
  },
  setup: ["Custom CSV support is scaffolded for future upload, mapping, and scheduled import flows."],
});
