import { expect, test } from "@playwright/test";

test("dev bypass dashboard loads demo data", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Enter with dev bypass")).toBeVisible();
  await page.getByText("Enter with dev bypass").click();
  await expect(page.getByRole("heading", { name: "MoonArq Data Command Center" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connected platform command grid" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cross-platform trend" })).toBeVisible();
  await expect(page.getByText("Run All Due Sources")).toBeVisible();
});

test("add source wizard detects Supabase and website", async ({ page }) => {
  await page.goto("/dashboard/sources/new");
  await page.getByPlaceholder("https://xxxxx.supabase.co").fill("https://xxxxx.supabase.co");
  await page.getByRole("button", { name: /Detect/ }).click();
  await expect(page.getByText("Supabase").first()).toBeVisible();
  await expect(page.getByText(/Links identify the source/)).toBeVisible();

  await page.getByPlaceholder("https://xxxxx.supabase.co").fill("https://example.com");
  await page.getByRole("button", { name: /Detect/ }).click();
  await expect(page.getByText("Website tracking").first()).toBeVisible();
});

test("events page shows snippets", async ({ page }) => {
  await page.goto("/dashboard/events");
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
  await expect(page.getByText("React / Next.js helper")).toBeVisible();
});
