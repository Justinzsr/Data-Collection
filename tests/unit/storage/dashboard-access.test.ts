import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasDashboardSession } from "@/storage/auth/dashboard-access";
import { signDashboardSession } from "@/storage/auth/dashboard-session";

const cookieStore = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DEV_AUTH_BYPASS", "false");
  vi.stubEnv("DASHBOARD_ADMIN_PASSWORD", "test-password");
  vi.stubEnv("DASHBOARD_SESSION_SECRET", "test-private-session-secret");
  cookieStore.get.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("public entry session check", () => {
  it("leaves an anonymous visitor on the public preview", async () => {
    await expect(hasDashboardSession()).resolves.toBe(false);
    expect(cookieStore.get).toHaveBeenCalledWith("__Host-moonarq_dashboard");
  });

  it("recognizes the existing password and Google session format", async () => {
    cookieStore.get.mockReturnValue({ value: await signDashboardSession("test-private-session-secret") });
    await expect(hasDashboardSession()).resolves.toBe(true);
  });

  it("does not trust forged or expired browser state", async () => {
    cookieStore.get.mockReturnValue({ value: await signDashboardSession("another-secret") });
    await expect(hasDashboardSession()).resolves.toBe(false);
    cookieStore.get.mockReturnValue({ value: await signDashboardSession("test-private-session-secret", Date.now() - 86400000) });
    await expect(hasDashboardSession()).resolves.toBe(false);
  });

  it("fails closed when production is not configured even with bypass set", async () => {
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "");
    vi.stubEnv("DEV_AUTH_BYPASS", "true");
    await expect(hasDashboardSession()).resolves.toBe(false);
    expect(cookieStore.get).not.toHaveBeenCalled();
  });
});
