import { describe, expect, it } from "vitest";
import type { Source } from "@/storage/db/schema";
import { authorizationState } from "@/presentation/dashboard/connection-health-panel";

const now = Date.parse("2026-09-29T12:00:00.000Z");
const inDays = (days: number) => new Date(now + days * 86_400_000 + 3_600_000).toISOString();

function source(overrides: Partial<Source>): Source {
  return {
    id: "source-1",
    data_space_id: "space-1",
    source_type_key: "instagram",
    display_name: "Instagram",
    input_url: null,
    normalized_url: null,
    external_account_id: null,
    account_name: null,
    status: "healthy",
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
    metadata: {},
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("authorizationState", () => {
  it("ignores platforms that do not use OAuth tokens", () => {
    expect(authorizationState(source({ source_type_key: "website" }), now)).toBeNull();
    expect(authorizationState(source({ source_type_key: "shopify" }), now)).toBeNull();
  });

  it("marks demo sources without asking for renewal", () => {
    expect(authorizationState(source({ status: "demo", metadata: { demo: true } }), now)).toEqual({
      tone: "slate",
      label: "Demo only",
      attention: false,
    });
  });

  it("flags OAuth platforms that were never authorized", () => {
    expect(authorizationState(source({ metadata: {} }), now)).toMatchObject({ label: "Not authorized", attention: true });
  });

  it("shows a healthy long-lived Instagram token with its expiry date", () => {
    const state = authorizationState(source({ metadata: { oauth_connected: true, token_expires_at: inDays(40) } }), now);
    expect(state).toMatchObject({ tone: "green", attention: false });
    expect(state?.label).toMatch(/^Valid until /);
  });

  it("warns two weeks before a Meta token expires and after it has expired", () => {
    expect(authorizationState(source({
      source_type_key: "meta_ads",
      metadata: { oauth_connected: true, token_expires_at: inDays(5) },
    }), now)).toMatchObject({ tone: "amber", label: "Renew within 5 days", attention: true });
    expect(authorizationState(source({
      metadata: { oauth_connected: true, token_expires_at: inDays(-2) },
    }), now)).toMatchObject({ tone: "rose", label: "Authorization expired", attention: true });
  });

  it("uses the TikTok refresh-token expiry, not the short access-token expiry", () => {
    expect(authorizationState(source({
      source_type_key: "tiktok",
      metadata: { oauth_connected: true, token_expires_at: inDays(-1), refresh_expires_at: inDays(200) },
    }), now)).toMatchObject({ tone: "green", attention: false });
    expect(authorizationState(source({
      source_type_key: "tiktok",
      metadata: { oauth_connected: true },
    }), now)).toEqual({ tone: "green", label: "Auto-refreshing", attention: false });
  });
});
