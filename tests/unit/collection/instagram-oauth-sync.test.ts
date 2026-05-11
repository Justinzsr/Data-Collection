import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDailyReport, dailyReportToExcelXml } from "@/aggregation/services/daily-report-service";
import { getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { enqueueSyncRun } from "@/collection/sync/engine";
import {
  AUTO_LAB_INSTAGRAM_ACCOUNT_ID,
  AUTO_LAB_INSTAGRAM_SOURCE_ID,
  AUTO_LAB_INSTAGRAM_USERNAME,
  AUTO_LAB_FACEBOOK_PAGE_ID,
} from "@/collection/connectors/instagram/constants";
import {
  createInstagramOAuthState,
  INSTAGRAM_OAUTH_STATE_COOKIE,
  INSTAGRAM_OAUTH_STATE_MAX_AGE_SECONDS,
  validateInstagramOAuthState,
} from "@/collection/connectors/instagram/oauth-state";
import { GET as instagramOAuthStartRoute } from "@/app/api/oauth/instagram/start/route";
import { GET as instagramOAuthCallbackRoute } from "@/app/api/oauth/instagram/callback/route";
import { POST as testSourceRoute } from "@/app/api/sources/[id]/test/route";
import { DASHBOARD_SESSION_COOKIE, signDashboardSession } from "@/storage/auth/dashboard-session";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { listCredentialHints, saveCredential } from "@/storage/repositories/credentials-repository";
import { listDataSpaces } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";

const ORIGINAL_ENV = { ...process.env };
const META_APP_ID = "1287137936945850";
const META_SECRET = "meta-secret-for-tests";
const MOONARQ_META_APP_ID = "999999999999999";
const MOONARQ_META_SECRET = "moonarq-meta-secret-for-tests";
const REDIRECT_URI = "https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback";
const MEDIA_ID = "18112617760837714";
const MOONARQ_INSTAGRAM_SOURCE_ID = "77777777-7777-4777-8777-777777777777";
const MOONARQ_INSTAGRAM_ACCOUNT_ID = "17841470000000001";
const MOONARQ_INSTAGRAM_USERNAME = "moonarqstudio";
const MOONARQ_FACEBOOK_PAGE_ID = "1020267000000001";
const LONG_CREDENTIAL_VALUE = "test-long-credential-value";
const SHORT_CREDENTIAL_VALUE = "test-short-credential-value";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function addAutoLabInstagramSource(patch: Partial<Source> = {}) {
  const now = "2026-04-22T16:00:00.000Z";
  const source: Source = {
    id: AUTO_LAB_INSTAGRAM_SOURCE_ID,
    data_space_id: DATA_SPACE_IDS.autoLab,
    source_type_key: "instagram",
    display_name: "Auto Lab Instagram",
    input_url: "https://www.instagram.com/just.4is",
    normalized_url: "https://www.instagram.com/just.4is",
    external_account_id: null,
    account_name: "just.4is",
    status: "needs_credentials",
    sync_mode: "manual",
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
      scaffoldOnly: true,
      intended_use: "personal_car_content_testing",
    },
    created_at: now,
    updated_at: now,
    ...patch,
  };
  getDemoStore().sources.push(source);
  return source;
}

function addMoonArqInstagramSource(patch: Partial<Source> = {}) {
  const now = "2026-04-22T16:00:00.000Z";
  const source: Source = {
    id: MOONARQ_INSTAGRAM_SOURCE_ID,
    data_space_id: DATA_SPACE_IDS.moonarq,
    source_type_key: "instagram",
    display_name: "MoonArq Instagram",
    input_url: "https://www.instagram.com/moonarqstudio",
    normalized_url: "https://www.instagram.com/moonarqstudio",
    external_account_id: null,
    account_name: null,
    status: "needs_credentials",
    sync_mode: "manual",
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
      scaffoldOnly: true,
    },
    created_at: now,
    updated_at: now,
    ...patch,
  };
  getDemoStore().sources.push(source);
  return source;
}

