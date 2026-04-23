import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm exec next dev -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    env: {
      DEV_AUTH_BYPASS: "true",
      APP_ENCRYPTION_KEY: "test-key-32-bytes-long-for-aes!!",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } } },
  ],
});
