import { expect, settleResponsiveLayout, test } from "./test";
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
    await settleResponsiveLayout(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}

for (const width of [390, 320]) {
  test(`platform cards and detail pages stay inside the ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/w/moonarq/dashboard?demo_state=ads-live");
    await expect(page.getByTestId("paid-ads-overview")).toBeVisible();
    await settleResponsiveLayout(page);
    const overview = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      return {
        overflow: document.documentElement.scrollWidth - viewportWidth,
        viewportWidth,
        cards: Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='platform-card-'], [data-testid='overview-add-platform']"))
          .map((card) => {
            const rect = card.getBoundingClientRect();
            return { left: rect.left, right: rect.right, height: rect.height };
          }),
      };
    });
    expect(overview.overflow).toBeLessThanOrEqual(1);
    expect(overview.cards).toHaveLength(6);
    expect(overview.cards.every((card) => card.left >= -1 && card.right <= overview.viewportWidth + 1 && card.height >= 44)).toBe(true);

    await page.goto("/w/moonarq/dashboard/platforms/ads");
    const paidPanel = page.getByTestId("instagram-paid-ads-panel");
    await expect(paidPanel).toBeVisible();
    await expect(paidPanel.getByText("Paid Story attribution", { exact: true })).toBeVisible();
    await expect(paidPanel.getByRole("link", { name: "Connect Meta Ads" })).toBeVisible();
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
    await settleResponsiveLayout(page);
    const ads = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const panel = document.querySelector<HTMLElement>("[data-testid='instagram-paid-ads-panel']");
      const panelRect = panel?.getBoundingClientRect() ?? null;
      const touchTargets = Array.from(document.querySelectorAll<HTMLElement>("main a, main button"))
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== "none"
            && style.visibility !== "hidden"
            && !element.closest("details:not([open])")
            && element.getClientRects().length > 0;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { label: element.textContent?.trim().slice(0, 60) ?? element.tagName, width: rect.width, height: rect.height };
        });
      return {
        overflow: document.documentElement.scrollWidth - viewportWidth,
        viewportWidth,
        panel: panelRect ? { left: panelRect.left, right: panelRect.right, overflow: panel!.scrollWidth - panel!.clientWidth } : null,
        aidmaStageRects: Array.from(document.querySelectorAll<HTMLElement>("[data-aidma-stage]")).map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        }),
        touchTargets,
      };
    });
    expect(ads.overflow).toBeLessThanOrEqual(1);
    expect(ads.panel).not.toBeNull();
    expect(ads.panel!.left).toBeGreaterThanOrEqual(-1);
    expect(ads.panel!.right).toBeLessThanOrEqual(ads.viewportWidth + 1);
    expect(ads.panel!.overflow).toBeLessThanOrEqual(1);
    expect(ads.aidmaStageRects).toHaveLength(5);
    expect(ads.aidmaStageRects.every((rect) => rect.left >= -1 && rect.right <= ads.viewportWidth + 1 && rect.width > 0)).toBe(true);
    expect(ads.touchTargets.length).toBeGreaterThanOrEqual(5);
    expect(
      ads.touchTargets.every((target) => target.width >= 40 && target.height >= 40),
      JSON.stringify(ads.touchTargets.filter((target) => target.width < 40 || target.height < 40)),
    ).toBe(true);

    await page.goto("/w/moonarq/dashboard/platforms/supabase");
    const emailMarketingLink = page.getByTestId("supabase-header").getByRole("link", { name: "Email Marketing", exact: true });
    await expect(emailMarketingLink).toHaveAttribute("href", "/w/moonarq/dashboard/supabase/email-marketing");
    await settleResponsiveLayout(page);
    const linkBox = await emailMarketingLink.boundingBox();
    expect(linkBox).not.toBeNull();
    expect(linkBox!.x).toBeGreaterThanOrEqual(-1);
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(width + 1);
    expect(linkBox!.width).toBeGreaterThanOrEqual(40);
    expect(linkBox!.height).toBeGreaterThanOrEqual(40);
  });
}

test("AIDMA stages use five columns on desktop and two columns on tablet", async ({ page }) => {
  await page.goto("/w/moonarq/dashboard/platforms/ads");
  await expect(page.getByTestId("instagram-paid-ads-panel")).toBeVisible();

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
  "/w/moonarq/dashboard/platforms/ads?demo_state=ads-live",
  "/w/moonarq/dashboard/platforms/website",
  "/w/moonarq/dashboard/platforms/shopify",
  "/w/moonarq/dashboard/platforms/whatnot",
  "/w/moonarq/dashboard/platforms/instagram",
  "/w/moonarq/dashboard/platforms/tiktok",
  "/w/moonarq/dashboard/platforms/supabase",
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
    await settleResponsiveLayout(page);
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
