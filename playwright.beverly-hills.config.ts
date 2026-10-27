import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/beverly-hills-2d",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 180_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5188",
    timezoneId: "America/Los_Angeles",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command:
      "VITE_ADMIN_VISUAL_TEST=1 pnpm exec vite --host 127.0.0.1 --port 5188",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
