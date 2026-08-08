import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchMetaAdAccounts,
  fetchMetaAdsInsights,
  fetchMetaAdsSnapshot,
  metaAdsActionValue,
  parseMetaAdsUrlTags,
  type MetaAdsSyncSnapshot,
} from "@/collection/connectors/meta-ads/api";
import { META_ADS_METRIC_KEYS, metaAdsConnector } from "@/collection/connectors/meta-ads/connector";
import type { Source } from "@/storage/db/schema";

const ACCESS_TOKEN = "meta-ads-super-secret-token";
const ACCOUNT_ID = "act_2865948327088647";
const SOURCE_ID = "88888888-8888-4888-8888-888888888888";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function source(metadata: Source["metadata"] = {}): Source {
  const now = "2026-07-15T12:00:00.000Z";
  return {
    id: SOURCE_ID,
    data_space_id: "22222222-2222-4222-8222-222222222222",
    source_type_key: "meta_ads",
    display_name: "MoonArq Meta Ads",
    input_url: "https://business.facebook.com/adsmanager/manage/campaigns",
    normalized_url: "https://business.facebook.com/adsmanager/manage/campaigns",
    external_account_id: ACCOUNT_ID,
    account_name: "MoonArq",
    status: "healthy",
    sync_mode: "hourly",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    next_sync_at: null,
    metadata,
    created_at: now,
    updated_at: now,
  };
}

function snapshot(insights: MetaAdsSyncSnapshot["insights"]): MetaAdsSyncSnapshot {
  return {
    kind: "meta_ads_sync_snapshot",
    account: {
      id: ACCOUNT_ID,
      account_id: ACCOUNT_ID.replace("act_", ""),
      name: "MoonArq",
      account_status: 1,
      currency: "USD",
      timezone_name: "America/Los_Angeles",
    },
    ads: [
      {
        id: "ad-1",
        name: "MoonArq_BraceletGrid_Story_PNG_V1",
        status: "ACTIVE",
        effective_status: "ACTIVE",
        campaign: {
          id: "campaign-1",
          name: "MoonArq_IGStory_Traffic_BraceletGrid_Jul2026",
          status: "ACTIVE",
          effective_status: "ACTIVE",
          objective: "OUTCOME_TRAFFIC",
          lifetime_budget: "2500",
        },
        adset: {
          id: "adset-1",
          name: "MoonArq_IGStory_US_Women18-44_5Days",
          status: "ACTIVE",
          effective_status: "ACTIVE",
          lifetime_budget: "2500",
          start_time: "2026-07-15T08:00:00-0700",
          end_time: "2026-07-20T08:00:00-0700",
          optimization_goal: "LANDING_PAGE_VIEWS",
        },
        creative: {
          id: "creative-1",
          name: "First story",
          object_type: "STORY",
          url_tags: "utm_source=instagram&utm_medium=paid_social&utm_campaign=bracelet_grid_jul2026&utm_content=story_v1",
        },
      },
    ],
    insights,
    graphApiVersion: "v25.0",
    windowStartDate: "2026-06-16",
    windowEndDate: "2026-07-15",
    fetchedAt: "2026-07-15T12:00:00.000Z",
  };
}

