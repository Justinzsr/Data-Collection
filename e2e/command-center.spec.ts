import { expect, test } from "@playwright/test";
import { dashboardAuthCookie, loginDashboard } from "./auth";

test("dashboard shows platform modules and sparklines", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard");
  await expect(page.getByRole("heading", { name: "MoonArq command center" })).toBeVisible();
  await expect(page.getByTestId("overview-module-summary-website")).toBeVisible();
  await expect(page.getByTestId("overview-module-summary-supabase")).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "TikTok official API" })).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "Instagram Graph API" })).toBeVisible();
  await expect(page.getByTestId("overview-module-summary-shopify")).toBeVisible();
  await expect(page.getByText("Planned and custom sources")).toBeVisible();
  await expect(page.getByTestId("platform-sparkline").first()).toBeVisible();
});

test("dashboard puts graphs, platform summaries, and health metrics above the fold", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard");

  const placement = await page.evaluate(() => ({
    scrollY: window.scrollY,
    stageTop: document.querySelector<HTMLElement>("[data-testid='dashboard-data-stage']")?.getBoundingClientRect().top ?? Infinity,
    chartBottom: document.querySelector<HTMLElement>("[data-testid='overview-chart']")?.getBoundingClientRect().bottom ?? Infinity,
    summaryBottoms: ["website", "supabase", "tiktok", "instagram", "shopify"].map((type) =>
      document.querySelector<HTMLElement>(`[data-testid='overview-module-summary-${type}']`)?.getBoundingClientRect().bottom ?? Infinity,
    ),
    kpiBottoms: Array.from(document.querySelectorAll<HTMLElement>("[data-testid='overview-kpi']")).map((element) => element.getBoundingClientRect().bottom),
    viewportHeight: window.innerHeight,
  }));

  expect(placement.scrollY).toBe(0);
  expect(placement.stageTop).toBeLessThan(220);
  expect(placement.chartBottom).toBeLessThan(placement.viewportHeight);
  expect(placement.summaryBottoms).toHaveLength(5);
  expect(placement.summaryBottoms.every((bottom) => bottom < placement.viewportHeight)).toBe(true);
  expect(placement.kpiBottoms).toHaveLength(4);
  expect(placement.kpiBottoms.every((bottom) => bottom < placement.viewportHeight)).toBe(true);
});

test("platform modules keep the overview visible and disclose detail on demand", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard");

  for (const type of ["website", "supabase", "tiktok", "instagram", "shopify"]) {
    await expect(page.getByTestId(`overview-module-${type}`)).toHaveJSProperty("open", false);
    await expect(page.getByTestId(`overview-module-summary-${type}`)).toBeVisible();
    await expect(page.getByTestId(`overview-module-detail-${type}`)).toBeHidden();
  }

  const website = page.getByTestId("overview-module-website");
  await page.getByTestId("overview-module-summary-website").click();
  await expect(website).toHaveJSProperty("open", true);
  await expect(page.getByTestId("overview-module-detail-website")).toBeVisible();
  await expect(page.getByText("Page views", { exact: true }).first()).toBeVisible();
  await page.getByTestId("overview-module-summary-website").click();
  await expect(website).toHaveJSProperty("open", false);
});

test("Shopify CTA opens the official connector directly and keeps credentials empty", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/sources/new?template=shopify");
  await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
  await expect(page.getByRole("heading", { name: "Configure Shopify" })).toBeVisible();
  await page.getByLabel("Public source URL").fill("https://e2e-shop.myshopify.com");
  await page.getByRole("button", { name: "Check URL" }).click();
  await expect(page.getByText("URL matches Shopify")).toBeVisible();
  await page.getByRole("button", { name: "Review connection" }).click();
  await expect(page.getByText("Encrypted server credentials", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save source" }).click();
  await page.getByText("Additional encrypted settings").click();
  await expect(page.getByLabel("Shopify Client ID")).toHaveValue("");
  await expect(page.getByLabel("Shopify Client secret")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Save Credentials" })).toBeVisible();
});

test("add source wizard detects Supabase and Website and shows credentials after save", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/sources/new");
  await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
  await page.getByRole("button", { name: /Supabase/ }).click();
  await page.getByLabel("Public source URL").fill("https://xxxxx.supabase.co");
  await page.getByRole("button", { name: "Check URL" }).click();
  await page.getByRole("button", { name: "Review connection" }).click();
  await page.getByRole("button", { name: "Save source" }).click();
  await page.getByText("Additional encrypted settings").click();
  await expect(page.getByLabel("Service role key")).toBeVisible();
  await expect(page.getByLabel("Anon key")).toHaveCount(0);
  await page.getByLabel("Service role key").fill("fake-service-role-value");
  await page.getByRole("button", { name: "Save Credentials" }).click();
  await expect(page.getByText("fake••••alue")).toBeVisible();

  await page.goto("/w/moonarq/dashboard/sources/new");
  await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
  await page.getByRole("button", { name: /Website Tracker/ }).click();
  await page.getByRole("button", { name: /First-party Website Tracker/ }).click();
  await page.getByRole("button", { name: "Check URL" }).click();
  await page.getByRole("button", { name: "Review connection" }).click();
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(page.getByText("First-party tracker").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open tracker snippet" })).toBeVisible();
});

test("add source wizard prepares MoonArq Instagram OAuth", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/sources/new");
  await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
  await page.getByRole("button", { name: /Instagram/ }).click();
  await page.getByRole("button", { name: "Check URL" }).click();
  await page.getByRole("button", { name: "Review connection" }).click();
  await page.getByRole("button", { name: "Save source" }).click();
  const connect = page.getByRole("link", { name: "Connect Instagram" });
  await expect(connect).toBeVisible();
  await expect(connect).toHaveAttribute("href", /dataSpaceSlug=moonarq/);
  await expect(page.getByLabel("Instagram account ID")).toHaveCount(0);
});

test("events page shows non-empty JavaScript tracking snippet", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/events");
  await page.getByText("Endpoints, tracking snippets, and setup").click();
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
  await expect(page.getByText("moonarq_anonymous_id").first()).toBeVisible();
  await expect(page.getByText("moonarq_session_id").first()).toBeVisible();
  await expect(page.getByText("/api/track").first()).toBeVisible();
});

