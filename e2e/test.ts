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
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

export { expect };
export type {
  APIRequestContext,
  Locator,
  Page,
} from "@playwright/test";
