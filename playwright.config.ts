import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:4000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:4000",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    env: {
      APP_ENCRYPTION_KEY: "test-key-32-bytes-long-for-aes!!",
      DASHBOARD_ADMIN_PASSWORD: "e2e-dashboard-password",
      DASHBOARD_SESSION_SECRET: "e2e-dashboard-session-secret-32-bytes",
      NEXT_PUBLIC_APP_URL: "http://localhost:4000",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } } },
  ],
});
