import {
  expect,
  settleResponsiveLayout,
  test,
  type APIRequestContext,
  type Locator,
} from "./test";
import { dashboardAuthCookie, loginDashboard } from "./auth";

const overviewViewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
  { width: 360, height: 780 },
  { width: 320, height: 740 },
] as const;

const longAcquisitionValues = {
  utmSource: "partner_social_channel_with_an_intentionally_long_but_safe_name",
  utmMedium: "community_collaboration_and_editorial_referral",
  utmCampaign: "moonlit_studio_launch_with_complete_persistent_acquisition_context",
  landingPath: "/collections/moonlit-studio-launch/complete-persistent-acquisition-context",
  referrerHost: "editorial-partnership-long-reference.example.invalid",
} as const;

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
  for (const viewport of overviewViewports) {
    await test.step(`${viewport.width}px Overview layout`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("/w/moonarq/dashboard?demo_state=long-values");
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
      const acquisitionValues = Object.values(longAcquisitionValues);
      const visibleAcquisition = viewport.width >= 1024
        ? page.getByRole("region", { name: "Scrollable acquisition performance table" })
        : page.locator("[data-acquisition-mobile-row]").first();
      await expect(visibleAcquisition).toBeVisible();
      for (const value of acquisitionValues) {
        await expect(visibleAcquisition).toContainText(value);
      }
      await expect(page.getByTestId("commerce-outcomes").locator("dl")).toHaveCount(0);

      const acquisitionBounds = await page.getByTestId("acquisition-performance").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      expect(acquisitionBounds.left).toBeGreaterThanOrEqual(-1);
      expect(acquisitionBounds.right).toBeLessThanOrEqual(viewport.width + 1);

      const primaryTrendControl = page.getByRole("link", { name: "Website sessions", exact: true });
      await expectVisibleFocus(primaryTrendControl);

      const requiredTouchTargets = await page.locator(
        "[data-testid='storefront-conversion-trend'] a, "
        + "[data-testid='storefront-trend-table'] > summary, "
        + "form[action='/w/moonarq/dashboard'] button",
      ).evaluateAll((elements) => elements
        .filter((element) => {
          const candidate = element as HTMLElement;
          const style = getComputedStyle(candidate);
          return style.display !== "none" && style.visibility !== "hidden" && candidate.getClientRects().length > 0;
        })
        .map((element) => {
          const rect = (element as HTMLElement).getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }));
      expect(requiredTouchTargets.length).toBeGreaterThan(5);
      expect(requiredTouchTargets.every((target) => target.width >= 40 && target.height >= 40)).toBe(true);

      if (viewport.width <= 390) {
        const acquisition = page.getByTestId("acquisition-performance");
        await expect(acquisition.locator("dt", { hasText: "Referrer" }).first()).toBeVisible();
        await expect(acquisition.locator("dt", { hasText: "Product intent" }).first()).toBeVisible();
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

});

test("comparison rendering matches available, off, and unavailable states", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/w/moonarq/dashboard?demo_state=populated");
  const availableTrend = page.getByTestId("storefront-conversion-trend");
  await expect(availableTrend.getByText("Selected period — solid")).toBeVisible();
  await expect(availableTrend.getByText("Previous period — dashed")).toBeVisible();
  await expect(availableTrend.locator(".recharts-line-curve")).toHaveCount(2);
  await availableTrend.getByTestId("storefront-trend-table").locator("summary").click();
  await expect(availableTrend.getByRole("columnheader", { name: "Previous period" })).toBeVisible();

  await page.goto("/w/moonarq/dashboard?compare=off");
  const offTrend = page.getByTestId("storefront-conversion-trend");
  await expect(offTrend.getByText("Selected period — solid")).toBeVisible();
  await expect(offTrend.getByText("Previous period — dashed")).toHaveCount(0);
  await expect(offTrend.locator(".recharts-line-curve")).toHaveCount(1);
  await expect(offTrend.getByText("Comparison off.", { exact: true })).toBeVisible();
  await offTrend.getByTestId("storefront-trend-table").locator("summary").click();
  await expect(offTrend.getByRole("columnheader", { name: "Previous period" })).toHaveCount(0);
  await expect(page.getByTestId("dashboard-overview")).not.toContainText("— vs previous");

  await page.goto("/w/moonarq/dashboard?demo_state=comparison-unavailable");
  const unavailableTrend = page.getByTestId("storefront-conversion-trend");
  await expect(unavailableTrend.getByText("Previous period — dashed")).toHaveCount(0);
  await expect(unavailableTrend.locator(".recharts-line-curve")).toHaveCount(1);
  await expect(unavailableTrend.locator("[data-comparison-state='unavailable']")).toHaveCount(1);
  await expect(unavailableTrend).toContainText(
    "Comparison unavailable — Deterministic local fixture: previous-period coverage is unavailable.",
  );
});

