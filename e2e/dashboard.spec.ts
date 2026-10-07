import { expect, test } from "./test";
import { loginDashboard } from "./auth";

test("dashboard login loads demo data", async ({ page }) => {
  await loginDashboard(page);
  await expect(page.getByRole("heading", { name: "MoonArq Overview" })).toBeVisible();
  await expect(page.getByTestId("paid-ads-overview")).toBeVisible();
  await expect(page.getByTestId("platform-card-website")).toContainText("Sessions");
  await expect(page.getByTestId("platform-card-supabase")).toContainText("New signups");
  await expect(page.getByTestId("overview-header").getByRole("button", { name: "Refresh" })).toBeVisible();
});

test("add source wizard detects Supabase and website", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/sources/new");
  await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
  await page.getByRole("button", { name: /Supabase/ }).click();
  await page.getByLabel("Public source URL").fill("https://xxxxx.supabase.co");
  await page.getByRole("button", { name: "Check URL" }).click();
  await expect(page.getByText("URL matches Supabase")).toBeVisible();
  await page.getByRole("button", { name: "Change platform" }).click();
  await page.getByRole("button", { name: /Website Tracker/ }).click();
  await expect(page.getByRole("button", { name: /Vercel Web Analytics Drain/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /First-party Website Tracker/ })).toBeVisible();
});

test("Xiaohongshu is visible as a non-actionable placeholder", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/sources/new");
  await page.getByRole("button", { name: /小红书 \/ Xiaohongshu/ }).click();
  await expect(page.getByText("Coming soon")).toBeVisible();
  await expect(page.getByText(/does not collect data, request credentials, test connections, or run syncs/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save source" })).toHaveCount(0);
});

test("events page shows snippets", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/events");
  await page.getByText("Endpoints, tracking snippets, and setup").click();
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
  await expect(page.getByText("React / Next.js helper")).toBeVisible();
});

test("data explorer and daily report are reachable from the dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard");
  const sidebar = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(sidebar.getByRole("link", { name: "Data Explorer" })).toHaveAttribute("href", "/w/moonarq/dashboard/data");
  await expect(sidebar.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/w/moonarq/dashboard/reports/daily");
  for (const platform of ["Meta Ads", "Website", "Shopify", "Etsy", "Whatnot", "Instagram", "TikTok", "Supabase"]) {
    await expect(sidebar.getByRole("link", { name: platform, exact: true })).toBeVisible();
  }
  await page.goto("/w/moonarq/dashboard/data");
  await expect(page.getByRole("heading", { name: "MoonArq Source Data Explorer" })).toBeVisible();
  await expect(page.getByText("Website / Vercel").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy JSON/ }).last()).toBeVisible();
  await page.goto("/w/moonarq/dashboard/reports/daily");
  await expect(page.getByRole("heading", { name: "MoonArq Daily Report" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate/ })).toBeVisible();
});

test("Auto Lab workspace is empty and isolated", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/auto-lab/dashboard");
  await expect(page.getByRole("heading", { name: "Auto Lab Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Auto Lab has no sources yet" })).toBeVisible();
  await expect(page.getByText("Use this space to test personal car/content TikTok and Instagram accounts.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add Auto Lab TikTok" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add Auto Lab Instagram" })).toBeVisible();
  await expect(page.getByTestId("paid-ads-overview")).toHaveCount(0);
  await expect(page.locator("[data-testid^='platform-card-']")).toHaveCount(0);
  const sidebar = page.getByRole("navigation", { name: "Primary navigation" });
  if (await sidebar.isVisible()) {
    await expect(sidebar.getByRole("link", { name: "Meta Ads", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Instagram", exact: true })).toHaveAttribute("href", "/w/auto-lab/dashboard/platforms/instagram");
  }
});

test("settings preserves the selected workspace", async ({ page }) => {
  await loginDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/w/auto-lab/dashboard/settings");
  await expect(page).toHaveURL(/\/w\/auto-lab\/dashboard\/settings$/);
  await expect(page.getByRole("heading", { name: "Auto Lab settings" })).toBeVisible();
  await page.getByLabel("Open navigation").click();
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await page.locator("#mobile-workspace-options").getByRole("link", { name: /MoonArq/ }).click();
  await expect(page).toHaveURL(/\/w\/moonarq\/dashboard\/settings$/);
  await expect(page.getByRole("heading", { name: "MoonArq settings" })).toBeVisible();
});

test("mobile sync history keeps older runs collapsed", async ({ page }) => {
  await loginDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/w/moonarq/dashboard/sync");
  const olderRuns = page.locator("details").filter({ hasText: /older runs/ });
  await expect(olderRuns).toBeVisible();
  await expect(olderRuns).toHaveJSProperty("open", false);
});
