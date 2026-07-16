import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as metaAdsOAuthStartRoute } from "@/app/api/oauth/meta-ads/start/route";
import { GET as instagramOAuthCallbackRoute } from "@/app/api/oauth/instagram/callback/route";
import {
  INSTAGRAM_OAUTH_STATE_COOKIE,
  validateInstagramOAuthState,
} from "@/collection/connectors/instagram/oauth-state";
import { DASHBOARD_SESSION_COOKIE, signDashboardSession } from "@/storage/auth/dashboard-session";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";
import { listCredentialHints } from "@/storage/repositories/credentials-repository";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";

const ORIGINAL_ENV = { ...process.env };
const INSTAGRAM_SOURCE_ID = "7a9fd0cf-aeaf-4857-a871-97ef6bf5e9c0";
const INSTAGRAM_ACCOUNT_ID = "17841470000000001";
const INSTAGRAM_USERNAME = "moonarq.studio";
const FACEBOOK_PAGE_ID = "1020267000000001";
const META_APP_ID = "999999999999999";
const META_APP_SECRET = "meta-app-secret-used-only-in-test-fetch";
const REDIRECT_URI = "https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback";
const SHORT_TOKEN = "test-short-meta-oauth-token";
const LONG_TOKEN = "test-long-meta-oauth-token";

type AdAccount = {
  id: string;
  account_id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
};

