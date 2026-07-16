import { beforeEach, describe, expect, it } from "vitest";
import { POST as selectMetaAdsAccountRoute } from "@/app/api/sources/[id]/meta-ads-account/route";
import { DASHBOARD_SESSION_COOKIE, signDashboardSession } from "@/storage/auth/dashboard-session";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";

const ORIGINAL_ENV = { ...process.env };
const INSTAGRAM_SOURCE_ID = "7a9fd0cf-aeaf-4857-a871-97ef6bf5e9c0";
const META_SOURCE_ID = "88888888-8888-4888-8888-888888888888";
const ACCOUNT_ID = "act_2865948327088647";

function source(input: Pick<Source, "id" | "source_type_key" | "display_name" | "status" | "metadata">): Source {
  const now = "2026-07-15T17:00:00.000Z";
  return {
    data_space_id: DATA_SPACE_IDS.moonarq,
    input_url: null,
    normalized_url: null,
    external_account_id: null,
    account_name: null,
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
    created_at: now,
    updated_at: now,
    ...input,
  };
}

function seedSources(accountStatus = 1) {
  getDemoStore().sources.push(
    source({
      id: INSTAGRAM_SOURCE_ID,
      source_type_key: "instagram",
      display_name: "MoonArq Instagram",
      status: "healthy",
      metadata: { oauth_connected: true },
    }),
    source({
      id: META_SOURCE_ID,
      source_type_key: "meta_ads",
      display_name: "MoonArq Meta Ads",
      status: "warning",
      metadata: {
        oauth_connected: true,
        linked_instagram_source_id: INSTAGRAM_SOURCE_ID,
        candidate_ad_accounts: [
          {
            id: ACCOUNT_ID,
            name: "MoonArq Studio",
            account_status: accountStatus,
            currency: "USD",
            timezone_name: "America/Los_Angeles",
          },
        ],
      },
    }),
  );
}

async function select(accountId: string, authenticated = true) {
  const session = authenticated
    ? await signDashboardSession(process.env.DASHBOARD_SESSION_SECRET!)
    : null;
  return selectMetaAdsAccountRoute(
    new Request(`https://app.example.com/api/sources/${META_SOURCE_ID}/meta-ads-account?dataSpaceSlug=moonarq`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(session ? { cookie: `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(session)}` } : {}),
      },
      body: JSON.stringify({ accountId }),
    }),
    { params: Promise.resolve({ id: META_SOURCE_ID }) },
  );
}

describe("Meta Ads account selection", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_ENCRYPTION_KEY: "test-key-32-bytes-long-for-aes!!",
      DASHBOARD_ADMIN_PASSWORD: "dashboard-password-for-tests",
      DASHBOARD_SESSION_SECRET: "session-secret-with-enough-entropy",
      DEV_AUTH_BYPASS: "false",
    };
    delete process.env.DATABASE_URL;
    resetDemoStore();
  });

  it("rejects account selection without an authenticated dashboard session", async () => {
    seedSources();
    const connectorEventsBefore = [...getDemoStore().connectorEvents];

    const response = await select(ACCOUNT_ID, false);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized." });
    expect(await getDecryptedCredentialMap(META_SOURCE_ID)).not.toHaveProperty("meta_ad_account_id");
    expect(getDemoStore().sources.find((item) => item.id === META_SOURCE_ID)?.external_account_id).toBeNull();
    expect(getDemoStore().connectorEvents).toEqual(connectorEventsBefore);
  });

  it("only selects an OAuth-returned candidate and updates the linked Instagram source", async () => {
    seedSources();

    const response = await select(ACCOUNT_ID.replace("act_", ""));
    const metaSource = getDemoStore().sources.find((item) => item.id === META_SOURCE_ID);
    const instagramSource = getDemoStore().sources.find((item) => item.id === INSTAGRAM_SOURCE_ID);

    expect(response.status).toBe(200);
    expect(metaSource).toMatchObject({
      status: "healthy",
      external_account_id: ACCOUNT_ID,
      account_name: "MoonArq Studio",
      metadata: { selected_ad_account_id: ACCOUNT_ID },
    });
    expect(instagramSource?.metadata).toMatchObject({
      meta_ads_source_id: META_SOURCE_ID,
      meta_ads_connected: true,
      meta_ads_account_id: ACCOUNT_ID,
    });
    expect(await getDecryptedCredentialMap(META_SOURCE_ID)).toMatchObject({ meta_ad_account_id: ACCOUNT_ID });
    expect(getDemoStore().connectorEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "meta_ads_account_selected", severity: "info" }),
    ]));
  });

  it("rejects an account that was not returned by the OAuth connection", async () => {
    seedSources();

    const response = await select("act_9999999999999999");

    expect(response.status).toBe(403);
    expect(await getDecryptedCredentialMap(META_SOURCE_ID)).not.toHaveProperty("meta_ad_account_id");
    expect(getDemoStore().sources.find((item) => item.id === META_SOURCE_ID)?.external_account_id).toBeNull();
  });

  it("keeps a non-active selected account in warning state until connection verification", async () => {
    seedSources(2);

    const response = await select(ACCOUNT_ID);
    const metaSource = getDemoStore().sources.find((item) => item.id === META_SOURCE_ID);

    expect(response.status).toBe(200);
    expect(metaSource).toMatchObject({ status: "warning", external_account_id: ACCOUNT_ID });
    expect(metaSource?.last_error).toContain("not active");
    expect(getDemoStore().connectorEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "meta_ads_account_selected", severity: "warning" }),
    ]));
  });

  it("resets sync freshness when the selected account changes", async () => {
    seedSources();
    const metaSource = getDemoStore().sources.find((item) => item.id === META_SOURCE_ID)!;
    metaSource.external_account_id = "act_1111111111111111";
    metaSource.last_manual_sync_at = "2026-07-15T16:00:00.000Z";
    metaSource.last_cron_sync_at = "2026-07-15T17:00:00.000Z";
    metaSource.last_success_at = "2026-07-15T17:00:00.000Z";
    metaSource.next_sync_at = "2026-07-15T18:00:00.000Z";
    metaSource.metadata = {
      ...metaSource.metadata,
      selected_ad_account_id: "act_1111111111111111",
      campaign_id: "old-campaign",
      ad_id: "old-ad",
      delivery_status: "ACTIVE",
    };

    const response = await select(ACCOUNT_ID);
    const updatedMetaSource = getDemoStore().sources.find((item) => item.id === META_SOURCE_ID);

    expect(response.status).toBe(200);
    expect(updatedMetaSource).toMatchObject({
      external_account_id: ACCOUNT_ID,
      last_manual_sync_at: null,
      last_cron_sync_at: null,
      last_success_at: null,
    });
    expect(updatedMetaSource?.next_sync_at).not.toBeNull();
    expect(updatedMetaSource?.metadata).toMatchObject({
      selected_ad_account_id: ACCOUNT_ID,
      campaign_id: null,
      ad_id: null,
      delivery_status: null,
    });
    expect(getDemoStore().connectorEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: "meta_ads_account_selected",
        metadata: expect.objectContaining({ accountChanged: true }),
      }),
    ]));
  });
});
