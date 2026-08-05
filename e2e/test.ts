import {
  expect,
  test as base,
} from "@playwright/test";

function isLoopbackBrowserRequest(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (["about:", "blob:", "data:"].includes(url.protocol)) return true;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export const test = base.extend({
  page: async ({ page }, providePage) => {
    let consoleErrorCount = 0;
    let pageErrorCount = 0;
    let nonLoopbackRequestCount = 0;

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrorCount += 1;
    });
    page.on("pageerror", () => {
      pageErrorCount += 1;
    });
    page.on("request", (request) => {
      if (!isLoopbackBrowserRequest(request.url())) nonLoopbackRequestCount += 1;
    });

    await providePage(page);

    expect(
      {
        consoleErrorCount,
        pageErrorCount,
        nonLoopbackRequestCount,
      },
      "Browser QA must remain error-free and local-only.",
    ).toEqual({
      consoleErrorCount: 0,
      pageErrorCount: 0,
      nonLoopbackRequestCount: 0,
    });
  },
});

export async function settleResponsiveLayout(page: import("@playwright/test").Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const timeoutMs = 3_000;
    const requiredStableSamples = 3;

    const sanitizeGeometry = (value: number): number | null => {
      if (!Number.isFinite(value)) return null;
      const rounded = Math.round(value * 4) / 4;
      return Object.is(rounded, -0) ? 0 : rounded;
    };
    const geometryFor = (rect: DOMRect) => {
      return {
        width: sanitizeGeometry(rect.width),
        height: sanitizeGeometry(rect.height),
        left: sanitizeGeometry(rect.left),
        right: sanitizeGeometry(rect.right),
      };
    };
    const isLayoutVisible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && style.visibility !== "collapse"
        && element.getClientRects().length > 0;
    };
    const hasPositiveDimensions = (rect: DOMRect) => (
      Number.isFinite(rect.width)
      && Number.isFinite(rect.height)
      && rect.width > 0
      && rect.height > 0
    );
    const captureSnapshot = () => {
      let chartsReady = true;
      const charts = Array.from(document.querySelectorAll<HTMLElement>(
        ".recharts-responsive-container",
      )).filter(isLayoutVisible).map((container, index) => {
        const containerRect = container.getBoundingClientRect();
        const wrapper = container.querySelector<HTMLElement>(".recharts-wrapper");
        const wrapperRect = wrapper?.getBoundingClientRect() ?? null;
        const ready = hasPositiveDimensions(containerRect)
          && wrapper !== null
          && isLayoutVisible(wrapper)
          && wrapperRect !== null
          && hasPositiveDimensions(wrapperRect)
          && Math.abs(wrapperRect.width - containerRect.width) <= 1;
        chartsReady &&= ready;

        return {
          index,
          ready,
          container: geometryFor(containerRect),
          wrapper: wrapperRect ? geometryFor(wrapperRect) : null,
        };
      });

      const bodyScrollWidth = document.body?.scrollWidth;
      const fontsReady = typeof document.fonts === "undefined"
        || document.fonts.status === "loaded";
      const documentReady = document.documentElement.clientWidth > 0
        && document.documentElement.scrollWidth > 0
        && typeof bodyScrollWidth === "number"
        && bodyScrollWidth > 0;
      return {
        fontsReady,
        eligible: fontsReady && documentReady && chartsReady,
        geometry: {
          documentClientWidth: sanitizeGeometry(document.documentElement.clientWidth),
          documentScrollWidth: sanitizeGeometry(document.documentElement.scrollWidth),
          bodyScrollWidth: sanitizeGeometry(bodyScrollWidth ?? Number.NaN),
          charts,
        },
      };
    };

    const startedAt = performance.now();
    let animationFrameId: number | null = null;
    let lastSnapshot = captureSnapshot();
    let previousEligibleGeometry: string | null = null;
    let stableSampleCount = 0;
    let settled = false;
    let timeoutId = 0;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve();
    };
    const failOnTimeout = () => {
      lastSnapshot = captureSnapshot();
      finish(new Error(
        `Responsive layout did not stabilize within ${timeoutMs}ms; final numeric geometry: ${
          JSON.stringify({
            elapsedMs: sanitizeGeometry(performance.now() - startedAt),
            stableSampleCount,
            ...lastSnapshot,
          })
        }`,
      ));
    };
    const sample = () => {
      if (settled) return;
      if (performance.now() - startedAt >= timeoutMs) {
        failOnTimeout();
        return;
      }

      lastSnapshot = captureSnapshot();
      if (!lastSnapshot.eligible) {
        previousEligibleGeometry = null;
        stableSampleCount = 0;
      } else {
        const eligibleGeometry = JSON.stringify(lastSnapshot.geometry);
        if (eligibleGeometry === previousEligibleGeometry) {
          stableSampleCount += 1;
        } else {
          previousEligibleGeometry = eligibleGeometry;
          stableSampleCount = 1;
        }
        if (stableSampleCount >= requiredStableSamples) {
          finish();
          return;
        }
      }
      animationFrameId = requestAnimationFrame(sample);
    };

    timeoutId = window.setTimeout(failOnTimeout, timeoutMs);
    animationFrameId = requestAnimationFrame(sample);
  }));
}

export { expect };
export type {
  APIRequestContext,
  Locator,
  Page,
} from "@playwright/test";
