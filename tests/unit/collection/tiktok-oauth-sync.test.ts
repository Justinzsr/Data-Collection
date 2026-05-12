import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { AUTO_LAB_TIKTOK_SOURCE_ID, TIKTOK_OAUTH_SCOPES } from "@/collection/connectors/tiktok/constants";
import {
  createTikTokOAuthState,
  TIKTOK_OAUTH_STATE_COOKIE,
  TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS,
  validateTikTokOAuthState,
} from "@/collection/connectors/tiktok/oauth-state";
import { enqueueSyncRun } from "@/collection/sync/engine";
import { GET as tiktokOAuthStartRoute } from "@/app/api/oauth/tiktok/start/route";
import { GET as tiktokOAuthCallbackRoute } from "@/app/api/oauth/tiktok/callback/route";
import { POST as testSourceRoute } from "@/app/api/sources/[id]/test/route";
import { DASHBOARD_SESSION_COOKIE, signDashboardSession } from "@/storage/auth/dashboard-session";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { listCredentialHints, saveCredential } from "@/storage/repositories/credentials-repository";
import { getSource } from "@/storage/repositories/sources-repository";

const ORIGINAL_ENV = { ...process.env };
const TIKTOK_CLIENT_KEY = "test-tiktok-client-key";
const TIKTOK_CLIENT_SECRET = "test-tiktok-client-secret";
const TIKTOK_REDIRECT_URI = "https://moonarq-data-hub.vercel.app/api/oauth/tiktok/callback";
const ACCESS_TOKEN = "act.test-access-token";
const REFRESH_TOKEN = "rft.test-refresh-token";
const OPEN_ID = "open-id-auto-lab-tiktok";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function addAutoLabTikTokSource(patch: Partial<Source> = {}) {
  const now = "2026-05-11T17:00:00.000Z";
  const source: Source = {
    id: AUTO_LAB_TIKTOK_SOURCE_ID,
    data_space_id: DATA_SPACE_IDS.autoLab,
    source_type_key: "tiktok",
    display_name: "Auto Lab TikTok",
    input_url: "https://www.tiktok.com/@auto_lab_cars",
    normalized_url: "https://www.tiktok.com/@auto_lab_cars",
    external_account_id: null,
    account_name: "@auto_lab_cars",
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

function addMoonArqTikTokSource(patch: Partial<Source> = {}) {
  const now = "2026-05-11T17:00:00.000Z";
  const source: Source = {
    id: "44444444-4444-4444-8444-444444444444",
    data_space_id: DATA_SPACE_IDS.moonarq,
    source_type_key: "tiktok",
    display_name: "MoonArq TikTok",
    input_url: "https://www.tiktok.com/@moonarq",
    normalized_url: "https://www.tiktok.com/@moonarq",
    external_account_id: null,
    account_name: "@moonarq",
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
    metadata: { scaffoldOnly: true },
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
  return `${TIKTOK_OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}`;
}

function tamperState(state: string) {
  return `${state.slice(0, -1)}${state.endsWith("a") ? "b" : "a"}`;
}

function mockTikTokApi(options: { scope?: string; missingVideoScope?: boolean } = {}) {
  const scope = options.scope ?? TIKTOK_OAUTH_SCOPES.join(",");
  const calls: Array<{ url: string; body?: string | null }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    const url = new URL(href);
    calls.push({ url: url.toString(), body: typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : null });

    if (url.pathname.endsWith("/v2/oauth/token/")) {
      return jsonResponse({
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        token_type: "Bearer",
        expires_in: 86_400,
        refresh_expires_in: 31_536_000,
        open_id: OPEN_ID,
        scope,
      });
    }

    if (url.pathname.endsWith("/v2/user/info/")) {
      return jsonResponse({
        data: {
          user: {
            open_id: OPEN_ID,
            union_id: "union-id",
            display_name: "Auto Lab IS350",
            username: "auto_lab_cars",
            profile_deep_link: "https://www.tiktok.com/@auto_lab_cars",
            follower_count: 321,
            following_count: 44,
            likes_count: 1200,
            video_count: 9,
          },
        },
        error: { code: "ok", message: "", log_id: "log-id" },
      });
    }

    if (url.pathname.endsWith("/v2/video/list/")) {
      if (options.missingVideoScope) {
        return jsonResponse({ error: { code: "scope_not_authorized", message: "video.list missing", log_id: "log-id" } }, 401);
      }
      return jsonResponse({
        data: {
          videos: [
            {
              id: "video-1",
              create_time: 1_779_120_000,
              cover_image_url: "https://example.com/cover.jpg",
              share_url: "https://www.tiktok.com/@auto_lab_cars/video/1",
              video_description: "IS350 canyon shakedown.",
              title: "IS350 shakedown",
              like_count: 42,
              comment_count: 5,
              share_count: 3,
              view_count: 1000,
            },
          ],
          cursor: 0,
          has_more: false,
        },
        error: { code: "ok", message: "", log_id: "log-id" },
      });
    }

    throw new Error(`Unexpected TikTok API URL: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function saveTikTokCredentials(sourceId = AUTO_LAB_TIKTOK_SOURCE_ID, scope = TIKTOK_OAUTH_SCOPES.join(",")) {
  await saveCredential(sourceId, "tiktok_access_token", ACCESS_TOKEN);
  await saveCredential(sourceId, "tiktok_refresh_token", REFRESH_TOKEN);
  await saveCredential(sourceId, "open_id", OPEN_ID);
  await saveCredential(sourceId, "scope", scope);
  await saveCredential(sourceId, "expires_at", "2026-12-31T00:00:00.000Z");
  await saveCredential(sourceId, "refresh_expires_at", "2027-12-31T00:00:00.000Z");
}

describe("Auto Lab TikTok OAuth and sync", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_ENCRYPTION_KEY: "test-key-32-bytes-long-for-aes!!",
      DASHBOARD_ADMIN_PASSWORD: "dashboard-password-for-tests",
      DASHBOARD_SESSION_SECRET: "session-secret-with-enough-entropy",
      DEV_AUTH_BYPASS: "false",
      DEMO_NOW: "2026-05-12T17:00:00.000Z",
      TIKTOK_CLIENT_KEY,
      TIKTOK_CLIENT_SECRET,
      TIKTOK_REDIRECT_URI,
    };
    delete process.env.DATABASE_URL;
    resetDemoStore();
    vi.unstubAllGlobals();
  });

  it("builds the TikTok authorization URL without exposing secrets", async () => {
    addAutoLabTikTokSource();
    const response = await tiktokOAuthStartRoute(
      new Request(`https://app.example.com/api/oauth/tiktok/start?sourceId=${AUTO_LAB_TIKTOK_SOURCE_ID}&dataSpaceSlug=auto-lab&returnPath=${encodeURIComponent(`/w/auto-lab/dashboard/sources/${AUTO_LAB_TIKTOK_SOURCE_ID}`)}`, {
        headers: { cookie: await dashboardCookie() },
      }),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("https://www.tiktok.com/v2/auth/authorize/");
    expect(location).toContain(`client_key=${TIKTOK_CLIENT_KEY}`);
    expect(decodeURIComponent(location)).toContain("user.info.basic,user.info.profile,user.info.stats,video.list");
    expect(location).not.toContain(TIKTOK_CLIENT_SECRET);
    expect(location).not.toContain("client_secret");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(TIKTOK_OAUTH_STATE_COOKIE);
    const cookieValue = decodeURIComponent(setCookie.match(new RegExp(`${TIKTOK_OAUTH_STATE_COOKIE}=([^;]+)`))?.[1] ?? "");
    const state = new URL(location).searchParams.get("state");
    expect(validateTikTokOAuthState(state, cookieValue)).toMatchObject({
      sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
      dataSpaceSlug: "auto-lab",
      returnPath: `/w/auto-lab/dashboard/sources/${AUTO_LAB_TIKTOK_SOURCE_ID}`,
    });
  });

  it("returns a sanitized setup error when TikTok environment variables are missing", async () => {
    addAutoLabTikTokSource();
    delete process.env.TIKTOK_CLIENT_SECRET;
    const response = await tiktokOAuthStartRoute(
      new Request(`https://app.example.com/api/oauth/tiktok/start?sourceId=${AUTO_LAB_TIKTOK_SOURCE_ID}&dataSpaceSlug=auto-lab`, {
        headers: { cookie: await dashboardCookie() },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain("TIKTOK_CLIENT_SECRET");
    expect(JSON.stringify(body)).not.toContain(TIKTOK_CLIENT_SECRET);
  });

  it("rejects MoonArq TikTok sources at OAuth start and callback", async () => {
    const moonarqSource = addMoonArqTikTokSource();
    const startResponse = await tiktokOAuthStartRoute(
      new Request(`https://app.example.com/api/oauth/tiktok/start?sourceId=${moonarqSource.id}&dataSpaceSlug=moonarq`, {
        headers: { cookie: await dashboardCookie() },
      }),
    );
    expect(startResponse.status).toBe(403);

    const state = createTikTokOAuthState({
      sourceId: moonarqSource.id,
      dataSpaceSlug: "auto-lab",
      returnPath: `/w/auto-lab/dashboard/sources/${moonarqSource.id}`,
    });
    const callbackResponse = await tiktokOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/tiktok/callback?code=code-from-tiktok&state=${encodeURIComponent(state)}`, {
        headers: { cookie: oauthStateCookie(state) },
      }),
    );
    expect(callbackResponse.status).toBe(403);
  });

  it("rejects invalid and expired TikTok OAuth state", async () => {
    addAutoLabTikTokSource();
    const state = createTikTokOAuthState({
      sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
      dataSpaceSlug: "auto-lab",
      returnPath: `/w/auto-lab/dashboard/sources/${AUTO_LAB_TIKTOK_SOURCE_ID}`,
    });
    const invalidResponse = await tiktokOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/tiktok/callback?code=code-from-tiktok&state=${encodeURIComponent(tamperState(state))}`),
    );
    expect(invalidResponse.status).toBe(400);
    expect((await invalidResponse.json()).error).toContain("Invalid TikTok OAuth state");

    const expiredState = createTikTokOAuthState(
      {
        sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
        dataSpaceSlug: "auto-lab",
        returnPath: `/w/auto-lab/dashboard/sources/${AUTO_LAB_TIKTOK_SOURCE_ID}`,
      },
      process.env,
      Date.now() - (TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS + 5) * 1000,
    );
    const expiredResponse = await tiktokOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/tiktok/callback?code=code-from-tiktok&state=${encodeURIComponent(expiredState)}`),
    );
    expect(expiredResponse.status).toBe(400);
    expect((await expiredResponse.json()).error).toContain("TikTok OAuth state expired");
  });

  it("stores TikTok OAuth credentials encrypted only on the Auto Lab TikTok source", async () => {
    addAutoLabTikTokSource();
    const { calls } = mockTikTokApi();
    const state = createTikTokOAuthState({
      sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
      dataSpaceSlug: "auto-lab",
      returnPath: `/w/auto-lab/dashboard/sources/${AUTO_LAB_TIKTOK_SOURCE_ID}`,
    });
    const response = await tiktokOAuthCallbackRoute(
      new Request(`https://app.example.com/api/oauth/tiktok/callback?code=code-from-tiktok&state=${encodeURIComponent(state)}`, {
        headers: { cookie: oauthStateCookie(state) },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(`/w/auto-lab/dashboard/sources/${AUTO_LAB_TIKTOK_SOURCE_ID}`);
    expect(calls.some((call) => call.url.includes("/v2/oauth/token/"))).toBe(true);
    expect(calls.find((call) => call.url.includes("/v2/oauth/token/"))?.body).toContain(`client_key=${TIKTOK_CLIENT_KEY}`);

    const source = await getSource(AUTO_LAB_TIKTOK_SOURCE_ID, { dataSpaceId: DATA_SPACE_IDS.autoLab });
    expect(source).toMatchObject({
      data_space_id: DATA_SPACE_IDS.autoLab,
      source_type_key: "tiktok",
      status: "healthy",
      external_account_id: OPEN_ID,
      account_name: "auto_lab_cars",
    });
    expect(source?.metadata).toMatchObject({
      oauth_connected: true,
      tiktok_open_id: OPEN_ID,
      tiktok_username: "auto_lab_cars",
      tiktok_display_name: "Auto Lab IS350",
      tiktok_scopes: TIKTOK_OAUTH_SCOPES.join(","),
    });

    const hints = await listCredentialHints(AUTO_LAB_TIKTOK_SOURCE_ID);
    expect(hints.map((hint) => hint.field_key)).toEqual(expect.arrayContaining(["tiktok_access_token", "tiktok_refresh_token", "open_id", "scope"]));
    const credentialStore = JSON.stringify(getDemoStore().credentials);
    expect(credentialStore).not.toContain(ACCESS_TOKEN);
    expect(credentialStore).not.toContain(REFRESH_TOKEN);
    expect(credentialStore).not.toContain(TIKTOK_CLIENT_SECRET);
  });

  it("runs a real mocked Test Connection and reports missing video scope", async () => {
    addAutoLabTikTokSource({ status: "healthy", metadata: { oauth_connected: true } });
    await saveTikTokCredentials(AUTO_LAB_TIKTOK_SOURCE_ID, "user.info.basic,user.info.profile,user.info.stats");
    mockTikTokApi({ scope: "user.info.basic,user.info.profile,user.info.stats" });

    const response = await testSourceRoute(
      new Request(`https://app.example.com/api/sources/${AUTO_LAB_TIKTOK_SOURCE_ID}/test?dataSpaceSlug=auto-lab`, { method: "POST" }),
      { params: Promise.resolve({ id: AUTO_LAB_TIKTOK_SOURCE_ID }) },
    );
    const body = await response.json();

    expect(body.result).toMatchObject({
      ok: false,
      status: "unsupported",
    });
    expect(body.result.message).toContain("video.list scope is missing");
    expect(JSON.stringify(body)).not.toContain(ACCESS_TOKEN);
  });

  it("syncs and normalizes TikTok videos into Auto Lab metrics/content without MoonArq leakage", async () => {
    addAutoLabTikTokSource({ status: "healthy", metadata: { oauth_connected: true } });
    addMoonArqTikTokSource();
    await saveTikTokCredentials();
    mockTikTokApi();

    const run = await enqueueSyncRun({ sourceId: AUTO_LAB_TIKTOK_SOURCE_ID, trigger: "manual" });

    expect(run.status).toBe("success");
    const store = getDemoStore();
    const autoLabMetricKeys = store.metricsDaily
      .filter((row) => row.source_id === AUTO_LAB_TIKTOK_SOURCE_ID)
      .map((row) => row.metric_key);
    expect(autoLabMetricKeys).toEqual(expect.arrayContaining(["tiktok_video_views", "tiktok_likes", "tiktok_comments", "tiktok_shares", "tiktok_engagement_rate", "tiktok_followers", "tiktok_video_count"]));
    expect(store.contentItems.find((item) => item.source_id === AUTO_LAB_TIKTOK_SOURCE_ID)).toMatchObject({
      source_type_key: "tiktok",
      external_content_id: "video-1",
      title: "IS350 shakedown",
      url: "https://www.tiktok.com/@auto_lab_cars/video/1",
    });
    expect(store.rawIngestions.find((item) => item.source_id === AUTO_LAB_TIKTOK_SOURCE_ID)?.payload).toMatchObject({
      kind: "tiktok_sync_snapshot",
      sourceId: AUTO_LAB_TIKTOK_SOURCE_ID,
    });
    expect(JSON.stringify(store.rawIngestions)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(store.rawIngestions)).not.toContain(REFRESH_TOKEN);

    const autoLabModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.autoLab, dataSpaceName: "Auto Lab" });
    const moonarqModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq, dataSpaceName: "MoonArq" });
    const autoLabTikTok = autoLabModules.find((module) => module.sourceTypeKey === "tiktok");
    const moonarqTikTok = moonarqModules.find((module) => module.sourceTypeKey === "tiktok");
    expect(autoLabTikTok?.sourceId).toBe(AUTO_LAB_TIKTOK_SOURCE_ID);
    expect(autoLabTikTok?.primaryMetric.value).toBe(1000);
    expect(moonarqTikTok?.sourceId).not.toBe(AUTO_LAB_TIKTOK_SOURCE_ID);
  });
});
