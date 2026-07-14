import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const E2E_DASHBOARD_PASSWORD = "e2e-dashboard-password";

export async function loginDashboard(page: Page) {
  await page.goto("/login");

  const devBypass = page.getByText("Enter with dev bypass");
  if (await devBypass.isVisible({ timeout: 800 }).catch(() => false)) {
    await devBypass.click();
  } else {
    await page.getByLabel("Admin password").fill(E2E_DASHBOARD_PASSWORD);
    await page.getByRole("button", { name: "Enter command center" }).click();
  }

  await expect(page).toHaveURL(/\/w\/moonarq\/dashboard(?:\?.*)?$/);
  await expect(page.getByTestId("dashboard-overview")).toBeVisible();
}

export async function dashboardAuthCookie(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", {
    form: {
      password: E2E_DASHBOARD_PASSWORD,
      next: "/dashboard",
    },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);

  const cookie = response.headers()["set-cookie"]?.split(";")[0] ?? "";
  expect(cookie).toContain("moonarq_dashboard");
  return cookie;
}