test("credential API routes save masked hints and delete credentials", async ({ request }) => {
  const cookie = await dashboardAuthCookie(request);
  const createResponse = await request.post("/api/sources", {
    headers: { cookie },
    data: {
      source_type_key: "supabase",
      display_name: "Supabase API route test",
      input_url: "https://xxxxx.supabase.co",
      normalized_url: "https://xxxxx.supabase.co",
      account_name: "xxxxx",
      sync_mode: "hybrid",
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { source } = await createResponse.json();

  const fieldsResponse = await request.get(`/api/sources/${source.id}/credentials`, { headers: { cookie } });
  expect(fieldsResponse.ok()).toBeTruthy();
  const fieldsBody = await fieldsResponse.json();
  expect(fieldsBody.fields.map((field: { key: string }) => field.key)).toContain("service_role_key");
  expect(fieldsBody.fields.map((field: { key: string }) => field.key)).not.toContain("anon_key");

  const saveResponse = await request.post(`/api/sources/${source.id}/credentials`, {
    headers: { cookie },
    data: { credentials: { service_role_key: "fake-service-role-value" } },
  });
  expect(saveResponse.ok()).toBeTruthy();
  const saveBody = await saveResponse.json();
  expect(JSON.stringify(saveBody)).not.toContain("fake-service-role-value");
  expect(saveBody.saved.find((item: { field_key: string }) => item.field_key === "service_role_key").value_hint).toBe("fake••••alue");

  const deleteResponse = await request.delete(`/api/sources/${source.id}/credentials/service_role_key`, { headers: { cookie } });
  expect(deleteResponse.ok()).toBeTruthy();
  expect((await deleteResponse.json()).deleted).toBe(true);
});

test("source detail pages show setup, credentials, actions, and website snippets", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/sources/22222222-2222-4222-8222-222222222222");
  await expect(page.getByRole("heading", { name: "MoonArq Supabase" })).toBeVisible();
  await expect(page.getByText("Connection state")).toBeVisible();
  await page.getByText("Credentials and connection settings").click();
  await expect(page.getByLabel("Service role key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Test Connection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Sync Now" })).toBeVisible();
  await page.getByText("Instructions, endpoints, and code snippets").click();
  await expect(page.getByText(/public\.profiles/).first()).toBeVisible();

  await page.goto("/w/moonarq/dashboard/sources/11111111-1111-4111-8111-111111111111");
  await expect(page.getByRole("heading", { name: "MoonArq Website / Vercel" })).toBeVisible();
  await page.getByText("Instructions, endpoints, and code snippets").click();
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
});

test("sources page supports sync controls", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/sources");
  await expect(page.getByRole("heading", { name: "MoonArq Source management" })).toBeVisible();
  const sourceContainer = page.getByTestId(
    (await page.getByTestId("source-row-22222222-2222-4222-8222-222222222222").isVisible())
      ? "source-row-22222222-2222-4222-8222-222222222222"
      : "source-card-22222222-2222-4222-8222-222222222222",
  );
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/sources/") && response.url().includes("/sync"));
  await sourceContainer.getByRole("button", { name: /^Sync$/ }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(500);
  await expect(page.getByRole("main").getByText(/Sync (success|failed)/)).toBeVisible();
});

test("mobile dashboard has no horizontal overflow", async ({ page }) => {
  await loginDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/w/moonarq/dashboard");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("overview-module-summary-website")).toBeVisible();
});
