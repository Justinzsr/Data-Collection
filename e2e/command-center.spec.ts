import { expect, test } from "@playwright/test";

test("dashboard shows platform modules and sparklines", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "MoonArq Data Command Center" })).toBeVisible();
  for (const label of ["Website / Vercel Site", "Supabase", "TikTok", "Instagram", "Shopify"]) {
    await expect(page.locator("article").filter({ hasText: label }).first()).toBeVisible();
  }
  await expect(page.getByTestId("platform-sparkline").first()).toBeVisible();
});

test("add source wizard detects Supabase and Website and shows credentials after save", async ({ page }) => {
  await page.goto("/dashboard/sources/new");
  await page.getByLabel("Paste a source link or identifier").fill("https://xxxxx.supabase.co");
  await page.getByRole("button", { name: "Detect" }).click();
  await expect(page.getByText("Supabase").first()).toBeVisible();
  await page.getByRole("button", { name: "Save Source" }).click();
  await expect(page.getByPlaceholder("eyJhbGciOi...").first()).toBeVisible();

  await page.goto("/dashboard/sources/new");
  await page.getByLabel("Paste a source link or identifier").fill("https://example.com");
  await page.getByRole("button", { name: "Detect" }).click();
  await expect(page.getByText("Website tracking").first()).toBeVisible();
});

test("events page shows non-empty JavaScript tracking snippet", async ({ page }) => {
  await page.goto("/dashboard/events");
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
  await expect(page.getByText("moonarq_anonymous_id").first()).toBeVisible();
});

test("sources page supports sync controls", async ({ page }) => {
  await page.goto("/dashboard/sources");
  await expect(page.getByText("Connected platform command grid")).toBeVisible();
  await page.getByRole("button", { name: /^Sync$/ }).first().click();
  await expect(page.getByText(/Sync (success|skipped)/)).toBeVisible();
});

test("mobile dashboard has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByText("Website / Vercel Site").first()).toBeVisible();
});
