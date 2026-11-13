import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";
import type { ConnectorDefinition, NormalizedMetric } from "@/collection/connectors/types";
import {
  CHATGPT_ADS_ATTRIBUTION,
  CHATGPT_ADS_DEFAULT_LOOKBACK_DAYS,
  CHATGPT_ADS_MAX_LOOKBACK_DAYS,
  chatgptAdsDateInTimeZone,
  chatgptAdsNumber,
  fetchChatgptAdsAccount,
  fetchChatgptAdsSnapshot,
  hashChatgptAdsSnapshot,
  isChatgptAdsDate,
  isChatgptAdsSyncSnapshot,
  sanitizeChatgptAdsErrorMessage,
  type ChatgptAdsAccount,
  type ChatgptAdsSyncSnapshot,
} from "@/collection/connectors/chatgpt-ads/api";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { updateSource } from "@/storage/repositories/sources-repository";

export const CHATGPT_ADS_METRIC_KEYS = [
  "chatgpt_ads_spend",
  "chatgpt_ads_impressions",
  "chatgpt_ads_clicks",
  "chatgpt_ads_conversions",
  "chatgpt_ads_click_through_conversions",
  "chatgpt_ads_view_through_conversions",
  "chatgpt_ads_purchase_value",
] as const;

function accountMatches(account: ChatgptAdsAccount, source: Source, credentials: Record<string, string>) {
  for (const expected of [source.external_account_id, credentials.chatgpt_ads_account_id]) {
    if (expected?.trim() && expected.trim() !== account.id) {
      throw new Error("The ChatGPT Ads API key belongs to a different account. Use the key for this source's selected account.");
    }
  }
}