const AD_ACCOUNT: AdAccount = {
  id: "act_2865948327088647",
  account_id: "2865948327088647",
  name: "MoonArq Studio",
  account_status: 1,
  currency: "USD",
  timezone_name: "America/Los_Angeles",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function addInstagramSource() {
  const now = "2026-07-15T17:00:00.000Z";
  const source: Source = {
    id: INSTAGRAM_SOURCE_ID,
    data_space_id: DATA_SPACE_IDS.moonarq,
    source_type_key: "instagram",
    display_name: "MoonArq Instagram",
    input_url: "https://www.instagram.com/moonarq.studio/",
    normalized_url: "https://www.instagram.com/moonarq.studio/",
    external_account_id: INSTAGRAM_ACCOUNT_ID,
    account_name: INSTAGRAM_USERNAME,
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
    metadata: {
      oauth_connected: true,
      instagram_account_id: INSTAGRAM_ACCOUNT_ID,
      instagram_username: INSTAGRAM_USERNAME,
      meta_app_profile: "moonarq",
    },
    created_at: now,
    updated_at: now,
  };
  getDemoStore().sources.push(source);
  return source;
}

async function dashboardCookie() {
  const session = await signDashboardSession(process.env.DASHBOARD_SESSION_SECRET!);
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(session)}`;
}

function parseOAuthStart(response: Response) {
  const location = response.headers.get("location") ?? "";
  const state = new URL(location).searchParams.get("state");
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookieValue = decodeURIComponent(
    setCookie.match(new RegExp(`${INSTAGRAM_OAUTH_STATE_COOKIE}=([^;]+)`))?.[1] ?? "",
  );
  return { location, state, cookieValue };
}

function mockMetaOAuthGraphApi(adAccounts: AdAccount[]) {
  const calls: Array<{ url: URL; authorization: string | null }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    const url = new URL(href);
    const authorization = new Headers(init?.headers).get("authorization");
    calls.push({ url, authorization });

    if (url.pathname.endsWith("/oauth/access_token") && url.searchParams.get("grant_type") === "fb_exchange_token") {
      return jsonResponse({ access_token: LONG_TOKEN, token_type: "bearer", expires_in: 5_184_000 });
    }

    if (url.pathname.endsWith("/oauth/access_token") && url.searchParams.get("code")) {
      return jsonResponse({ access_token: SHORT_TOKEN, token_type: "bearer", expires_in: 3_600 });
    }

    if (url.pathname.endsWith("/me/accounts")) {
      return jsonResponse({
        data: [
          {
            id: FACEBOOK_PAGE_ID,
            name: "MoonArq",
            instagram_business_account: {
              id: INSTAGRAM_ACCOUNT_ID,
              username: INSTAGRAM_USERNAME,
              followers_count: 20,
              media_count: 12,
            },
          },
        ],
      });
    }

    if (url.pathname.endsWith("/me/adaccounts")) {
      return jsonResponse({ data: adAccounts });
    }

    throw new Error(`Unexpected Meta Graph API URL: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function startMetaAdsOAuth() {
  return metaAdsOAuthStartRoute(
    new Request(
      `https://app.example.com/api/oauth/meta-ads/start?instagramSourceId=${INSTAGRAM_SOURCE_ID}&dataSpaceSlug=moonarq&returnPath=${encodeURIComponent(`/w/moonarq/dashboard/sources/${INSTAGRAM_SOURCE_ID}`)}`,
      { headers: { cookie: await dashboardCookie() } },
    ),
  );
}

async function completeMetaAdsOAuth(adAccounts: AdAccount[]) {
  const startResponse = await startMetaAdsOAuth();
  const { state, cookieValue } = parseOAuthStart(startResponse);
  mockMetaOAuthGraphApi(adAccounts);
  const sessionCookie = await dashboardCookie();
  const callbackResponse = await instagramOAuthCallbackRoute(
    new Request(
      `https://app.example.com/api/oauth/instagram/callback?code=code-from-meta&state=${encodeURIComponent(state ?? "")}`,
      {
        headers: {
          cookie: `${sessionCookie}; ${INSTAGRAM_OAUTH_STATE_COOKIE}=${encodeURIComponent(cookieValue)}`,
        },
      },
    ),
  );
  return callbackResponse;
}

describe("Meta Ads OAuth", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_ENCRYPTION_KEY: "test-key-32-bytes-long-for-aes!!",
      DASHBOARD_ADMIN_PASSWORD: "dashboard-password-for-tests",
      DASHBOARD_SESSION_SECRET: "session-secret-with-enough-entropy",
      DEV_AUTH_BYPASS: "false",
      DEMO_NOW: "2026-07-15T17:00:00.000Z",
      MOONARQ_META_APP_ID: META_APP_ID,
      MOONARQ_META_APP_SECRET: META_APP_SECRET,
      MOONARQ_META_GRAPH_API_VERSION: "v25.0",
      MOONARQ_META_REDIRECT_URI: REDIRECT_URI,
    };
    delete process.env.DATABASE_URL;
    resetDemoStore();
    addInstagramSource();
    vi.unstubAllGlobals();
  });

  it("requests ads_read and signs a connectMetaAds callback state without exposing secrets", async () => {
    const response = await startMetaAdsOAuth();
    const { location, state, cookieValue } = parseOAuthStart(response);
    const authorizationUrl = new URL(location);

    expect(response.status).toBe(307);
    expect(authorizationUrl.origin).toBe("https://www.facebook.com");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(META_APP_ID);
    expect(authorizationUrl.searchParams.get("scope")?.split(",")).toEqual(
      expect.arrayContaining(["instagram_basic", "instagram_manage_insights", "ads_read"]),
    );
    expect(validateInstagramOAuthState(state, cookieValue)).toMatchObject({
      sourceId: INSTAGRAM_SOURCE_ID,
      dataSpaceSlug: "moonarq",
      returnPath: `/w/moonarq/dashboard/sources/${INSTAGRAM_SOURCE_ID}`,
      metaAppProfile: "moonarq",
      connectMetaAds: true,
    });
    expect(location).not.toContain(META_APP_SECRET);
    expect(location).not.toContain("client_secret");
  });

  it("rejects the MoonArq Story connector in another data space", async () => {
    const autoLabSource = {
      ...getDemoStore().sources.find((source) => source.id === INSTAGRAM_SOURCE_ID)!,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      data_space_id: DATA_SPACE_IDS.autoLab,
      display_name: "Auto Lab Instagram",
    };
    getDemoStore().sources.push(autoLabSource);

    const response = await metaAdsOAuthStartRoute(new Request(
      `https://app.example.com/api/oauth/meta-ads/start?instagramSourceId=${autoLabSource.id}&dataSpaceSlug=auto-lab`,
      { headers: { cookie: await dashboardCookie() } },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("only available") });
  });

  it("reports a cancelled Ads flow as a Meta Ads error without marking Instagram disconnected", async () => {
    const startResponse = await startMetaAdsOAuth();
    const { state, cookieValue } = parseOAuthStart(startResponse);
    const response = await instagramOAuthCallbackRoute(new Request(
      `https://app.example.com/api/oauth/instagram/callback?error=access_denied&state=${encodeURIComponent(state ?? "")}`,
      { headers: { cookie: `${await dashboardCookie()}; ${INSTAGRAM_OAUTH_STATE_COOKIE}=${encodeURIComponent(cookieValue)}` } },
    ));
    const location = response.headers.get("location") ?? "";

    expect(location).toContain("meta_ads_oauth=error");
    expect(location).not.toContain("instagram_oauth=error");
  });

  it("creates a separate healthy Meta Ads source for one available ad account and never persists plaintext tokens", async () => {
    const response = await completeMetaAdsOAuth([AD_ACCOUNT]);
    const location = response.headers.get("location") ?? "";
    const instagramSource = getDemoStore().sources.find((source) => source.id === INSTAGRAM_SOURCE_ID);
    const metaSource = getDemoStore().sources.find(
      (source) => source.source_type_key === "meta_ads" && source.metadata.linked_instagram_source_id === INSTAGRAM_SOURCE_ID,
    );

    expect(response.status).toBe(303);
    expect(location).toContain("instagram_oauth=connected");
    expect(location).toContain("meta_ads_oauth=connected");
    expect(metaSource).toMatchObject({
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "meta_ads",
      status: "healthy",
      external_account_id: AD_ACCOUNT.id,
      account_name: AD_ACCOUNT.name,
      sync_mode: "hourly",
      metadata: {
        linked_instagram_source_id: INSTAGRAM_SOURCE_ID,
        oauth_connected: true,
        selected_ad_account_id: AD_ACCOUNT.id,
        selected_ad_account_name: AD_ACCOUNT.name,
        tracked_utm: {
          utm_source: "instagram",
          utm_medium: "paid_social",
          utm_campaign: "bracelet_grid_jul2026",
          utm_content: "story_v1",
        },
      },
    });
    expect(metaSource?.id).not.toBe(INSTAGRAM_SOURCE_ID);
    expect(instagramSource?.metadata).toMatchObject({
      meta_ads_source_id: metaSource?.id,
      meta_ads_connected: true,
      meta_ads_account_id: AD_ACCOUNT.id,
    });

    const hints = await listCredentialHints(metaSource!.id);
    expect(hints.map((hint) => hint.field_key)).toEqual(
      expect.arrayContaining([
        "meta_ads_access_token",
        "meta_ads_expires_at",
        "meta_ads_graph_api_version",
        "meta_ads_lookback_days",
        "meta_ad_account_id",
      ]),
    );
    const persistedState = JSON.stringify({
      credentials: getDemoStore().credentials,
      sources: getDemoStore().sources,
      events: getDemoStore().connectorEvents,
    });
    expect(persistedState).not.toContain(SHORT_TOKEN);
    expect(persistedState).not.toContain(LONG_TOKEN);
    expect(persistedState).not.toContain(META_APP_SECRET);
    expect(location).not.toContain(SHORT_TOKEN);
    expect(location).not.toContain(LONG_TOKEN);
  });

  it("keeps a multiple-account connection in warning state with sanitized selection candidates", async () => {
    const secondAccount: AdAccount = {
      ...AD_ACCOUNT,
      id: "act_999000111222333",
      account_id: "999000111222333",
      name: "MoonArq Sandbox",
    };
    const response = await completeMetaAdsOAuth([AD_ACCOUNT, secondAccount]);
    const location = response.headers.get("location") ?? "";
    const instagramSource = getDemoStore().sources.find((source) => source.id === INSTAGRAM_SOURCE_ID);
    const metaSource = getDemoStore().sources.find(
      (source) => source.source_type_key === "meta_ads" && source.metadata.linked_instagram_source_id === INSTAGRAM_SOURCE_ID,
    );

    expect(response.status).toBe(303);
    expect(location).toContain("meta_ads_oauth=select_account");
    expect(metaSource).toMatchObject({
      status: "warning",
      external_account_id: null,
      account_name: null,
      metadata: {
        oauth_connected: true,
        linked_instagram_source_id: INSTAGRAM_SOURCE_ID,
        candidate_ad_accounts: [
          expect.objectContaining({ id: AD_ACCOUNT.id, name: AD_ACCOUNT.name, currency: "USD" }),
          expect.objectContaining({ id: secondAccount.id, name: secondAccount.name, currency: "USD" }),
        ],
      },
    });
    expect(metaSource?.metadata.selected_ad_account_id ?? null).toBeNull();
    expect(instagramSource?.metadata).toMatchObject({
      meta_ads_source_id: metaSource?.id,
      meta_ads_connected: false,
      meta_ads_account_id: null,
    });
    const hints = await listCredentialHints(metaSource!.id);
    expect(hints.map((hint) => hint.field_key)).not.toContain("meta_ad_account_id");
    expect(getDemoStore().connectorEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_id: metaSource?.id,
          event_type: "meta_ads_account_selection_required",
          severity: "warning",
          metadata: { accountCount: 2, selectedAccountId: null, sanitized: true },
        }),
      ]),
    );
    expect(JSON.stringify(metaSource)).not.toContain(SHORT_TOKEN);
    expect(JSON.stringify(metaSource)).not.toContain(LONG_TOKEN);
  });

  it("requires the original signed-in browser session for the ads_read callback", async () => {
    const startResponse = await startMetaAdsOAuth();
    const { state } = parseOAuthStart(startResponse);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await instagramOAuthCallbackRoute(
      new Request(
        `https://app.example.com/api/oauth/instagram/callback?code=stolen-code&state=${encodeURIComponent(state ?? "")}`,
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("meta_ads_oauth=error");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDemoStore().sources.some((source) => source.source_type_key === "meta_ads")).toBe(false);
  });

  it("preserves the explicit account selection when reconnecting with multiple available accounts", async () => {
    await completeMetaAdsOAuth([AD_ACCOUNT]);
    const secondAccount: AdAccount = {
      ...AD_ACCOUNT,
      id: "act_999000111222333",
      account_id: "999000111222333",
      name: "MoonArq Sandbox",
    };

    const response = await completeMetaAdsOAuth([secondAccount, AD_ACCOUNT]);
    const metaSources = getDemoStore().sources.filter((source) => source.source_type_key === "meta_ads");
    const metaSource = metaSources[0];

    expect(response.headers.get("location")).toContain("meta_ads_oauth=connected");
    expect(metaSources).toHaveLength(1);
    expect(metaSource).toMatchObject({
      status: "healthy",
      external_account_id: AD_ACCOUNT.id,
      metadata: { selected_ad_account_id: AD_ACCOUNT.id },
    });
    const hints = await listCredentialHints(metaSource!.id);
    expect(hints.map((hint) => hint.field_key)).toContain("meta_ad_account_id");
    expect(hints.map((hint) => hint.field_key)).not.toContain("meta_ads_long_lived_access_token");
  });

  it("does not silently switch accounts when the previously selected account disappears", async () => {
    await completeMetaAdsOAuth([AD_ACCOUNT]);
    const replacementAccount: AdAccount = {
      ...AD_ACCOUNT,
      id: "act_444555666777888",
      account_id: "444555666777888",
      name: "Different business",
    };

    const response = await completeMetaAdsOAuth([replacementAccount]);
    const metaSource = getDemoStore().sources.find((source) => source.source_type_key === "meta_ads");

    expect(response.headers.get("location")).toContain("meta_ads_oauth=select_account");
    expect(metaSource).toMatchObject({ status: "warning", external_account_id: null });
    expect(metaSource?.metadata.selected_ad_account_id ?? null).toBeNull();
    const hints = await listCredentialHints(metaSource!.id);
    expect(hints.map((hint) => hint.field_key)).not.toContain("meta_ad_account_id");
  });
});