describe("Meta Ads Graph API", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects Ads Manager URLs without retaining account query parameters", () => {
    expect(metaAdsConnector.detect(`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${ACCOUNT_ID.replace("act_", "")}`)).toMatchObject({
      sourceTypeKey: "meta_ads",
      normalizedUrl: "https://business.facebook.com/adsmanager/manage/campaigns",
      externalAccountId: ACCOUNT_ID,
    });
  });

  it("paginates ad accounts with an Authorization header and strips tokens from paging URLs", async () => {
    const requestedUrls: string[] = [];
    const authorizationHeaders: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      requestedUrls.push(url.toString());
      const headers = new Headers(init?.headers);
      authorizationHeaders.push(headers.get("authorization") ?? "");
      if (!url.searchParams.has("after")) {
        return jsonResponse({
          data: [{ id: ACCOUNT_ID, account_id: ACCOUNT_ID.replace("act_", ""), name: "MoonArq" }],
          paging: {
            next: `https://graph.facebook.com/v25.0/me/adaccounts?after=next-page&access_token=${ACCESS_TOKEN}`,
          },
        });
      }
      return jsonResponse({
        data: [{ id: "act_123", account_id: "123", name: "Second account" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const accounts = await fetchMetaAdAccounts(ACCESS_TOKEN, { graphApiVersion: "v25.0" });

    expect(accounts.map((account) => account.id)).toEqual([ACCOUNT_ID, "act_123"]);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls.every((url) => !url.includes(ACCESS_TOKEN) && !url.includes("access_token="))).toBe(true);
    expect(authorizationHeaders).toEqual([`Bearer ${ACCESS_TOKEN}`, `Bearer ${ACCESS_TOKEN}`]);
  });

  it("parses UTM tags and chooses one preferred action without double counting aliases", () => {
    expect(
      parseMetaAdsUrlTags(
        "?utm_source=instagram&amp;utm_medium=paid_social&utm_campaign=bracelet_grid_jul2026&utm_content=story_v1",
      ),
    ).toEqual({
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "bracelet_grid_jul2026",
      utm_content: "story_v1",
    });
    expect(
      metaAdsActionValue(
        [
          { action_type: "purchase", value: "3" },
          { action_type: "omni_purchase", value: "3" },
        ],
        ["purchase", "omni_purchase"],
      ),
    ).toBe(3);
  });

  it("requests ad-level daily insights over the exact window and paginates safely", async () => {
    const requestedUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
        requestedUrls.push(url);
        if (!url.searchParams.has("after")) {
          return jsonResponse({
            data: [{ ad_id: "ad-1", date_start: "2026-07-14", spend: "1.00" }],
            paging: {
              next: `https://graph.facebook.com/v25.0/${ACCOUNT_ID}/insights?after=cursor&access_token=${ACCESS_TOKEN}`,
            },
          });
        }
        return jsonResponse({ data: [{ ad_id: "ad-1", date_start: "2026-07-15", spend: "2.00" }] });
      }),
    );

    const rows = await fetchMetaAdsInsights(
      ACCESS_TOKEN,
      { graphApiVersion: "v25.0" },
      ACCOUNT_ID,
      "2026-07-14",
      "2026-07-15",
    );

    expect(rows).toHaveLength(2);
    expect(requestedUrls[0]?.searchParams.get("level")).toBe("ad");
    expect(requestedUrls[0]?.searchParams.get("time_increment")).toBe("1");
    expect(requestedUrls[0]?.searchParams.get("time_range")).toBe('{"since":"2026-07-14","until":"2026-07-15"}');
    expect(requestedUrls[0]?.searchParams.get("use_account_attribution_setting")).toBe("true");
    expect(requestedUrls[0]?.searchParams.get("fields")).toContain("website_purchase_roas");
    expect(requestedUrls.every((url) => !url.toString().includes(ACCESS_TOKEN))).toBe(true);
  });

  it("retains scheduled ad metadata and budget when there are no delivered insight rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
        if (url.pathname.endsWith("/ads")) {
          return jsonResponse({
            data: [
              {
                id: "ad-1",
                name: "MoonArq_BraceletGrid_Story_PNG_V1",
                status: "ACTIVE",
                effective_status: "CAMPAIGN_PAUSED",
                campaign: {
                  id: "campaign-1",
                  name: "MoonArq_IGStory_Traffic_BraceletGrid_Jul2026",
                  status: "ACTIVE",
                  effective_status: "ACTIVE",
                  objective: "OUTCOME_TRAFFIC",
                },
                adset: {
                  id: "adset-1",
                  name: "MoonArq_IGStory_US_Women18-44_5Days",
                  status: "ACTIVE",
                  effective_status: "ACTIVE",
                  lifetime_budget: "2500",
                },
                creative: {
                  id: "creative-1",
                  object_type: "STORY",
                  url_tags: "utm_source=instagram&utm_medium=paid_social",
                },
              },
            ],
          });
        }
        if (url.pathname.endsWith("/insights")) return jsonResponse({ data: [] });
        throw new Error(`Unexpected URL ${url.pathname}`);
      }),
    );

    const result = await fetchMetaAdsSnapshot({
      accessToken: ACCESS_TOKEN,
      config: { graphApiVersion: "v25.0" },
      account: { id: ACCOUNT_ID, currency: "USD", timezone_name: "America/Los_Angeles" },
      startDate: "2026-06-16",
      endDate: "2026-07-15",
      fetchedAt: "2026-07-15T12:00:00.000Z",
    });

    expect(result.insights).toEqual([]);
    expect(result.ads[0]).toMatchObject({
      effective_status: "CAMPAIGN_PAUSED",
      campaign: { objective: "OUTCOME_TRAFFIC" },
      adset: { lifetime_budget: "2500" },
      creative: { object_type: "STORY", url_tags: "utm_source=instagram&utm_medium=paid_social" },
    });
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
  });

  it("sanitizes API error messages and never returns access tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              message: `Invalid access_token=${ACCESS_TOKEN}; Authorization: Bearer ${ACCESS_TOKEN}`,
              code: 190,
              type: "OAuthException",
            },
          },
          401,
        ),
      ),
    );

    const result = await metaAdsConnector.testConnection({
      source: source(),
      credentials: { meta_ads_long_lived_access_token: ACCESS_TOKEN, meta_ad_account_id: ACCOUNT_ID },
      isDemoMode: false,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(result.message).toContain("[redacted]");
  });
});

