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

    await expect(page.getByTestId("business-pulse")).toBeVisible();
    await expect(page.getByTestId("storefront-funnel")).toBeVisible();
    await expect(page.getByTestId("storefront-conversion-trend")).toBeVisible();
    await expect(page.getByTestId("commerce-outcomes")).toBeVisible();

    for (const type of ["supabase", "tiktok", "instagram"]) {
      await page.getByTestId(`overview-module-summary-${type}`).click();
      await expect(page.getByTestId(`overview-module-${type}`)).toHaveJSProperty("open", true);
    }

    const instagram = page.locator("details.overview-social-card").filter({
      has: page.getByText("Instagram Graph API", { exact: true }),
    });
    await instagram.locator("summary").first().click();
    await expect(instagram).toHaveJSProperty("open", true);
    await instagram.getByText("Organic account & media details", { exact: true }).click();

    const tiktok = page.locator("details.overview-social-card").filter({
      has: page.getByText("TikTok official API", { exact: true }),
    });
    await tiktok.locator("summary").first().click();
    await expect(tiktok).toHaveJSProperty("open", true);

    const paidPanel = page.getByTestId("instagram-paid-ads-panel");
    await expect(paidPanel).toBeVisible();
    await expect(paidPanel.getByText("Paid Story attribution", { exact: true })).toBeVisible();
    await expect(paidPanel.getByText("Connect Ads", { exact: true })).toBeVisible();
    await expect(paidPanel.getByRole("link", { name: "Connect Meta Ads" })).toBeVisible();
    await expect(paidPanel.getByText(
      "utm_source=instagram&utm_medium=paid_social&utm_campaign=bracelet_grid_jul2026&utm_content=story_v1",
      { exact: true },
    )).toBeVisible();

    for (const testId of [
      "paid-raw-efficiency",
      "paid-budget-pacing",
      "paid-memory-economics",
      "paid-attribution-reconciliation",
      "paid-creative-diagnostics",
    ]) {
      const detail = paidPanel.getByTestId(testId);
      await detail.locator("summary").click();
      await expect(detail).toHaveJSProperty("open", true);
    }

    const layout = await page.evaluate(() => {
      const socialRoot = document.querySelector<HTMLElement>("[data-testid='social-platform-detail-modules']");
      const socialTouchTargets = socialRoot
        ? Array.from(socialRoot.querySelectorAll<HTMLElement>("a,button"))
          .filter((element) => {
            const style = getComputedStyle(element);
            return style.display !== "none"
              && style.visibility !== "hidden"
              && !element.closest("details:not([open])")
              && element.getClientRects().length > 0;
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })
        : [];
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        chartRights: Array.from(document.querySelectorAll<HTMLElement>("[data-overview-chart='true']")).map((element) => element.getBoundingClientRect().right),
        paidPanel: (() => {
          const element = document.querySelector<HTMLElement>("[data-testid='instagram-paid-ads-panel']");
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            overflow: element.scrollWidth - element.clientWidth,
          };
        })(),
        aidmaStageRects: Array.from(document.querySelectorAll<HTMLElement>("[data-aidma-stage]")).map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        }),
        socialTouchTargets,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.chartRights.every((right) => right <= layout.viewportWidth + 1)).toBe(true);
    expect(layout.paidPanel).not.toBeNull();
    expect(layout.paidPanel!.left).toBeGreaterThanOrEqual(-1);
    expect(layout.paidPanel!.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.paidPanel!.overflow).toBeLessThanOrEqual(1);
    expect(layout.aidmaStageRects).toHaveLength(5);
    expect(layout.aidmaStageRects.every((rect) => rect.left >= -1 && rect.right <= layout.viewportWidth + 1 && rect.width > 0)).toBe(true);
    expect(layout.socialTouchTargets.length).toBeGreaterThanOrEqual(5);
    expect(
      layout.socialTouchTargets.every((target) => target.width >= 40 && target.height >= 40),
    ).toBe(true);
  });
}

test("AIDMA stages use five columns on desktop and two columns on tablet", async ({ page }) => {
  await page.goto("/w/moonarq/dashboard");
  const instagram = page.locator("details.overview-social-card").filter({
    has: page.getByText("Instagram Graph API", { exact: true }),
  });
  await instagram.locator("summary").first().click();

  for (const expectation of [
    { width: 1440, columns: 5 },
    { width: 1024, columns: 2 },
    { width: 768, columns: 2 },
  ]) {
    await page.setViewportSize({ width: expectation.width, height: 900 });
    const tops = await page.locator("[data-aidma-stage]").evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().top)),
    );
    expect(new Set(tops.slice(0, expectation.columns)).size).toBe(1);
    if (expectation.columns < 5) expect(tops[expectation.columns]).toBeGreaterThan(tops[0]);
    else expect(new Set(tops).size).toBe(1);
  }
});

for (const path of [
  "/w/moonarq/dashboard/sources",
  "/w/moonarq/dashboard/sources/new",
  "/w/moonarq/dashboard/events",
  "/w/moonarq/dashboard/content",
  "/w/moonarq/dashboard/commerce",
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
