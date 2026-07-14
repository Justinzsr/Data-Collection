import type { ConnectorDefinition } from "@/collection/connectors/types";

const setupInstructions = [
  "小红书 / Xiaohongshu is a planned placeholder only. No production connector is available in MoonArq yet.",
  "MoonArq does not collect, test, or sync Xiaohongshu data, and it does not request account credentials for this placeholder.",
  "A future implementation must use an official, authorized API or webhook path. Dashboard scraping and password or cookie collection are not allowed.",
];

function normalizedXiaohongshuUrl(inputUrl: string) {
  try {
    const url = new URL(inputUrl);
    const hostname = url.hostname.toLowerCase();
    const isXiaohongshu = hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
    const isShortLink = hostname === "xhslink.com" || hostname.endsWith(".xhslink.com");
    if (!isXiaohongshu && !isShortLink) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export const xiaohongshuConnector: ConnectorDefinition = {
  key: "xiaohongshu",
  displayName: "小红书 / Xiaohongshu",
  description: "Planned Xiaohongshu connector placeholder. It does not collect data or accept credentials.",
  category: "Content",
  icon: "BookOpen",
  availability: "planned",
  setupKind: "planned",
  defaultSyncMode: "manual",
  urlPatterns: [
    /^https:\/\/([a-z0-9-]+\.)?xiaohongshu\.com(?:\/|$)/i,
    /^https:\/\/([a-z0-9-]+\.)?xhslink\.com(?:\/|$)/i,
  ],
  requiredFields: [],
  optionalFields: [],
  authType: "planned_official_api",
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
    const normalizedUrl = normalizedXiaohongshuUrl(inputUrl);
    if (!normalizedUrl) return null;
    return {
      sourceTypeKey: "xiaohongshu",
      displayName: "小红书 / Xiaohongshu",
      availability: "planned",
      setupKind: "planned",
      confidence: 0.99,
      normalizedUrl,
      reasons: ["Xiaohongshu domain detected. This platform is planned and cannot be connected yet."],
      requiredSetup: setupInstructions,
      possibleMetrics: [],
      demoAvailable: false,
    };
  },
  async testConnection() {
    return {
      ok: false,
      status: "unsupported",
      message: "小红书 / Xiaohongshu is planned and cannot be connection-tested yet.",
      details: { availability: "planned", collectsData: false },
    };
  },
  async sync() {
    throw new Error("小红书 / Xiaohongshu is planned and cannot sync data yet.");
  },
  async normalize() {
    return { metrics: [] };
  },
  getMetricDefinitions() {
    return [];
  },
  getSetupInstructions() {
    return setupInstructions;
  },
};
