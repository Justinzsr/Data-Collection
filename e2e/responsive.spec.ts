import { expect, test } from "@playwright/test";
import { loginDashboard } from "./auth";

test.beforeEach(async ({ page }) => {
  await loginDashboard(page);
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
  { width: 360, height: 780 },
  { width: 320, height: 740 },
]) {
  test(`dashboard has no horizontal overflow at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/w/moonarq/dashboard");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}

for (const width of [390, 320]) {
  test(`expanded dashboard modules stay inside the ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/w/moonarq/dashboard");

    for (const type of ["website", "supabase", "tiktok", "instagram"]) {
      await page.getByTestId(`overview-module-summary-${type}`).click();
      await expect(page.getByTestId(`overview-module-${type}`)).toHaveJSProperty("open", true);
    }

    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chartRights: Array.from(document.querySelectorAll<HTMLElement>("[data-overview-chart='true']")).map((element) => element.getBoundingClientRect().right),
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.chartRights.every((right) => right <= layout.viewportWidth + 1)).toBe(true);
  });
}

for (const path of [
  "/w/moonarq/dashboard/sources",
  "/w/moonarq/dashboard/sources/new",
  "/w/moonarq/dashboard/events",
  "/w/moonarq/dashboard/content",
  "/w/moonarq/dashboard/sync",
  "/w/moonarq/dashboard/data",
  "/w/moonarq/dashboard/reports/daily",
  "/w/moonarq/dashboard/sources/22222222-2222-4222-8222-222222222222",
  "/w/auto-lab/dashboard",
  "/settings",
]) {
  test(`${path} has no horizontal overflow on narrow mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}

test("mobile navigation opens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/w/moonarq/dashboard");
  await page.getByLabel("Open navigation").click();
  await expect(page.getByRole("link", { name: "Sync Center" }).last()).toBeVisible();
});
