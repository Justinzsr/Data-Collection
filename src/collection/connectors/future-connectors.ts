import type { ConnectorDefinition } from "@/collection/connectors/types";
import type { MetricDefinition, SourceTypeKey } from "@/storage/db/schema";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";

interface PlannedConnectorOptions {
  key: SourceTypeKey;
  displayName: string;
  description: string;
  category: string;
  icon: string;
  urlPatterns: RegExp[];
  authType: string;
  supportedMetrics: string[];
  detect: (inputUrl: string) => { confidence: number; normalizedUrl: string; reasons: string[]; accountName?: string | null } | null;
  setup: string[];
}

export function createPlannedConnector(options: PlannedConnectorOptions): ConnectorDefinition {
  return {
    key: options.key,
    displayName: options.displayName,
    description: options.description,
    category: options.category,
    icon: options.icon,
    availability: "planned",
    setupKind: "planned",
    defaultSyncMode: "manual",
    urlPatterns: options.urlPatterns,
    requiredFields: [],
    optionalFields: [],
    authType: options.authType,
    docsUrl: null,
    capabilities: {
      supportsWebhook: false,
      supportsPolling: false,
      supportsManualSync: false,
      recommendedSyncFrequencyMinutes: 0,
      canBackfill: false,
      canTestConnection: false,
    },
    detect(inputUrl) {
      const detected = options.detect(inputUrl);
      if (!detected) return null;
      return {
        sourceTypeKey: options.key,
        displayName: options.displayName,
        availability: "planned",
        setupKind: "planned",
        confidence: detected.confidence,
        normalizedUrl: detected.normalizedUrl,
        accountName: detected.accountName,
        reasons: detected.reasons,
        requiredSetup: options.setup,
        possibleMetrics: options.supportedMetrics,
        demoAvailable: false,
      };
    },
    async testConnection() {
      return {
        ok: false,
        status: "unsupported",
        message: `${options.displayName} is planned and is not available for connection testing or data collection yet.`,
        details: { availability: "planned", collectsData: false },
      };
    },
    async sync() {
      throw new Error(`${options.displayName} is planned and cannot sync data yet.`);
    },
    async normalize() {
      return { metrics: [] };
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

export const vercelProjectConnector = createPlannedConnector({
  key: "vercel_project",
  displayName: "Vercel project",
  description: "Future connector for deployment metadata, build status, deployment counts, and project health.",
  category: "Deployments",
  icon: "Rocket",
  urlPatterns: [/^https:\/\/vercel\.com\/[^/]+\/[^/?#]+/i],
  authType: "vercel_api_token",
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

export const shopifyConnector = createPlannedConnector({
  key: "shopify",
  displayName: "Shopify",
  description: "Future Shopify Admin API connector for orders, sales, refunds, and products.",
  category: "Commerce",
  icon: "ShoppingBag",
  urlPatterns: [/\.myshopify\.com/i, /^https:\/\/admin\.shopify\.com\/store\//i],
  authType: "shopify_admin_api_token",
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

export const customApiConnector = createPlannedConnector({
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

export const customCsvConnector = createPlannedConnector({
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