async function dashboardCookie() {
  const session = await signDashboardSession(process.env.DASHBOARD_SESSION_SECRET!);
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(session)}`;
}

function oauthStateCookie(state: string) {
  return `${INSTAGRAM_OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}`;
}

function tamperState(state: string) {
  return `${state.slice(0, -1)}${state.endsWith("a") ? "b" : "a"}`;
}

function mockInstagramGraphApi(options: { insights?: "success" | "fallback"; username?: string; accountId?: string; pageId?: string; followers?: number; mediaCount?: number; mediaId?: string } = {}) {
  const insights = options.insights ?? "success";
  const username = options.username ?? AUTO_LAB_INSTAGRAM_USERNAME;
  const accountId = options.accountId ?? AUTO_LAB_INSTAGRAM_ACCOUNT_ID;
  const pageId = options.pageId ?? AUTO_LAB_FACEBOOK_PAGE_ID;
  const followers = options.followers ?? 428;
  const mediaCount = options.mediaCount ?? 17;
  const mediaId = options.mediaId ?? MEDIA_ID;
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const href = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    const url = new URL(href);
    calls.push(url.toString());

    if (url.pathname.endsWith("/oauth/access_token") && url.searchParams.get("grant_type") === "fb_exchange_token") {
      return jsonResponse({ access_token: LONG_CREDENTIAL_VALUE, token_type: "bearer", expires_in: 5_184_000 });
    }

    if (url.pathname.endsWith("/oauth/access_token") && url.searchParams.get("code")) {
      return jsonResponse({ access_token: SHORT_CREDENTIAL_VALUE, token_type: "bearer", expires_in: 3_600 });
    }

    if (url.pathname.endsWith("/me/accounts")) {
      return jsonResponse({
        data: [
          {
            id: pageId,
            name: "Auto Lab IS350",
            instagram_business_account: {
              id: accountId,
              username,
              followers_count: followers,
              media_count: mediaCount,
            },
          },
        ],
      });
    }

    if (url.pathname.endsWith(`/${accountId}`)) {
      return jsonResponse({
        id: accountId,
        username,
        followers_count: followers,
        media_count: mediaCount,
      });
    }

    if (url.pathname.endsWith(`/${accountId}/media`)) {
      return jsonResponse({
        data: [
          {
            id: mediaId,
            caption: "First shakedown clip for the Auto Lab IS350.",
            media_type: "VIDEO",
            media_url: "https://example.com/media.mp4",
            permalink: "https://www.instagram.com/p/test-media/",
            timestamp: "2026-04-22T12:00:00+0000",
            like_count: 27,
            comments_count: 3,
          },
        ],
      });
    }

    if (url.pathname.endsWith(`/${mediaId}/insights`)) {
      const metric = url.searchParams.get("metric");
      if (insights === "fallback" && metric === "reach,saved,total_interactions") {
        return jsonResponse({ error: { message: "Unsupported metric for this media type.", code: 100 } }, 400);
      }
      if (insights === "fallback" && metric === "total_interactions") {
        return jsonResponse({ error: { message: "Unsupported metric for this media type.", code: 100 } }, 400);
      }
      const values: Record<string, number> = {
        reach: 100,
        saved: 0,
        total_interactions: 30,
      };
      const metricNames = (metric ?? "").split(",").filter(Boolean);
      return jsonResponse({
        data: metricNames.map((name) => ({
          name,
          values: [{ value: values[name] ?? 0 }],
        })),
      });
    }

    throw new Error(`Unexpected Instagram Graph API URL: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function saveInstagramCredentials() {
  await saveInstagramCredentialsForSource(AUTO_LAB_INSTAGRAM_SOURCE_ID, AUTO_LAB_INSTAGRAM_ACCOUNT_ID, AUTO_LAB_INSTAGRAM_USERNAME);
}