describe("Meta Ads normalization", () => {
  it("normalizes ad/day actions, revenue, UTM, status, and ranking dimensions idempotently", async () => {
    const data = snapshot([
      {
        account_id: ACCOUNT_ID.replace("act_", ""),
        account_name: "MoonArq",
        campaign_id: "campaign-1",
        campaign_name: "MoonArq_IGStory_Traffic_BraceletGrid_Jul2026",
        adset_id: "adset-1",
        adset_name: "MoonArq_IGStory_US_Women18-44_5Days",
        ad_id: "ad-1",
        ad_name: "MoonArq_BraceletGrid_Story_PNG_V1",
        date_start: "2026-07-15",
        date_stop: "2026-07-15",
        attribution_setting: "7d_click_1d_view",
        spend: "12.50",
        impressions: "1000",
        reach: "800",
        frequency: "1.25",
        clicks: "50",
        inline_link_clicks: "40",
        outbound_clicks: [{ action_type: "outbound_click", value: "35" }],
        ctr: "5",
        cpc: "0.25",
        cpm: "12.5",
        actions: [
          { action_type: "landing_page_view", value: "30" },
          { action_type: "view_content", value: "20" },
          { action_type: "add_to_cart", value: "5" },
          { action_type: "initiate_checkout", value: "3" },
          { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
          { action_type: "omni_purchase", value: "2" },
          { action_type: "post_save", value: "7" },
          { action_type: "onsite_conversion.post_save", value: "11" },
          { action_type: "post_reaction", value: "19" },
          { action_type: "comment", value: "4" },
          { action_type: "post_engagement", value: "31" },
        ],
        action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "75" }],
        cost_per_action_type: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "6.25" }],
        purchase_roas: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "6" }],
        website_purchase_roas: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "6" }],
        quality_ranking: "ABOVE_AVERAGE",
        engagement_rate_ranking: "AVERAGE",
        conversion_rate_ranking: "BELOW_AVERAGE_35",
        video_p25_watched_actions: [{ action_type: "video_view", value: "700" }],
        video_p50_watched_actions: [{ action_type: "video_view", value: "600" }],
        video_p75_watched_actions: [{ action_type: "video_view", value: "500" }],
        video_p95_watched_actions: [{ action_type: "video_view", value: "450" }],
        video_p100_watched_actions: [{ action_type: "video_view", value: "400" }],
        video_thruplay_watched_actions: [{ action_type: "video_view", value: "420" }],
      },
    ]);
    const raw = [{ fetchedAt: data.fetchedAt, payload: data as unknown as Record<string, never> }];

    const first = await metaAdsConnector.normalize(raw, source());
    const second = await metaAdsConnector.normalize(raw, source());

    expect(second).toEqual(first);
    expect(first.replaceMetricWindow).toEqual({
      metricKeys: [...META_ADS_METRIC_KEYS],
      startDate: "2026-06-16",
      endDate: "2026-07-15",
    });
    expect(first.metrics.find((metric) => metric.metricKey === "meta_ads_purchases")?.metricValue).toBe(2);
    expect(first.metrics.find((metric) => metric.metricKey === "meta_ads_purchase_value")?.metricValue).toBe(75);
    expect(first.metrics.find((metric) => metric.metricKey === "meta_ads_purchase_roas")?.metricValue).toBe(6);
    expect(first.metrics.find((metric) => metric.metricKey === "meta_ads_post_saves")?.metricValue).toBe(7);
    expect(first.metrics.find((metric) => metric.metricKey === "meta_ads_post_reactions")?.metricValue).toBe(19);
    expect(first.metrics.find((metric) => metric.metricKey === "meta_ads_comments")?.metricValue).toBe(4);
    expect(first.metrics.find((metric) => metric.metricKey === "meta_ads_post_engagements")?.metricValue).toBe(31);
    const dimensions = first.metrics[0]?.dimensions;
    expect(dimensions).toMatchObject({
      account_currency: "USD",
      campaign_id: "campaign-1",
      campaign_name: "MoonArq_IGStory_Traffic_BraceletGrid_Jul2026",
      adset_id: "adset-1",
      adset_name: "MoonArq_IGStory_US_Women18-44_5Days",
      ad_id: "ad-1",
      ad_name: "MoonArq_BraceletGrid_Story_PNG_V1",
      delivery_status: "ACTIVE",
      attribution_setting: "7d_click_1d_view",
      creative_type: "story",
      creative_type_source: "utm_or_name",
      meta_creative_object_type: "STORY",
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "bracelet_grid_jul2026",
      utm_content: "story_v1",
      utm_term: null,
      quality_ranking: "ABOVE_AVERAGE",
    });
  });

  it("never synthesizes creative UTM tags and omits ratio metrics for zero denominators", async () => {
    const data = snapshot([
      {
        campaign_id: "campaign-1",
        adset_id: "adset-1",
        ad_id: "ad-1",
        date_start: "2026-07-15",
        date_stop: "2026-07-15",
        spend: "0",
        impressions: "0",
        reach: "0",
        clicks: "0",
        ctr: "0",
        cpc: "0",
        cpm: "0",
        actions: [],
      },
    ]);
    data.ads[0]!.creative!.url_tags = undefined;
    const trackedUtm = {
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "bracelet_grid_jul2026",
      utm_content: "story_v1",
      utm_term: "bracelet",
    };

    const result = await metaAdsConnector.normalize(
      [{ fetchedAt: data.fetchedAt, payload: data as unknown as Record<string, never> }],
      source({
        tracked_utm: trackedUtm,
        campaign_name: "MoonArq_IGStory_Traffic_BraceletGrid_Jul2026",
      }),
    );
    const keys = result.metrics.map((metric) => metric.metricKey);

    expect(keys).not.toContain("meta_ads_frequency");
    expect(keys).not.toContain("meta_ads_ctr");
    expect(keys).not.toContain("meta_ads_cpc");
    expect(keys).not.toContain("meta_ads_cpm");
    expect(keys).not.toContain("meta_ads_cost_per_purchase");
    expect(keys).not.toContain("meta_ads_purchase_roas");
    expect(keys).not.toContain("meta_ads_website_purchase_roas");
    expect(result.metrics.find((metric) => metric.metricKey === "meta_ads_post_saves")?.metricValue).toBe(0);
    expect(result.metrics.find((metric) => metric.metricKey === "meta_ads_post_reactions")?.metricValue).toBe(0);
    expect(result.metrics.find((metric) => metric.metricKey === "meta_ads_comments")?.metricValue).toBe(0);
    expect(result.metrics.find((metric) => metric.metricKey === "meta_ads_post_engagements")?.metricValue).toBe(0);
    expect(result.metrics[0]?.dimensions).toMatchObject({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
    });
  });

  it("does not assign the tracked Story UTM fallback to a different untagged campaign", async () => {
    const data = snapshot([
      {
        campaign_id: "campaign-2",
        campaign_name: "MoonArq_Future_Campaign",
        adset_id: "adset-2",
        adset_name: "Future ad set",
        ad_id: "ad-2",
        ad_name: "Future creative",
        date_start: "2026-07-15",
        date_stop: "2026-07-15",
        spend: "10",
        impressions: "100",
        reach: "80",
        clicks: "5",
        actions: [],
      },
    ]);
    data.ads = [{
      id: "ad-2",
      name: "Future creative",
      campaign: { id: "campaign-2", name: "MoonArq_Future_Campaign" },
      adset: { id: "adset-2", name: "Future ad set" },
      creative: { id: "creative-2" },
    }];

    const result = await metaAdsConnector.normalize(
      [{ fetchedAt: data.fetchedAt, payload: data as unknown as Record<string, never> }],
      source({
        tracked_utm: {
          utm_source: "instagram",
          utm_medium: "paid_social",
          utm_campaign: "bracelet_grid_jul2026",
          utm_content: "story_v1",
        },
        campaign_name: "MoonArq_IGStory_Traffic_BraceletGrid_Jul2026",
      }),
    );

    expect(result.metrics.find((metric) => metric.metricKey === "meta_ads_spend")?.dimensions).toMatchObject({
      campaign_name: "MoonArq_Future_Campaign",
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
    });
  });

  it("keeps access tokens out of sync snapshots, cursors, messages, and errors", async () => {
    process.env.DEMO_NOW = "2026-07-16T01:00:00.000Z";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
        if (url.pathname.endsWith("/me/adaccounts")) {
          return jsonResponse({ data: [{ id: ACCOUNT_ID, name: "MoonArq", currency: "USD", timezone_name: "America/Los_Angeles" }] });
        }
        if (url.pathname.endsWith("/ads")) return jsonResponse({ data: [] });
        if (url.pathname.endsWith("/insights")) return jsonResponse({ data: [] });
        throw new Error(`Unexpected URL ${url.pathname}`);
      }),
    );

    const result = await metaAdsConnector.sync({
      source: source(),
      credentials: {
        meta_ads_long_lived_access_token: ACCESS_TOKEN,
        meta_ad_account_id: ACCOUNT_ID,
      },
      isDemoMode: false,
      trigger: "manual",
    });

    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(result.rawPayloads[0]?.payload).toMatchObject({
      kind: "meta_ads_sync_snapshot",
      account: { id: ACCOUNT_ID },
      ads: [],
      insights: [],
      windowEndDate: "2026-07-15",
    });
    expect(result.rawPayloads[0]?.cursor).toMatchObject({
      accountId: ACCOUNT_ID,
      accountTimeZone: "America/Los_Angeles",
      endDate: "2026-07-15",
    });
    expect(result.cursorAfter).toMatchObject({
      accountId: ACCOUNT_ID,
      accountTimeZone: "America/Los_Angeles",
      endDate: "2026-07-15",
    });
    delete process.env.DEMO_NOW;
  });
});
