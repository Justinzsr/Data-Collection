import { expect, settleResponsiveLayout, test } from "./test";
import { loginDashboard } from "./auth";

test.beforeEach(async ({ page }) => {
  await loginDashboard(page);
});

for (const platform of [
  { path: "ads", spend: "$340.15", impressions: "7,625", clicks: "365", label: "All clicks", campaignCount: 3 },
  { path: "chatgpt-ads", spend: "$0.00", impressions: "0", clicks: "0", label: "Ad clicks", campaignCount: 1 },
]) {
  test(`${platform.path} campaign history preserves coverage and totals across date ranges and viewport sizes`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/w/moonarq/dashboard/platforms/${platform.path}?demo_state=ads-live`);
    const history = page.getByTestId("ads-campaign-history");
    await expect(history.getByRole("heading", { name: "Campaign history", exact: true })).toBeVisible();
    await expect(history).toContainText("Sample data");
    await expect(history.getByTestId("ads-history-spend").locator("dd")).toHaveText(platform.spend);
    await expect(history.getByTestId("ads-history-impressions").locator("dd")).toHaveText(platform.impressions);
    await expect(history.getByTestId("ads-history-clicks").locator("dt")).toHaveText(platform.label);
    await expect(history.getByTestId("ads-history-clicks").locator("dd")).toHaveText(platform.clicks);
    await expect(history.getByRole("row")).toHaveCount(platform.campaignCount + 1);
    await expect(history.getByTestId("ads-history-coverage")).toContainText(/history/i);
    await expect(history).not.toContainText(/all time|lifetime/i);
    const coverage = await history.getByTestId("ads-history-coverage").textContent();

    await page.getByRole("navigation", { name: "Date range", exact: true }).getByRole("link", { name: "7 days", exact: true }).click();
    await expect(page).toHaveURL(/[?&]range=7d(?:&|$)/);
    await expect(history.getByTestId("ads-history-spend").locator("dd")).toHaveText(platform.spend);
    await expect(history.getByTestId("ads-history-coverage")).toHaveText(coverage!);

    for (const width of [1440, 1024, 768, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await settleResponsiveLayout(page);
      const geometry = await history.evaluate((section) => {
        const viewport = document.documentElement.clientWidth;
        const rect = section.getBoundingClientRect();
        const scrollRegion = section.querySelector<HTMLElement>('[data-testid="ads-history-campaigns"]')!;
        const scrollRect = scrollRegion.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - viewport,
          viewport, left: rect.left, right: rect.right,
          scrollLeft: scrollRect.left, scrollRight: scrollRect.right,
          tableHasInternalScroll: scrollRegion.scrollWidth > scrollRegion.clientWidth,
        };
      });
      expect(geometry.overflow, `${platform.path} at ${width}px`).toBeLessThanOrEqual(1);
      expect(geometry.left).toBeGreaterThanOrEqual(-1);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.scrollLeft).toBeGreaterThanOrEqual(-1);
      expect(geometry.scrollRight).toBeLessThanOrEqual(geometry.viewport + 1);
      if (width <= 390) expect(geometry.tableHasInternalScroll).toBe(true);
    }
  });
}
