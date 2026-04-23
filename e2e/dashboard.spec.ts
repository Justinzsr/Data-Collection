import { expect, test } from "@playwright/test";

test("dev bypass dashboard loads demo data", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Enter with dev bypass")).toBeVisible();
  await page.getByText("Enter with dev bypass").click();
  await expect(page.getByRole("heading", { name: "MoonArq Data Command Center" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "MoonArq Website / Vercel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cross-platform trend" })).toBeVisible();
  await expect(page.getByText("Run All Due Sources")).toBeVisible();
});

test("add source wizard detects Supabase and website", async ({ page }) => {
  await page.goto("/dashboard/sources/new");
  await page.getByLabel("Paste a MoonArq source link or identifier").fill("https://xxxxx.supabase.co");
  await page.getByRole("button", { name: /Detect/ }).click();
  await expect(page.getByText("Supabase").first()).toBeVisible();
  await expect(page.getByText(/Links identify the monitored source/)).toBeVisible();

  await page.getByLabel("Paste a MoonArq source link or identifier").fill("https://moonarqstudio.com");
  await page.getByRole("button", { name: /Detect/ }).click();
  await expect(page.getByText("MoonArq Website / Vercel").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Vercel Web Analytics Drain/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Website Tracker fallback/ })).toBeVisible();
});

test("events page shows snippets", async ({ page }) => {
  await page.goto("/dashboard/events");
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
  await expect(page.getByText("React / Next.js helper")).toBeVisible();
});
