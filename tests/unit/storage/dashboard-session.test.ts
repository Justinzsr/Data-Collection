import { describe, expect, it } from "vitest";
import {
  getDashboardAuthSetup,
  isPrivateApiPath,
  isProtectedUiPath,
  signDashboardSession,
  verifyDashboardSession,
} from "@/storage/auth/dashboard-session";

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

  it("identifies protected UI and private API routes without blocking ingestion routes", () => {
    expect(isProtectedUiPath("/dashboard/sources")).toBe(true);
    expect(isProtectedUiPath("/settings")).toBe(true);
    expect(isPrivateApiPath("/api/sources/abc/credentials")).toBe(true);
    expect(isPrivateApiPath("/api/metrics/summary")).toBe(true);
    expect(isPrivateApiPath("/api/track")).toBe(false);
    expect(isPrivateApiPath("/api/cron/sync")).toBe(false);
    expect(isPrivateApiPath("/api/webhooks/vercel/analytics-drain/source")).toBe(false);
  });
});