async function saveInstagramCredentialsForSource(sourceId: string, accountId: string, username: string) {
  await saveCredential(sourceId, "instagram_long_lived_access_token", LONG_CREDENTIAL_VALUE);
  await saveCredential(sourceId, "instagram_account_id", accountId);
  await saveCredential(sourceId, "instagram_username", username);
  await saveCredential(sourceId, "expires_at", "2026-12-31T00:00:00.000Z");
}

describe("Auto Lab Instagram OAuth and sync", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_ENCRYPTION_KEY: "test-key-32-bytes-long-for-aes!!",
      DASHBOARD_ADMIN_PASSWORD: "dashboard-password-for-tests",
      DASHBOARD_SESSION_SECRET: "session-secret-with-enough-entropy",
      DEV_AUTH_BYPASS: "false",
      DEMO_NOW: "2026-04-22T16:00:00.000Z",
      META_APP_ID,
      META_APP_SECRET: META_SECRET,
      META_GRAPH_API_VERSION: "v25.0",
      META_REDIRECT_URI: REDIRECT_URI,
      MOONARQ_META_APP_ID,
      MOONARQ_META_APP_SECRET: MOONARQ_META_SECRET,
      MOONARQ_META_GRAPH_API_VERSION: "v25.0",
      MOONARQ_META_REDIRECT_URI: REDIRECT_URI,
    };
    delete process.env.DATABASE_URL;
    resetDemoStore();
    vi.unstubAllGlobals();
  });

  it("builds the Meta authorization URL without exposing secrets", async () => {
    addAutoLabInstagramSource();
    const response = await instagramOAuthStartRoute(
      new Request(`https://app.example.com/api/oauth/instagram/start?sourceId=${AUTO_LAB_INSTAGRAM_SOURCE_ID}&dataSpaceSlug=auto-lab&returnPath=${encodeURIComponent(`/w/auto-lab/dashboard/sources/${AUTO_LAB_INSTAGRAM_SOURCE_ID}`)}`, {
        headers: { cookie: await dashboardCookie() },
      }),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("https://www.facebook.com/v25.0/dialog/oauth");
    expect(location).toContain(`client_id=${META_APP_ID}`);
    expect(location).not.toContain(`client_id=${MOONARQ_META_APP_ID}`);
    expect(decodeURIComponent(location)).toContain("instagram_basic");
    expect(decodeURIComponent(location)).toContain("instagram_manage_insights");
    expect(location).not.toContain(META_SECRET);
    expect(location).not.toContain("client_secret");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(INSTAGRAM_OAUTH_STATE_COOKIE);
    const cookieValue = decodeURIComponent(setCookie.match(new RegExp(`${INSTAGRAM_OAUTH_STATE_COOKIE}=([^;]+)`))?.[1] ?? "");
    const state = new URL(location).searchParams.get("state");
    expect(validateInstagramOAuthState(state, cookieValue)).toMatchObject({
      sourceId: AUTO_LAB_INSTAGRAM_SOURCE_ID,
      dataSpaceSlug: "auto-lab",
      returnPath: `/w/auto-lab/dashboard/sources/${AUTO_LAB_INSTAGRAM_SOURCE_ID}`,
      metaAppProfile: "default",
    });
  });

  it("uses the MoonArq Meta app profile for MoonArq Instagram OAuth start", async () => {
    addMoonArqInstagramSource();
    const response = await instagramOAuthStartRoute(
      new Request(`https://app.example.com/api/oauth/instagram/start?sourceId=${MOONARQ_INSTAGRAM_SOURCE_ID}&dataSpaceSlug=moonarq&returnPath=${encodeURIComponent(`/w/moonarq/dashboard/sources/${MOONARQ_INSTAGRAM_SOURCE_ID}`)}`, {
        headers: { cookie: await dashboardCookie() },
      }),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain(`client_id=${MOONARQ_META_APP_ID}`);
    expect(location).not.toContain(MOONARQ_META_SECRET);
    expect(location).not.toContain(META_SECRET);
    const setCookie = response.headers.get("set-cookie") ?? "";
    const cookieValue = decodeURIComponent(setCookie.match(new RegExp(`${INSTAGRAM_OAUTH_STATE_COOKIE}=([^;]+)`))?.[1] ?? "");
    const state = new URL(location).searchParams.get("state");
    expect(validateInstagramOAuthState(state, cookieValue)).toMatchObject({
      sourceId: MOONARQ_INSTAGRAM_SOURCE_ID,
      dataSpaceSlug: "moonarq",
      returnPath: `/w/moonarq/dashboard/sources/${MOONARQ_INSTAGRAM_SOURCE_ID}`,
      metaAppProfile: "moonarq",
    });
  });

  it("returns a sanitized setup error when Meta environment variables are missing", async () => {
    addAutoLabInstagramSource();
    delete process.env.META_APP_SECRET;
    const response = await instagramOAuthStartRoute(
      new Request(`https://app.example.com/api/oauth/instagram/start?sourceId=${AUTO_LAB_INSTAGRAM_SOURCE_ID}`, {
        headers: { cookie: await dashboardCookie() },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain("META_APP_SECRET");
    expect(JSON.stringify(body)).not.toContain(META_SECRET);
  });

  it("returns a sanitized setup error when MoonArq Meta app env vars are incomplete", async () => {
    addMoonArqInstagramSource();
    delete process.env.MOONARQ_META_APP_SECRET;
    const response = await instagramOAuthStartRoute(
      new Request(`https://app.example.com/api/oauth/instagram/start?sourceId=${MOONARQ_INSTAGRAM_SOURCE_ID}&dataSpaceSlug=moonarq`, {
        headers: { cookie: await dashboardCookie() },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain("MOONARQ_META_APP_SECRET");
    expect(JSON.stringify(body)).not.toContain(MOONARQ_META_SECRET);
    expect(JSON.stringify(body)).not.toContain(META_SECRET);
  });

  it("validates callback state and rejects cross-space Instagram sources", async () => {
    addMoonArqInstagramSource();
    const state = createInstagramOAuthState({
      sourceId: MOONARQ_INSTAGRAM_SOURCE_ID,
      dataSpaceSlug: "auto-lab",
      returnPath: `/w/auto-lab/dashboard/sources/${MOONARQ_INSTAGRAM_SOURCE_ID}`,
    });
    const response = await instagramOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/instagram/callback?code=code-from-meta&state=${encodeURIComponent(state)}`, {
        headers: { cookie: oauthStateCookie(state) },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("requested data space");
  });

  it("rejects Instagram OAuth callback state with an invalid signature", async () => {
    addMoonArqInstagramSource();
    const state = createInstagramOAuthState({
      sourceId: MOONARQ_INSTAGRAM_SOURCE_ID,
      dataSpaceSlug: "moonarq",
      returnPath: `/w/moonarq/dashboard/sources/${MOONARQ_INSTAGRAM_SOURCE_ID}`,
      metaAppProfile: "moonarq",
    });
    const response = await instagramOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/instagram/callback?code=code-from-meta&state=${encodeURIComponent(tamperState(state))}`),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid Instagram OAuth state");
  });

  it("rejects expired Instagram OAuth callback state", async () => {
    addMoonArqInstagramSource();
    const expiredState = createInstagramOAuthState(
      {
        sourceId: MOONARQ_INSTAGRAM_SOURCE_ID,
        dataSpaceSlug: "moonarq",
        returnPath: `/w/moonarq/dashboard/sources/${MOONARQ_INSTAGRAM_SOURCE_ID}`,
        metaAppProfile: "moonarq",
      },
      process.env,
      Date.now() - (INSTAGRAM_OAUTH_STATE_MAX_AGE_SECONDS + 5) * 1000,
    );
    const response = await instagramOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/instagram/callback?code=code-from-meta&state=${encodeURIComponent(expiredState)}`),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Instagram OAuth state expired");
  });

  it("stores OAuth credentials encrypted and redirects back to the Auto Lab source", async () => {
    addAutoLabInstagramSource();
    const { calls } = mockInstagramGraphApi();
    const state = createInstagramOAuthState(AUTO_LAB_INSTAGRAM_SOURCE_ID);
    const response = await instagramOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/instagram/callback?code=code-from-meta&state=${encodeURIComponent(state)}`, {
        headers: { cookie: oauthStateCookie(state) },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(`/w/auto-lab/dashboard/sources/${AUTO_LAB_INSTAGRAM_SOURCE_ID}`);
    expect(calls.some((call) => call.includes("/oauth/access_token"))).toBe(true);

    const source = getDemoStore().sources.find((item) => item.id === AUTO_LAB_INSTAGRAM_SOURCE_ID);
    expect(source).toMatchObject({
      data_space_id: DATA_SPACE_IDS.autoLab,
      source_type_key: "instagram",
      status: "healthy",
      external_account_id: AUTO_LAB_INSTAGRAM_ACCOUNT_ID,
      account_name: AUTO_LAB_INSTAGRAM_USERNAME,
    });
    expect(source?.metadata).toMatchObject({
      oauth_connected: true,
      instagram_account_id: AUTO_LAB_INSTAGRAM_ACCOUNT_ID,
      instagram_username: AUTO_LAB_INSTAGRAM_USERNAME,
      page_id: AUTO_LAB_FACEBOOK_PAGE_ID,
      graph_api_version: "v25.0",
      meta_app_profile: "default",
    });

    const hints = await listCredentialHints(AUTO_LAB_INSTAGRAM_SOURCE_ID);
    expect(hints.map((hint) => hint.field_key)).toEqual(
      expect.arrayContaining([
        "instagram_access_token",
        "instagram_long_lived_access_token",
        "instagram_account_id",
        "instagram_username",
        "expires_at",
      ]),
    );
    const credentialStore = JSON.stringify(getDemoStore().credentials);
    expect(credentialStore).not.toContain(LONG_CREDENTIAL_VALUE);
    expect(credentialStore).not.toContain(SHORT_CREDENTIAL_VALUE);
  });

  it("discovers and stores MoonArq Instagram account metadata for a MoonArq source", async () => {
    addMoonArqInstagramSource();
    const { calls } = mockInstagramGraphApi({
      username: MOONARQ_INSTAGRAM_USERNAME,
      accountId: MOONARQ_INSTAGRAM_ACCOUNT_ID,
      pageId: MOONARQ_FACEBOOK_PAGE_ID,
      followers: 1200,
      mediaCount: 44,
    });
    const state = createInstagramOAuthState({
      sourceId: MOONARQ_INSTAGRAM_SOURCE_ID,
      dataSpaceSlug: "moonarq",
      returnPath: `/w/moonarq/dashboard/sources/${MOONARQ_INSTAGRAM_SOURCE_ID}`,
      metaAppProfile: "moonarq",
    });
    const response = await instagramOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/instagram/callback?code=code-from-meta&state=${encodeURIComponent(state)}`, {
        headers: { cookie: oauthStateCookie(state) },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(`/w/moonarq/dashboard/sources/${MOONARQ_INSTAGRAM_SOURCE_ID}`);
    expect(calls.some((call) => call.includes("/me/accounts"))).toBe(true);
    const tokenCalls = calls.filter((call) => call.includes("/oauth/access_token"));
    expect(tokenCalls.every((call) => new URL(call).searchParams.get("client_id") === MOONARQ_META_APP_ID)).toBe(true);
    expect(tokenCalls.every((call) => new URL(call).searchParams.get("client_secret") === MOONARQ_META_SECRET)).toBe(true);

    const source = getDemoStore().sources.find((item) => item.id === MOONARQ_INSTAGRAM_SOURCE_ID);
    expect(source).toMatchObject({
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "instagram",
      status: "healthy",
      external_account_id: MOONARQ_INSTAGRAM_ACCOUNT_ID,
      account_name: MOONARQ_INSTAGRAM_USERNAME,
    });
    expect(source?.metadata).toMatchObject({
      scaffoldOnly: false,
      oauth_connected: true,
      instagram_account_id: MOONARQ_INSTAGRAM_ACCOUNT_ID,
      instagram_username: MOONARQ_INSTAGRAM_USERNAME,
      page_id: MOONARQ_FACEBOOK_PAGE_ID,
      graph_api_version: "v25.0",
      meta_app_profile: "moonarq",
    });
    const autoLabHints = await listCredentialHints(AUTO_LAB_INSTAGRAM_SOURCE_ID);
    const moonarqHints = await listCredentialHints(MOONARQ_INSTAGRAM_SOURCE_ID);
    expect(autoLabHints).toHaveLength(0);
    expect(moonarqHints.map((hint) => hint.field_key)).toEqual(expect.arrayContaining(["instagram_long_lived_access_token", "instagram_account_id"]));
  });

  it("accepts valid signed callback state when the state cookie is missing and records a warning", async () => {
    addMoonArqInstagramSource();
    mockInstagramGraphApi({
      username: MOONARQ_INSTAGRAM_USERNAME,
      accountId: MOONARQ_INSTAGRAM_ACCOUNT_ID,
      pageId: MOONARQ_FACEBOOK_PAGE_ID,
    });
    const state = createInstagramOAuthState({
      sourceId: MOONARQ_INSTAGRAM_SOURCE_ID,
      dataSpaceSlug: "moonarq",
      returnPath: `/w/moonarq/dashboard/sources/${MOONARQ_INSTAGRAM_SOURCE_ID}`,
      metaAppProfile: "moonarq",
    });
    const response = await instagramOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/instagram/callback?code=code-from-meta&state=${encodeURIComponent(state)}`),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(`/w/moonarq/dashboard/sources/${MOONARQ_INSTAGRAM_SOURCE_ID}`);
    expect(response.headers.get("location")).toContain("instagram_oauth=connected");
    const source = getDemoStore().sources.find((item) => item.id === MOONARQ_INSTAGRAM_SOURCE_ID);
    expect(source).toMatchObject({
      data_space_id: DATA_SPACE_IDS.moonarq,
      status: "healthy",
      external_account_id: MOONARQ_INSTAGRAM_ACCOUNT_ID,
      account_name: MOONARQ_INSTAGRAM_USERNAME,
    });
    expect(getDemoStore().connectorEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_id: MOONARQ_INSTAGRAM_SOURCE_ID,
          event_type: "instagram_oauth_state_cookie_missing",
          severity: "warning",
        }),
      ]),
    );
  });

  it("keeps Auto Lab account enforcement when reconnecting", async () => {
    addAutoLabInstagramSource();
    mockInstagramGraphApi({ username: "wrong-account", accountId: "17841470000000999" });
    const state = createInstagramOAuthState(AUTO_LAB_INSTAGRAM_SOURCE_ID);
    const response = await instagramOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/instagram/callback?code=code-from-meta&state=${encodeURIComponent(state)}`, {
        headers: { cookie: oauthStateCookie(state) },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("instagram_oauth=error");
    const source = getDemoStore().sources.find((item) => item.id === AUTO_LAB_INSTAGRAM_SOURCE_ID);
    expect(source?.status).toBe("needs_credentials");
    expect(source?.external_account_id).toBeNull();
    expect(getDemoStore().connectorEvents.some((event) => event.source_id === AUTO_LAB_INSTAGRAM_SOURCE_ID && event.event_type === "instagram_oauth_error")).toBe(true);
  });

  it("runs a real sanitized Test Connection against the mocked Graph API", async () => {
    addAutoLabInstagramSource();
    await saveInstagramCredentials();
    mockInstagramGraphApi();

    const response = await testSourceRoute(
      new Request(`https://app.example.com/api/sources/${AUTO_LAB_INSTAGRAM_SOURCE_ID}/test?dataSpaceSlug=auto-lab`, { method: "POST" }),
      { params: Promise.resolve({ id: AUTO_LAB_INSTAGRAM_SOURCE_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({
      ok: true,
      status: "connected",
      details: {
        instagramAccountId: AUTO_LAB_INSTAGRAM_ACCOUNT_ID,
        username: AUTO_LAB_INSTAGRAM_USERNAME,
        followersCount: 428,
        mediaCount: 17,
      },
    });
    expect(JSON.stringify(body)).not.toContain(LONG_CREDENTIAL_VALUE);
    expect(JSON.stringify(body)).not.toContain(SHORT_CREDENTIAL_VALUE);
  });

  it("normalizes manual sync data, records insight fallbacks, and keeps MoonArq isolated", async () => {
    const moonarqSourcesBefore = await listSources({ dataSpaceId: DATA_SPACE_IDS.moonarq });
    addAutoLabInstagramSource({ status: "healthy" });
    await saveInstagramCredentials();
    mockInstagramGraphApi({ insights: "fallback" });

    const run = await enqueueSyncRun({ sourceId: AUTO_LAB_INSTAGRAM_SOURCE_ID, trigger: "manual" });
    const store = getDemoStore();
    const autoLabMetrics = store.metricsDaily.filter((metric) => metric.source_id === AUTO_LAB_INSTAGRAM_SOURCE_ID);
    const metricKeys = autoLabMetrics.map((metric) => metric.metric_key);

    expect(run.status).toBe("success");
    expect(store.rawIngestions.some((ingestion) => ingestion.source_id === AUTO_LAB_INSTAGRAM_SOURCE_ID)).toBe(true);
    expect(metricKeys).toEqual(
      expect.arrayContaining([
        "instagram_followers",
        "instagram_media_count",
        "instagram_media_reach",
        "instagram_media_likes",
        "instagram_media_comments",
        "instagram_media_saved",
        "instagram_media_total_interactions",
        "instagram_engagement_rate",
      ]),
    );
    expect(autoLabMetrics.find((metric) => metric.metric_key === "instagram_media_reach" && metric.dimensions.rollup === "media_sync_total")?.metric_value).toBe(100);
    expect(store.contentItems.some((item) => item.source_id === AUTO_LAB_INSTAGRAM_SOURCE_ID && item.external_content_id === MEDIA_ID)).toBe(true);
    expect(store.contentMetrics.some((metric) => metric.source_id === AUTO_LAB_INSTAGRAM_SOURCE_ID && metric.metric_key === "instagram_media_likes")).toBe(true);
    expect(store.connectorEvents.some((event) => event.source_id === AUTO_LAB_INSTAGRAM_SOURCE_ID && event.event_type === "instagram_insight_metric_unsupported")).toBe(true);
    expect(store.platformChangeEvents.some((event) => event.source_id === AUTO_LAB_INSTAGRAM_SOURCE_ID && event.platform_record_type === "instagram_media")).toBe(true);

    const moonarqSourcesAfter = await listSources({ dataSpaceId: DATA_SPACE_IDS.moonarq });
    expect(moonarqSourcesAfter.map((source) => source.id)).toEqual(moonarqSourcesBefore.map((source) => source.id));
    expect(moonarqSourcesAfter.map((source) => source.display_name)).not.toContain("Auto Lab Instagram");

    const dataSpaces = await listDataSpaces();
    const moonarq = dataSpaces.find((space) => space.slug === "moonarq");
    const autoLab = dataSpaces.find((space) => space.slug === "auto-lab");
    const moonarqModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq, dataSpaceName: "MoonArq" });
    const autoLabModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.autoLab, dataSpaceName: "Auto Lab" });
    expect(moonarqModules.find((module) => module.sourceTypeKey === "instagram")?.sourceId).not.toBe(AUTO_LAB_INSTAGRAM_SOURCE_ID);
    expect(autoLabModules.find((module) => module.sourceTypeKey === "instagram")?.sourceId).toBe(AUTO_LAB_INSTAGRAM_SOURCE_ID);

    const moonarqReport = await generateDailyReport("2026-04-22", moonarq);
    const autoLabReport = await generateDailyReport("2026-04-22", autoLab);
    expect(JSON.stringify(moonarqReport)).not.toContain("Auto Lab Instagram");
    expect(JSON.stringify(autoLabReport)).not.toContain("MoonArq Website / Vercel");

    const moonarqWorkbook = dailyReportToExcelXml(moonarqReport);
    const autoLabWorkbook = dailyReportToExcelXml(autoLabReport);
    expect(moonarqWorkbook).not.toContain("Auto_Lab_Instagram");
    expect(autoLabWorkbook).not.toContain("MoonArq_Website_Vercel");
    expect(autoLabWorkbook).not.toContain("MoonArq_Supabase");
  });

  it("syncs MoonArq Instagram through the same connector without leaking into Auto Lab reports or exports", async () => {
    addAutoLabInstagramSource({ status: "healthy" });
    addMoonArqInstagramSource({ status: "healthy" });
    await saveInstagramCredentials();
    await saveInstagramCredentialsForSource(MOONARQ_INSTAGRAM_SOURCE_ID, MOONARQ_INSTAGRAM_ACCOUNT_ID, MOONARQ_INSTAGRAM_USERNAME);

    mockInstagramGraphApi({ username: MOONARQ_INSTAGRAM_USERNAME, accountId: MOONARQ_INSTAGRAM_ACCOUNT_ID, pageId: MOONARQ_FACEBOOK_PAGE_ID, followers: 1200, mediaCount: 44 });
    const moonarqRun = await enqueueSyncRun({ sourceId: MOONARQ_INSTAGRAM_SOURCE_ID, trigger: "manual" });
    expect(moonarqRun.status).toBe("success");

    mockInstagramGraphApi({ username: AUTO_LAB_INSTAGRAM_USERNAME, accountId: AUTO_LAB_INSTAGRAM_ACCOUNT_ID, pageId: AUTO_LAB_FACEBOOK_PAGE_ID, followers: 428, mediaCount: 17 });
    const autoLabRun = await enqueueSyncRun({ sourceId: AUTO_LAB_INSTAGRAM_SOURCE_ID, trigger: "manual" });
    expect(autoLabRun.status).toBe("success");

    const store = getDemoStore();
    expect(store.metricsDaily.some((metric) => metric.source_id === MOONARQ_INSTAGRAM_SOURCE_ID && metric.metric_key === "instagram_media_reach")).toBe(true);
    expect(store.metricsDaily.some((metric) => metric.source_id === AUTO_LAB_INSTAGRAM_SOURCE_ID && metric.metric_key === "instagram_media_reach")).toBe(true);

    const dataSpaces = await listDataSpaces();
    const moonarq = dataSpaces.find((space) => space.slug === "moonarq");
    const autoLab = dataSpaces.find((space) => space.slug === "auto-lab");
    const moonarqReport = await generateDailyReport("2026-04-22", moonarq);
    const autoLabReport = await generateDailyReport("2026-04-22", autoLab);

    expect(JSON.stringify(moonarqReport)).toContain("MoonArq Instagram");
    expect(JSON.stringify(moonarqReport)).not.toContain("Auto Lab Instagram");
    expect(JSON.stringify(autoLabReport)).toContain("Auto Lab Instagram");
    expect(JSON.stringify(autoLabReport)).not.toContain("MoonArq Instagram");

    const moonarqWorkbook = dailyReportToExcelXml(moonarqReport);
    const autoLabWorkbook = dailyReportToExcelXml(autoLabReport);
    expect(moonarqWorkbook).toContain("MoonArq_Instagram");
    expect(moonarqWorkbook).not.toContain("Auto_Lab_Instagram");
    expect(autoLabWorkbook).toContain("Auto_Lab_Instagram");
    expect(autoLabWorkbook).not.toContain("MoonArq_Instagram");
  });
});