test("Shopify availability never disguises unavailable data as zero", async ({ page }) => {
  await page.goto("/w/moonarq/dashboard?demo_state=shopify-awaiting");
  const awaiting = page.getByTestId("commerce-outcomes");
  await expect(awaiting.getByText("Shopify is awaiting its first successful sync.", { exact: true })).toBeVisible();
  await expect(awaiting.locator("dl")).toHaveCount(0);
  await expect(awaiting).not.toContainText("$0.00");

  await page.goto("/w/moonarq/dashboard?demo_state=shopify-zero");
  const readyZero = page.getByTestId("commerce-outcomes");
  await expect(readyZero.locator("dl")).toBeVisible();
  await expect(readyZero.getByText("Selected range: Last 30 days", { exact: true })).toBeVisible();
  await expect(readyZero.getByText(/^Data through:/u)).toBeVisible();
  await expect(readyZero.getByText(
    "No Shopify orders were recorded in the selected period.",
    { exact: true },
  )).toBeVisible();
});

test("acquisition tables and disclosures retain keyboard access", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/w/moonarq/dashboard?demo_state=long-values");

  for (const name of [
    "Scrollable collection performance table",
    "Scrollable product performance table",
    "Scrollable acquisition performance table",
  ]) {
    await expectVisibleFocus(page.getByRole("region", { name }));
  }

  for (const testId of ["storefront-trend-table", "storefront-quality"]) {
    const disclosure = page.getByTestId(testId);
    await expectVisibleFocus(disclosure.locator("summary"));
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveJSProperty("open", true);
  }
});

test("unsafe acquisition query values are not reflected into rendered controls", async ({ page }) => {
  const unsafeFilter = [
    "private",
    "-person",
    "%2540",
    "example.invalid",
  ].join("");
  await page.goto(`/w/moonarq/dashboard?range=7d&utm_campaign=${encodeURIComponent(unsafeFilter)}`);

  const reflected = await page.locator("body").evaluate(
    (body, candidate) => body.textContent?.includes(candidate) ?? false,
    unsafeFilter,
  );
  const finalUrl = new URL(page.url());
  expect(reflected).toBe(false);
  expect(finalUrl.searchParams.get("range")).toBe("7d");
  expect(finalUrl.searchParams.has("utm_campaign")).toBe(false);
  await expect(page.getByLabel("UTM campaign")).toHaveValue("");
});

