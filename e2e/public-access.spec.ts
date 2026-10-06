import { expect, test, settleResponsiveLayout } from "./test";
import { E2E_DASHBOARD_PASSWORD, loginDashboard } from "./auth";

// Public interactions must not even request a private API or private route.
test("visitors can explore fictional data without contacting private workspaces", async ({ page }) => {
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/") || path.startsWith("/w/") || path.startsWith("/dashboard")) privateRequests.push(path);
  });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByText("Demo · Sample data", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your business, in focus." })).toBeVisible();
  const initialMetrics = await page.getByLabel("30-day sample metrics").innerText();
  await page.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(page.getByLabel("7-day sample metrics")).toBeVisible();
  expect(await page.getByLabel("7-day sample metrics").innerText()).not.toBe(initialMetrics);
  await page.getByRole("button", { name: "Acquisition", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Acquisition mix" })).toBeVisible();
  await page.getByRole("button", { name: "Connections", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Source health" })).toBeVisible();
  await expect(page.getByText("Illustrative connections. No accounts are connected to this demo.")).toBeVisible();
  expect(privateRequests).toEqual([]);
  const content = await page.content();
  for (const marker of ["GOOGLE_CLIENT_SECRET", "GOOGLE_ALLOWED_EMAIL", "DASHBOARD_SESSION_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]) {
    expect(content).not.toContain(marker);
  }
});

test("anonymous direct access to both workspaces and data APIs stays blocked", async ({ page, request }) => {
  for (const path of ["/w/moonarq/dashboard", "/w/auto-lab/dashboard", "/w/moonarq/dashboard/sources", "/w/auto-lab/dashboard/data"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Sign in to DataHub" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
  }
  for (const path of [
    "/api/sources?dataSpaceSlug=moonarq", "/api/sources?dataSpaceSlug=auto-lab",
    "/api/sources/test-source/credentials", "/api/metrics/summary", "/api/metrics/email-signups",
    "/api/reports/daily", "/api/content", "/api/events", "/api/health", "/api/source-types",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});

test("forged browser cookies do not unlock the landing page or private APIs", async ({ page, context }) => {
  await context.addCookies([{ name: "__Host-moonarq_dashboard", value: "forged-session", domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/");
  await expect(page.getByText("Demo · Sample data", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/sources")).status()).toBe(401);
});

test("password fallback signs in, root enters the workspace, and logout returns to public access", async ({ page }) => {
  await page.goto("/login?error=google_not_allowed&next=%2Fw%2Fauto-lab%2Fdashboard");
  await expect(page.getByRole("alert").filter({ hasText: "This Google account does not have direct access" })).toBeVisible();
  await page.getByLabel("Admin password").fill(E2E_DASHBOARD_PASSWORD);
  await page.getByRole("button", { name: "Enter command center" }).click();
  await expect(page).toHaveURL(/\/w\/auto-lab\/dashboard$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/moonarq\/dashboard$/);
  await page.goto("/demo");
  await expect(page.getByText("Demo · Sample data", { exact: true })).toBeVisible();
  await page.goto("/w/moonarq/dashboard/settings");
  await page.locator('form[action="/api/auth/logout"] button').click();
  await expect(page.getByRole("heading", { name: "Sign in to DataHub" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Demo · Sample data", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/sources")).status()).toBe(401);
});

test("password login preserves safe destinations and rejects external or auth-loop redirects", async ({ page }) => {
  await page.goto("/login?next=%2F%2Fevil.example");
  await page.getByLabel("Admin password").fill("incorrect-synthetic-password");
  await page.getByRole("button", { name: "Enter command center" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid dashboard password" })).toBeVisible();
  await page.getByLabel("Admin password").fill(E2E_DASHBOARD_PASSWORD);
  await page.getByRole("button", { name: "Enter command center" }).click();
  await expect(page).toHaveURL(/\/w\/moonarq\/dashboard$/);
  await page.goto("/login?next=%2Fapi%2Fauth%2Fgoogle%2Fstart");
  await expect(page).toHaveURL(/\/w\/moonarq\/dashboard$/);
});

test("missing Google configuration and unsolicited callbacks preserve the password option", async ({ page, request }) => {
  for (const error of ["__proto__", "constructor", "unrecognized"]) {
    await page.goto(`/login?error=${error}`);
    await expect(page.getByRole("heading", { name: "Sign in to DataHub" })).toBeVisible();
  }
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  await expect(page.getByLabel("Admin password")).toBeVisible();
  const callback = await request.get("/api/auth/google/callback?code=not-a-real-code&state=forged", { maxRedirects: 0 });
  expect(callback.status()).toBe(303);
  expect(callback.headers()["location"]).toContain("google_unavailable");
  expect(callback.headers()["set-cookie"]).not.toContain("__Host-moonarq_dashboard=");
  await loginDashboard(page);
});

test("public preview and sign-in fit narrow mobile through ultrawide screens", async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ["/demo", "/login"]) {
      await page.goto(path);
      await settleResponsiveLayout(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${path} at ${width}px`).toBe(true);
      if (width === 390 || width === 1440) {
        await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}-${width}.png`), fullPage: true });
      }
    }
  }
});
