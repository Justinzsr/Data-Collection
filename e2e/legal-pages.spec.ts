import { expect, test } from "./test";

const legalPages = [
  {
    path: "/privacy",
    heading: "Privacy Policy",
    text: "private analytics and data hub",
  },
  {
    path: "/terms",
    heading: "Terms of Service",
    text: "private and internal analytics dashboard",
  },
  {
    path: "/data-deletion",
    heading: "User Data Deletion Instructions",
    text: "Data deletion request - Auto Lab IS350",
  },
];

const blockedSecretMarkers = [
  "service_role",
  "APP_ENCRYPTION_KEY",
  "CRON_SECRET",
  "drain secret",
  "access token",
];

for (const legalPage of legalPages) {
  test(`${legalPage.path} is public and contains no secret markers`, async ({ page }) => {
    const response = await page.goto(legalPage.path);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(legalPage.path);
    await expect(page.getByRole("heading", { name: legalPage.heading })).toBeVisible();
    await expect(page.getByText(legalPage.text).first()).toBeVisible();

    const content = await page.content();
    expect(content).not.toContain("/login?next=");
    for (const marker of blockedSecretMarkers) {
      expect(content.toLowerCase()).not.toContain(marker.toLowerCase());
    }
  });
}