test("Overview muted text, chart ticks, and funnel bars meet contrast requirements", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/w/moonarq/dashboard?demo_state=long-values");
  await expect(page.getByTestId("storefront-conversion-trend").locator(".recharts-cartesian-axis-tick-value").first()).toBeVisible();

  const contrast = await page.evaluate(() => {
    type Color = [number, number, number, number];

    const parseRgbColor = (value: string): Color => {
      const channels = value.match(/[0-9.]+/gu)?.map(Number) ?? [];
      if (channels.length < 3) throw new Error("Unable to parse computed color.");
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const parseColor = (value: string): Color => {
      if (/^rgba?\(/u.test(value)) return parseRgbColor(value);
      const probe = document.createElement("span");
      probe.style.color = value;
      probe.style.position = "fixed";
      probe.style.visibility = "hidden";
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return parseRgbColor(resolved);
    };
    const colorFunctions = (value: string) =>
      value.match(/(?:rgba?|hsla?|lab|lch|oklab|oklch)\([^)]*\)/gu) ?? [];
    const composite = (foreground: Color, background: Color): Color => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      return [
        (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
      ];
    };
    const luminance = (color: Color) => {
      const linear = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const ratio = (left: Color, right: Color) => {
      const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const gradientColors = (element: Element) => {
      const body = parseColor(getComputedStyle(document.body).backgroundColor);
      const gradient = getComputedStyle(element).backgroundImage;
      const stops = colorFunctions(gradient).map(parseColor);
      return stops.length > 0 ? stops.map((stop) => composite(stop, body)) : [body];
    };
    const minimum = (values: number[]) => Math.min(...values);

    const mutedText = [...document.querySelectorAll<HTMLElement>("[class*='text-[var(--muted)]']")];
    const textRatios = mutedText.flatMap((element) => {
      const panel = element.closest(".glass") ?? document.body;
      const foreground = parseColor(getComputedStyle(element).color);
      return gradientColors(panel).map((background) => ratio(foreground, background));
    });

    const chart = document.querySelector<HTMLElement>("[data-testid='storefront-conversion-trend'] [role='group']");
    const chartBackgrounds = gradientColors(chart?.closest(".glass") ?? document.body)
      .map((background) => chart
        ? composite(parseColor(getComputedStyle(chart).backgroundColor), background)
        : background);
    const tickRatios = [...document.querySelectorAll<SVGElement>(
      "[data-testid='storefront-conversion-trend'] .recharts-cartesian-axis-tick-value",
    )]
      .flatMap((tick) => {
        const foreground = parseColor(getComputedStyle(tick).fill);
        return chartBackgrounds.map((background) => ratio(foreground, background));
      });

    const funnelBar = document.querySelector<HTMLElement>("[data-funnel-bar]");
    const funnelTrack = funnelBar?.parentElement;
    const panelBackgrounds = gradientColors(funnelBar?.closest(".glass") ?? document.body);
    const trackBackgrounds = panelBackgrounds.map((background) => funnelTrack
      ? composite(parseColor(getComputedStyle(funnelTrack).backgroundColor), background)
      : background);
    const barStops = funnelBar
      ? colorFunctions(getComputedStyle(funnelBar).backgroundImage).map(parseColor)
      : [];
    const barRatios = barStops.flatMap((foreground) =>
      trackBackgrounds.map((background) => ratio(foreground, background)));

    return {
      mutedTextCount: mutedText.length,
      chartTickCount: tickRatios.length,
      funnelBarStopCount: barStops.length,
      minimumMutedTextRatio: minimum(textRatios),
      minimumChartTickRatio: minimum(tickRatios),
      minimumFunnelBarRatio: minimum(barRatios),
    };
  });

  expect(contrast.mutedTextCount).toBeGreaterThan(10);
  expect(contrast.chartTickCount).toBeGreaterThan(0);
  expect(contrast.funnelBarStopCount).toBeGreaterThanOrEqual(2);
  expect(contrast.minimumMutedTextRatio).toBeGreaterThanOrEqual(4.5);
  expect(contrast.minimumChartTickRatio).toBeGreaterThanOrEqual(4.5);
  expect(contrast.minimumFunnelBarRatio).toBeGreaterThanOrEqual(3);
});

test("Overview controls, filters, and disclosures work from the keyboard with visible focus", async ({ page }) => {
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
    await settleResponsiveLayout(page);
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