export function chatgptAdsMetricWindow(credentials: Record<string, string>, timezone: string, now = new Date()) {
  const requested = Number(credentials.chatgpt_ads_lookback_days || CHATGPT_ADS_DEFAULT_LOOKBACK_DAYS);
  if (!Number.isInteger(requested) || requested < 1 || requested > CHATGPT_ADS_MAX_LOOKBACK_DAYS) {
    throw new Error("ChatGPT Ads lookback must be a whole number from 1 to 365 days.");
  }
  const endDate = chatgptAdsDateInTimeZone(now, timezone);
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - requested + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

function normalizeSnapshot(snapshot: ChatgptAdsSyncSnapshot, source: Source) {
  const metrics: NormalizedMetric[] = [];
  const dailyMetricKeys = new Set<string>();
  const baseDimensions: JsonRecord = {
    account_id: snapshot.account.id,
    account_currency: snapshot.account.currency_code,
    account_timezone: snapshot.account.timezone,
    rollup: "account_daily",
  };
  const conversionDimensions: JsonRecord = { ...baseDimensions, ...CHATGPT_ADS_ATTRIBUTION, conversion_scope: "campaign_goals" };
  function add(date: string, key: typeof CHATGPT_ADS_METRIC_KEYS[number], value: unknown, unit: string, dimensions: JsonRecord) {
    const number = chatgptAdsNumber(value);
    if (number === null) return;
    if (!isChatgptAdsDate(date) || date < snapshot.windowStartDate || date > snapshot.windowEndDate) {
      throw new Error("ChatGPT Ads returned a metric outside the requested account-local reporting window.");
    }
    const identity = `${date}:${key}`;
    if (dailyMetricKeys.has(identity)) throw new Error("ChatGPT Ads returned duplicate account/day metric rows.");
    dailyMetricKeys.add(identity);
    metrics.push({ date, sourceId: source.id, sourceTypeKey: "chatgpt_ads", metricKey: key, metricValue: number, unit, dimensions });
  }
  for (const row of snapshot.insights) {
    if (row.ad_account_id && row.ad_account_id !== snapshot.account.id) throw new Error("ChatGPT Ads insights returned a different account.");
    if (row.timezone && row.timezone !== snapshot.account.timezone) throw new Error("ChatGPT Ads insights returned a different account time zone.");
    const date = isChatgptAdsDate(row.readable_time)
      ? row.readable_time
      : typeof row.start_time === "number" && Number.isFinite(row.start_time)
        ? chatgptAdsDateInTimeZone(new Date(row.start_time * 1_000), snapshot.account.timezone)
        : "";
    add(date, "chatgpt_ads_spend", row.spend !== undefined ? row.spend : row.ad_account_spend, snapshot.account.currency_code, baseDimensions);
    add(date, "chatgpt_ads_impressions", row.impressions !== undefined ? row.impressions : row.ad_account_impressions, "count", baseDimensions);
    add(date, "chatgpt_ads_clicks", row.clicks !== undefined ? row.clicks : row.ad_account_clicks, "count", baseDimensions);
  }
  if (snapshot.conversionCurrency && snapshot.conversionCurrency !== snapshot.account.currency_code) {
    throw new Error("ChatGPT Ads conversion report currency does not match the account currency.");
  }
  for (const row of snapshot.conversions) {
    if (row.entity_id !== snapshot.account.id) throw new Error("ChatGPT Ads conversion insights returned a different account.");
    const date = row.date ?? "";
    add(date, "chatgpt_ads_conversions", row.conversions, "count", conversionDimensions);
    add(date, "chatgpt_ads_click_through_conversions", row.click_through_conversions, "count", conversionDimensions);
    add(date, "chatgpt_ads_view_through_conversions", row.view_through_conversions, "count", conversionDimensions);
    const currency = row.order_created_attributed_sales_currency || snapshot.conversionCurrency;
    if (chatgptAdsNumber(row.order_created_attributed_sales) !== null) {
      if (!currency || currency !== snapshot.account.currency_code) throw new Error("ChatGPT Ads attributed purchase value has a missing or mismatched currency.");
      add(date, "chatgpt_ads_purchase_value", row.order_created_attributed_sales, currency, {
        ...baseDimensions,
        ...CHATGPT_ADS_ATTRIBUTION,
        purchase_scope: "attributed_order_created_goal_and_non_goal",
      });
    }
  }
  return metrics.sort((left, right) => `${left.date}:${left.metricKey}`.localeCompare(`${right.date}:${right.metricKey}`));
}

export const chatgptAdsConnector: ConnectorDefinition = {
  key: "chatgpt_ads",
  displayName: "ChatGPT Ads",
  description: "Official read-only Advertiser API reporting for daily delivery, spend, attributed goal conversions, and purchase value.",
  category: "Marketing",
  icon: "Megaphone",
  availability: "live",
  setupKind: "credentials",
  defaultSyncMode: "hourly",
  urlPatterns: [/^https:\/\/ads\.openai\.com(?:\/|$)/iu],
  authType: "chatgpt_ads_api_key",
  docsUrl: "https://learn.chatgpt.com/ads/api-overview",
  requiredFields: [{
    key: "chatgpt_ads_api_key",
    label: "ChatGPT Ads API key",
    description: "Account-scoped Advertiser API key from Ads Manager Settings. Encrypted and used only on the server.",
    required: true,
    secret: true,
    type: "password",
  }],
  optionalFields: [
    { key: "chatgpt_ads_account_id", label: "Expected ad account ID", description: "Optional account identity check. The API key itself is scoped to one ad account.", required: false, secret: false, type: "text" },
    { key: "chatgpt_ads_lookback_days", label: "Reporting lookback days", description: "Overlapping account-local daily window, from 1 to 365 days; defaults to 30.", required: false, secret: false, type: "text" },
  ],
  capabilities: { supportsWebhook: false, supportsPolling: true, supportsManualSync: true, recommendedSyncFrequencyMinutes: 60, canBackfill: true, canTestConnection: true },
  detect(inputUrl) {
    try {
      const url = new URL(inputUrl);
      if (url.protocol !== "https:" || url.hostname !== "ads.openai.com" || url.username || url.password || url.port) return null;
      return {
        sourceTypeKey: "chatgpt_ads",
        displayName: this.displayName,
        availability: this.availability,
        setupKind: this.setupKind,
        confidence: 0.99,
        normalizedUrl: "https://ads.openai.com/",
        reasons: ["Official ChatGPT Ads Manager URL detected."],
        requiredSetup: this.getSetupInstructions(),
        possibleMetrics: [...CHATGPT_ADS_METRIC_KEYS],
        demoAvailable: false,
      };
    } catch {
      return null;
    }
  },
  async testConnection(ctx) {
    const apiKey = ctx.credentials.chatgpt_ads_api_key?.trim();
    if (!apiKey) return { ok: false, status: "needs_credentials", message: "Add the account-scoped ChatGPT Ads API key in this source's secure connection settings." };
    try {
      const account = await fetchChatgptAdsAccount(apiKey);
      accountMatches(account, ctx.source, ctx.credentials);
      return {
        ok: true,
        status: "connected",
        message: `ChatGPT Ads reporting connected for ${account.name}.`,
        details: { adAccountId: account.id, accountName: account.name, accountCurrency: account.currency_code, accountTimezone: account.timezone, accountStatus: account.status ?? null },
      };
    } catch (error) {
      return { ok: false, status: "error", message: sanitizeChatgptAdsErrorMessage(error instanceof Error ? error.message : null, apiKey) };
    }
  },
  async sync(ctx) {
    const apiKey = ctx.credentials.chatgpt_ads_api_key?.trim();
    if (!apiKey) throw new Error("ChatGPT Ads API credentials are missing.");
    const account = await fetchChatgptAdsAccount(apiKey);
    accountMatches(account, ctx.source, ctx.credentials);
    if (!ctx.source.external_account_id
      || ctx.source.metadata.account_timezone !== account.timezone
      || ctx.source.metadata.account_currency !== account.currency_code
      || ctx.source.account_name !== account.name) {
      // The shared sync engine holds this source's lease. Pin the first verified
      // identity before reporting so a later credential change cannot mix accounts.
      const bound = await updateSource(ctx.source.id, {
        external_account_id: account.id,
        account_name: account.name,
        metadata: { ...ctx.source.metadata, account_timezone: account.timezone, account_currency: account.currency_code },
      }, { dataSpaceId: ctx.source.data_space_id });
      if (!bound || bound.external_account_id !== account.id) throw new Error("Could not bind the verified ChatGPT Ads account to this source.");
    }
    const window = chatgptAdsMetricWindow(ctx.credentials, account.timezone);
    const fetchedAt = new Date().toISOString();
    const snapshot = await fetchChatgptAdsSnapshot({ apiKey, account, ...window, fetchedAt });
    return {
      rawPayloads: [{ externalId: `chatgpt_ads:${account.id}:${window.startDate}:${window.endDate}`, fetchedAt, payload: snapshot as unknown as JsonRecord, payloadHash: hashChatgptAdsSnapshot(snapshot), cursor: { accountId: account.id, ...window } }],
      cursorAfter: { accountId: account.id, currency: account.currency_code, timeZone: account.timezone, ...window, fetchedAt, conversionStatus: snapshot.conversionStatus },
      recordsFetched: snapshot.insights.length + snapshot.conversions.length,
      message: `Synced ${snapshot.insights.length} ChatGPT Ads account/day delivery row(s) and ${snapshot.conversions.length} goal-conversion row(s). Recent spend and attribution may be revised.`,
    };
  },
  async normalize(rawPayloads, source) {
    const latest = rawPayloads.map((raw) => raw.payload).filter(isChatgptAdsSyncSnapshot).sort((left, right) => left.fetchedAt.localeCompare(right.fetchedAt)).at(-1);
    if (!latest) return { metrics: [] };
    accountMatches(latest.account, source, {});
    return { metrics: normalizeSnapshot(latest, source), replaceMetricWindow: { metricKeys: [...CHATGPT_ADS_METRIC_KEYS], startDate: latest.windowStartDate, endDate: latest.windowEndDate } };
  },
  getMetricDefinitions() {
    return metricDefinitions.filter((definition) => definition.source_type_key === "chatgpt_ads");
  },
  getSetupInstructions() {
    return [
      "Create an account-scoped Advertiser API key in ChatGPT Ads Manager Settings, then enter it in this source's secure connection settings; do not paste it into a URL or chat.",
      "Optionally enter the expected ad account ID to prevent a key for a different account being used by mistake.",
      "MoonArq reads official account metadata, daily delivery insights, and conversion reports. It does not scrape dashboards, create ads, or change budgets.",
      "Credentials remain encrypted and server-only. All sync triggers use the shared sync engine and overlapping daily windows for delayed attribution updates.",
      "Goal conversions use 30-day click and 1-day view attribution on the ad-interaction date. Attributed purchase value includes order_created events and is separate from authoritative Shopify revenue.",
      "Current-day delivery is partial, spend can arrive later, and conversion outcomes update through daily processing. Missing or unavailable values are not recorded as zero.",
    ];
  },
};
