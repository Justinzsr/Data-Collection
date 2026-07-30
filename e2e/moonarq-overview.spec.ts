import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { dashboardAuthCookie, loginDashboard } from "./auth";

const overviewViewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
  { width: 360, height: 780 },
  { width: 320, height: 740 },
] as const;

function monitorBrowserErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

async function settleResponsiveLayout(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function expectVisibleFocus(locator: Locator) {
  await locator.focus();
  await expect(locator).toBeFocused();
  const paintsFocus = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const hasOutline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    return hasOutline || (style.boxShadow !== "none" && style.boxShadow.length > 0);
  });
  expect(paintsFocus).toBe(true);
}

async function assertDeterministicDemoRuntime(request: APIRequestContext) {
  const cookie = await dashboardAuthCookie(request);
  const response = await request.get("/api/sources?dataSpaceSlug=moonarq", {
    headers: { cookie },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as {
    sources?: Array<{
      source_type_key?: unknown;
      metadata?: Record<string, unknown>;
    }>;
  };
  const isDemoRuntime = Array.isArray(body.sources)
    && body.sources.length > 0
    && body.sources.every((source) => source.metadata?.demo === true);
  expect(
    isDemoRuntime,
    "Overview browser QA requires the deterministic local demo runtime.",
  ).toBe(true);
  const websiteSourceCount = body.sources?.filter(
    (source) => source.source_type_key === "website",
  ).length;
  expect(
    websiteSourceCount,
    "Overview browser QA requires exactly one deterministic Website source.",
  ).toBe(1);
}

test.beforeEach(async ({ page, request }) => {
  await assertDeterministicDemoRuntime(request);
  await loginDashboard(page);
});

test("MoonArq Overview remains readable without page overflow at every required viewport", async ({ page }) => {
  const errors = monitorBrowserErrors(page);

  for (const viewport of overviewViewports) {
    await test.step(`${viewport.width}px Overview layout`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("/w/moonarq/dashboard?demo_state=populated");
      await expect(page.getByRole("heading", { name: "MoonArq Overview" })).toBeVisible();
      await expect(page.getByTestId("business-pulse")).toBeVisible();
      await expect(page.getByTestId("storefront-funnel")).toBeVisible();
      await expect(page.getByTestId("storefront-conversion-trend")).toBeVisible();
      await settleResponsiveLayout(page);

      const layout = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const stageRects = Array.from(document.querySelectorAll<HTMLElement>("[data-funnel-stage]")).map((stage) => {
          const rect = stage.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            labelSize: Number.parseFloat(getComputedStyle(stage.querySelector("p") ?? stage).fontSize),
            hasPersistentValues: ["From previous", "Drop-off", "Raw events", "Period change"]
              .every((label) => stage.textContent?.includes(label)),
          };
        });
        const chart = document.querySelector<HTMLElement>(
          "[data-testid='storefront-conversion-trend'] [data-overview-chart='true']",
        );
        const chartRect = chart?.getBoundingClientRect() ?? null;
        return {
          overflow: document.documentElement.scrollWidth - viewportWidth,
          viewportWidth,
          pulseCards: document.querySelectorAll("[data-testid^='business-pulse-']").length,
          stageRects,
          chartRect: chartRect
            ? { left: chartRect.left, right: chartRect.right, width: chartRect.width, height: chartRect.height }
            : null,
        };
      });

      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.pulseCards).toBe(5);
      expect(layout.stageRects).toHaveLength(4);
      expect(layout.stageRects.every((stage) =>
        stage.left >= -1
        && stage.right <= layout.viewportWidth + 1
        && stage.width >= Math.min(240, layout.viewportWidth - 64)
        && stage.labelSize >= 14
        && stage.hasPersistentValues,
      )).toBe(true);
      expect(layout.chartRect).not.toBeNull();
      expect(layout.chartRect!.left).toBeGreaterThanOrEqual(-1);
      expect(layout.chartRect!.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(layout.chartRect!.width).toBeGreaterThanOrEqual(Math.min(220, layout.viewportWidth - 64));
      expect(layout.chartRect!.height).toBeGreaterThanOrEqual(240);
      await expect(page.getByText("Selected period — solid")).toBeVisible();
      await expect(page.getByText("Previous period — dashed")).toBeVisible();
      await expect(page.getByText("View daily values", { exact: true })).toBeVisible();

      if (viewport.width <= 390) {
        const dailyValues = page.getByTestId("storefront-trend-table");
        await dailyValues.locator("summary").click();
        await expect(dailyValues).toHaveJSProperty("open", true);
        await settleResponsiveLayout(page);
        const expandedOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(expandedOverflow).toBeLessThanOrEqual(1);
      }
    });
  }

  expect(errors.consoleErrors, errors.consoleErrors.join("\n")).toEqual([]);
  expect(errors.pageErrors, errors.pageErrors.join("\n")).toEqual([]);
});

