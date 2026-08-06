import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import {
  DASHBOARD_SESSION_COOKIE,
  DEFAULT_DASHBOARD_PATH,
  getDashboardAuthSetup,
  getDashboardSessionCookieName,
  isPrivateApiPath,
  isProtectedUiPath,
  safeDashboardRedirectPath,
  SECURE_DASHBOARD_SESSION_COOKIE,
  signDashboardSession,
  verifyDashboardSession,
} from "@/storage/auth/dashboard-session";

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe("Cookie");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboard session gate", () => {
  it("signs and verifies dashboard sessions", async () => {
    const cookie = await signDashboardSession("session-secret-with-enough-entropy", Date.UTC(2026, 3, 22));
    await expect(verifyDashboardSession(cookie, "session-secret-with-enough-entropy", Date.UTC(2026, 3, 22) + 1000)).resolves.toBe(true);
    await expect(verifyDashboardSession(cookie, "wrong-secret", Date.UTC(2026, 3, 22) + 1000)).resolves.toBe(false);
  });

  it("requires production dashboard password and session secret", () => {
    expect(getDashboardAuthSetup({ NODE_ENV: "production" }).missing).toEqual(["DASHBOARD_ADMIN_PASSWORD", "DASHBOARD_SESSION_SECRET"]);
    expect(
      getDashboardAuthSetup({
        NODE_ENV: "production",
        DASHBOARD_ADMIN_PASSWORD: "set",
        DASHBOARD_SESSION_SECRET: "set",
      }).configured,
    ).toBe(true);
  });

  it("uses local cookie names without __Host and secure names in production", () => {
    expect(getDashboardSessionCookieName({ NODE_ENV: "test" })).toBe(DASHBOARD_SESSION_COOKIE);
    expect(getDashboardSessionCookieName({ NODE_ENV: "development" })).toBe(DASHBOARD_SESSION_COOKIE);
    expect(getDashboardSessionCookieName({ NODE_ENV: "production" })).toBe(SECURE_DASHBOARD_SESSION_COOKIE);
    expect(DASHBOARD_SESSION_COOKIE.startsWith("__Host-")).toBe(false);
    expect(SECURE_DASHBOARD_SESSION_COOKIE.startsWith("__Host-")).toBe(true);
  });

  it("allows normalized same-origin paths and rejects redirect authority tricks", () => {
    expect(safeDashboardRedirectPath("/w/moonarq/dashboard?range=7d#health")).toBe(
      "/w/moonarq/dashboard?range=7d#health",
    );
    expect(safeDashboardRedirectPath("https://evil.example/path")).toBe(DEFAULT_DASHBOARD_PATH);
    expect(safeDashboardRedirectPath("//evil.example/path")).toBe(DEFAULT_DASHBOARD_PATH);
    expect(safeDashboardRedirectPath("/\\evil.example/path")).toBe(DEFAULT_DASHBOARD_PATH);
    expect(safeDashboardRedirectPath("dashboard")).toBe(DEFAULT_DASHBOARD_PATH);
  });

  it("identifies protected UI and private API routes without blocking ingestion routes", () => {
    expect(isProtectedUiPath("/dashboard/sources")).toBe(true);
    expect(isProtectedUiPath("/w/moonarq/dashboard")).toBe(true);
    expect(isProtectedUiPath("/w/auto-lab/dashboard")).toBe(true);
    expect(isProtectedUiPath("/settings")).toBe(true);
    expect(isProtectedUiPath("/privacy")).toBe(false);
    expect(isProtectedUiPath("/terms")).toBe(false);
    expect(isProtectedUiPath("/data-deletion")).toBe(false);
    expect(isPrivateApiPath("/api/sources/abc/credentials")).toBe(true);
    expect(isPrivateApiPath("/api/metrics/summary")).toBe(true);
    expect(isPrivateApiPath("/api/track")).toBe(false);
    expect(isPrivateApiPath("/api/cron/sync")).toBe(false);
    expect(isPrivateApiPath("/api/cron/daily-report")).toBe(false);
    expect(isPrivateApiPath("/api/webhooks/supabase/source")).toBe(false);
    expect(isPrivateApiPath("/api/webhooks/vercel/analytics-drain/source")).toBe(false);
  });

  it("returns a sanitized no-store response before an unauthenticated private API can read data", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH_BYPASS", "false");
    vi.stubEnv("DASHBOARD_ADMIN_PASSWORD", "synthetic-dashboard-password");
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "synthetic-dashboard-session-secret");

    const response = await proxy(
      new NextRequest("https://app.example.com/api/metrics/email-signups?dataSpaceSlug=moonarq"),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized." });
    expect(JSON.stringify(body)).not.toMatch(/@|shopify|customer|signup/iu);
    expectPrivateNoStore(response);
  });

  it("keeps a missing-auth-setup private API response non-cacheable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH_BYPASS", "false");
    vi.stubEnv("DASHBOARD_ADMIN_PASSWORD", "");
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "");

    const response = await proxy(
      new NextRequest("https://app.example.com/api/metrics/email-signups?dataSpaceSlug=moonarq"),
    );

    expect(response.status).toBe(503);
    expectPrivateNoStore(response);
  });
});
