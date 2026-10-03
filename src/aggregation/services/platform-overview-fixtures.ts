import { isRuntimeDatabaseConfigured } from "@/storage/db/client";
import type { MetricDaily, Source } from "@/storage/db/schema";
import { addDaysToDateKey, dateKeyInAppTimeZone, startOfAppDateUtc } from "@/storage/runtime/app-time";

/*
 * Deterministic Meta Ads data for local previews and browser tests. It is only
 * reachable when the e2e fixture flag is on and no database is configured, so a
 * real deployment can never render it.
 */

export function isLocalOverviewFixtureEnabled() {
  return process.env.MOONARQ_OVERVIEW_E2E_FIXTURES === "true" && !isRuntimeDatabaseConfigured();
}

const ACCOUNT_ID = "100000000000001";

const CAMPAIGNS = [
  { id: "fixture-campaign-story", name: "Bracelet Grid Story", status: "ACTIVE", objective: "OUTCOME_TRAFFIC", base: 21, cpm: 9.4, ctr: 1.35, conversion: 0, endsDaysAgo: null },
  { id: "fixture-campaign-reels", name: "Moonlit Studio Reels", status: "ACTIVE", objective: "OUTCOME_SALES", base: 34, cpm: 12.8, ctr: 1.05, conversion: 0.028, endsDaysAgo: null },
  { id: "fixture-campaign-retargeting", name: "Spring Retargeting", status: "PAUSED", objective: "OUTCOME_SALES", base: 15, cpm: 15.5, ctr: 1.6, conversion: 0.041, endsDaysAgo: 19 },
] as const;

function wave(seed: number) {
  return (Math.sin(seed * 1.7) + Math.sin(seed * 0.43 + 1.1)) / 2;
}

function row(sourceId: string, date: string, metricKey: string, value: number, unit: string, dimensions: MetricDaily["dimensions"], updatedAt: string): MetricDaily {
  return {
    id: `${sourceId}:${date}:${String(dimensions.campaign_id)}:${metricKey}`,
    date,
    source_id: sourceId,
    source_type_key: "meta_ads",
    metric_key: metricKey,
    metric_value: Math.round(value * 100) / 100,
    unit,
    dimensions,
    dimensions_hash: `${String(dimensions.campaign_id)}:fixture`,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

export function paidAdsFixture(input: { dataSpaceId: string; now: Date }): { source: Source; rows: MetricDaily[] } {
  const { now } = input;
  const sourceId = "00000000-0000-4000-8000-00000000ad01";
  const today = dateKeyInAppTimeZone(now);
  // Synced 12 minutes ago, but never before today's midnight, so today's delivery is always known.
  const lastSuccess = new Date(Math.max(now.getTime() - 12 * 60_000, Date.parse(startOfAppDateUtc(today)))).toISOString();
  const nextSync = new Date(Math.ceil((now.getTime() + 1) / 3_600_000) * 3_600_000).toISOString();
  const rows: MetricDaily[] = [];
  for (let offset = 59; offset >= 0; offset -= 1) {
    const date = addDaysToDateKey(today, -offset);
    // Today is still in progress: about half a day of delivery so far.
    const dayShare = offset === 0 ? 0.46 : 1;
    CAMPAIGNS.forEach((campaign, index) => {
      if (campaign.endsDaysAgo !== null && offset < campaign.endsDaysAgo) return;
      const seed = offset * 3 + index * 11;
      const growth = 1 + (59 - offset) * 0.004;
      const spend = campaign.base * growth * (1 + wave(seed) * 0.22) * dayShare;
      const impressions = (spend / campaign.cpm) * 1_000;
      const linkClicks = impressions * (campaign.ctr / 100) * (1 + wave(seed + 5) * 0.12);
      const purchases = Math.round(linkClicks * campaign.conversion * (1 + wave(seed + 9) * 0.5));
      const dimensions = {
        rollup: "ad_daily",
        definition_version: "meta-ads-v1",
        account_id: ACCOUNT_ID,
        account_name: "MoonArq Ads",
        account_currency: "USD",
        account_timezone: "America/Los_Angeles",
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        campaign_status: campaign.status,
        campaign_objective: campaign.objective,
        ad_id: `${campaign.id}-ad`,
        delivery_status: campaign.status,
        fixture: true,
      };
      rows.push(
        row(sourceId, date, "meta_ads_spend", spend, "usd", dimensions, lastSuccess),
        row(sourceId, date, "meta_ads_impressions", Math.round(impressions), "count", dimensions, lastSuccess),
        row(sourceId, date, "meta_ads_clicks", Math.round(linkClicks * 1.6), "count", dimensions, lastSuccess),
        row(sourceId, date, "meta_ads_inline_link_clicks", Math.round(linkClicks), "count", dimensions, lastSuccess),
        row(sourceId, date, "meta_ads_outbound_clicks", Math.round(linkClicks * 0.92), "count", dimensions, lastSuccess),
        row(sourceId, date, "meta_ads_landing_page_views", Math.round(linkClicks * 0.71), "count", dimensions, lastSuccess),
        row(sourceId, date, "meta_ads_purchases", purchases, "count", dimensions, lastSuccess),
        row(sourceId, date, "meta_ads_purchase_value", purchases * 64, "usd", dimensions, lastSuccess),
      );
    });
  }
  const source: Source = {
    id: sourceId,
    data_space_id: input.dataSpaceId,
    source_type_key: "meta_ads",
    display_name: "Meta Ads (local fixture)",
    input_url: null,
    normalized_url: null,
    external_account_id: `act_${ACCOUNT_ID}`,
    account_name: "MoonArq Ads",
    status: "healthy",
    sync_mode: "hourly",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: lastSuccess,
    last_webhook_sync_at: null,
    last_success_at: lastSuccess,
    last_error_at: null,
    last_error: null,
    next_sync_at: nextSync,
    metadata: {
      demo: true,
      fixture: true,
      oauth_connected: true,
      selected_ad_account_id: ACCOUNT_ID,
      account_currency: "USD",
      account_timezone: "America/Los_Angeles",
      token_expires_at: new Date(now.getTime() + 50 * 86_400_000).toISOString(),
    },
    created_at: lastSuccess,
    updated_at: lastSuccess,
  };
  return { source, rows };
}
