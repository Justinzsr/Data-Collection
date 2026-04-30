import { expect, test } from "@playwright/test";
import { loginDashboard } from "./auth";

test("dashboard login loads demo data", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Admin password").fill("e2e-dashboard-password");
  await page.getByRole("button", { name: "Enter command center" }).click();
  await expect(page.getByRole("heading", { name: "MoonArq Data Command Center" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "MoonArq Website / Vercel" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cross-platform trend" })).toBeVisible();
  await expect(page.getByText("Run All Due Sources")).toBeVisible();
});

test("add source wizard detects Supabase and website", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/dashboard/sources/new");
  await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
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
  await loginDashboard(page);
  await page.goto("/dashboard/events");
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
  await expect(page.getByText("React / Next.js helper")).toBeVisible();
});

test("data explorer and daily report are reachable from the dashboard", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /Open Report/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Explore Data/ })).toBeVisible();
  await page.goto("/dashboard/data");
  await expect(page.getByRole("heading", { name: "Source Data Explorer" })).toBeVisible();
  await expect(page.getByText("Website / Vercel").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy JSON/ }).last()).toBeVisible();
  await page.goto("/dashboard/reports/daily");
  await expect(page.getByRole("heading", { name: "MoonArq Daily Report" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate/ })).toBeVisible();
});