test("Overview controls, filters, and disclosures work from the keyboard with visible focus", async ({ page }) => {
  const errors = monitorBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/w/moonarq/dashboard?demo_state=populated");

  const sevenDays = page.getByRole("link", { name: "7 days", exact: true });
  await expectVisibleFocus(sevenDays);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]range=7d(?:&|$)/);

  const addToCartTrend = page.getByRole("link", { name: "Add-to-cart sessions", exact: true });
  await expectVisibleFocus(addToCartTrend);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]trend=add_to_cart(?:&|$)/);

  const journeySegment = page.getByLabel("Journey segment");
  await journeySegment.scrollIntoViewIfNeeded();
  await expectVisibleFocus(journeySegment);
  await journeySegment.selectOption("ready-made");
  const applyFilters = page.getByRole("button", { name: "Apply filters" });
  await expectVisibleFocus(applyFilters);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]segment=ready-made(?:&|$)/);
  await expect(page).toHaveURL(/[?&]range=7d(?:&|$)/);
  await expect(page).toHaveURL(/[?&]trend=add_to_cart(?:&|$)/);

  const dailyValues = page.getByTestId("storefront-trend-table");
  const dailyValuesSummary = dailyValues.locator("summary");
  await expectVisibleFocus(dailyValuesSummary);
  await page.keyboard.press("Enter");
  await expect(dailyValues).toHaveJSProperty("open", true);
  await expect(dailyValues.getByRole("columnheader", { name: "Selected period" })).toBeVisible();
  await expect(dailyValues.getByRole("columnheader", { name: "Previous period" })).toBeVisible();

  const quality = page.getByTestId("storefront-quality");
  const qualitySummary = quality.locator("summary");
  await expectVisibleFocus(qualitySummary);
  await page.keyboard.press("Enter");
  await expect(quality).toHaveJSProperty("open", true);
  await expect(quality.getByText("Sequence policy", { exact: true })).toBeVisible();

  const touchTargets = await page.evaluate(() => {
    const selectors = [
      "[data-testid='dashboard-overview'] a",
      "[data-testid='dashboard-overview'] button",
      "[data-testid='storefront-conversion-trend'] a",
      "[data-testid='storefront-trend-table'] > summary",
      "form[action='/w/moonarq/dashboard'] button",
      "form[action='/w/moonarq/dashboard'] a",
      "form[action='/w/moonarq/dashboard'] select",
      "[data-testid='storefront-quality'] > summary",
      "[data-testid='dashboard-data-stage'] a",
      "[data-testid='dashboard-data-stage'] button",
      "[data-testid='daily-report-module'] a",
      "[data-testid='more-integrations'] a",
    ];
    return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")))
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none"
          && style.visibility !== "hidden"
          && !element.closest("details:not([open])")
          && element.getClientRects().length > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 80) ?? element.tagName,
          width: rect.width,
          height: rect.height,
        };
      });
  });

  expect(touchTargets.length).toBeGreaterThan(10);
  expect(
    touchTargets.every((target) => target.width >= 40 && target.height >= 40),
    JSON.stringify(touchTargets.filter((target) => target.width < 40 || target.height < 40)),
  ).toBe(true);
  expect(errors.consoleErrors, errors.consoleErrors.join("\n")).toEqual([]);
  expect(errors.pageErrors, errors.pageErrors.join("\n")).toEqual([]);
});

test("funnel and trend values have persistent text equivalents without hover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/w/moonarq/dashboard?demo_state=populated");

  const funnel = page.getByTestId("storefront-funnel");
  await expect(funnel.locator("[data-funnel-stage]")).toHaveCount(4);
  for (const label of ["From previous", "Drop-off", "Raw events", "Period change"]) {
    await expect(funnel.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(funnel).toContainText(
    "First-party session funnel; ends at checkout started. Orders and revenue are reported separately by Shopify.",
  );

  const trend = page.getByTestId("storefront-conversion-trend");
  await expect(trend.getByText("Selected period — solid")).toBeVisible();
  await expect(trend.getByText("Previous period — dashed")).toBeVisible();
  const dailyValues = page.getByTestId("storefront-trend-table");
  await dailyValues.locator("summary").click();
  await expect(dailyValues.getByRole("table")).toBeVisible();
  expect(await dailyValues.locator("tbody tr").count()).toBeGreaterThan(0);
});

test("empty and low-volume states remain explicit and readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/w/moonarq/dashboard?demo_state=empty");
  await expect(page.getByText("No tracked Website events in this period.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("storefront-funnel")).not.toContainText("Limited data — rates are directional.");

  await page.goto("/w/moonarq/dashboard?demo_state=low-volume");
  await expect(page.getByText("Limited data — rates are directional.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("storefront-funnel").locator("[data-funnel-stage]")).toHaveCount(4);

  for (const state of ["empty", "low-volume"]) {
    await page.goto(`/w/moonarq/dashboard?demo_state=${state}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("builder commerce remains explicitly unmeasured across the Overview", async ({ page }) => {
  await page.goto("/w/moonarq/dashboard?segment=builder&trend=checkout");

  await expect(page.getByText("Builder cart and checkout trends are not measured.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("business-pulse-add_to_cart")).toContainText("Not measured");
  await expect(page.getByTestId("business-pulse-begin_checkout")).toContainText("Not measured");
  await expect(page.getByTestId("storefront-funnel").locator("[data-funnel-stage='add_to_cart']")).toContainText("Not measured");
});
